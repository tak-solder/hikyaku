import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { AskSettings, ConductorConfig } from "../scripts/lib/conductor.mts";
import {
  ASK_IDS,
  checkConductorAsks,
  collectTags,
  DEFAULT_CONDUCTOR,
  defaultAllowedTools,
  judgePr,
  lintTags,
  parseFinalText,
  parseResultJson,
  resolveAllAsks,
  resolveAsk,
  settingsDigest,
  shellQuote,
} from "../scripts/lib/conductor.mts";
import { pluginRoot } from "../scripts/lib/paths.mts";
import { parsePrReviewState, parsePrView } from "../scripts/lib/github.mts";
import { planReviewers, skipTargetOf, type ReviewerInput } from "../scripts/lib/reviewers.mts";
import { cli, snapshot, succeeds, testEnvironment, workspace, write } from "./helpers.mts";

const settings: AskSettings = {
  gates: { userStories: true, codebaseSurvey: false, designChoice: true, architecture: true, plan: false },
  reviews: {
    userStories: true, architecture: true, tasklist: true, plan: true, testSpec: true, code: true,
    security: "recommended", retrospective: "auto", validate: "manual",
  },
};

function conductor(overrides: Partial<ConductorConfig> = {}): ConductorConfig {
  return { ...DEFAULT_CONDUCTOR, ...overrides };
}

function git(directory: string, ...args: string[]): string {
  const run = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

/** conductor asks が返す digest。launch / parse に渡す */
function digest(directory: string): string {
  return JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json")).digest;
}

function result(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result", subtype: "success", is_error: false, result: text,
    session_id: "s-1", total_cost_usd: 1.5, ...extra,
  });
}

test("conductor: 既定では同意ゲートを監督に、障害・中止・分類できない問いを人間に振り分ける", () => {
  const handlers = Object.fromEntries(resolveAllAsks(conductor(), settings).map((ask) => [ask.id, ask.handler]));
  for (const id of ["cycle", "branch", "G3", "G6", "G8", "G10", "questions", "review-findings", "docs-link"]) {
    assert.equal(handlers[id], "supervisor", id);
  }
  for (const id of ["retry-limit", "abandon", "other"]) assert.equal(handlers[id], "human", id);
});

test("conductor: escalate と delegate で振り分けを上書きし、中止は常に人間に上げる", () => {
  const config = conductor({ escalate: ["G8"], delegate: ["retry-limit"] });
  assert.deepEqual(
    [resolveAsk("G8", config, settings).handler, resolveAsk("G8", config, settings).source],
    ["human", "escalate"],
  );
  assert.deepEqual(
    [resolveAsk("retry-limit", config, settings).handler, resolveAsk("retry-limit", config, settings).source],
    ["supervisor", "delegate"],
  );
  assert.deepEqual(
    [resolveAsk("abandon", config, settings).handler, resolveAsk("abandon", config, settings).source],
    ["human", "fixed"],
  );
});

test("conductor: 表に無い ID は分類できない問いとして人間に上げる", () => {
  const ask = resolveAsk("G1", conductor(), settings);
  assert.equal(ask.category, "unknown");
  assert.equal(ask.handler, "human");
});

test("conductor: profile と振り返りの設定で出ない問いを enabled: false にする", () => {
  const enabled = Object.fromEntries(resolveAllAsks(conductor(), settings).map((ask) => [ask.id, ask.enabled]));
  assert.equal(enabled["G2"], false);
  assert.equal(enabled["G7"], false);
  assert.equal(enabled["G3"], true);
  assert.equal(enabled["retrospective"], false);
  const prompt = { ...settings, reviews: { ...settings.reviews, retrospective: "prompt" as const } };
  assert.equal(resolveAsk("retrospective", conductor(), prompt).enabled, true);
});

for (const [name, config, pattern] of [
  ["未知の ID", conductor({ escalate: ["G1"] }), /不明な問いの ID/],
  ["delegate の abandon", conductor({ delegate: ["abandon"] }), /指定できません/],
  ["delegate の other", conductor({ delegate: ["other"] }), /指定できません/],
  ["両方に同じ ID", conductor({ escalate: ["G8"], delegate: ["G8"] }), /両方/],
] as const) {
  test(`conductor: 設定の検査で${name}を拒否する`, () => {
    assert.throws(() => checkConductorAsks(config, "[conductor]"), pattern);
  });
}

test("conductor: 最終出力の末尾にある gate / done / blocked を取り出す", () => {
  assert.deepEqual(parseFinalText('plan を書きました。\n\n<hikyaku-gate id="G8">\n承認しますか？\n</hikyaku-gate>\n'), {
    outcome: "gate", id: "G8", body: "承認しますか？",
  });
  assert.deepEqual(parseFinalText('<hikyaku-done next="/hikyaku:builder 001-test 2">\nPR: x\n</hikyaku-done>'), {
    outcome: "done", next: "/hikyaku:builder 001-test 2", body: "PR: x",
  });
  assert.deepEqual(parseFinalText("<hikyaku-blocked>\n差し戻し\n</hikyaku-blocked>"), {
    outcome: "blocked", body: "差し戻し",
  });
});

for (const [name, text, reason] of [
  ["ブロックが無い", "承認しますか？", /ブロックがありません/],
  ["ブロックが複数", '<hikyaku-gate id="G8">\na\n</hikyaku-gate>\n<hikyaku-gate id="G6">\nb\n</hikyaku-gate>', /2 個/],
  ["ブロックの後に出力が続く", '<hikyaku-done next="">\nx\n</hikyaku-done>\nおまけ', /後に出力/],
  ["gate に id が無い", '<hikyaku-gate id="">\na\n</hikyaku-gate>', /id がありません/],
] as const) {
  test(`conductor: ${name}ときは推測せず violation を返す`, () => {
    const parsed = parseFinalText(text);
    assert.equal(parsed.outcome, "violation");
    assert.match(parsed.reason ?? "", reason);
  });
}

test("conductor: 結果 JSON から session-id と費用を取り出す", () => {
  const parsed = parseResultJson(result('<hikyaku-gate id="G4">\nq\n</hikyaku-gate>'));
  assert.equal(parsed.outcome, "gate");
  assert.equal(parsed.sessionId, "s-1");
  assert.equal(parsed.costUsd, 1.5);
});

test("conductor: 異常終了は規約違反と区別して error を返し、理由に本文を添える", () => {
  const budget = parseResultJson(result("", { subtype: "error_max_budget_usd", is_error: true }));
  assert.equal(budget.outcome, "error");
  assert.match(budget.reason ?? "", /error_max_budget_usd/);
  // 利用上限への到達は subtype が success のまま is_error だけが立つ
  const limit = parseResultJson(result("You've hit your session limit", { is_error: true }));
  assert.equal(limit.outcome, "error");
  assert.match(limit.reason ?? "", /is_error.*session limit/);
  assert.equal(parseResultJson("not json").outcome, "error");
});

for (const raw of ["null", "[]", '"text"', "1"]) {
  test(`conductor: JSON として読めてもオブジェクトでない結果（${raw}）は error を返す`, () => {
    const parsed = parseResultJson(raw);
    assert.equal(parsed.outcome, "error");
    assert.equal(parsed.sessionId, null);
  });
}

test("conductor: 既定の許可は node を Hikyaku CLI の実行だけに、git を列挙したサブコマンドだけに絞る", () => {
  const tools = defaultAllowedTools("/plugins/hikyaku");
  assert.equal(tools.includes("Bash(node:*)"), false);
  assert.equal(tools.includes("Bash(git:*)"), false);
  assert.ok(tools.includes("Bash(git commit:*)"));
  assert.equal(tools.some((tool) => /^Bash\(git (-c|config)/.test(tool)), false);
  assert.ok(tools.includes("Bash(node /plugins/hikyaku/scripts/hikyaku.mts:*)"));
  assert.ok(tools.includes('Bash(node "/plugins/hikyaku/scripts/hikyaku.mts":*)'));
  assert.equal(tools.some((tool) => /^Bash\(node(?! .*hikyaku\.mts)/.test(tool)), false);
});

test("conductor: タグの集合と ASKS の食い違いを両方向で検出する", () => {
  const matching = new Map([["skills/x/SKILL.md", ASK_IDS.filter((id) => id !== "other")]]);
  assert.deepEqual(lintTags(matching), []);
  const renamed = new Map([
    ["skills/x/SKILL.md", [...ASK_IDS.filter((id) => id !== "other" && id !== "review-findings"), "code-review"]],
  ]);
  const problems = lintTags(renamed);
  assert.equal(problems.length, 2);
  assert.match(problems[0] ?? "", /code-review が .* ASKS にありません/);
  assert.match(problems[1] ?? "", /review-findings に対応するタグ/);
});

test("conductor: タグは全角括弧の（Gn）と（ask: id）だけを拾う", () => {
  assert.deepEqual(collectTags("承認を得る（G8）。尋ねる（ask: branch）。（G3 を省く）(G4) G10"), ["G8", "branch"]);
});

test("conductor: シェルの単一引用符を正しくエスケープする", () => {
  assert.equal(shellQuote("Bash(git:*)"), "'Bash(git:*)'");
  assert.equal(shellQuote("/hikyaku:builder"), "/hikyaku:builder");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});

test("conductor: ダイジェストは委任の範囲を決める設定が変わると変わる", () => {
  const base = settingsDigest("standard", settings, conductor());
  assert.equal(settingsDigest("standard", settings, conductor()), base);
  assert.notEqual(settingsDigest("express", settings, conductor()), base);
  assert.notEqual(settingsDigest("standard", settings, conductor({ delegate: ["retry-limit"] })), base);
  assert.notEqual(settingsDigest("standard", settings, conductor({ allowedTools: ["Bash(curl:*)"] })), base);
  assert.notEqual(settingsDigest("standard", settings, conductor(), ['base_branch = "other"']), base);
});

test("CLI: conductor lint はプラグイン本体のタグと ASKS が一致していれば成功する", (t) => {
  const directory = workspace(t);
  assert.match(succeeds(directory, "conductor", "lint"), /一致しています/);
});

test("CLI: conductor asks はサイクルの profile を反映し、設定の誤りを終了コード 1 で拒否する", (t) => {
  const directory = workspace(t, true);
  const output = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json"));
  assert.equal(output.profile, "standard");
  const g2 = output.asks.find((ask: { id: string }) => ask.id === "G2");
  assert.equal(g2.enabled, false);
  assert.match(output.digest, /^[0-9a-f]{12}$/);
  assert.deepEqual(output.allowedTools, defaultAllowedTools(pluginRoot()));

  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[conductor]\ndelegate = ["abandon"]\n');
  const rejected = cli(directory, "conductor", "asks", "001");
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /abandon は指定できません/);
});

test("CLI: conductor launch は起動コマンドを組み立てるだけで、何も書き込まない", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "export", "--bp", "2");
  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"
[conductor]
allowed_tools = ["Bash(npm test:*)"]
budget_per_run = 2.5
`);
  const expected = digest(directory);
  const before = snapshot(directory);
  const output = JSON.parse(succeeds(
    directory, "conductor", "launch", "builder", "001", "1", "--out", "r.json", "--expect-digest", expected, "--json",
  ));
  assert.equal(output.prompt, "/hikyaku:builder 001-test 1");
  assert.equal(output.resumed, false);
  assert.deepEqual(output.allowedTools, [...defaultAllowedTools(pluginRoot()), "Bash(npm test:*)"]);
  for (const flag of ["--session-id", "--disallowedTools", "--append-system-prompt-file", "--permission-prompts"]) {
    assert.ok(output.argv.includes(flag), flag);
  }
  assert.equal(output.argv[output.argv.indexOf("--max-budget-usd") + 1], "2.5");
  assert.ok(output.command.endsWith("< /dev/null > r.json"));
  assert.deepEqual(snapshot(directory), before);

  const returned = JSON.parse(succeeds(
    directory, "conductor", "launch", "architect", "001", "build-01", "--expect-digest", expected, "--json",
  ));
  assert.equal(returned.prompt, "/hikyaku:architect 001-test build-01");
});

test("CLI: conductor launch は再開時に回答ファイルを渡し、組で指定されなければ拒否する", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "export", "--bp", "2");
  write(directory, "answer.txt", "回答（委任された判断）: 承認する\n");
  const expected = digest(directory);
  const output = JSON.parse(succeeds(
    directory, "conductor", "launch", "builder", "001", "1", "--resume", "s-1", "--message", "answer.txt",
    "--expect-digest", expected, "--json",
  ));
  assert.equal(output.resumed, true);
  assert.equal(output.sessionId, "s-1");
  assert.equal(output.argv[2], "回答（委任された判断）: 承認する");
  assert.ok(output.argv.includes("--resume"));
  assert.equal(output.argv.includes("--max-budget-usd"), false);

  const launch = (...args: string[]) => cli(directory, "conductor", "launch", ...args, "--expect-digest", expected);
  assert.equal(launch("builder", "001", "1", "--resume", "s-1").status, 1);
  assert.equal(launch("builder", "001").status, 1);
  assert.equal(launch("builder", "001", "9").status, 1);
  assert.equal(launch("planner", "001").status, 1);
  assert.equal(cli(directory, "conductor", "launch", "builder", "001", "1").status, 1);
});

test("CLI: conductor parse は gate の振り分けまで返す", (t) => {
  const directory = workspace(t, true);
  write(directory, "r.json", result('<hikyaku-gate id="G8">\n承認しますか？\n</hikyaku-gate>'));
  const output = JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest(directory), "--json"));
  assert.equal(output.outcome, "gate");
  assert.equal(output.ask.handler, "supervisor");

  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[conductor]\nescalate = ["G8"]\n');
  const escalated = JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest(directory), "--json"));
  assert.equal(escalated.ask.handler, "human");
  assert.equal(escalated.ask.source, "escalate");
});

test("CLI: 合意したときから委任の設定が変わっていれば launch / parse を止める", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "export", "--bp", "2");
  write(directory, "r.json", result('<hikyaku-gate id="G8">\nq\n</hikyaku-gate>'));
  const agreed = digest(directory);
  // 子が .hikyaku.config を書き換えた想定
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[conductor]\nallowed_tools = ["Bash(curl:*)"]\n');
  for (const args of [["launch", "builder", "001", "1"], ["parse", "r.json", "001"]]) {
    const changed = cli(directory, "conductor", ...args, "--expect-digest", agreed);
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /合意したときから変わっています/);
  }
});

test("CLI: [conductor] 以外の設定（base_branch やサイクル設定）が変わっても launch を止める", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "export", "--bp", "2");
  const agreed = digest(directory);
  const launch = () => cli(directory, "conductor", "launch", "builder", "001", "1", "--expect-digest", agreed);
  assert.equal(launch().status, 0);
  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", '[branch]\nprefix = "other"\n');
  assert.equal(launch().status, 1);
  rmSync(join(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config"));
  assert.equal(launch().status, 0);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\nbase_branch = "release"\n');
  assert.equal(launch().status, 1);
});

test("CLI: context は conductor を読むべきフェーズとして受け付けない", (t) => {
  const directory = workspace(t, true);
  const rejected = cli(directory, "context", "conductor", "001");
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /読むべきドキュメントを持たないフェーズ/);
});

test("CLI: フェーズの PR は conductor ブランチへ、conductor ブランチの PR はデフォルトブランチへ向く", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\nbase_branch = "main"\n');
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "init");
  const base = (phase: string) => JSON.parse(succeeds(directory, "pr", "base", phase, "001", "--no-fetch", "--json")).base;

  // plan の PR が未マージのまま、plan のブランチから conductor ブランチを切る（先端が同じになる）
  git(directory, "switch", "-q", "-c", "hikyaku/001-test/plan");
  git(directory, "commit", "-q", "--allow-empty", "-m", "plan");
  git(directory, "switch", "-q", "-c", "hikyaku/001-test/conductor");
  assert.equal(base("conductor"), "main");

  git(directory, "switch", "-q", "-c", "hikyaku/001-test/architect");
  git(directory, "commit", "-q", "--allow-empty", "-m", "architect");
  assert.equal(base("architect"), "hikyaku/001-test/conductor");

  // 監督が --no-ff で取り込み、取り込んだブランチを消してから次のビルドを切る
  git(directory, "switch", "-q", "hikyaku/001-test/conductor");
  git(directory, "merge", "-q", "--no-ff", "-m", "merge architect", "hikyaku/001-test/architect");
  git(directory, "branch", "-q", "-d", "hikyaku/001-test/architect");
  git(directory, "switch", "-q", "-c", "hikyaku/001-test/build-01");
  git(directory, "commit", "-q", "--allow-empty", "-m", "build-01");
  assert.equal(base("build-01"), "hikyaku/001-test/conductor");
});

test("CLI: デフォルトブランチから切ったばかりの conductor ブランチも、取り込み済みとみなさない", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\nbase_branch = "main"\n');
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "init");
  const base = (phase: string) => JSON.parse(succeeds(directory, "pr", "base", phase, "001", "--no-fetch", "--json")).base;

  // plan の PR はマージ済み。最新の main から conductor ブランチを切る（先端が main と同じになる）
  git(directory, "switch", "-q", "-c", "hikyaku/001-test/conductor");
  git(directory, "switch", "-q", "-c", "hikyaku/001-test/architect");
  git(directory, "commit", "-q", "--allow-empty", "-m", "architect");
  assert.equal(base("architect"), "hikyaku/001-test/conductor");

  // conductor ブランチを切ったあとに main だけが進んでも（conductor が main の祖先になっても）変わらない
  git(directory, "switch", "-q", "main");
  git(directory, "commit", "-q", "--allow-empty", "-m", "other work");
  git(directory, "switch", "-q", "hikyaku/001-test/architect");
  assert.equal(base("architect"), "hikyaku/001-test/conductor");
});

test("CLI: [conductor.models] のフェーズ、無ければ model を --model で渡し、どちらも無ければ渡さない", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "export", "--bp", "2");
  const modelOf = (...args: string[]) => {
    const output = JSON.parse(succeeds(
      directory, "conductor", "launch", ...args, "--expect-digest", digest(directory), "--json",
    ));
    const index = output.argv.indexOf("--model");
    assert.equal(index === -1 ? null : output.argv[index + 1], output.model);
    return output.model;
  };
  assert.equal(modelOf("builder", "001", "1"), null);

  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"
[conductor]
model = "sonnet"
[conductor.models]
architect = "opus"
`);
  assert.equal(modelOf("architect", "001"), "opus");
  assert.equal(modelOf("builder", "001", "1"), "sonnet");
  const asks = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json"));
  assert.deepEqual(asks.models, { architect: "opus", builder: "sonnet", "close-cycle": "sonnet" });
});

for (const [name, content, pattern] of [
  ["未知のフェーズ", '[conductor.models]\nplanner = "opus"\n', /指定できないキー/],
  ["空文字のモデル", '[conductor]\nmodel = ""\n', /空文字/],
  ["テーブルでない models", '[conductor]\nmodels = "opus"\n', /models はテーブルで指定してください/],
] as const) {
  test(`CLI: [conductor] のモデル指定で${name}を拒否する`, (t) => {
    const directory = workspace(t, true);
    write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"\n${content}`);
    const rejected = cli(directory, "conductor", "asks", "001");
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, pattern);
  });
}

interface FakeGh {
  /** gh を差し替えた PATH で CLI を実行する */
  cli: (...args: string[]) => ReturnType<typeof cli>;
  /** gh が受け取った引数（1呼び出し1行） */
  calls: () => string[];
}

type FakeReviewer = string | null | { __typename: string; login?: string; slug?: string };

interface FakeState {
  /** gh pr view の結果 */
  view?: unknown;
  /**
   * GraphQL の reviewRequests。実際の GitHub では、Copilot などの Bot の依頼は gh pr view や
   * REST に現れず、ここにしか現れない。文字列は User として扱う
   */
  requests?: FakeReviewer[];
  threads?: { path: string; line: number | null; author: string; resolved: boolean | undefined }[];
  truncated?: boolean;
  /** GraphQL の応答をそのまま差し替える（壊れた応答のテスト用） */
  graphql?: unknown;
}

/**
 * 偽の gh を PATH の先頭に置く。pr view の1回目の呼び出しは steps[0]、2回目は steps[1]…を返し、
 * steps を使い切ったら基本の状態を返し続ける。api graphql は直前の pr view と同じ状態の
 * reviewRequests とスレッドを返し、pr edit は記録するだけ（editFails なら失敗する）
 */
function useGh(t: TestContext, directory: string, state: FakeState & { steps?: FakeState[]; editFails?: boolean } = {}): FakeGh {
  const bin = `${directory}-bin`;
  mkdirSync(bin, { recursive: true });
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const write = (suffix: string, step: FakeState) => {
    const merged = { ...state, ...step };
    writeFileSync(join(bin, `view${suffix}.json`), typeof merged.view === "string" ? merged.view : JSON.stringify(merged.view ?? prView()));
    writeFileSync(join(bin, `graphql${suffix}.json`), JSON.stringify(merged.graphql ?? graphqlResponse(merged)));
  };
  write("", {});
  (state.steps ?? []).forEach((step, index) => write(`.${index + 1}`, step));
  if (state.editFails) writeFileSync(join(bin, "edit.fail"), "");
  writeFileSync(join(bin, "gh"), `#!/bin/sh
DIR="$(dirname "$0")"
echo "$@" >> "$DIR/calls.log"
case "$1 $2" in
  "pr view")
    n=$(cat "$DIR/count" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "$DIR/count"
    if [ -f "$DIR/view.$n.json" ]; then cat "$DIR/view.$n.json"; else cat "$DIR/view.json"; fi ;;
  "api graphql")
    n=$(cat "$DIR/count" 2>/dev/null || echo 0)
    if [ -f "$DIR/graphql.$n.json" ]; then cat "$DIR/graphql.$n.json"; else cat "$DIR/graphql.json"; fi ;;
  "pr edit") if [ -f "$DIR/edit.fail" ]; then echo "boom" >&2; exit 1; fi ;;
  *) echo "unsupported: $*" >&2; exit 1 ;;
esac
`);
  chmodSync(join(bin, "gh"), 0o755);
  return {
    cli: (...args) => {
      const saved = process.env["PATH"];
      process.env["PATH"] = `${bin}:${saved}`;
      try {
        return cli(directory, ...args);
      } finally {
        process.env["PATH"] = saved;
      }
    },
    calls: () => {
      try {
        return readFileSync(join(bin, "calls.log"), "utf8").trim().split("\n");
      } catch {
        return [];
      }
    },
  };
}

function graphqlResponse(state: FakeState) {
  const copilot = { __typename: "Bot", login: "copilot-pull-request-reviewer" };
  return {
    data: {
      repository: {
        pullRequest: {
          reviewRequests: {
            nodes: (state.requests ?? []).map((reviewer) => ({
              requestedReviewer: typeof reviewer === "string" ? (reviewer === "@copilot" ? copilot : { __typename: "User", login: reviewer }) : reviewer,
            })),
          },
          reviewThreads: {
            pageInfo: { hasNextPage: state.truncated === true },
            nodes: (state.threads ?? []).map((thread) => ({
              isResolved: thread.resolved,
              path: thread.path,
              line: thread.line,
              comments: { nodes: [{ author: { login: thread.author }, url: `https://example.invalid/${thread.path}` }] },
            })),
          },
        },
      },
    },
  };
}

const CONDUCTOR = "hikyaku/001-test/conductor";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

function prView(overrides: Record<string, unknown> = {}) {
  return {
    number: 7, state: "OPEN", isDraft: false, baseRefName: CONDUCTOR, headRefName: "hikyaku/001-test/architect",
    statusCheckRollup: [{ __typename: "CheckRun", name: "typecheck", status: "COMPLETED", conclusion: "SUCCESS" }],
    headRefOid: HEAD_SHA, author: { login: "owner" }, reviewRequests: [], reviews: [], latestReviews: [],
    ...overrides,
  } as Parameters<typeof judgePr>[0];
}

test("conductor: マージ先が conductor ブランチで CI が通っていれば取り込める", () => {
  const verdict = judgePr(prView(), CONDUCTOR);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.checks.status, "pass");
  assert.deepEqual(verdict.problems, []);
});

test("conductor: マージ先が conductor ブランチでなければ取り込めない", () => {
  const verdict = judgePr(prView({ baseRefName: "main" }), CONDUCTOR);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.baseOk, false);
  assert.match(verdict.problems[0] ?? "", /期待: hikyaku\/001-test\/conductor \/ 実際: main/);
});

test("conductor: Draft の PR は取り込めない", () => {
  const verdict = judgePr(prView({ isDraft: true }), CONDUCTOR);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.readyOk, false);
  assert.match(verdict.problems.join("\n"), /Draft/);
});

test("conductor: レビューの依頼が残っていれば（人・チーム・Bot のどれでも）取り込めない", () => {
  const requests = [
    { __typename: "User", login: "alice" },
    { __typename: "Team", name: "Platform", slug: "platform" },
    { __typename: "Bot", login: "copilot-pull-request-reviewer" },
  ];
  const verdict = judgePr(prView({ reviewRequests: requests }), CONDUCTOR);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.requestsOk, false);
  assert.deepEqual(verdict.requested, ["alice", "platform", "copilot-pull-request-reviewer"]);
  assert.match(verdict.problems.join("\n"), /レビューの依頼が残っています: alice, platform, copilot-pull-request-reviewer/);
});

test("conductor: 承認は既定では不問で、コメントだけのレビューや変更の要求でも取り込める", () => {
  const reviews = [
    { author: { login: "copilot-pull-request-reviewer" }, state: "COMMENTED" },
    { author: { login: "bob" }, state: "CHANGES_REQUESTED" },
  ];
  const verdict = judgePr(prView({ reviews }), CONDUCTOR);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.approval.required, false);
});

test("conductor: 承認を必須にすると、承認が1人以上あり、変更の要求が残っていない場合だけ取り込める", () => {
  const strict = { requireApproval: true };
  const approve = { author: { login: "alice" }, state: "APPROVED" };
  const comment = { author: { login: "copilot-pull-request-reviewer" }, state: "COMMENTED" };
  const changes = { author: { login: "bob" }, state: "CHANGES_REQUESTED" };

  const none = judgePr(prView(), CONDUCTOR, strict);
  assert.equal(none.ok, false);
  assert.match(none.problems.join("\n"), /承認（Approve）がありません/);
  assert.equal(judgePr(prView({ reviews: [comment] }), CONDUCTOR, strict).ok, false);

  const approved = judgePr(prView({ reviews: [comment, approve] }), CONDUCTOR, strict);
  assert.equal(approved.ok, true);
  assert.deepEqual(approved.approval.approvedBy, ["alice"]);

  const blocked = judgePr(prView({ reviews: [approve, changes] }), CONDUCTOR, strict);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.approval.changesRequestedBy, ["bob"]);
  assert.match(blocked.problems.join("\n"), /変更が要求されています: bob/);
});

test("conductor: 承認と変更の要求は、コメントだけのレビューで上書きされず、取り下げで消える", () => {
  const strict = { requireApproval: true };
  const at = (login: string, state: string, submittedAt: string) => ({ author: { login }, state, submittedAt });

  const stillRequested = judgePr(prView({
    reviews: [at("alice", "APPROVED", "2026-01-01T00:00:00Z"), at("bob", "CHANGES_REQUESTED", "2026-01-01T01:00:00Z"),
      at("bob", "COMMENTED", "2026-01-01T02:00:00Z")],
  }), CONDUCTOR, strict);
  assert.equal(stillRequested.ok, false);
  assert.deepEqual(stillRequested.approval.changesRequestedBy, ["bob"]);

  const stillApproved = judgePr(prView({
    reviews: [at("alice", "APPROVED", "2026-01-01T00:00:00Z"), at("alice", "COMMENTED", "2026-01-01T01:00:00Z")],
  }), CONDUCTOR, strict);
  assert.equal(stillApproved.ok, true);
  assert.deepEqual(stillApproved.approval.approvedBy, ["alice"]);

  // 後から承認し直せば変更の要求は消える。提出日時で並べるので、応答の順には依らない
  const reapproved = judgePr(prView({
    reviews: [at("bob", "APPROVED", "2026-01-01T03:00:00Z"), at("bob", "CHANGES_REQUESTED", "2026-01-01T01:00:00Z")],
  }), CONDUCTOR, strict);
  assert.equal(reapproved.ok, true);

  const dismissed = judgePr(prView({
    reviews: [at("alice", "DISMISSED", "2026-01-01T00:00:00Z")],
  }), CONDUCTOR, strict);
  assert.deepEqual(dismissed.approval.approvedBy, []);
  assert.equal(dismissed.ok, false);
});

test("conductor: 開いていない PR は取り込めない", () => {
  for (const state of ["MERGED", "CLOSED"]) {
    const verdict = judgePr(prView({ state }), CONDUCTOR);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.stateOk, false);
  }
});

for (const [name, entry, status] of [
  ["失敗した CheckRun", { __typename: "CheckRun", name: "t", status: "COMPLETED", conclusion: "FAILURE" }, "fail"],
  ["取り消された CheckRun", { __typename: "CheckRun", name: "t", status: "COMPLETED", conclusion: "CANCELLED" }, "fail"],
  ["タイムアウトした CheckRun", { __typename: "CheckRun", name: "t", status: "COMPLETED", conclusion: "TIMED_OUT" }, "fail"],
  ["実行中の CheckRun", { __typename: "CheckRun", name: "t", status: "IN_PROGRESS", conclusion: "" }, "pending"],
  ["待機中の CheckRun", { __typename: "CheckRun", name: "t", status: "QUEUED", conclusion: "" }, "pending"],
  ["失敗した StatusContext", { __typename: "StatusContext", context: "ci/x", state: "FAILURE" }, "fail"],
  ["エラーの StatusContext", { __typename: "StatusContext", context: "ci/x", state: "ERROR" }, "fail"],
  ["保留中の StatusContext", { __typename: "StatusContext", context: "ci/x", state: "PENDING" }, "pending"],
  ["成功した StatusContext", { __typename: "StatusContext", context: "ci/x", state: "SUCCESS" }, "pass"],
  ["中立の CheckRun", { __typename: "CheckRun", name: "t", status: "COMPLETED", conclusion: "NEUTRAL" }, "pass"],
  ["スキップされた CheckRun", { __typename: "CheckRun", name: "t", status: "COMPLETED", conclusion: "SKIPPED" }, "pass"],
  ["承認待ちの CheckRun", { __typename: "CheckRun", name: "t", status: "WAITING", conclusion: "" }, "pending"],
  ["status の無い CheckRun", { __typename: "CheckRun", name: "t", conclusion: "" }, "fail"],
  ["知らない status の CheckRun", { __typename: "CheckRun", name: "t", status: "SOMETHING_NEW" }, "fail"],
  ["state を持つ CheckRun", { __typename: "CheckRun", name: "t", state: "", status: "IN_PROGRESS" }, "pending"],
  ["__typename の無い StatusContext", { context: "ci/x", state: "SUCCESS" }, "pass"],
] as const) {
  test(`conductor: CI の判定（${name}）`, () => {
    const verdict = judgePr(prView({ statusCheckRollup: [entry] }), CONDUCTOR);
    assert.equal(verdict.checks.status, status);
    assert.equal(verdict.ok, status === "pass");
  });
}

test("conductor: CI は失敗が1つでもあれば失敗、次に待機中、全て成功なら成功。1つも無ければ none で失敗にしない", () => {
  const success = { __typename: "CheckRun", name: "a", status: "COMPLETED", conclusion: "SUCCESS" };
  const failure = { __typename: "CheckRun", name: "b", status: "COMPLETED", conclusion: "FAILURE" };
  const running = { __typename: "CheckRun", name: "c", status: "IN_PROGRESS" };
  const mixed = judgePr(prView({ statusCheckRollup: [success, running, failure] }), CONDUCTOR);
  assert.equal(mixed.checks.status, "fail");
  assert.deepEqual(mixed.checks.failing, ["b"]);
  assert.deepEqual(mixed.checks.pending, ["c"]);
  assert.equal(judgePr(prView({ statusCheckRollup: [success, running] }), CONDUCTOR).checks.status, "pending");
  const none = judgePr(prView({ statusCheckRollup: [] }), CONDUCTOR);
  assert.equal(none.checks.status, "none");
  assert.equal(none.ok, true);
});

test("conductor: CI の状態を判定できないチェックは、待たずに失敗として名前と状態を示す", () => {
  const verdict = judgePr(prView({ statusCheckRollup: [{ __typename: "CheckRun", name: "t", status: "SOMETHING_NEW" }] }), CONDUCTOR);
  assert.equal(verdict.waiting, false);
  assert.deepEqual(verdict.checks.failing, ["t（状態を判定できません: SOMETHING_NEW）"]);
});

test("conductor: チェックの登録を待つあいだは、CI が1つも無くても合格にせず waiting にする", () => {
  const waiting = judgePr(prView({ statusCheckRollup: [] }), CONDUCTOR, { requireApproval: false, awaitChecks: true });
  assert.equal(waiting.ok, false);
  assert.equal(waiting.waiting, true);
  assert.match(waiting.problems.join("\n"), /CI のチェックがまだ登録されていません/);
  // チェックがあれば、待つ指定は効かない
  assert.equal(judgePr(prView(), CONDUCTOR, { requireApproval: false, awaitChecks: true }).ok, true);
});

test("conductor: 未解決のレビュースレッドがあれば、待たずに取り込めない", () => {
  const unresolved = [{ path: "src/a.mts", line: 12, author: "copilot-pull-request-reviewer", url: "u" }];
  const verdict = judgePr(prView({ reviewThreads: { unresolved, truncated: false } }), CONDUCTOR);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.threads.ok, false);
  assert.equal(verdict.waiting, false);
  assert.match(verdict.problems.join("\n"), /未解決のレビュースレッドが 1 件あります: src\/a\.mts:12（copilot-pull-request-reviewer）/);
  const outdated = judgePr(prView({ reviewThreads: { unresolved: [{ ...unresolved[0], line: null }], truncated: false } }), CONDUCTOR);
  assert.match(outdated.problems.join("\n"), /src\/a\.mts（/);
  const truncated = judgePr(prView({ reviewThreads: { unresolved: [], truncated: true } }), CONDUCTOR);
  assert.equal(truncated.ok, false);
});

test("conductor: 待てば解消しうる問題（CI の実行中・レビューの依頼）だけなら waiting、人間の対応が要る問題が混ざれば waiting でない", () => {
  const running = { __typename: "CheckRun", name: "c", status: "IN_PROGRESS" };
  const failed = { __typename: "CheckRun", name: "f", status: "COMPLETED", conclusion: "FAILURE" };
  const request = [{ __typename: "Bot", login: "copilot-pull-request-reviewer" }];
  const thread = { unresolved: [{ path: "a", line: 1, author: "x", url: "u" }], truncated: false };

  assert.equal(judgePr(prView({ statusCheckRollup: [running] }), CONDUCTOR).waiting, true);
  assert.equal(judgePr(prView({ reviewRequests: request }), CONDUCTOR).waiting, true);
  assert.equal(judgePr(prView({ reviewRequests: request, statusCheckRollup: [running] }), CONDUCTOR).waiting, true);
  assert.equal(judgePr(prView(), CONDUCTOR).waiting, false);
  assert.equal(judgePr(prView({ statusCheckRollup: [running, failed] }), CONDUCTOR).waiting, false);
  assert.equal(judgePr(prView({ reviewRequests: request, reviewThreads: thread }), CONDUCTOR).waiting, false);
  assert.equal(judgePr(prView({ isDraft: true, reviewRequests: request }), CONDUCTOR).waiting, false);
  assert.equal(judgePr(prView({ baseRefName: "main", reviewRequests: request }), CONDUCTOR).waiting, false);
});

test("conductor: 承認の不足は、レビューの依頼が残っているあいだだけ待てる", () => {
  const strict = { requireApproval: true };
  const request = [{ __typename: "Bot", login: "copilot-pull-request-reviewer" }];
  assert.equal(judgePr(prView({ reviewRequests: request }), CONDUCTOR, strict).waiting, true);
  assert.equal(judgePr(prView(), CONDUCTOR, strict).waiting, false);
});

function reviewerInput(overrides: Partial<ReviewerInput> = {}): ReviewerInput {
  return {
    phase: "build-01", baseRefName: "main", conductorBranch: CONDUCTOR, reviewers: ["alice", "@copilot"], skip: [],
    phaseReviewers: ["@copilot"], author: "owner", requested: [], reviewed: [], ...overrides,
  };
}

test("reviewers: build-NN は build として、他のフェーズはそのままの名前でオフにできる単位に対応する", () => {
  assert.equal(skipTargetOf("build-03"), "build");
  assert.equal(skipTargetOf("build-120"), "build");
  for (const phase of ["init", "bp-guide", "create", "plan", "architect", "close", "conductor"]) {
    assert.equal(skipTargetOf(phase), phase);
  }
  assert.equal(skipTargetOf("review"), undefined);
});

test("reviewers: マージ先がデフォルトブランチなら [pr] reviewers、conductor ブランチなら phase_reviewers を使う", () => {
  const toMain = planReviewers(reviewerInput());
  assert.equal(toMain.source, "pr");
  assert.deepEqual(toMain.request, ["alice", "@copilot"]);
  const toConductor = planReviewers(reviewerInput({ baseRefName: CONDUCTOR }));
  assert.equal(toConductor.source, "conductor");
  assert.deepEqual(toConductor.request, ["@copilot"]);
  // サイクルに属さないフェーズには conductor ブランチが無い
  assert.equal(planReviewers(reviewerInput({ phase: "init", conductorBranch: undefined })).source, "pr");
});

test("reviewers: 設定が空なら何もせず、スキルごとのオフは build-NN 全体と指定したフェーズにだけ効く", () => {
  assert.deepEqual(planReviewers(reviewerInput({ reviewers: [] })), { source: "none", skipped: false, request: [], excluded: [] });
  const skipped = planReviewers(reviewerInput({ phase: "build-07", skip: ["build"] }));
  assert.equal(skipped.skipped, true);
  assert.deepEqual(skipped.request, []);
  assert.equal(planReviewers(reviewerInput({ phase: "architect", skip: ["build"] })).skipped, false);
  // オフは phase_reviewers にも効く
  assert.equal(planReviewers(reviewerInput({ phase: "architect", baseRefName: CONDUCTOR, skip: ["architect"] })).skipped, true);
});

test("reviewers: 作成者本人・依頼済み・レビュー済みには依頼しない。@copilot は Copilot の login と対応する", () => {
  const plan = planReviewers(reviewerInput({
    reviewers: ["Owner", "alice", "bob", "carol", "@copilot", "org/platform"],
    author: "owner",
    requested: ["alice", "platform"],
    reviewed: ["bob", "copilot-pull-request-reviewer"],
  }));
  assert.deepEqual(plan.request, ["carol"]);
  assert.deepEqual(plan.excluded, [
    { reviewer: "Owner", reason: "PR の作成者本人" },
    { reviewer: "alice", reason: "依頼済み" },
    { reviewer: "bob", reason: "レビュー済み" },
    { reviewer: "@copilot", reason: "レビュー済み" },
    { reviewer: "org/platform", reason: "依頼済み" },
  ]);
  assert.deepEqual(planReviewers(reviewerInput({ reviewers: ["alice", "alice"] })).request, ["alice"]);
});

for (const [name, content, pattern] of [
  ["空白を含むレビュアー", '[pr]\nreviewers = ["alice bob"]\n', /指定できない値/],
  ["カンマを含むレビュアー", '[pr]\nreviewers = ["alice,bob"]\n', /指定できない値/],
  ["空文字のレビュアー", '[conductor]\nphase_reviewers = [""]\n', /指定できない値/],
  ["未知の reviewers_skip", '[pr]\nreviewers_skip = ["builder"]\n', /reviewers_skip に指定できない値/],
  ["負の review_timeout", "[conductor]\nreview_timeout = -1\n", /review_timeout は 0 以上/],
] as const) {
  test(`CLI: レビュアーの設定で${name}を拒否する`, (t) => {
    const directory = workspace(t, true);
    write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"\n${content}`);
    const rejected = cli(directory, "config", "001", "--json");
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, pattern);
  });
}

test("CLI: [pr] reviewers とオフの設定は config に反映され、サイクル設定で上書きできる", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"
[pr]
reviewers = ["alice", "@copilot", "org/platform"]
reviewers_skip = ["init", "build"]
[conductor]
phase_reviewers = ["@copilot"]
review_timeout = 5
`);
  const config = JSON.parse(succeeds(directory, "config", "001", "--json"));
  assert.deepEqual(config.pr.reviewers, ["alice", "@copilot", "org/platform"]);
  assert.deepEqual(config.pr.reviewersSkip, ["init", "build"]);
  assert.deepEqual(config.conductor.phaseReviewers, ["@copilot"]);
  assert.equal(config.conductor.reviewTimeoutMinutes, 5);
  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", '[pr]\nreviewers = ["bob"]\n');
  assert.deepEqual(JSON.parse(succeeds(directory, "config", "001", "--json")).pr.reviewers, ["bob"]);
});

test("CLI: pr request-reviewers は PR のマージ先で一覧を選び、作成者を除いて gh pr edit で依頼する", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"
[pr]
reviewers = ["owner", "alice", "@copilot"]
[conductor]
phase_reviewers = ["@copilot"]
`);
  const gh = useGh(t, directory, { view: prView({ baseRefName: "main", author: { login: "owner" } }) });
  const dry = JSON.parse(gh.cli("pr", "request-reviewers", "build-01", "001", "--pr", "7", "--dry-run", "--json").stdout);
  assert.equal(dry.source, "pr");
  assert.deepEqual(dry.request, ["alice", "@copilot"]);
  assert.deepEqual(dry.excluded, [{ reviewer: "owner", reason: "PR の作成者本人" }]);
  assert.equal(dry.requested, false);
  assert.equal(gh.calls().some((call) => call.startsWith("pr edit")), false, "--dry-run は書き込まない");

  const real = JSON.parse(gh.cli("pr", "request-reviewers", "build-01", "001", "--pr", "7", "--json").stdout);
  assert.equal(real.requested, true);
  assert.ok(gh.calls().includes("pr edit 7 --add-reviewer alice,@copilot"));
});

test("CLI: pr request-reviewers は conductor ブランチ向けの PR に phase_reviewers を使う", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"
[pr]
reviewers = ["alice"]
[conductor]
phase_reviewers = ["@copilot"]
`);
  const gh = useGh(t, directory, { view: prView() });
  const output = JSON.parse(gh.cli("pr", "request-reviewers", "architect", "001", "--pr", "7", "--json").stdout);
  assert.equal(output.source, "conductor");
  assert.ok(gh.calls().includes("pr edit 7 --add-reviewer @copilot"));
});

test("CLI: pr request-reviewers は設定が空・オフ・新しく依頼する人がいないときに gh pr edit を呼ばない", (t) => {
  const directory = workspace(t, true);
  const gh = useGh(t, directory, { view: prView({ baseRefName: "main" }) });
  const empty = JSON.parse(gh.cli("pr", "request-reviewers", "plan", "001", "--pr", "7", "--json").stdout);
  assert.equal(empty.source, "none");

  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"
[pr]
reviewers = ["alice"]
reviewers_skip = ["plan"]
`);
  const skipped = JSON.parse(gh.cli("pr", "request-reviewers", "plan", "001", "--pr", "7", "--json").stdout);
  assert.equal(skipped.skipped, true);

  const already = useGh(t, directory, { view: prView({ baseRefName: "main" }), requests: ["alice"] });
  const none = JSON.parse(already.cli("pr", "request-reviewers", "architect", "001", "--pr", "7", "--json").stdout);
  assert.deepEqual(none.request, []);
  assert.equal(none.requested, false);
  assert.equal([...gh.calls(), ...already.calls()].some((call) => call.startsWith("pr edit")), false);
});

test("CLI: pr request-reviewers は --pr が無い・gh が失敗したときに終了コード 1 を返す", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[pr]\nreviewers = ["alice"]\n');
  const gh = useGh(t, directory, { view: prView({ baseRefName: "main" }), editFails: true });
  assert.equal(gh.cli("pr", "request-reviewers", "plan", "001").status, 1);
  const failed = gh.cli("pr", "request-reviewers", "plan", "001", "--pr", "7");
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /レビュアーの依頼に失敗しました: alice/);
  assert.match(failed.stderr, /PR 自体は作成済み/);
});

test("CLI: conductor check-pr は gh の結果で取り込めるかを返し、満たさなければ終了コード 2", (t) => {
  const directory = workspace(t, true);
  const good = useGh(t, directory, {}).cli("conductor", "check-pr", "7", "001", "--json");
  assert.equal(good.status, 0, good.stderr);
  const parsed = JSON.parse(good.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.conductorBranch, CONDUCTOR);
  assert.equal(parsed.threads.ok, true);

  const wrongBase = useGh(t, directory, { view: prView({ baseRefName: "main" }) }).cli("conductor", "check-pr", "7", "001", "--json");
  assert.equal(wrongBase.status, 2);
  assert.equal(JSON.parse(wrongBase.stdout).baseOk, false);

  const failing = useGh(t, directory, {
    view: prView({ statusCheckRollup: [{ __typename: "CheckRun", name: "typecheck", status: "COMPLETED", conclusion: "FAILURE" }] }),
  }).cli("conductor", "check-pr", "7", "001");
  assert.equal(failing.status, 2);
  assert.match(failing.stdout, /CI: fail/);
  assert.match(failing.stderr, /CI が失敗しています: typecheck/);

  const draft = useGh(t, directory, { view: prView({ isDraft: true }), requests: ["alice"] }).cli("conductor", "check-pr", "7", "001");
  assert.equal(draft.status, 2);
  assert.match(draft.stderr, /Draft/);
  assert.match(draft.stderr, /レビューの依頼が残っています: alice/);

});

test("CLI: conductor check-pr は gh の応答に必須のフィールドが無い・型が違うときに、合格にせず終了コード 1 で止まる", (t) => {
  const directory = workspace(t, true);
  const full = prView() as unknown as Record<string, unknown>;
  for (const field of ["isDraft", "statusCheckRollup", "reviews", "headRefOid", "state", "baseRefName"]) {
    const { [field]: _removed, ...rest } = full;
    const result = useGh(t, directory, { view: rest }).cli("conductor", "check-pr", "7", "001", "--json");
    assert.equal(result.status, 1, `${field} が無い応答は合格にしない`);
    assert.match(result.stderr, new RegExp(`必須のフィールドが無いか、型が違います: ${field}`));
  }
  const wrongType = useGh(t, directory, { view: { ...full, isDraft: "false" } }).cli("conductor", "check-pr", "7", "001");
  assert.equal(wrongType.status, 1);
  assert.equal(useGh(t, directory, { view: "not json" }).cli("conductor", "check-pr", "7", "001").status, 1);
  assert.equal(useGh(t, directory, { view: "null" }).cli("conductor", "check-pr", "7", "001").status, 1);
  // 空配列は、CI もレビューも無い PR の正常な応答
  const empty = useGh(t, directory, { view: { ...full, statusCheckRollup: [], reviews: [] } }).cli("conductor", "check-pr", "7", "001");
  assert.equal(empty.status, 0, empty.stderr);
});

test("CLI: conductor check-pr は GraphQL の応答が不完全なときに、依頼なし・未解決なしとして扱わず終了コード 1 で止まる", (t) => {
  const directory = workspace(t, true);
  const broken = [
    { data: { repository: { pullRequest: null } } },
    { errors: [{ message: "boom" }], data: null },
    { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } },
    { data: { repository: { pullRequest: { reviewRequests: { nodes: [] } } } } },
  ];
  for (const graphql of broken) {
    const result = useGh(t, directory, { graphql }).cli("conductor", "check-pr", "7", "001");
    assert.equal(result.status, 1, JSON.stringify(graphql));
    assert.match(result.stderr, /gh api graphql で取得できませんでした/);
  }
});

test("CLI: 依頼先を読めない依頼は依頼が残っているものとして数え、解決済みと確認できないスレッドは未解決として扱う", (t) => {
  const directory = workspace(t, true);
  const unknownRequest = useGh(t, directory, { requests: [null] }).cli("conductor", "check-pr", "7", "001", "--json");
  assert.equal(unknownRequest.status, 2);
  assert.deepEqual(JSON.parse(unknownRequest.stdout).requested, ["（不明なレビュアー）"]);

  const unknownThread = useGh(t, directory, {
    threads: [{ path: "src/a.mts", line: 1, author: "copilot-pull-request-reviewer", resolved: undefined }],
  }).cli("conductor", "check-pr", "7", "001", "--json");
  assert.equal(unknownThread.status, 2);
  assert.equal(JSON.parse(unknownThread.stdout).threads.unresolved.length, 1);
});

test("github: gh pr view の応答は必須のフィールドが全て揃っているときだけ読み、空配列は正常として扱う", () => {
  const valid = {
    number: 7, state: "OPEN", isDraft: false, baseRefName: "main", headRefName: "x", headRefOid: HEAD_SHA,
    statusCheckRollup: [], reviews: [],
  };
  assert.equal(parsePrView(valid).isDraft, false);
  for (const field of Object.keys(valid)) {
    const { [field]: _removed, ...rest } = valid as Record<string, unknown>;
    assert.throws(() => parsePrView(rest), new RegExp(field), field);
  }
  for (const raw of [null, [], "text", 1, undefined]) assert.throws(() => parsePrView(raw), /JSON のオブジェクトではありません/);
  assert.throws(() => parsePrView({ ...valid, isDraft: undefined }), /isDraft/);
  assert.throws(() => parsePrView({ ...valid, statusCheckRollup: null }), /statusCheckRollup/);
  assert.throws(() => parsePrView({ ...valid, headRefOid: "main" }), /headRefOid/);
});

test("github: レビュアーのアサイン用の gh pr view の応答も、作成者や最新のレビューが無ければエラーにする", () => {
  const valid = { number: 7, baseRefName: "main", author: { login: "owner" }, latestReviews: [] };
  assert.equal(parsePrReviewState(valid).author, "owner");
  assert.throws(() => parsePrReviewState({ ...valid, author: null }), /author/);
  assert.throws(() => parsePrReviewState({ ...valid, author: { login: "" } }), /author/);
  assert.throws(() => parsePrReviewState({ ...valid, latestReviews: undefined }), /latestReviews/);
});

test("conductor: isDraft が欠けた応答を Ready と判定しない", () => {
  const view = { ...prView(), isDraft: undefined } as unknown as Parameters<typeof judgePr>[0];
  const verdict = judgePr(view, CONDUCTOR);
  assert.equal(verdict.readyOk, false);
  assert.equal(verdict.ok, false);
});


test("CLI: conductor check-pr は gh api graphql で未解決のレビュースレッドを取得し、あれば終了コード 2", (t) => {
  const directory = workspace(t, true);
  const gh = useGh(t, directory, {
    threads: [
      { path: "src/a.mts", line: 3, author: "copilot-pull-request-reviewer", resolved: false },
      { path: "src/b.mts", line: null, author: "copilot-pull-request-reviewer", resolved: true },
    ],
  });
  const result = gh.cli("conductor", "check-pr", "7", "001", "--json");
  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.threads.unresolved.length, 1);
  assert.equal(parsed.threads.unresolved[0].path, "src/a.mts");
  assert.ok(gh.calls().some((call) => call.startsWith("api graphql") && call.includes("owner={owner}") && call.includes("number=7")));
  assert.match(result.stderr, /未解決のレビュースレッドが 1 件あります/);

  const truncated = useGh(t, directory, { truncated: true }).cli("conductor", "check-pr", "7", "001");
  assert.equal(truncated.status, 2);
});

test("CLI: conductor check-pr --wait はレビューの依頼が消えるまで確かめ直し、消えたら成功する", (t) => {
  const directory = workspace(t, true);
  const gh = useGh(t, directory, { steps: [{ requests: ["@copilot"] }, { requests: ["@copilot"] }] });
  const result = gh.cli("conductor", "check-pr", "7", "001", "--wait", "--interval", "1", "--timeout", "1", "--json");
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.timedOut, false);
  assert.equal(gh.calls().filter((call) => call.startsWith("pr view")).length, 3);
});

test("CLI: conductor check-pr --wait は PR を作った直後にチェックが無ければ、登録されるまで待つ", (t) => {
  const directory = workspace(t, true);
  const gh = useGh(t, directory, { steps: [{ view: prView({ statusCheckRollup: [] }) }] });
  const result = gh.cli("conductor", "check-pr", "7", "001", "--wait", "--interval", "1", "--timeout", "1", "--json");
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.checks.status, "pass");
  assert.equal(gh.calls().filter((call) => call.startsWith("pr view")).length, 2);

  // 待たない設定なら、チェックが無くても none で合格にする
  const once = useGh(t, directory, { view: prView({ statusCheckRollup: [] }) }).cli("conductor", "check-pr", "7", "001", "--json");
  assert.equal(once.status, 0, once.stderr);
  assert.equal(JSON.parse(once.stdout).checks.status, "none");
});

test("CLI: conductor check-pr は検証した head のコミットを返し、--interval は 1 秒未満を拒否する", (t) => {
  const directory = workspace(t, true);
  const result = useGh(t, directory, {}).cli("conductor", "check-pr", "7", "001", "--json");
  assert.equal(JSON.parse(result.stdout).headSha, HEAD_SHA);
  const rejected = useGh(t, directory, {}).cli("conductor", "check-pr", "7", "001", "--wait", "--interval", "0");
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /--interval は 1 以上/);
});

test("CLI: conductor check-pr --wait は上限を超えたら timedOut で終了コード 2、待たない設定なら1回で判定する", (t) => {
  const directory = workspace(t, true);
  const gh = useGh(t, directory, { requests: ["@copilot"] });
  const timedOut = gh.cli("conductor", "check-pr", "7", "001", "--wait", "--interval", "1", "--timeout", "0", "--json");
  assert.equal(timedOut.status, 2);
  assert.equal(JSON.parse(timedOut.stdout).timedOut, true);
  assert.match(timedOut.stderr, /待機の上限（0 分）を超えました/);
  assert.equal(gh.calls().filter((call) => call.startsWith("pr view")).length, 1);

  // 設定の review_timeout を上限の既定にする
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[conductor]\nreview_timeout = 0\n');
  const configured = useGh(t, directory, { requests: ["@copilot"] }).cli("conductor", "check-pr", "7", "001", "--wait", "--interval", "1", "--json");
  assert.equal(JSON.parse(configured.stdout).timedOut, true);
});

test("CLI: conductor check-pr --wait は待っても解消しない問題（Draft・未解決の指摘）を見つけたらすぐ返す", (t) => {
  const directory = workspace(t, true);
  const gh = useGh(t, directory, { view: prView({ isDraft: true }), requests: ["@copilot"] });
  const result = gh.cli("conductor", "check-pr", "7", "001", "--wait", "--interval", "1", "--timeout", "10", "--json");
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).timedOut, false);
  assert.equal(gh.calls().filter((call) => call.startsWith("pr view")).length, 1);
});

test("CLI: conductor check-pr は gh が PR を取得できなければ終了コード 1", (t) => {
  const directory = workspace(t, true);
  const bin = `${directory}-bin`;
  mkdirSync(bin, { recursive: true });
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, "gh"), "#!/bin/sh\necho 'no such pr' >&2\nexit 1\n");
  chmodSync(join(bin, "gh"), 0o755);
  const saved = process.env["PATH"];
  process.env["PATH"] = `${bin}:${saved}`;
  try {
    const failed = cli(directory, "conductor", "check-pr", "99", "001");
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /gh pr view で取得できませんでした/);
  } finally {
    process.env["PATH"] = saved;
  }
  assert.equal(cli(directory, "conductor", "check-pr").status, 1);
});

test("CLI: [conductor] require_approval を設定すると check-pr が承認を求める", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[conductor]\nrequire_approval = true\n');
  const result = useGh(t, directory, {}).cli("conductor", "check-pr", "7", "001");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /承認（Approve）がありません/);
});

test("CLI: conductor asks はレビューの設定を返し、設定を変えるとダイジェストも変わる", (t) => {
  const directory = workspace(t, true);
  const before = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json"));
  assert.deepEqual(before.review.phaseReviewers, []);
  assert.equal(before.review.timeoutMinutes, 15);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[pr]\nreviewers = ["alice"]\n[conductor]\nphase_reviewers = ["@copilot"]\n');
  const after = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json"));
  assert.deepEqual(after.review.phaseReviewers, ["@copilot"]);
  assert.deepEqual(after.review.finalReviewers, ["alice"]);
  assert.notEqual(after.digest, before.digest);
});


test("CLI: Copilot（Bot）への依頼は gh pr view に現れなくても、GraphQL から読んで check-pr が待つ", (t) => {
  const directory = workspace(t, true);
  // 実際の GitHub では、gh pr view の reviewRequests は空のまま、GraphQL にだけ Bot の依頼が現れる
  const gh = useGh(t, directory, { view: prView({ reviewRequests: [] }), requests: ["@copilot"] });
  const result = gh.cli("conductor", "check-pr", "7", "001", "--json");
  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.requested, ["copilot-pull-request-reviewer"]);
  assert.equal(parsed.waiting, true);
  assert.equal(
    gh.calls().some((call) => call.startsWith("pr view") && call.includes("reviewRequests")),
    false,
    "gh pr view の reviewRequests は使わない",
  );
});

test("CLI: pr request-reviewers は Copilot が GraphQL 上で依頼済みなら、重ねて依頼しない", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[pr]\nreviewers = ["@copilot"]\n');
  // リポジトリの設定などで、既に Copilot が依頼されている状態
  const gh = useGh(t, directory, { view: prView({ baseRefName: "main" }), requests: ["@copilot"] });
  const output = JSON.parse(gh.cli("pr", "request-reviewers", "plan", "001", "--pr", "7", "--json").stdout);
  assert.deepEqual(output.request, []);
  assert.deepEqual(output.excluded, [{ reviewer: "@copilot", reason: "依頼済み" }]);
  assert.equal(gh.calls().some((call) => call.startsWith("pr edit")), false);
});
