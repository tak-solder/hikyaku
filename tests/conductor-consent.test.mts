/**
 * build-19: conductor での事後同意。最後のビルドの子の同意ゲート（対象はサイクル全体）、architect・最後以外のビルドの子の
 * 回し方、監督の上限を超える答えの事後同意への回し方、最後の PR の一覧（ledger pr-section --all）。
 *
 * 事後同意の有効の判定は基準（origin/HEAD）の merge-base のサイクル設定を読むので、一時リポジトリに origin を作る
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { loadConfig, type ResolvedConfig } from "../scripts/lib/config.mts";
import { closesMessage } from "../scripts/lib/conductor.mts";
import {
  cycleConsentItems,
  deferrablePremisesProblem,
  readLedger,
  type DecideRecord,
  type Ledger,
  type LedgerItem,
  type OpenRecord,
} from "../scripts/lib/ledger.mts";
import "../scripts/lib/steps/index.mts";
import { ARCHITECT_STEPS } from "../scripts/lib/steps/architect.mts";
import { conductorConsentMode, consentGateSlot, consentProblem, consentTargets, isLastBuild } from "../scripts/lib/steps/consent.mts";
import type { StepContext } from "../scripts/lib/steps/engine.mts";
import { cli, cliWith, repository, snapshot, succeeds, temporaryDirectory, testEnvironment, write } from "./helpers.mts";

// 単体テストはこのプロセスの環境で評価する。conductor の子の中で npm test を走らせても持ち込まない
delete process.env["HIKYAKU_CONDUCTOR_CHILD"];

const CYCLE = "docs/hikyaku/cycles/001-test";
const CHILD = { HIKYAKU_CONDUCTOR_CHILD: "1" };
const PR = (n: number) => `https://github.com/o/r/pull/${n}`;

function git(directory: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function commit(directory: string, message: string): void {
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "--allow-empty", "-m", message);
}

interface Setup {
  /** サイクル設定に [consent] deferred = true を書いて main にコミットする（既定 true） */
  consent?: boolean;
  /** [app] に merge_gate = "user" を書く（既定 true） */
  mergeGate?: boolean;
  /** tasklist にビルドを登録する（既定 true。architect の手順はビルドの分割があると記録の欠けとみなすので、architect のテストは false） */
  builds?: boolean;
}

/** サイクル 001-test（build-01〜03）を持つワークスペース。宣言の上限は「中まで」、重い領域 billing。main を origin へ push する */
function cycleWorkspace(t: TestContext, setup: Setup = {}): string {
  const directory = repository(t);
  succeeds(directory, "init", "--root", "docs/hikyaku");
  succeeds(directory, "cycle", "new", "test", "--profile", "standard");
  const config = join(directory, ".hikyaku.config");
  const app = [
    "", "[app]", 'exposure = "internal"', 'data = "none"', 'impact = "low"', ...(setup.mergeGate === false ? [] : ['merge_gate = "user"']),
    "", "[[app.areas]]", 'name = "billing"', 'paths = ["src/billing/**"]', "",
  ].join("\n");
  writeFileSync(config, `retrospective = "skip"\n${readFileSync(config, "utf8")}${app}`);
  if (setup.consent !== false) {
    const path = join(directory, CYCLE, ".hikyaku.config");
    if (existsSync(path)) appendFileSync(path, "\n[consent]\ndeferred = true\n");
    else write(directory, `${CYCLE}/.hikyaku.config`, "[consent]\ndeferred = true\n");
  }
  if (setup.builds !== false) {
    for (const title of ["基盤", "画面", "仕上げ"]) succeeds(directory, "tasklist", "add", "001", "--title", title, "--peak", "350k");
    for (const n of [1, 2, 3]) write(directory, `${CYCLE}/build-0${n}/issue.md`);
  }
  write(directory, "src/billing/invoice.ts", "export {};\n");
  commit(directory, "main");
  const remote = temporaryDirectory(t);
  git(remote, "init", "--quiet", "--bare");
  git(directory, "remote", "add", "origin", remote);
  git(directory, "push", "-q", "origin", "main");
  git(directory, "remote", "set-head", "origin", "main");
  return directory;
}

/** tasklist の PR 列を埋める（作業ツリー） */
function prDone(directory: string, ...ids: number[]): void {
  for (const id of ids) succeeds(directory, "tasklist", "done", "001", "--id", String(id), "--pr", PR(10 + id));
}

function open(id: string, unit: string, overrides: Partial<OpenRecord> = {}): OpenRecord {
  return {
    record: "open", at: "2026-11-17T00:00:00.000Z", id, unit, type: "risk", summary: `${id} の受け入れ`,
    when: `merge@${unit}`, who: "user", premises: ["app.exposure"], loses: "安全側の案の利点", ...overrides,
  };
}

function decide(id: string, unit: string, overrides: Partial<DecideRecord> = {}): DecideRecord {
  return { record: "decide", at: "2026-11-17T01:00:00.000Z", id, unit, decision: "consented", by: "user", input: "同意する", ...overrides };
}

const DIRECTORY_OF: Record<string, string> = { architect: "design", plan: "planning", close: "" };

/** 作業単位の decisions.jsonl に記録を足す（時刻を決めて置くため、CLI を通さずに書く） */
function record(directory: string, unit: string, ...records: (OpenRecord | DecideRecord)[]): void {
  const folder = join(directory, CYCLE, DIRECTORY_OF[unit] ?? unit);
  mkdirSync(folder, { recursive: true });
  appendFileSync(join(folder, "decisions.jsonl"), records.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
}

function ledgerOf(directory: string, unit: string): Record<string, unknown>[] {
  const path = join(directory, CYCLE, DIRECTORY_OF[unit] ?? unit, "decisions.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

interface Directive {
  kind: string;
  step?: string;
  ask?: string;
  approval?: string;
  message?: string;
  reason?: string;
  args?: Record<string, unknown>;
}

const SESSION = "s-child";

function childEnv(t: TestContext, session = SESSION): NodeJS.ProcessEnv {
  return { ...CHILD, CLAUDE_CODE_SESSION_ID: session, CLAUDE_CONFIG_DIR: temporaryDirectory(t) };
}

function nextOf(directory: string, unit: string, env: NodeJS.ProcessEnv = {}): Directive {
  const result = cliWith(directory, env, "step", "next", unit, "001", "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function reportOf(directory: string, env: NodeJS.ProcessEnv, unit: string, step: string, ...extra: string[]) {
  return cliWith(directory, env, "step", "report", unit, step, "001", ...extra, "--json");
}

function reported(directory: string, env: NodeJS.ProcessEnv, unit: string, step: string, ...extra: string[]): Directive {
  const result = reportOf(directory, env, unit, step, ...extra);
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

/** ビルドを handoff まで進める（retrospective は skip）。stop を渡すと、そのステップの手前で止める */
function upTo(directory: string, env: NodeJS.ProcessEnv, unit: string, stop?: string): void {
  const build = `${CYCLE}/${unit}`;
  const steps: [string, () => string[]][] = [
    ["plan", () => (write(directory, `${build}/plan.md`, "# plan\n"), ["--result", "done", "--peak", "350k"])],
    ["plan-review", () => ["--result", "done"]],
    ["test-spec", () => (write(directory, `${build}/test-spec.md`, "# test-spec\n"), ["--result", "done"])],
    ["test-spec-review", () => ["--result", "done"]],
    ["G8", () => ["--result", "approved", "--input", "OK"]],
    ["implement", () => ["--result", "done"]],
    ["verify", () => ["--result", "done"]],
    ["agreement-review", () => (write(directory, `${build}/agreement.md`), ["--result", "done"])],
    ["review", () => ["--result", "done"]],
    ["handoff", () => (write(directory, `${build}/handoff.md`), ["--result", "done"])],
  ];
  for (const [step, args] of steps) {
    if (step === stop) return;
    reported(directory, env, unit, step, ...args());
  }
}

function withEnv<T>(env: Record<string, string>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** ワークスペースの設定をこのプロセスで読む（git を読む判定を in-process で行うため、cwd を移す） */
function configOf(directory: string): ResolvedConfig {
  const saved = process.cwd();
  process.chdir(directory);
  try {
    return loadConfig({ cycleDir: join(directory, CYCLE) });
  } finally {
    process.chdir(saved);
  }
}

function ctxOf(config: ResolvedConfig, directory: string, unit: string): StepContext {
  const cycleDirectory = join(directory, CYCLE);
  return {
    config,
    cycle: { directory: cycleDirectory } as StepContext["cycle"],
    unit,
    unitDirectory: join(cycleDirectory, DIRECTORY_OF[unit] ?? unit),
    events: [],
  };
}

const ids = (items: LedgerItem[]) => items.map((entry) => entry.open.id);

// ---------------------------------------------------------------------------
// cycleConsentItems・isLastBuild（単体）

test("cycleConsentItems: 作業単位を問わず who=user・when=merge@ の risk と objection を記録順で拾い、ほかは含めない", () => {
  const item = (o: OpenRecord): LedgerItem => ({ open: o, decisions: [], latest: undefined });
  const ledger: Ledger = {
    items: [
      item(open("architect.1-aaaa", "architect", { at: "2026-11-17T10:05:00.000Z" })),
      item(open("build-01.1-bbbb", "build-01", { type: "objection", harm: "中", at: "2026-11-17T10:10:00.000Z" })),
      item(open("build-02.1-cccc", "build-02", { when: "merge@build-03", at: "2026-11-17T10:00:00.000Z" })),
      item(open("q", "build-01", { type: "question" })),
      item(open("ai", "build-01", { who: "ai:build-01" })),
      item(open("now", "build-01", { when: "now" })),
      item(open("close", "build-03", { when: "merge@close" })),
      item(open("patch", "patch-202611-fix", { when: "merge@patch-202611-fix" })),
    ],
    orphans: [],
  };
  assert.deepEqual(ids(cycleConsentItems(ledger)), ["build-02.1-cccc", "architect.1-aaaa", "build-01.1-bbbb"]);
  assert.deepEqual(cycleConsentItems({ items: ledger.items.slice(3), orphans: [] }), []);
});

function tasklist(t: TestContext, rows: [string, string][] | undefined): string {
  const directory = temporaryDirectory(t);
  if (rows === undefined) return directory;
  writeFileSync(join(directory, "tasklist.md"), [
    "# tasklist", "", "| buildID | title | 予測ピーク | dependencies | PR |", "|---|---|---|---|---|",
    ...rows.map(([id, pr]) => `| ${id} | t | 350k | — | ${pr === "" ? "—" : pr} |`), "",
  ].join("\n"));
  return directory;
}

test("isLastBuild: ほかの全ビルドの PR 列で決め、自分の PR 列は見ない。build-NN でなければ false、読めない・行が無ければ true", (t) => {
  assert.equal(isLastBuild(tasklist(t, [["1", "#11"], ["2", "#12"], ["3", ""]]), "build-03"), true);
  assert.equal(isLastBuild(tasklist(t, [["1", "#11"], ["2", ""], ["3", ""]]), "build-03"), false);
  assert.equal(isLastBuild(tasklist(t, [["1", "#11"], ["2", "#12"], ["3", "#13"]]), "build-03"), true);
  const full = tasklist(t, [["1", "#11"], ["2", "#12"], ["3", "#13"]]);
  assert.equal(isLastBuild(full, "architect"), false);
  assert.equal(isLastBuild(full, "close"), false);
  assert.equal(isLastBuild(tasklist(t, undefined), "build-02"), true, "tasklist が無い");
  assert.equal(isLastBuild(tasklist(t, [["1", ""], ["2", ""]]), "build-04"), true, "行が無い");
  assert.equal(isLastBuild(tasklist(t, [["1", ""]]), "build-01"), true, "ビルドが1つ（解釈）");
});

test("closesMessage: 待ちの事項は decided の固定文、同意の項目は項目ごとの決定のひな形。同意の項目が無ければ従来の文面", () => {
  const plain = closesMessage("build-02", "001", ["build-02.3-llll"], "延ばす");
  assert.equal(plain, [
    "次の事項はユーザーの答えで閉じます。続きに進む前に、それぞれを記録してください（答えは書き換えずにそのまま渡す）。",
    "- hikyaku ledger decide build-02 build-02.3-llll 001 --decision decided --by user --input='延ばす'",
    "",
    "ユーザーの答え:",
    "延ばす",
  ].join("\n"));
  const both = closesMessage("build-03", "001", ["build-03.3-nnnn"], "aaaa は同意", [{ open: { id: "architect.1-aaaa" } }]);
  assert.match(both, /build-03\.3-nnnn 001 --decision decided --by user/);
  assert.match(both, /項目ごとに consented \/ decided \/ rejected \/ resolved を選び/);
  assert.match(both, /--accepts/);
  assert.match(both, /ledger decide build-03 architect\.1-aaaa 001 --decision <consented\|decided\|rejected\|resolved> --by user --input='aaaa は同意'/);
  assert.doesNotMatch(both, /architect\.1-aaaa 001 --decision decided/);
  const only = closesMessage("build-03", "001", [], "同意", [{ open: { id: "architect.1-aaaa" } }]);
  assert.doesNotMatch(only, /--decision decided/);
});

// ---------------------------------------------------------------------------
// conductorConsentMode・consentTargets・consentProblem（このプロセスで、実際の有効の判定を使う）

test("conductorConsentMode: 事後同意が有効なサイクルの子だけ、architect と最後以外は deferred、最後のビルドは last。close-cycle と子でないのは none", (t) => {
  const directory = cycleWorkspace(t);
  prDone(directory, 1);
  const config = configOf(directory);
  const mode =(skill: string, unit: string) => conductorConsentMode(skill, ctxOf(config, directory, unit));
  assert.equal(mode("builder", "build-03"), "none", "子でない");
  withEnv(CHILD, () => {
    assert.equal(mode("architect", "architect"), "deferred");
    assert.equal(mode("builder", "build-02"), "deferred");
    assert.equal(mode("builder", "build-03"), "deferred", "build-02 の PR 列が空");
  });
  prDone(directory, 2);
  withEnv(CHILD, () => {
    assert.equal(mode("builder", "build-03"), "last");
    assert.equal(mode("close-cycle", "close"), "none");
  });

  // consentTargets: last ならサイクル全体、子でなければその単位だけ
  record(directory, "architect", open("architect.1-aaaa", "architect"));
  record(directory, "build-01", open("build-01.1-bbbb", "build-01", { type: "objection", harm: "中" }));
  record(directory, "build-03", open("build-03.1-eeee", "build-03"));
  const ledger = readLedger(join(directory, CYCLE));
  const ctx = ctxOf(config, directory, "build-03");
  assert.deepEqual(ids(withEnv(CHILD, () => consentTargets(ledger, "builder", ctx))), ["architect.1-aaaa", "build-01.1-bbbb", "build-03.1-eeee"]);
  assert.deepEqual(ids(consentTargets(ledger, "builder", ctx)), ["build-03.1-eeee"]);

  // 全ビルドの PR 列が埋まった後の architect の子（指摘からの追加設計）は none（後ろに拾う同意ゲートが無い）
  prDone(directory, 3);
  withEnv(CHILD, () => assert.equal(mode("architect", "architect"), "none"));

  // tasklist を読めないビルドの子は last、architect の子は none（止める向き）
  writeFileSync(join(directory, CYCLE, "tasklist.md"), "壊れた tasklist\n");
  withEnv(CHILD, () => {
    assert.equal(mode("builder", "build-02"), "last");
    assert.equal(mode("architect", "architect"), "none");
  });
});

test("conductorConsentMode: 選んでいない・選んでいても有効でない（merge_gate が無い）サイクルの子は none", (t) => {
  for (const setup of [{ consent: false }, { mergeGate: false }]) {
    const directory = cycleWorkspace(t, setup);
    prDone(directory, 1, 2);
    const config = configOf(directory);
    withEnv(CHILD, () => {
      assert.equal(conductorConsentMode("architect", ctxOf(config, directory, "architect")), "none", JSON.stringify(setup));
      assert.equal(conductorConsentMode("builder", ctxOf(config, directory, "build-03")), "none", JSON.stringify(setup));
    });
  }
});

test("consentProblem: close-cycle の子は、事後同意が有効でも決定の無い項目で止まり blocked を案内する", (t) => {
  const directory = cycleWorkspace(t);
  prDone(directory, 1, 2, 3);
  record(directory, "build-03", open("build-03.2-gggg", "build-03", { when: "merge@close" }));
  const config = configOf(directory);
  const problem = withEnv(CHILD, () => consentProblem("close-cycle")(ctxOf(config, directory, "close"))) ?? "";
  assert.match(problem, /build-03\.2-gggg/);
  assert.match(problem, /PR を完了にせず、blocked でユーザーに上げてください/);
});

test("deferrablePremisesProblem: 宣言の参照（app.*・宣言にある area）だけを受け付ける", (t) => {
  const directory = cycleWorkspace(t);
  const config = configOf(directory);
  assert.equal(deferrablePremisesProblem(config, ["app.exposure", "area:billing"]), undefined);
  assert.equal(typeof deferrablePremisesProblem(config, ["app.exposure", "README.md"]), "string");
  assert.equal(typeof deferrablePremisesProblem(config, ["app.exposure", "adr:x.md"]), "string");
  assert.equal(typeof deferrablePremisesProblem(config, ["area:payments"]), "string");
  assert.equal(typeof deferrablePremisesProblem(config, []), "string");
});

// ---------------------------------------------------------------------------
// CLI: 最後のビルドの子の同意ゲート

test("CLI: 最後のビルドの子では、ほかの単位で記録した項目で同意ゲートが現れ、サイクル全体が args に入り、監督の位置とも一致する", (t) => {
  const directory = cycleWorkspace(t);
  prDone(directory, 1, 2);
  const env = childEnv(t);
  upTo(directory, env, "build-03");
  // サイクル全体に対象が無ければ、監督も子も pr
  assert.equal(nextOf(directory, "build-03", env).step, "pr");

  record(directory, "architect", open("architect.1-aaaa", "architect", { at: "2026-11-17T00:00:00.000Z" }));
  const gate = nextOf(directory, "build-03", env);
  assert.deepEqual([gate.kind, gate.step, gate.ask], ["gate", "consent", "deferred-consent"]);
  // 子でないセッションの build-03 の対象は merge@build-03 だけなので、ゲートは現れない
  assert.equal(nextOf(directory, "build-03").step, "pr");

  // 監督（conductor parse の childStep。位置だけの評価）も consent を現在地とする
  const digest = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json")).digest as string;
  write(directory, "r.json", JSON.stringify({ type: "result", subtype: "success", is_error: false, result: '<hikyaku-gate id="deferred-consent">\n一覧\n</hikyaku-gate>', session_id: SESSION, total_cost_usd: 1 }));
  const parsed = JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest, "--json"));
  assert.equal(parsed.step.step, "consent");
  assert.deepEqual(parsed.stepProblems, []);

  record(directory, "build-01", open("build-01.1-bbbb", "build-01", { type: "objection", harm: "中", at: "2026-11-17T00:01:00.000Z" }));
  record(directory, "build-03", open("build-03.1-eeee", "build-03", { at: "2026-11-17T00:02:00.000Z" }));
  assert.deepEqual(nextOf(directory, "build-03", env).args?.["items"], ["architect.1-aaaa", "build-01.1-bbbb", "build-03.1-eeee"]);

  // ほかの単位の決定の無い項目では、承認も pr も受け付けない（案内は consent.md）
  record(directory, "build-03", decide("build-03.1-eeee", "build-03"), decide("build-01.1-bbbb", "build-03"));
  const refused = reportOf(directory, env, "build-03", "consent", "--result", "approved", "--input", "OK");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /architect\.1-aaaa/);
  assert.doesNotMatch(refused.stderr, /build-03\.1-eeee/);
  assert.match(refused.stderr, /consent\.md/);
  assert.doesNotMatch(refused.stderr, /blocked/);

  record(directory, "build-03", decide("architect.1-aaaa", "build-03"));
  reported(directory, env, "build-03", "consent", "--result", "approved", "--input", "全項目に同意した");
  assert.equal(nextOf(directory, "build-03", env).step, "pr");

  // 承認のあとに、ほかの単位へ決定の無い対象が足されたら取り直す
  record(directory, "build-01", open("build-01.2-ffff", "build-01", { at: new Date(Date.now() + 1000).toISOString() }));
  const reopened = nextOf(directory, "build-03", env);
  assert.equal(reopened.step, "consent");
  assert.match(JSON.stringify(reopened), /build-01\.2-ffff/);
  // 足された項目に決定が付けば、取り直しは要らない（決定の足りない対象だけで取り直す）
  record(directory, "build-03", decide("build-01.2-ffff", "build-03", { at: new Date(Date.now() + 2000).toISOString() }));
  assert.equal(nextOf(directory, "build-03", env).step, "pr");
  prDone(directory, 3);
  assert.equal(reported(directory, env, "build-03", "pr", "--result", "done", "--pr", PR(13)).step, "publish");
});

test("CLI: 最後のビルドの子で記録を読めなければ同意ゲートを手順に入れ、監督も同じ位置を読む", (t) => {
  const directory = cycleWorkspace(t);
  prDone(directory, 1, 2);
  const env = childEnv(t);
  upTo(directory, env, "build-03");
  write(directory, `${CYCLE}/build-01/decisions.jsonl`, "{broken\n");
  const gate = nextOf(directory, "build-03", env);
  assert.equal(gate.step, "consent");
  assert.match(String(gate.args?.["error"]), /読めません/);
  const digest = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json")).digest as string;
  write(directory, "r.json", JSON.stringify({ type: "result", subtype: "success", is_error: false, result: '<hikyaku-gate id="deferred-consent">\n一覧\n</hikyaku-gate>', session_id: SESSION, total_cost_usd: 1 }));
  assert.equal(JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest, "--json")).step.step, "consent");
});

// ---------------------------------------------------------------------------
// CLI: architect・最後以外のビルドの子

test("CLI: 事後同意が有効なサイクルの最後以外のビルドの子は、merge@ の項目で止まらず pr を完了でき、--defer は PR の前だけ受け付ける", (t) => {
  const directory = cycleWorkspace(t);
  const env = childEnv(t);
  upTo(directory, env, "build-02");
  record(directory, "build-02", open("build-02.1-dddd", "build-02"));
  assert.equal(nextOf(directory, "build-02", env).step, "pr");
  // 監督の childStep も pr
  const digest = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json")).digest as string;
  write(directory, "r.json", JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "<hikyaku-done next=\"\">\n済み\n</hikyaku-done>", session_id: SESSION, total_cost_usd: 1 }));
  assert.equal(JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest, "--json")).step.step, "pr");

  const object = ["ledger", "object", "build-02", "001", "--summary", "公開 API の入力検証を後に回す", "--basis", '[app] exposure = "internal"', "--loses", "不正な入力を最初から弾けない", "--harm", "高", "--defer", "--premises", "app.exposure", "--json"];
  const deferred = cliWith(directory, CHILD, ...object);
  assert.equal(deferred.status, 0, deferred.stderr);
  const item = (JSON.parse(deferred.stdout) as { record: OpenRecord }).record;
  assert.deepEqual([item.who, item.when], ["user", "merge@build-02"]);

  prDone(directory, 2);
  reported(directory, env, "build-02", "pr", "--result", "done", "--pr", PR(12));
  // PR を作った後（PR 列が埋まった後）は、ほかのビルドが最後になって同意ゲートを過ぎているかもしれないので拒む
  const before = ledgerOf(directory, "build-02").length;
  assert.equal(cliWith(directory, CHILD, ...object).status, 1);
  assert.equal(ledgerOf(directory, "build-02").length, before);

  // 最後のビルド（build-03）の子の同意ゲートに載る
  prDone(directory, 1);
  const env3 = childEnv(t, "s-03");
  upTo(directory, env3, "build-03");
  const gate = nextOf(directory, "build-03", env3);
  assert.equal(gate.step, "consent");
  assert.ok((gate.args?.["items"] as string[]).includes(item.id));
  assert.ok((gate.args?.["items"] as string[]).includes("build-02.1-dddd"));
});

test("CLI: 最後以外のビルドの子でも、同じ単位で退けて作り直していない項目があれば pr を受け付けない", (t) => {
  const directory = cycleWorkspace(t);
  const env = childEnv(t);
  upTo(directory, env, "build-02");
  record(directory, "build-02",
    open("build-02.1-dddd", "build-02", { step: "implement", at: "2026-11-17T00:00:00.000Z" }),
    decide("build-02.1-dddd", "build-02", { decision: "rejected", at: new Date(Date.now() + 1000).toISOString() }));
  prDone(directory, 2);
  const refused = reportOf(directory, env, "build-02", "pr", "--result", "done", "--pr", PR(12));
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /退けた項目を作り直していません（build-02\.1-dddd → implement）/);
});

test("事後同意が有効なサイクルの architect の子は、merge@architect の項目で同意ゲートを手順に入れず、pr も止めない。--defer も受け付ける", (t) => {
  // architect の手順を pr まで CLI で進めるには build-manager の記録が要るので、ステップ定義をこのプロセスで評価する
  const directory = cycleWorkspace(t, { builds: false });
  record(directory, "architect", open("architect.1-aaaa", "architect"));
  const config = configOf(directory);
  const ctx = ctxOf(config, directory, "architect");
  const gate = ARCHITECT_STEPS.steps.find((step) => step.id === "consent");
  const pr = ARCHITECT_STEPS.steps.find((step) => step.id === "pr");
  assert.equal(gate?.when?.(ctx), true, "子でなければ手順に入る");
  assert.match(pr?.accepts?.(ctx) ?? "", /architect\.1-aaaa/);
  withEnv(CHILD, () => {
    assert.equal(gate?.when?.(ctx), false);
    assert.equal(pr?.accepts?.(ctx), undefined);
  });
  const object = cliWith(directory, CHILD, "ledger", "object", "architect", "001", "--summary", "s", "--basis", "b", "--loses", "l", "--harm", "高", "--defer", "--premises", "app.exposure");
  assert.equal(object.status, 0, object.stderr);
  // 差し戻しからの再設計の回は、子でも最後のビルドへ回さない（その場の同意のまま）
  const restart = { at: "2026-11-17T00:00:00.000Z", skill: "architect", step: "*", result: "restart" as const, round: "return" };
  assert.equal(typeof withEnv(CHILD, () => consentGateSlot(ARCHITECT_STEPS, { ...ctx, events: [restart] })), "string");
  assert.equal(withEnv(CHILD, () => consentGateSlot(ARCHITECT_STEPS, ctx)), undefined);
});

test("CLI: 事後同意が無効なサイクルの子は、従来どおり同意ゲートを手順に入れず、決定の無い項目で pr が blocked を案内し、--defer を拒む", (t) => {
  const directory = cycleWorkspace(t, { consent: false });
  prDone(directory, 1, 2);
  const env = childEnv(t);
  upTo(directory, env, "build-03");
  record(directory, "build-03", open("build-03.1-eeee", "build-03"));
  assert.equal(nextOf(directory, "build-03", env).step, "pr");
  prDone(directory, 3);
  const refused = reportOf(directory, env, "build-03", "pr", "--result", "done", "--pr", PR(13));
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /build-03\.1-eeee/);
  assert.match(refused.stderr, /PR を完了にせず、blocked でユーザーに上げてください/);
  const before = ledgerOf(directory, "build-03").length;
  const object = cliWith(directory, CHILD, "ledger", "object", "build-03", "001", "--summary", "s", "--basis", "b", "--loses", "l", "--harm", "高", "--defer", "--premises", "app.exposure");
  assert.equal(object.status, 1);
  assert.equal(ledgerOf(directory, "build-03").length, before);
});

test("CLI: 最後のビルドの子は同意ゲートの手前なら --defer を受け付け、pr の後は拒む。close-cycle の子は拒む", (t) => {
  const directory = cycleWorkspace(t);
  prDone(directory, 1, 2);
  const env = childEnv(t);
  upTo(directory, env, "build-03", "implement");
  const object = (unit: string) =>
    cliWith(directory, CHILD, "ledger", "object", unit, "001", "--summary", "s", "--basis", "b", "--loses", "l", "--harm", "高", "--defer", "--premises", "app.exposure", "--json");
  const accepted = object("build-03");
  assert.equal(accepted.status, 0, accepted.stderr);
  const id = (JSON.parse(accepted.stdout) as { record: OpenRecord }).record.id;
  record(directory, "build-03", decide(id, "build-03", { decision: "consented", accepts: "受け入れる", at: new Date(Date.now() + 1000).toISOString() }));
  upToRest(directory, env);
  reported(directory, env, "build-03", "consent", "--result", "approved", "--input", "OK");
  prDone(directory, 3);
  reported(directory, env, "build-03", "pr", "--result", "done", "--pr", PR(13));
  const before = ledgerOf(directory, "build-03").length;
  assert.equal(object("build-03").status, 1);
  assert.equal(ledgerOf(directory, "build-03").length, before);

  const close = object("close");
  assert.equal(close.status, 1);
  assert.match(close.stderr, /同意ゲートがありません/);
});

/** implement から handoff まで（upTo の残り） */
function upToRest(directory: string, env: NodeJS.ProcessEnv): void {
  const build = `${CYCLE}/build-03`;
  reported(directory, env, "build-03", "implement", "--result", "done");
  reported(directory, env, "build-03", "verify", "--result", "done");
  write(directory, `${build}/agreement.md`);
  reported(directory, env, "build-03", "agreement-review", "--result", "done");
  reported(directory, env, "build-03", "review", "--result", "done");
  write(directory, `${build}/handoff.md`);
  reported(directory, env, "build-03", "handoff", "--result", "done");
}

// ---------------------------------------------------------------------------
// CLI: ledger consent-list・pr-section・return-draft

test("CLI: consent-list と return-draft は、最後のビルドの子ではサイクル全体、子でなければその単位だけを対象にする", (t) => {
  const directory = cycleWorkspace(t);
  prDone(directory, 1, 2);
  record(directory, "architect", open("architect.1-aaaa", "architect"));
  record(directory, "build-01", open("build-01.1-bbbb", "build-01", { type: "objection", harm: "中" }));
  record(directory, "build-03", open("build-03.1-eeee", "build-03"));
  const list = (env: NodeJS.ProcessEnv) => {
    const result = cliWith(directory, env, "ledger", "consent-list", "build-03", "001", "--json");
    assert.equal(result.status, 0, result.stderr);
    return (JSON.parse(result.stdout) as { items: { id: string }[] }).items.map((entry) => entry.id);
  };
  assert.deepEqual(list(CHILD), ["architect.1-aaaa", "build-01.1-bbbb", "build-03.1-eeee"]);
  assert.deepEqual(list({}), ["build-03.1-eeee"]);
  // 監督は子を装わずに --all でサイクル全体を並べる
  const all = JSON.parse(succeeds(directory, "ledger", "consent-list", "build-03", "001", "--all", "--json")) as { items: { id: string }[] };
  assert.deepEqual(all.items.map((entry) => entry.id), ["architect.1-aaaa", "build-01.1-bbbb", "build-03.1-eeee"]);
  assert.match(cliWith(directory, CHILD, "ledger", "consent-list", "build-03", "001").stdout, /（サイクル全体）/);

  record(directory, "build-03", decide("architect.1-aaaa", "build-03", { decision: "rejected" }));
  const draft = cliWith(directory, CHILD, "ledger", "return-draft", "build-03", "001", "--items", "architect.1-aaaa");
  assert.equal(draft.status, 0, draft.stderr);
  assert.match(draft.stdout, /architect\.1-aaaa/);
  const refused = cli(directory, "ledger", "return-draft", "build-03", "001", "--items", "architect.1-aaaa");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /同意ゲートの項目ではありません/);
});

test("CLI: pr-section --all はサイクル全体の受け入れ・決定の無い項目・退け・merge@ の question/provisional を出し、出どころを添え、書き込まない", (t) => {
  const directory = cycleWorkspace(t);
  record(directory, "architect",
    open("architect.1-aaaa", "architect"),
    open("architect.2-iiii", "architect", { type: "provisional" }));
  record(directory, "build-01",
    open("build-01.1-bbbb", "build-01", { type: "objection", harm: "中" }),
    open("build-01.3-jjjj", "build-01", { type: "question" }));
  record(directory, "build-02", open("build-02.1-cccc", "build-02"), decide("build-02.1-cccc", "build-02", { decision: "rejected" }));
  record(directory, "build-03", decide("architect.1-aaaa", "build-03", { from: "user" }));
  const before = snapshot(directory);
  const json = JSON.parse(succeeds(directory, "ledger", "pr-section", "build-03", "001", "--all", "--json"));
  assert.deepEqual(json.accepted, ["architect.1-aaaa"]);
  assert.deepEqual(json.undecided, ["build-01.1-bbbb"]);
  assert.deepEqual(json.rejected, ["build-02.1-cccc"]);
  assert.deepEqual([...json.beforeMerge].sort(), ["architect.2-iiii", "build-01.3-jjjj"]);
  const text = succeeds(directory, "ledger", "pr-section", "build-03", "001", "--all");
  assert.match(text, /決定: consented（ユーザー・出どころ: user）/);
  assert.deepEqual(snapshot(directory), before);

  // --all なしの子でないセッションは、ほかの単位の項目を出さない（未解決の退けはサイクル全体のまま）
  const own = JSON.parse(succeeds(directory, "ledger", "pr-section", "build-03", "001", "--json"));
  assert.deepEqual([own.accepted, own.undecided, own.beforeMerge], [[], [], []]);

  // --all なしでも、最後のビルドの子では同意の対象がサイクル全体、question・provisional は自分の単位だけ
  prDone(directory, 1, 2);
  record(directory, "build-03", open("build-03.2-kkkk", "build-03", { type: "provisional" }));
  const child = JSON.parse(cliWith(directory, CHILD, "ledger", "pr-section", "build-03", "001", "--json").stdout);
  assert.ok(child.accepted.includes("architect.1-aaaa"));
  assert.deepEqual(child.beforeMerge, ["build-03.2-kkkk"]);

  // from の無い決定は従来どおりの表示
  const plain = cycleWorkspace(t);
  record(plain, "architect", open("architect.1-aaaa", "architect"));
  record(plain, "build-03", decide("architect.1-aaaa", "build-03"));
  assert.doesNotMatch(succeeds(plain, "ledger", "pr-section", "build-03", "001", "--all"), /出どころ/);
});

// ---------------------------------------------------------------------------
// CLI: ledger decide --by supervisor と事後同意の risk の同時記録

function supervisorEnv(defer: boolean, risk = "高:app.exposure"): NodeJS.ProcessEnv {
  return {
    ...CHILD, HIKYAKU_ANSWER_FROM: "supervisor", HIKYAKU_ANSWER_ASK: "questions", HIKYAKU_ANSWER_RISK: risk, HIKYAKU_ANSWER_TOKEN: "t-001",
    ...(defer ? { HIKYAKU_ANSWER_DEFER: "1" } : {}),
  };
}

test("CLI: DEFER の監督の答えは --loses を求め、決定と risk の事項を同時に書く。最後のビルドの同意ゲートに載る", (t) => {
  const directory = cycleWorkspace(t);
  const question = JSON.parse(succeeds(directory, "ledger", "open", "build-02", "001", "--type", "question", "--who", "supervisor", "--when", "now", "--ask", "questions", "--summary", "ログの保持期間", "--json")).record.id as string;
  const decideArgs = ["ledger", "decide", "build-02", question, "001", "--decision", "decided", "--by", "supervisor", "--input", "ログの保持を延ばす"];
  const before = ledgerOf(directory, "build-02").length;
  const refused = cliWith(directory, supervisorEnv(true), ...decideArgs);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--loses/);
  assert.equal(ledgerOf(directory, "build-02").length, before);

  const written = cliWith(directory, supervisorEnv(true), ...decideArgs, "--loses", "保持を短くして漏えい時の範囲を狭める利点");
  assert.equal(written.status, 0, written.stderr);
  const records = ledgerOf(directory, "build-02");
  const decision = records.find((entry) => entry["record"] === "decide");
  assert.equal(decision?.["token"], "t-001");
  const risk = records.find((entry) => entry["record"] === "open" && entry["type"] === "risk");
  assert.ok(risk, JSON.stringify(records));
  assert.equal(risk["who"], "user");
  assert.equal(risk["when"], "merge@build-02");
  assert.equal(risk["harm"], "高");
  assert.deepEqual(risk["premises"], ["app.exposure"]);
  assert.equal(risk["loses"], "保持を短くして漏えい時の範囲を狭める利点");
  assert.equal(risk["ask"], "questions");
  assert.equal(risk["source"], "supervisor-answer");
  assert.equal(risk["token"], "t-001");
  assert.equal(risk["summary"], "監督の答え（questions）で受け入れたリスク: ログの保持期間");
  // 同じ起動の答えで2つ目の事項を閉じても、risk の事項は重ねない（--loses も求めない）
  const second = JSON.parse(succeeds(directory, "ledger", "open", "build-02", "001", "--type", "question", "--who", "supervisor", "--when", "now", "--ask", "questions", "--summary", "ログの保存先", "--json")).record.id as string;
  const again = cliWith(directory, supervisorEnv(true), "ledger", "decide", "build-02", second, "001", "--decision", "decided", "--by", "supervisor", "--input", "同じ答え");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(ledgerOf(directory, "build-02").filter((entry) => entry["type"] === "risk").length, 1);

  // 最後のビルドの子の consent-list に、決定の無い状態で載る
  prDone(directory, 1, 2);
  const list = JSON.parse(cliWith(directory, CHILD, "ledger", "consent-list", "build-03", "001", "--json").stdout) as { undecided: string[] };
  assert.ok(list.undecided.includes(risk["id"] as string));
});

test("CLI: DEFER でない監督の答えには risk の事項を書かず、--loses も受け付けない", (t) => {
  const directory = cycleWorkspace(t);
  const question = JSON.parse(succeeds(directory, "ledger", "open", "build-02", "001", "--type", "question", "--who", "supervisor", "--when", "now", "--ask", "questions", "--summary", "s", "--json")).record.id as string;
  const args = ["ledger", "decide", "build-02", question, "001", "--decision", "decided", "--by", "supervisor", "--input", "x"];
  assert.equal(cliWith(directory, supervisorEnv(false, "中:app.exposure"), ...args, "--loses", "l").status, 1);
  const result = cliWith(directory, supervisorEnv(false, "中:app.exposure"), ...args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(ledgerOf(directory, "build-02").filter((entry) => entry["type"] === "risk").length, 0);
});

// ---------------------------------------------------------------------------
// CLI: conductor launch

function digestOf(directory: string): string {
  return JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json")).digest as string;
}

function launch(directory: string, phase: string, build: string | undefined, ...args: string[]) {
  return cli(directory, "conductor", "launch", phase, "001", ...(build === undefined ? [] : [build]), ...args, "--expect-digest", digestOf(directory), "--json");
}

test("CLI: launch は事後同意が有効で、子に同意ゲートの置き場があり、前提が宣言だけなら上限を超える申告を受け付けて DEFER を渡す", (t) => {
  const directory = cycleWorkspace(t);
  write(directory, "answer.txt", "保持を延ばす\n");
  const env = childEnv(t, "s-02");
  upTo(directory, env, "build-02", "implement");
  const supervisor = (...extra: string[]) => launch(directory, "builder", "2", "--resume", "s-02", "--message", "answer.txt", "--from", "supervisor", "--ask", "questions", ...extra);

  const accepted = supervisor("--harm", "高", "--premises", "app.exposure");
  assert.equal(accepted.status, 0, accepted.stderr);
  const output = JSON.parse(accepted.stdout) as { command: string; argv: string[] };
  assert.ok(output.command.includes("HIKYAKU_ANSWER_DEFER=1"));
  assert.ok(output.command.includes("HIKYAKU_ANSWER_RISK='高:app.exposure'"));
  assert.match(output.argv[2] ?? "", /^この監督の答えは、AI に任せてよい上限を超える受け入れを/);
  assert.match(output.argv[2] ?? "", /--loses/);

  // 宣言にある area は害が中でも上限を超え、受け付ける
  const area = supervisor("--harm", "中", "--premises", "area:billing");
  assert.equal(area.status, 0, area.stderr);
  assert.ok(JSON.parse(area.stdout).command.includes("HIKYAKU_ANSWER_DEFER=1"));

  // 上限以内は DEFER を渡さない
  const within = launch(directory, "builder", "2", "--resume", "s-02", "--message", "answer.txt", "--from", "supervisor", "--ask", "review-findings", "--choice", "proceed", "--harm", "中", "--premises", "app.exposure");
  assert.equal(within.status, 0, within.stderr);
  assert.ok(!JSON.parse(within.stdout).command.includes("HIKYAKU_ANSWER_DEFER"));

  // 前提に宣言以外・宣言に無い area を含めば拒む
  assert.equal(supervisor("--harm", "高", "--premises", "app.exposure,adr:x.md").status, 1);
  assert.equal(supervisor("--harm", "高", "--premises", "area:payments").status, 1);
  // --resume が無く子の位置を確かめられなければ拒む
  assert.equal(launch(directory, "builder", "2", "--message", "answer.txt", "--from", "supervisor", "--ask", "questions", "--harm", "高", "--premises", "app.exposure").status, 1);
});

test("CLI: launch は事後同意が無効・close-cycle の子・pr を終えた最後のビルドの子への上限を超える申告を拒み、同意ゲートの手前の最後のビルドの子には受け付ける", (t) => {
  const off = cycleWorkspace(t, { consent: false });
  write(off, "answer.txt", "a\n");
  upTo(off, childEnv(t, "s-02"), "build-02", "implement");
  const refused = launch(off, "builder", "2", "--resume", "s-02", "--message", "answer.txt", "--from", "supervisor", "--ask", "questions", "--harm", "高", "--premises", "app.exposure");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /上限を超える/);
  assert.match(refused.stderr, /--escalate/);

  const directory = cycleWorkspace(t);
  write(directory, "answer.txt", "a\n");
  prDone(directory, 1, 2);
  const env = childEnv(t, "s-03");
  upTo(directory, env, "build-03", "implement");
  const over = () => launch(directory, "builder", "3", "--resume", "s-03", "--message", "answer.txt", "--from", "supervisor", "--ask", "questions", "--harm", "高", "--premises", "app.exposure");
  const before = over();
  assert.equal(before.status, 0, before.stderr);
  assert.ok(JSON.parse(before.stdout).command.includes("HIKYAKU_ANSWER_DEFER=1"));
  upToRest(directory, env);
  prDone(directory, 3);
  reported(directory, env, "build-03", "pr", "--result", "done", "--pr", PR(13));
  assert.equal(over().status, 1);

  // close-cycle の子
  const closeEnv = childEnv(t, "s-cl");
  reported(directory, closeEnv, "close", "collect", "--result", "done");
  assert.equal(launch(directory, "close-cycle", undefined, "--resume", "s-cl", "--message", "answer.txt", "--from", "supervisor", "--ask", "questions", "--harm", "高", "--premises", "app.exposure").status, 1);
});

test("CLI: launch --from user --closes は、最後のビルドの子ならサイクル全体の同意の項目を閉じられ、最後以外の子はほかの単位の項目を閉じられない", (t) => {
  const directory = cycleWorkspace(t);
  write(directory, "answer.txt", "aaaa は同意、bbbb は退ける\n");
  record(directory, "architect", open("architect.1-aaaa", "architect"));
  record(directory, "build-01", open("build-01.1-bbbb", "build-01"));
  const closes = (build: string, session: string) =>
    launch(directory, "builder", build, "--resume", session, "--message", "answer.txt", "--from", "user", "--ask", "deferred-consent", "--closes", "architect.1-aaaa,build-01.1-bbbb");
  // 最後以外（build-02 の PR 列が空）
  assert.equal(closes("2", "s-02").status, 1);

  prDone(directory, 1, 2);
  const result = closes("3", "s-03");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { command: string; argv: string[]; answerEnv: Record<string, string> };
  assert.equal(output.answerEnv["HIKYAKU_ANSWER_ITEMS"], "architect.1-aaaa,build-01.1-bbbb");
  assert.match(output.argv[2] ?? "", /項目ごとに consented \/ decided \/ rejected \/ resolved を選び/);
  assert.match(output.argv[2] ?? "", /ledger decide build-03 architect\.1-aaaa 001-test --decision <consented/);

  // 子は渡された ID に --by user で決定を書ける（from=user が残る）。渡されていない ID は拒む
  const env = { ...CHILD, HIKYAKU_ANSWER_FROM: "user", HIKYAKU_ANSWER_ITEMS: "architect.1-aaaa,build-01.1-bbbb" };
  assert.equal(cliWith(directory, env, "ledger", "decide", "build-03", "architect.1-aaaa", "001", "--decision", "consented", "--by", "user", "--input", "同意").status, 0);
  assert.equal(cliWith(directory, env, "ledger", "decide", "build-03", "build-01.1-bbbb", "001", "--decision", "rejected", "--by", "user", "--input", "退ける").status, 0);
  assert.ok(ledgerOf(directory, "build-03").every((entry) => entry["from"] === "user"));
  record(directory, "build-02", open("build-02.1-zzzz", "build-02"));
  assert.equal(cliWith(directory, env, "ledger", "decide", "build-03", "build-02.1-zzzz", "001", "--decision", "consented", "--by", "user", "--input", "x").status, 1);
  // 決定済みの項目（architect.1-aaaa は consented）は --closes に渡せない（決め直させない）
  assert.equal(launch(directory, "builder", "3", "--resume", "s-03", "--message", "answer.txt", "--from", "user", "--closes", "architect.1-aaaa").status, 1);
});

// ---------------------------------------------------------------------------
// CLI: conductor asks・ledger premises

test("CLI: conductor asks は事後同意の有効・無効と理由を JSON とテキストに出す", (t) => {
  const on = cycleWorkspace(t);
  const onJson = JSON.parse(succeeds(on, "conductor", "asks", "001", "--json"));
  assert.deepEqual([onJson.deferredConsent.requested, onJson.deferredConsent.effective], [true, true]);
  assert.match(succeeds(on, "conductor", "asks", "001"), /^事後同意: 有効/m);

  const off = cycleWorkspace(t, { mergeGate: false });
  const offJson = JSON.parse(succeeds(off, "conductor", "asks", "001", "--json"));
  assert.deepEqual([offJson.deferredConsent.requested, offJson.deferredConsent.effective], [true, false]);
  assert.match(offJson.deferredConsent.reason, /merge_gate/);
  assert.match(succeeds(off, "conductor", "asks", "001"), /^事後同意: 無効（.*merge_gate/m);
});

test("CLI: ledger premises --changed-from は、conductor ブランチで変えた宣言と、それを拠り所にした全フェーズの受け入れを出す", (t) => {
  const directory = cycleWorkspace(t);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/conductor");
  assert.equal(succeeds(directory, "ledger", "premises", "--changed-from", "main", "--format", "pr").trim(), "");
  const config = join(directory, ".hikyaku.config");
  writeFileSync(config, readFileSync(config, "utf8").replace('exposure = "internal"', 'exposure = "personal"'));
  record(directory, "architect", open("architect.1-aaaa", "architect"));
  record(directory, "build-01", open("build-01.1-bbbb", "build-01"), open("build-01.2-cccc", "build-01", { premises: ["app.data"] }));
  commit(directory, "宣言を変える");
  const section = succeeds(directory, "ledger", "premises", "--changed-from", "main", "--format", "pr");
  assert.match(section, /app\.exposure/);
  assert.match(section, /architect\.1-aaaa/);
  assert.match(section, /build-01\.1-bbbb/);
  assert.doesNotMatch(section, /build-01\.2-cccc/);
});
