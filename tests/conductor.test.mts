import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { AskSettings, ConductorConfig } from "../scripts/lib/conductor.mts";
import {
  ASK_IDS,
  checkConductorAsks,
  collectTags,
  DEFAULT_CONDUCTOR,
  defaultAllowedTools,
  lintTags,
  parseFinalText,
  parseResultJson,
  resolveAllAsks,
  resolveAsk,
  settingsDigest,
  shellQuote,
} from "../scripts/lib/conductor.mts";
import { pluginRoot } from "../scripts/lib/paths.mts";
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
