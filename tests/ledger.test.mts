import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { appendJsonl, parseJsonl, readJsonl } from "../scripts/lib/jsonl.mts";
import {
  assertDecider,
  decideItem,
  formatWhen,
  noticeLines,
  openItem,
  parsePremise,
  parsePremises,
  parseWhen,
  parseWho,
  readLedger,
  summarize,
  timingOf,
  whoLabel,
  type CycleTimeline,
  type DecideRecord,
  type LedgerItem,
  type OpenRecord,
  type RefContext,
} from "../scripts/lib/ledger.mts";
import type { ProgressEvent } from "../scripts/lib/progress.mts";
import { build, cli, cliInput, snapshot, succeeds, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";

// ---------------------------------------------------------------------------
// jsonl

const isAny = (value: unknown): value is { record: string } =>
  typeof value === "object" && value !== null && ((value as { record?: unknown }).record === "open" || (value as { record?: unknown }).record === "decide");
const LABELS = { writer: "w。", shape: "記録" };

test("parseJsonl: 空行を読み飛ばし、壊れた行・形の合わない行は行番号つきでエラー", () => {
  assert.equal(parseJsonl('{"record":"open"}\n\n{"record":"decide"}\n', "x.jsonl", isAny, LABELS).length, 2);
  assert.throws(() => parseJsonl('{"record":"open"}\n{"record":"open",\n', "x.jsonl", isAny, LABELS), /x\.jsonl:2 を JSON として読めません/);
  assert.throws(() => parseJsonl('{"record":"open"}\n{"record":"bogus"}\n', "x.jsonl", isAny, LABELS), /x\.jsonl:2 は記録の形をしていません/);
});

test("readJsonl / appendJsonl: 無ければ空、追記でディレクトリを作る", (t) => {
  const path = join(temporaryDirectory(t), "build-09", "decisions.jsonl");
  assert.deepEqual(readJsonl(path, isAny, LABELS), []);
  appendJsonl(path, { record: "open" });
  assert.equal(readJsonl(path, isAny, LABELS).length, 1);
});

// ---------------------------------------------------------------------------
// いつ・誰が・前提

function refs(t: TestContext, opening = "build-02"): RefContext {
  const cycleDirectory = temporaryDirectory(t);
  mkdirSync(join(cycleDirectory, "patches", "202611", "fix-typo"), { recursive: true });
  return { cycleDirectory, builds: [build("1"), build("2")], opening };
}

test("parseWhen: 語彙の5種を受け付け、@unit を補って保存する", (t) => {
  const ctx = refs(t);
  assert.deepEqual(parseWhen("now", ctx), { kind: "now" });
  assert.deepEqual(parseWhen("phase:architect", ctx), { kind: "phase", phase: "architect" });
  assert.deepEqual(parseWhen("gate:G4", ctx), { kind: "gate", gate: "G4", unit: "architect" });
  assert.deepEqual(parseWhen("merge", ctx), { kind: "merge", unit: "build-02" });
  assert.deepEqual(parseWhen("close", ctx), { kind: "close" });
  assert.equal(formatWhen(parseWhen("gate:G1", ctx)), "gate:G1@plan");
  assert.equal(formatWhen(parseWhen("gate:G3", ctx)), "gate:G3@architect");
  assert.equal(formatWhen(parseWhen("gate:G10", ctx)), "gate:G10@close");
  assert.equal(formatWhen(parseWhen("gate:G8", ctx)), "gate:G8@build-02");
  assert.equal(formatWhen(parseWhen("merge@build-1", ctx)), "merge@build-01");
});

test("parseWhen: 語彙外・存在しないゲート・存在しない参照先・担わない単位を拒否する", (t) => {
  const ctx = refs(t);
  for (const raw of ["2026-12-01", "来週", "after:build-01", "", "gate:G9", "gate:", "phase:build-07", "merge@build-07",
    "merge@patch-202611-other", "gate:G8@architect", "gate:G2@build-01", "gate:P1@build-01", "gate:G6@plan", "phase:create", "phase:init"]) {
    assert.throws(() => parseWhen(raw, ctx), Error, raw);
  }
  assert.equal(formatWhen(parseWhen("merge@patch-202611-fix-typo", ctx)), "merge@patch-202611-fix-typo");
  assert.equal(formatWhen(parseWhen("gate:G6@architect", ctx)), "gate:G6@architect");
  assert.equal(formatWhen(parseWhen("gate:G6@build-01", ctx)), "gate:G6@build-01");
  assert.equal(formatWhen(parseWhen("gate:P1@patch-202611-fix-typo", ctx)), "gate:P1@patch-202611-fix-typo");
});

test("parseWho / whoLabel: 3種を受け付け、語彙外とフェーズでない ai を拒否する", () => {
  assert.equal(parseWho("user"), "user");
  assert.equal(whoLabel(parseWho("ai:build-03")), "AI（build-03）");
  assert.equal(whoLabel(parseWho("supervisor")), "監督");
  assert.equal(whoLabel("user"), "ユーザー");
  for (const raw of ["human", "ai", "ai:", "ai:reviewer", "conductor"]) assert.throws(() => parseWho(raw), Error, raw);
});

test("parsePremise / parsePremises: 書式の8種だけを受け付ける", () => {
  for (const raw of ["app.exposure", "app.data", "app.impact", "app.merge_gate", "area:billing", "constraints#no-external-send",
    "adr:20261116-pending-items-ledger.md", "assumption:外部公開はしない"]) {
    assert.doesNotThrow(() => parsePremise(raw), raw);
  }
  for (const raw of ["app.owner", "area:", "constraints", "docs/foo.md", "assumption:"]) assert.throws(() => parsePremise(raw), Error, raw);
  assert.deepEqual(parsePremises("app.exposure,adr:20261116-pending-items-ledger.md"), ["app.exposure", "adr:20261116-pending-items-ledger.md"]);
  assert.throws(() => parsePremises("app.exposure,app.bogus"));
  assert.throws(() => parsePremises("assumption:社内向け,外部は無い"));
});

test("assertDecider: who=user はユーザーだけ（答えが必須）、ほかは同じ種類かユーザー", () => {
  const user = { id: "x.1", who: "user" as const };
  assert.throws(() => assertDecider(user, "supervisor", "OK"), (error: Error & { hint?: string }) =>
    /監督 は決められません/.test(error.message) && /付け替える手順はありません/.test(error.hint ?? ""));
  assert.throws(() => assertDecider(user, "ai:build-03", undefined));
  assert.throws(() => assertDecider(user, "user", undefined), /--input/);
  assert.doesNotThrow(() => assertDecider(user, "user", "その方針で進めて"));
  const ai = { id: "x.2", who: "ai:architect" as const };
  assert.doesNotThrow(() => assertDecider(ai, "ai:build-02", undefined));
  assert.doesNotThrow(() => assertDecider(ai, "user", "OK"));
  assert.throws(() => assertDecider(ai, "supervisor", undefined));
  const supervisor = { id: "x.3", who: "supervisor" as const };
  assert.doesNotThrow(() => assertDecider(supervisor, "supervisor", undefined));
  assert.doesNotThrow(() => assertDecider(supervisor, "user", "OK"));
  assert.throws(() => assertDecider(supervisor, "ai:build-02", undefined));
});

// ---------------------------------------------------------------------------
// 読み書きと導出

function opened(id: string, unit: string, overrides: Partial<OpenRecord> = {}): OpenRecord {
  return { record: "open", at: "2026-11-16T10:00:00Z", id, unit, type: "question", summary: `事項 ${id}`, when: "now", who: "user", ...overrides };
}

function decided(id: string, unit: string, at: string, decision: DecideRecord["decision"]): DecideRecord {
  return { record: "decide", at, id, unit, decision, by: "user", input: "OK" };
}

test("openItem / decideItem: 決定は決めた単位に書き、事項のファイルは変えない。同じ ID の2回目の open は拒否", (t) => {
  const dir = temporaryDirectory(t);
  openItem(dir, opened("architect.1", "architect"), readLedger(dir));
  const before = readFileSync(join(dir, "design", "decisions.jsonl"), "utf8");
  decideItem(dir, decided("architect.1", "build-02", "2026-11-16T11:00:00Z", "decided"), readLedger(dir));
  assert.equal(readFileSync(join(dir, "design", "decisions.jsonl"), "utf8"), before);
  assert.equal(readFileSync(join(dir, "build-02", "decisions.jsonl"), "utf8").trim().split("\n").length, 1);
  assert.throws(() => openItem(dir, opened("architect.1", "architect", { who: "supervisor" }), readLedger(dir)), /すでに記録/);
  assert.equal(readFileSync(join(dir, "design", "decisions.jsonl"), "utf8"), before);
  assert.throws(() => decideItem(dir, { ...decided("architect.1", "build-02", "2026-11-16T12:00:00Z", "decided"), by: "supervisor" }, readLedger(dir)));
});

test("readLedger: 全単位を読み ID で結び、最新は at 順（同時刻は読み順で後のもの）", (t) => {
  const dir = temporaryDirectory(t);
  appendJsonl(join(dir, "decisions.jsonl"), opened("close.1", "close"));
  appendJsonl(join(dir, "planning", "decisions.jsonl"), opened("plan.1", "plan"));
  appendJsonl(join(dir, "design", "decisions.jsonl"), opened("architect.1", "architect"));
  appendJsonl(join(dir, "patches", "202611", "fix-typo", "decisions.jsonl"), opened("patch-202611-fix-typo.1", "patch-202611-fix-typo"));
  appendJsonl(join(dir, "design", "decisions.jsonl"), decided("architect.1", "architect", "2026-11-16T09:00:00Z", "decided"));
  appendJsonl(join(dir, "design", "decisions.jsonl"), decided("architect.1", "architect", "2026-11-16T10:00:00Z", "rejected"));
  appendJsonl(join(dir, "build-01", "decisions.jsonl"), decided("architect.1", "build-01", "2026-11-16T11:00:00Z", "resolved"));
  appendJsonl(join(dir, "build-01", "decisions.jsonl"), decided("plan.1", "build-01", "2026-11-16T10:00:00Z", "decided"));
  appendJsonl(join(dir, "design", "decisions.jsonl"), decided("plan.1", "architect", "2026-11-16T10:00:00Z", "rejected"));
  appendJsonl(join(dir, "build-02", "decisions.jsonl"), decided("missing.1", "build-02", "2026-11-16T10:00:00Z", "decided"));
  const ledger = readLedger(dir);
  assert.deepEqual(ledger.items.map((item) => item.open.id).sort(), ["architect.1", "close.1", "patch-202611-fix-typo.1", "plan.1"]);
  const item = (id: string): LedgerItem => ledger.items.find((entry) => entry.open.id === id) as LedgerItem;
  assert.equal(item("architect.1").latest?.decision, "resolved");
  assert.equal(item("plan.1").latest?.unit, "build-01", "同時刻は読み順（design → build-01）で後のもの");
  assert.equal(item("close.1").latest, undefined);
  assert.equal(ledger.orphans.length, 1);
  assert.equal("status" in item("close.1").open, false);
});

test("summarize: rejected が最新なら未解決の退け、resolved で消え、未決だけが open に入る", (t) => {
  const dir = temporaryDirectory(t);
  appendJsonl(join(dir, "build-02", "decisions.jsonl"), opened("build-02.1", "build-02"));
  appendJsonl(join(dir, "build-02", "decisions.jsonl"), opened("build-02.2", "build-02"));
  appendJsonl(join(dir, "build-02", "decisions.jsonl"), opened("build-02.3", "build-02", { when: "close" }));
  appendJsonl(join(dir, "build-02", "decisions.jsonl"), decided("build-02.1", "build-02", "2026-11-16T11:00:00Z", "rejected"));
  appendJsonl(join(dir, "build-02", "decisions.jsonl"), decided("build-02.2", "build-02", "2026-11-16T11:00:00Z", "rejected"));
  appendJsonl(join(dir, "build-02", "decisions.jsonl"), decided("build-02.2", "build-02", "2026-11-16T12:00:00Z", "resolved"));
  const summary = summarize(readLedger(dir), timeline({}));
  assert.deepEqual(summary.rejected.map((item) => item.open.id), ["build-02.1"]);
  assert.deepEqual(summary.open.map((item) => item.open.id), ["build-02.3"]);
  assert.deepEqual(summary.due, []);
});

// ---------------------------------------------------------------------------
// 期限

const AT = "2026-11-16T10:00:00Z";

function ev(at: string, skill: string, step: string, result: ProgressEvent["result"] = "done"): ProgressEvent {
  return { at: `2026-11-16T${at}:00Z`, skill, step, result };
}

function timeline(
  events: Record<string, ProgressEvent[]>,
  options: { active?: boolean; merged?: string[]; current?: Record<string, string | null> } = {},
): CycleTimeline {
  return {
    active: options.active ?? true,
    events: new Map(Object.entries(events)),
    current: new Map(Object.entries(options.current ?? {})),
    merged: options.merged === undefined ? undefined : new Set(options.merged),
  };
}

function timing(when: string, line: CycleTimeline, unit = "build-02"): string {
  return timingOf({ open: opened(`${unit}.1`, unit, { when, at: AT }), decisions: [], latest: undefined }, line);
}

test("timingOf: now は来たまま過ぎない", () => {
  assert.equal(timing("now", timeline({ "build-02": [ev("11:00", "builder", "plan")] })), "due");
});

test("timingOf: phase の来た・過ぎた", () => {
  assert.equal(timing("phase:plan", timeline({ plan: [ev("10:10", "planner", "inputs")] })), "due");
  assert.equal(timing("phase:plan", timeline({ plan: [ev("10:10", "planner", "inputs")], architect: [ev("11:00", "architect", "survey")] })), "overdue");
  assert.equal(timing("phase:architect", timeline({ architect: [ev("10:05", "architect", "survey")] })), "due");
  assert.equal(timing("phase:architect", timeline({ architect: [ev("09:50", "architect", "survey")] })), "pending");
  assert.equal(timing("phase:architect", timeline({ architect: [ev("10:05", "architect", "survey")], "build-01": [ev("11:00", "builder", "plan")] })), "overdue");
  const building = { "build-02": [ev("11:00", "builder", "plan")] };
  assert.equal(timing("phase:build-02", timeline(building, { merged: ["build-02"] })), "overdue");
  assert.equal(timing("phase:build-02", timeline(building, { merged: [] })), "due");
  assert.equal(timing("phase:build-02", timeline(building)), "due");
  assert.equal(timing("phase:patch-202611-fix-typo", timeline({ "patch-202611-fix-typo": [ev("11:00", "patch", "start"), ev("12:00", "patch", "publish")] })), "due");
  assert.equal(timing("phase:close", timeline({ close: [ev("11:00", "close-cycle", "collect")] })), "due");
  assert.equal(timing("phase:close", timeline({ close: [ev("11:00", "close-cycle", "collect")] }, { active: false })), "overdue");
});

test("timingOf: close は close-cycle の記録で来て、active でなくなって過ぎた", () => {
  assert.equal(timing("close", timeline({})), "pending");
  assert.equal(timing("close", timeline({ close: [ev("11:00", "create-cycle", "pr")] })), "pending");
  assert.equal(timing("close", timeline({ close: [ev("11:00", "close-cycle", "collect")] })), "due");
  assert.equal(timing("close", timeline({}, { active: false })), "overdue");
});

test("timingOf: gate は現在地か記録で来て、承認で過ぎ、前の回の承認は数えない", () => {
  assert.equal(timing("gate:G8@build-02", timeline({ "build-02": [] }, { current: { "build-02": "G8" } })), "due");
  assert.equal(timing("gate:G8@build-02", timeline({ "build-02": [ev("11:00", "builder", "G8", "rejected")] })), "due");
  assert.equal(timing("gate:G8@build-02", timeline({ "build-02": [ev("11:00", "builder", "G8", "approved")] })), "overdue");
  // 近似の現在地: test-spec-review まで終えたら次は G8
  assert.equal(timing("gate:G8@build-02", timeline({ "build-02": [ev("09:00", "builder", "test-spec-review")] })), "due");
  // architect の add の回: 前の回の G4 の承認では過ぎない
  const add = [ev("09:00", "architect", "G4", "approved"), ev("09:30", "architect", "pr"), { ...ev("11:00", "architect", "*", "restart"), round: "add" },
    ev("11:30", "architect", "survey")];
  const item = { open: opened("architect.1", "architect", { when: "gate:G4@architect", at: "2026-11-16T12:00:00Z" }), decisions: [], latest: undefined };
  assert.equal(timingOf(item, timeline({ architect: add })), "pending");
  const merge = { open: opened("architect.2", "architect", { when: "merge@architect", at: "2026-11-16T12:00:00Z" }), decisions: [], latest: undefined };
  assert.equal(timingOf(merge, timeline({ architect: add })), "pending");
});

test("timingOf: 外れたゲートは後ろのステップの完了で過ぎ、G6 は記録で判定する", () => {
  assert.equal(timing("gate:G7@build-02", timeline({ "build-02": [ev("11:00", "builder", "G8", "approved")] })), "overdue");
  assert.equal(timing("gate:G6@build-02", timeline({ "build-02": [ev("11:00", "build-manager", "G6", "rejected")] })), "due");
  assert.equal(timing("gate:G6@build-02", timeline({ "build-02": [ev("11:00", "build-manager", "G6", "approved")] })), "overdue");
  assert.equal(timing("gate:G6@build-02", timeline({ "build-02": [] }, { current: { "build-02": "G6" } })), "due");
});

test("timingOf: merge の区切り（pr / patch は publish）と、マージ済みのビルドで過ぎること", () => {
  const before = { "build-02": [ev("11:00", "builder", "review")] };
  const atPr = { "build-02": [ev("11:00", "builder", "retrospective")] };
  const done = { "build-02": [ev("11:00", "builder", "pr"), ev("11:10", "builder", "publish")] };
  assert.equal(timing("merge@build-02", timeline(before, { merged: [] })), "pending");
  assert.equal(timing("merge@build-02", timeline(atPr, { merged: [] })), "due");
  assert.equal(timing("merge@build-02", timeline(done, { merged: [] })), "due");
  assert.equal(timing("merge@build-02", timeline(done, { merged: ["build-02"] })), "overdue");
  assert.equal(timing("merge@build-02", timeline(done)), "due");
  assert.equal(timing("merge@build-02", timeline({}, { current: { "build-02": null } })), "due");
  // patch は Draft PR を先に作るので、pr の記録では来たにならない
  const patch = "patch-202611-fix-typo";
  assert.equal(timing(`merge@${patch}`, timeline({ [patch]: [ev("11:00", "patch", "pr")] }), patch), "pending");
  assert.equal(timing(`merge@${patch}`, timeline({ [patch]: [] }, { current: { [patch]: "publish" } }), patch), "due");
  // plan・architect のマージは導けないので来たのまま
  assert.equal(timing("merge@architect", timeline({ architect: [ev("11:00", "architect", "pr")] }, { merged: ["build-01", "build-02"] }), "architect"), "due");
});

test("noticeLines: 期限が来た・過ぎた事項を1事項1行にする", (t) => {
  const dir = temporaryDirectory(t);
  appendJsonl(join(dir, "planning", "decisions.jsonl"), opened("plan.1", "plan", { when: "now", summary: "対象の利用者" }));
  appendJsonl(join(dir, "design", "decisions.jsonl"), opened("architect.2", "architect", { when: "phase:architect", who: "ai:architect", at: AT }));
  appendJsonl(join(dir, "design", "decisions.jsonl"), opened("architect.3", "architect", { when: "close", at: AT }));
  const lines = noticeLines(summarize(readLedger(dir), timeline({ architect: [ev("10:30", "architect", "survey")], "build-01": [ev("11:00", "builder", "plan")] })));
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", /期限が来た未決事項 plan\.1（いつ: now・決める人: ユーザー）: 対象の利用者/);
  assert.match(lines[1] ?? "", /期限を過ぎた未決事項 architect\.2.*AI（architect）/);
});

// ---------------------------------------------------------------------------
// CLI

const CYCLE = "docs/hikyaku/cycles/001-test";

function cycleWorkspace(t: TestContext): string {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
  succeeds(directory, "tasklist", "add", "001", "--title", "画面", "--peak", "350k");
  write(directory, `${CYCLE}/build-02/issue.md`);
  return directory;
}

function json<T>(directory: string, ...args: string[]): T {
  return JSON.parse(succeeds(directory, ...args, "--json")) as T;
}

function git(directory: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", env: testEnvironment() });
  assert.equal(result.status, 0, result.stderr);
}

function commitAll(directory: string, message: string): void {
  git(directory, "add", "-A");
  git(directory, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", message);
}

test("ledger open: 記録して欄が show で読め、--dry-run は書き込まない", (t) => {
  const directory = cycleWorkspace(t);
  const before = snapshot(directory);
  succeeds(directory, "ledger", "open", "build-02", "001", "--type", "risk", "--when", "merge", "--who", "user", "--summary", "外部APIの退避", "--dry-run");
  assert.deepEqual(snapshot(directory), before);

  succeeds(directory, "ledger", "open", "build-02", "001", "--type", "risk", "--when", "merge", "--who", "user", "--summary", "外部APIの退避",
    "--premises", "app.exposure,assumption:社内向け", "--loses", "安全側の再試行", "--harm", "高", "--ask", "G8");
  assert.equal(existsSync(join(directory, CYCLE, "build-02", "decisions.jsonl")), true);
  const shown = json<{ open: OpenRecord }>(directory, "ledger", "show", "build-02.1", "001");
  assert.deepEqual(shown.open.premises, ["app.exposure", "assumption:社内向け"]);
  assert.equal(shown.open.loses, "安全側の再試行");
  assert.equal(shown.open.harm, "高");
  assert.equal(shown.open.ask, "G8");
  assert.equal(shown.open.when, "merge@build-02");
  assert.equal(shown.open.step, "plan");
  assert.equal(typeof shown.open.hikyaku, "string");
});

test("ledger open: 語彙外・存在しない参照先・書式外を拒否し、ASKS とゲートの ID は受け付ける", (t) => {
  const directory = cycleWorkspace(t);
  const base = ["ledger", "open", "build-02", "001", "--type", "question", "--summary", "s"];
  for (const extra of [
    ["--when", "gate:G9", "--who", "user"],
    ["--when", "after-review", "--who", "user"],
    ["--when", "now", "--who", "human"],
    ["--when", "now", "--who", "user", "--premises", "app.owner"],
    ["--when", "now", "--who", "user", "--harm", "低"],
    ["--when", "now", "--who", "user", "--ask", "nonexistent"],
    ["--when", "phase:build-07", "--who", "user"],
  ]) {
    assert.notEqual(cli(directory, ...base, ...extra).status, 0, extra.join(" "));
  }
  assert.equal(existsSync(join(directory, CYCLE, "build-02", "decisions.jsonl")), false);
  succeeds(directory, ...base, "--when", "now", "--who", "user", "--ask", "design-conflict");
  succeeds(directory, ...base, "--when", "now", "--who", "user", "--ask", "P1");
  assert.equal(json<{ open: OpenRecord }>(directory, "ledger", "show", "build-02.2", "001").open.ask, "P1");
});

test("ledger open: サイクルに属さない patch は拒否する", (t) => {
  const directory = workspace(t);
  const result = cli(directory, "ledger", "open", "patch-202611-fix", "--type", "question", "--when", "now", "--who", "user", "--summary", "s");
  assert.notEqual(result.status, 0);
});

test("ledger open: 外れたゲートを指すと記録して知らせる", (t) => {
  const directory = cycleWorkspace(t);
  const out = succeeds(directory, "ledger", "open", "build-02", "001", "--type", "question", "--when", "gate:G7", "--who", "user", "--summary", "s");
  assert.match(out, /G7 は今の設定では現れないので、後ろのステップに進むと期限を過ぎた事項になります/);
  assert.equal(existsSync(join(directory, CYCLE, "build-02", "decisions.jsonl")), true);
});

test("ledger decide: 決めた単位に書き、付け替えと答えの無い user と --dry-run は書き込まない", (t) => {
  const directory = cycleWorkspace(t);
  write(directory, `${CYCLE}/planning/user-stories.md`);
  succeeds(directory, "ledger", "open", "plan", "001", "--type", "provisional", "--when", "phase:architect", "--who", "ai:plan", "--summary", "暫定");
  succeeds(directory, "ledger", "open", "build-02", "001", "--type", "question", "--when", "now", "--who", "user", "--summary", "ユーザーの問い");
  const planning = readFileSync(join(directory, CYCLE, "planning", "decisions.jsonl"), "utf8");

  const before = snapshot(directory);
  succeeds(directory, "ledger", "decide", "build-02", "build-02.1", "001", "--decision", "decided", "--by", "user", "--input", "OK", "--dry-run");
  assert.notEqual(cli(directory, "ledger", "decide", "build-02", "build-02.1", "001", "--decision", "decided", "--by", "supervisor", "--input", "x").status, 0);
  assert.notEqual(cli(directory, "ledger", "decide", "build-02", "build-02.1", "001", "--decision", "decided", "--by", "ai:build-02").status, 0);
  assert.notEqual(cli(directory, "ledger", "decide", "build-02", "build-02.1", "001", "--decision", "decided", "--by", "user").status, 0);
  assert.deepEqual(snapshot(directory), before);

  succeeds(directory, "ledger", "decide", "build-02", "plan.1", "001", "--decision", "consented", "--by", "user", "--input", "それでよい",
    "--accepts", "再試行が無いことを受け入れる");
  assert.equal(readFileSync(join(directory, CYCLE, "planning", "decisions.jsonl"), "utf8"), planning);
  const shown = json<{ latest: DecideRecord }>(directory, "ledger", "show", "plan.1", "001");
  assert.equal(shown.latest.unit, "build-02");
  assert.equal(shown.latest.input, "それでよい");
  assert.equal(shown.latest.accepts, "再試行が無いことを受け入れる");
});

test("ledger decide: 2ブランチが同じ事項に決定を足してもマージで衝突しない", (t) => {
  const directory = cycleWorkspace(t);
  write(directory, `${CYCLE}/build-01/issue.md`);
  succeeds(directory, "ledger", "open", "architect", "001", "--type", "provisional", "--when", "close", "--who", "ai:architect", "--summary", "暫定");
  commitAll(directory, "base");
  git(directory, "branch", "a");
  git(directory, "branch", "b");
  git(directory, "checkout", "-q", "a");
  succeeds(directory, "ledger", "decide", "build-01", "architect.1", "001", "--decision", "decided", "--by", "ai:build-01");
  commitAll(directory, "a");
  git(directory, "checkout", "-q", "b");
  succeeds(directory, "ledger", "decide", "build-02", "architect.1", "001", "--decision", "rejected", "--by", "ai:build-02");
  commitAll(directory, "b");
  git(directory, "checkout", "-q", "main");
  git(directory, "-c", "user.name=t", "-c", "user.email=t@example.com", "merge", "-q", "--no-edit", "a");
  git(directory, "-c", "user.name=t", "-c", "user.email=t@example.com", "merge", "-q", "--no-edit", "b");
  const shown = json<{ decisions: DecideRecord[]; latest: DecideRecord }>(directory, "ledger", "show", "architect.1", "001");
  assert.equal(shown.decisions.length, 2);
  assert.equal(shown.latest.decision, "rejected");
});

test("ledger list / step next / cycle status: 期限を過ぎた事項を示し続け、Stop フックの経路では読まない", (t) => {
  const directory = cycleWorkspace(t);
  // plan で記録した phase:architect の事項。architect と build-01 に後の記録があるので過ぎた
  succeeds(directory, "ledger", "open", "plan", "001", "--type", "question", "--when", "phase:architect", "--who", "user", "--summary", "対象の利用者");
  succeeds(directory, "ledger", "open", "build-02", "001", "--type", "question", "--when", "close", "--who", "user", "--summary", "締めで決める");
  succeeds(directory, "ledger", "open", "build-02", "001", "--type", "question", "--when", "now", "--who", "user", "--summary", "退けた");
  succeeds(directory, "ledger", "decide", "build-02", "build-02.2", "001", "--decision", "rejected", "--by", "user", "--input", "やり直す");
  const later = new Date(Date.now() + 60_000).toISOString();
  write(directory, `${CYCLE}/design/progress.jsonl`, `${JSON.stringify({ at: later, skill: "architect", step: "survey", result: "done" })}\n`);
  write(directory, `${CYCLE}/build-01/progress.jsonl`, `${JSON.stringify({ at: later, skill: "builder", step: "plan", result: "done" })}\n`);

  const list = json<{ due: { id: string; timing: string }[]; open: { id: string }[]; rejected: { id: string }[] }>(directory, "ledger", "list", "001");
  assert.deepEqual(list.due.map((item) => [item.id, item.timing]), [["plan.1", "overdue"]]);
  assert.deepEqual(list.open.map((item) => item.id).sort(), ["build-02.1", "plan.1"]);
  assert.deepEqual(list.rejected.map((item) => item.id), ["build-02.2"]);

  const next = json<{ directive: { notices: string[] } }>(directory, "step", "next", "build-02", "001");
  assert.equal(next.directive.notices.length, 1);
  assert.match(next.directive.notices[0] ?? "", /期限を過ぎた未決事項 plan\.1/);

  const status = json<{ ledger: { due: { id: string }[]; open: { id: string }[]; rejected: { id: string }[] } }>(directory, "cycle", "status", "001", "--no-fetch");
  assert.deepEqual(status.ledger.due.map((item) => item.id), ["plan.1"]);
  assert.deepEqual(status.ledger.open.map((item) => item.id).sort(), ["build-02.1", "plan.1"]);
  assert.deepEqual(status.ledger.rejected.map((item) => item.id), ["build-02.2"]);
  assert.match(succeeds(directory, "cycle", "status", "001", "--no-fetch"), /未決事項/);

  // 決定を足すと due・open から消える
  succeeds(directory, "ledger", "decide", "build-02", "plan.1", "001", "--decision", "decided", "--by", "user", "--input", "社内の利用者");
  assert.deepEqual(json<{ due: unknown[] }>(directory, "ledger", "list", "001").due, []);

  // 壊れた記録: step next は止まるが、Stop フックと step where は読まない
  succeeds(directory, "step", "report", "build-02", "plan", "001", "--result", "failed", "--reason", "試し");
  writeFileSync(join(directory, CYCLE, "build-02", "decisions.jsonl"), "{broken\n", { flag: "a" });
  assert.notEqual(cli(directory, "step", "next", "build-02", "001").status, 0);
  assert.equal(cli(directory, "step", "where", "001").status, 0);
  const hook = cliInput(directory, JSON.stringify({ session_id: "s", stop_hook_active: false }), {}, "step", "hook", "stop");
  assert.equal(hook.status, 0);
  assert.doesNotMatch(hook.stderr, /decisions\.jsonl/);
});

test("cycle status: 記録が無ければ未決事項の節を出さない", (t) => {
  const directory = cycleWorkspace(t);
  assert.doesNotMatch(succeeds(directory, "cycle", "status", "001", "--no-fetch"), /未決事項/);
  assert.deepEqual(json<{ ledger: { due: unknown[]; open: unknown[]; rejected: unknown[] } }>(directory, "cycle", "status", "001", "--no-fetch").ledger,
    { due: [], open: [], rejected: [] });
});
