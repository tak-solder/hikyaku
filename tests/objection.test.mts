/**
 * build-04: 異議（ledger object とゲートの承認の検査）、委任の前提が崩れた出来事の delegation、
 * G1 のプロファイル、記録する側の手順。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CONSENT_WHEN, DEFAULT_CONDUCTOR, checkConductorAsks, resolveAsk, type AskSettings } from "../scripts/lib/conductor.mts";
import {
  latestOpenAt,
  readLedger,
  unacceptedObjections,
  UNREADABLE_AT,
  type DecideRecord,
  type Ledger,
  type LedgerItem,
  type OpenRecord,
} from "../scripts/lib/ledger.mts";
import { lintApproval } from "../scripts/lib/steps/engine.mts";
import { cli, cliInput, cliWith, snapshot, succeeds, temporaryDirectory, workspace, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const BUILD = `${CYCLE}/build-01`;
const ROOT = join(import.meta.dirname, "..");

// ---------------------------------------------------------------------------
// unacceptedObjections / latestOpenAt（単体）

function open(id: string, overrides: Partial<OpenRecord> = {}): OpenRecord {
  return {
    record: "open", at: "2026-11-16T00:00:00.000Z", id, unit: "build-02", step: "G8",
    type: "objection", summary: "s", when: "now", who: "user", harm: "高", ...overrides,
  };
}

function decide(id: string, overrides: Partial<DecideRecord> = {}): DecideRecord {
  return { record: "decide", at: "2026-11-16T01:00:00.000Z", id, unit: "build-02", decision: "consented", by: "user", input: "進める", ...overrides };
}

function ledgerOf(...items: [OpenRecord, DecideRecord[]][]): Ledger {
  return {
    items: items.map(([o, ds]): LedgerItem => ({ open: o, decisions: ds, latest: ds[ds.length - 1] })),
    orphans: [],
  };
}

const ids = (items: LedgerItem[]) => items.map((item) => item.open.id);

test("unacceptedObjections: 決定の無い高の異議は止め、accepts 付きのユーザーの consented で片づく", () => {
  assert.deepEqual(ids(unacceptedObjections(ledgerOf([open("a"), []]), "build-02", "G8")), ["a"]);
  assert.deepEqual(ids(unacceptedObjections(ledgerOf([open("a"), [decide("a", { accepts: "ログに残ることを受け入れる" })]]), "build-02", "G8")), []);
  // accepts が無い・空白だけ
  assert.deepEqual(ids(unacceptedObjections(ledgerOf([open("a"), [decide("a")]]), "build-02", "G8")), ["a"]);
  assert.deepEqual(ids(unacceptedObjections(ledgerOf([open("a"), [decide("a", { accepts: "  " })]]), "build-02", "G8")), ["a"]);
});

test("unacceptedObjections: ユーザー以外の決定では片づかず、最新の決定で判定する", () => {
  assert.deepEqual(ids(unacceptedObjections(ledgerOf([open("a"), [decide("a", { by: "supervisor", accepts: "受け入れる" })]]), "build-02", "G8")), ["a"]);
  assert.deepEqual(ids(unacceptedObjections(ledgerOf([open("a"), [decide("a", { by: "supervisor", decision: "decided" })]]), "build-02", "G8")), ["a"]);
  const later = decide("a", { at: "2026-11-16T02:00:00.000Z" });
  assert.deepEqual(ids(unacceptedObjections(ledgerOf([open("a"), [decide("a", { accepts: "受け入れる" }), later]]), "build-02", "G8")), ["a"]);
});

test("unacceptedObjections: ユーザーが選択を改めた decided で片づく（解釈）", () => {
  assert.deepEqual(ids(unacceptedObjections(ledgerOf([open("a"), [decide("a", { decision: "decided" })]]), "build-02", "G8")), []);
});

test("unacceptedObjections: 中の異議・別のステップ・別の作業単位・objection 以外は数えない", () => {
  const ledger = ledgerOf(
    [open("mid", { harm: "中" }), []],
    [open("step", { step: "plan-review" }), []],
    [open("unit", { unit: "build-03" }), []],
    [open("risk", { type: "risk" }), []],
  );
  assert.deepEqual(ids(unacceptedObjections(ledger, "build-02", "G8")), []);
});

test("latestOpenAt: 条件に合う最新の at、無ければ undefined、壊れていれば UNREADABLE_AT", (t) => {
  const directory = temporaryDirectory(t);
  assert.equal(latestOpenAt(directory, (r) => r.ask === "design-conflict"), undefined, "ファイルが無い");
  const path = join(directory, "decisions.jsonl");
  const lines = [
    open("x.1-aaaa", { ask: "design-conflict", at: "2026-11-16T01:00:00Z" }),
    open("x.2-aaaa", { ask: "design-conflict", at: "2026-11-16T03:00:00Z" }),
    open("x.3-aaaa", { at: "2026-11-16T05:00:00Z" }),
  ];
  writeFileSync(path, `${lines.slice(2).map((l) => JSON.stringify(l)).join("\n")}\n`);
  assert.equal(latestOpenAt(directory, (r) => r.ask === "design-conflict"), undefined, "合う事項が無い");
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  assert.equal(latestOpenAt(directory, (r) => r.ask === "design-conflict"), "2026-11-16T03:00:00Z");
  writeFileSync(path, `${JSON.stringify(lines[0])}\n{"record":"open",\n`);
  assert.equal(latestOpenAt(directory, () => true), UNREADABLE_AT);
  assert.equal(UNREADABLE_AT, "");
});

test("readLedger: basis の無い既存の open も読め、basis があれば読める", (t) => {
  const directory = temporaryDirectory(t);
  mkdirSync(join(directory, "build-02"), { recursive: true });
  writeFileSync(
    join(directory, "build-02", "decisions.jsonl"),
    `${JSON.stringify(open("build-02.1-aaaa"))}\n${JSON.stringify(open("build-02.2-aaaa", { basis: '[app] data = "personal"' }))}\n`,
  );
  const ledger = readLedger(directory);
  assert.equal(ledger.items.length, 2);
  assert.equal(ledger.items[1]?.open.basis, '[app] data = "personal"');
});

// ---------------------------------------------------------------------------
// CLI

interface Directive {
  kind: string;
  step?: string;
  approval?: string;
  revise?: string;
  args?: Record<string, unknown>;
  objection?: { guide: string[]; pointers: string[]; command: string };
}

function built(t: TestContext): string {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
  write(directory, `${BUILD}/issue.md`);
  return directory;
}

function next(directory: string, phase = "build-01"): Directive {
  return (JSON.parse(succeeds(directory, "step", "next", phase, "001", "--json")) as { directive: Directive }).directive;
}

function report(directory: string, step: string, ...extra: string[]): Directive {
  const result = cli(directory, "step", "report", "build-01", step, "001", ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function upToG8(directory: string): void {
  write(directory, `${BUILD}/plan.md`, "# plan\n");
  report(directory, "plan", "--result", "done", "--peak", "350k");
  report(directory, "plan-review", "--result", "done");
  write(directory, `${BUILD}/test-spec.md`, "# test-spec\n");
  report(directory, "test-spec", "--result", "done");
  report(directory, "test-spec-review", "--result", "done");
}

function jsonl(directory: string, path: string): Record<string, unknown>[] {
  return readFileSync(join(directory, path), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

const OBJECT = ["ledger", "object", "build-01", "001", "--summary", "ログに個人データを残す", "--basis", '[app] data = "personal"', "--loses", "ログからの漏えいを防げない"];

function openId(directory: string, ...args: string[]): string {
  return (JSON.parse(succeeds(directory, "ledger", "open", ...args, "--json")) as { record: OpenRecord }).record.id;
}

test("ledger object: 異議と決定を同じ作業単位に対で書き、step は現在のステップ。中は --accepts・--premises が要らない", (t) => {
  const directory = built(t);
  upToG8(directory);
  succeeds(directory, ...OBJECT, "--harm", "中", "--decision", "consented", "--input", "そのままでよい");
  const [o, d] = jsonl(directory, `${BUILD}/decisions.jsonl`);
  assert.deepEqual(
    [o?.["record"], o?.["type"], o?.["when"], o?.["who"], o?.["step"], o?.["basis"], o?.["loses"], o?.["harm"]],
    ["open", "objection", "now", "user", "G8", '[app] data = "personal"', "ログからの漏えいを防げない", "中"],
  );
  assert.deepEqual([d?.["record"], d?.["id"], d?.["decision"], d?.["by"], d?.["input"]], ["decide", o?.["id"], "consented", "user", "そのままでよい"]);
  // ledger list・show で追える（US-1.5・US-1.6）
  const shown = succeeds(directory, "ledger", "show", String(o?.["id"]), "001");
  assert.match(shown, /根拠 +\[app\] data = "personal"/);
  assert.match(shown, /失うもの +ログからの漏えいを防げない/);
  assert.match(shown, /決定 .* consented（ユーザー・build-01）/);
});

test("ledger object: 害が高で consented なら --accepts・--premises が必須で、そろえば前提と結び付けて残る", (t) => {
  const directory = built(t);
  upToG8(directory);
  const before = snapshot(directory);
  for (const extra of [
    ["--premises", "app.data"],
    ["--premises", "app.data", "--accepts", "  "],
    ["--accepts", "ログに残ることを受け入れる"],
  ]) {
    const result = cli(directory, ...OBJECT, "--harm", "高", "--decision", "consented", "--input", "進める", ...extra);
    assert.equal(result.status, 1, extra.join(" "));
  }
  assert.deepEqual(snapshot(directory), before);
  succeeds(directory, ...OBJECT, "--harm", "高", "--decision", "consented", "--input", "進める", "--accepts", "ログに残ることを受け入れる", "--premises", "app.data,area:billing");
  const [o, d] = jsonl(directory, `${BUILD}/decisions.jsonl`);
  assert.deepEqual(o?.["premises"], ["app.data", "area:billing"]);
  assert.equal(d?.["accepts"], "ログに残ることを受け入れる");
});

test("ledger object: 害が高で decided でも、ユーザーの言葉（--input）が無ければ拒否する", (t) => {
  const directory = built(t);
  upToG8(directory);
  const before = snapshot(directory);
  assert.equal(cli(directory, ...OBJECT, "--harm", "高", "--decision", "decided", "--premises", "app.data").status, 1);
  assert.equal(cli(directory, ...OBJECT, "--harm", "高", "--decision", "decided", "--premises", "app.data", "--input", "  ").status, 1);
  assert.deepEqual(snapshot(directory), before);
});

test("ledger object: 害が高でも decided なら --accepts を求めない（解釈）", (t) => {
  const directory = built(t);
  upToG8(directory);
  succeeds(directory, ...OBJECT, "--harm", "高", "--decision", "decided", "--input", "ログに残さない方式に改める");
  assert.equal(jsonl(directory, `${BUILD}/decisions.jsonl`).length, 2);
});

test("ledger object: 語彙外・必須の欠落を拒否し、--dry-run は書かない", (t) => {
  const directory = built(t);
  upToG8(directory);
  const before = snapshot(directory);
  assert.equal(cli(directory, ...OBJECT, "--harm", "低", "--decision", "consented", "--input", "x").status, 1);
  assert.equal(cli(directory, ...OBJECT, "--harm", "中", "--decision", "rejected", "--input", "x").status, 1);
  assert.equal(cli(directory, "ledger", "object", "build-01", "001", "--summary", "s", "--loses", "l", "--harm", "中", "--decision", "consented", "--input", "x").status, 1, "--basis が無い");
  succeeds(directory, ...OBJECT, "--harm", "中", "--decision", "consented", "--input", "x", "--dry-run");
  assert.deepEqual(snapshot(directory), before);
});

test("step report: 高の異議が片づくまでゲートの approved を拒否し、consented + accepts で受け付ける", (t) => {
  const directory = built(t);
  upToG8(directory);
  const id = openId(directory, "build-01", "001", "--type", "objection", "--harm", "高", "--when", "now", "--who", "user", "--summary", "s");
  const refused = cli(directory, "step", "report", "build-01", "G8", "001", "--result", "approved", "--input", "OK");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, new RegExp(`害が高の異議が片づいていません（${id}）`));
  assert.match(refused.stderr, /ledger decide build-01 <ID> 001-test --decision consented --by user/);
  // 差し戻しは受け付ける
  report(directory, "G8", "--result", "rejected", "--input", "直して");
  succeeds(directory, "ledger", "decide", "build-01", id, "001", "--decision", "consented", "--by", "user", "--input", "進める", "--accepts", "受け入れる");
  assert.equal(report(directory, "G8", "--result", "approved", "--input", "OK").step, "implement");
});

test("step report: decided（解釈）・中・別のステップの異議はゲートを止めない", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`, "# plan\n");
  report(directory, "plan", "--result", "done", "--peak", "350k");
  // plan-review の最中に記録した高の異議は G8 を止めない
  openId(directory, "build-01", "001", "--type", "objection", "--harm", "高", "--when", "now", "--who", "user", "--summary", "別のステップ");
  report(directory, "plan-review", "--result", "done");
  write(directory, `${BUILD}/test-spec.md`, "# test-spec\n");
  report(directory, "test-spec", "--result", "done");
  report(directory, "test-spec-review", "--result", "done");
  openId(directory, "build-01", "001", "--type", "objection", "--harm", "中", "--when", "now", "--who", "user", "--summary", "中");
  succeeds(directory, ...OBJECT, "--harm", "高", "--decision", "decided", "--input", "改める");
  assert.equal(report(directory, "G8", "--result", "approved", "--input", "OK").step, "implement");
});

test("step report: 内部スキルの G6 でも高の異議で拒否し、記録が壊れていたら拒否する", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`, "# plan\n");
  // 見積もり直しで split_above を超え、build-manager を呼ぶ
  report(directory, "plan", "--result", "done", "--peak", "500k");
  report(directory, "plan-review", "--result", "done");
  for (const step of ["load", "scope", "estimate", "dry-run", "tasklist-review"]) {
    succeeds(directory, "step", "report", "build-01", step, "001", "--skill", "build-manager", "--result", "done");
  }
  assert.equal(next(directory).step, "split");
  openId(directory, "build-01", "001", "--type", "objection", "--harm", "高", "--when", "now", "--who", "user", "--summary", "G6");
  const g6 = jsonl(directory, `${BUILD}/decisions.jsonl`)[0];
  assert.equal(g6?.["step"], "G6");
  assert.equal(cli(directory, "step", "report", "build-01", "G6", "001", "--skill", "build-manager", "--result", "approved", "--input", "OK").status, 1);

  writeFileSync(join(directory, BUILD, "decisions.jsonl"), '{"record":"open",\n');
  const broken = cli(directory, "step", "report", "build-01", "G6", "001", "--skill", "build-manager", "--result", "approved", "--input", "OK");
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /未決事項の記録を読めず/);
});

test("directive: サイクルの gate に異議の指示とポインタが載り、run には載らない", (t) => {
  const directory = built(t);
  assert.equal(next(directory).objection, undefined, "plan（run）には載らない");
  upToG8(directory);
  const g8 = next(directory);
  const objection = g8.objection;
  assert.ok(objection !== undefined);
  const guide = objection.guide.join("\n");
  assert.match(guide, /好みの違い/);
  assert.match(guide, /唱えない/);
  assert.match(guide, /根拠/);
  assert.match(guide, /失うもの/);
  assert.match(guide, /中は指摘にとどめ/);
  assert.match(guide, /高は、ユーザーが何を受け入れるかを自分の言葉で書くまで承認を報告しない/);
  const pointers = objection.pointers.join("\n");
  assert.match(pointers, /config 001-test/);
  assert.match(pointers, /tasklist\.md/);
  assert.match(pointers, /ledger list 001-test/);
  assert.match(objection.command, /ledger object build-01 001-test --summary/);
  const text = succeeds(directory, "step", "next", "build-01", "001");
  assert.match(text, /^異議:/m);
  assert.match(text, /照合に使える宣言・記録/);
});

test("directive: 登録して実在する decisions・constraints だけをポインタに載せる", (t) => {
  const directory = built(t);
  upToG8(directory);
  const guidePath = join(directory, "docs/hikyaku/document-guide.md");
  const guide = readFileSync(guidePath, "utf8");
  const pointers = () => next(directory).objection?.pointers.join("\n") ?? "";
  // init の既定はどれも未作成
  assert.doesNotMatch(pointers(), /decisions: |constraints: /);
  // decisions を hikyaku 管理で登録し、constraints は未作成、overview は対象外のまま
  writeFileSync(
    guidePath,
    guide
      .replace(/^\| decisions .*$/m, "| decisions | hikyaku | `docs/decisions/` | ADR |")
      .replace(/^\| overview .*$/m, "| overview | 対象外 | — | 持たない |"),
  );
  assert.match(pointers(), /decisions: docs\/decisions\//);
  assert.doesNotMatch(pointers(), /constraints: |overview/);
});

test("directive: サイクルに属さない patch の P1 には異議の指示が載らない（解釈）", (t) => {
  const directory = workspace(t);
  const resolved = JSON.parse(succeeds(directory, "patch", "resolve", "fix-typo", "--json")) as { phase: string; unitDirectory: string };
  write(directory, join(resolved.unitDirectory, ".keep"), "");
  const step = (id: string, ...extra: string[]) => {
    const result = cli(directory, "step", "report", resolved.phase, id, "--result", "done", ...extra, "--json");
    assert.equal(result.status, 0, result.stderr);
    return (JSON.parse(result.stdout) as { directive: Directive }).directive;
  };
  step("start");
  step("survey");
  step("scope", "--peak", "100k");
  const p1 = step("fit");
  assert.equal(p1.step, "P1");
  assert.equal(p1.objection, undefined);
});

test("step lint: interrupt を gate 以外が持つと問題を返す", () => {
  const problems = lintApproval({ skill: "synthetic", steps: [{ id: "x", kind: "run", title: "t", interrupt: () => undefined }] });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /x は gate でないのに interrupt/);
});

// ---------------------------------------------------------------------------
// delegation

function conflict(directory: string): string {
  return openId(directory, "build-01", "001", "--type", "question", "--ask", "design-conflict", "--when", "now", "--who", "user", "--summary", "設計と要件の衝突");
}

test("delegation（builder）: design-conflict が無ければ手順に入らず、記録すると割り込みの同意ゲートになる", (t) => {
  const directory = built(t);
  upToG8(directory);
  report(directory, "G8", "--result", "approved", "--input", "OK");
  const status = JSON.parse(succeeds(directory, "step", "status", "build-01", "001", "--json")) as { steps: { id: string; status: string }[] };
  assert.equal(status.steps.find((s) => s.id === "delegation")?.status, "off");
  assert.equal(next(directory).step, "implement");

  conflict(directory);
  const gate = next(directory);
  assert.deepEqual([gate.kind, gate.step, gate.approval], ["gate", "delegation", "consent"]);
  // 割り込みの間は implement を報告できない
  assert.equal(cli(directory, "step", "report", "build-01", "implement", "001", "--result", "done").status, 1);
  // 差し戻しなら答えを返して提示し直す
  assert.equal(report(directory, "delegation", "--result", "rejected", "--input", "プロファイルを見直したい").revise, "プロファイルを見直したい");
  assert.equal(next(directory).step, "delegation");
  // 承認すると implement に戻り、それまでの完了はやり直しにならない
  assert.equal(report(directory, "delegation", "--result", "approved", "--input", "委任を続ける").step, "implement");
  const after = JSON.parse(succeeds(directory, "step", "status", "build-01", "001", "--json")) as { steps: { id: string; status: string }[] };
  for (const id of ["plan", "test-spec", "G8"]) assert.equal(after.steps.find((s) => s.id === id)?.status, "complete", id);
});

test("delegation（builder）: ほかの事項では出ず、2回目の design-conflict でまた出る", (t) => {
  const directory = built(t);
  conflict(directory);
  report(directory, "delegation", "--result", "approved", "--input", "続ける");
  openId(directory, "build-01", "001", "--type", "question", "--when", "now", "--who", "user", "--summary", "別の質問");
  assert.equal(next(directory).step, "plan");
  // 同じ ms に記録すると時刻が並ぶので、少し待つ
  const wait = Date.now() + 5;
  while (Date.now() < wait) { /* 待つ */ }
  conflict(directory);
  assert.equal(next(directory).step, "delegation");
});

test("delegation（builder）: 差し戻しと再設計のあとに戻っても、同じ出来事でもう一度は出ない", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`, "# plan\n");
  report(directory, "plan", "--result", "done", "--peak", "350k");
  conflict(directory);
  report(directory, "delegation", "--result", "approved", "--input", "差し戻す");
  write(directory, `${CYCLE}/return.md`, "# 差し戻し: build-01\n");
  assert.equal(next(directory).kind, "stop");
  // architect の再設計が return.md と古い plan.md を消した
  rmSync(join(directory, CYCLE, "return.md"));
  rmSync(join(directory, BUILD, "plan.md"));
  assert.equal(next(directory).step, "plan");
});

test("delegation（builder）: decisions.jsonl が壊れていたら出る（安全側）。Stop フックは引き止めない", (t) => {
  const directory = built(t);
  const env = { CLAUDE_CODE_SESSION_ID: "s-del", CLAUDE_CONFIG_DIR: temporaryDirectory(t) };
  write(directory, `${BUILD}/plan.md`, "# plan\n");
  assert.equal(cliWith(directory, env, "step", "report", "build-01", "plan", "001", "--result", "done", "--peak", "350k").status, 0);
  write(directory, `${BUILD}/decisions.jsonl`, '{"record":"open",\n');
  assert.equal(next(directory).step, "delegation");
  const hook = cliInput(directory, JSON.stringify({ hook_event_name: "Stop", cwd: directory, session_id: "s-del", stop_hook_active: false }), {}, "step", "hook", "stop");
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(hook.stdout.trim(), "", "gate なので止めない");
});

test("delegation（architect）: 再設計の回の先頭にだけ出て、承認すると survey に進む", (t) => {
  const directory = workspace(t, true);
  assert.notEqual(next(directory, "architect").step, "delegation", "通常の設計の回");
  succeeds(directory, "step", "restart", "architect", "001", "--round", "add", "--reason", "指摘");
  assert.equal(next(directory, "architect").step, "design-change", "追加設計の回");
  write(directory, `${CYCLE}/return.md`, "# 差し戻し: build-01\n");
  succeeds(directory, "step", "restart", "architect", "001", "--round", "return", "--reason", "build-01 からの差し戻し");
  const gate = next(directory, "architect");
  assert.deepEqual([gate.kind, gate.step, gate.approval], ["gate", "delegation", "consent"]);
  const result = cli(directory, "step", "report", "architect", "delegation", "001", "--result", "approved", "--input", "委任を続ける", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal((JSON.parse(result.stdout) as { directive: Directive }).directive.step, "survey");
});

test("conductor: delegation はユーザーに固定され、delegate に書けず、CONSENT_WHEN には入らない", () => {
  const settings: AskSettings = {
    gates: { codebaseSurvey: false, designChoice: true, architecture: true, plan: false },
    reviews: { userStories: true, architecture: true, tasklist: true, plan: true, testSpec: true, code: true, security: "recommended", retrospective: "auto", validate: "manual" },
  };
  for (const approval of [undefined, "consent" as const]) {
    const resolved = resolveAsk("delegation", DEFAULT_CONDUCTOR, settings, approval);
    assert.deepEqual([resolved.category, resolved.handler, resolved.source], ["consent", "user", "fixed"]);
  }
  assert.throws(() => checkConductorAsks({ ...DEFAULT_CONDUCTOR, delegate: ["delegation"] }, "[conductor]"), /delegation は指定できません/);
  assert.equal("delegation" in CONSENT_WHEN, false);
});

// ---------------------------------------------------------------------------
// G1・記録する側

test("planner: G1 の args にプロファイルが入る", (t) => {
  const directory = workspace(t, true);
  const step = (id: string) => {
    const result = cli(directory, "step", "report", "plan", id, "001", "--result", "done", "--json");
    assert.equal(result.status, 0, result.stderr);
    return (JSON.parse(result.stdout) as { directive: Directive }).directive;
  };
  step("inputs");
  step("scope");
  write(directory, `${CYCLE}/planning/user-stories.md`);
  step("user-stories");
  const g1 = step("review");
  assert.equal(g1.step, "G1");
  assert.equal(g1.args?.["profile"], "standard");
});

test("記録する側: planner の user-stories と builder の handoff の最中に記録すると、その単位とステップに入る", (t) => {
  const directory = built(t);
  succeeds(directory, "step", "report", "plan", "inputs", "001", "--result", "done");
  succeeds(directory, "step", "report", "plan", "scope", "001", "--result", "done");
  openId(directory, "plan", "001", "--type", "question", "--who", "user", "--when", "gate:G1", "--summary", "未回答の質問");
  const [planItem] = jsonl(directory, `${CYCLE}/planning/decisions.jsonl`);
  assert.deepEqual([planItem?.["unit"], planItem?.["step"], planItem?.["when"]], ["plan", "user-stories", "gate:G1@plan"]);

  upToG8(directory);
  report(directory, "G8", "--result", "approved", "--input", "OK");
  report(directory, "implement", "--result", "done");
  report(directory, "verify", "--result", "done");
  report(directory, "review", "--result", "done");
  openId(directory, "build-01", "001", "--type", "provisional", "--who", "user", "--when", "merge", "--summary", "確度: 要確認");
  const [buildItem] = jsonl(directory, `${BUILD}/decisions.jsonl`);
  assert.deepEqual([buildItem?.["unit"], buildItem?.["step"], buildItem?.["when"]], ["build-01", "handoff", "merge@build-01"]);
});

test("記録する側: 各スキルの指示ファイルが ledger open（close-cycle は ledger decide）を呼ぶ", () => {
  const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
  for (const path of [
    "skills/planner/steps/user-stories.md",
    "skills/architect/steps/adr.md",
    "skills/build-manager/steps/G6.md",
    "skills/builder/steps/handoff.md",
    "skills/builder/references/return.md",
    "skills/patch/steps/persist.md",
    "skills/conductor/references/headless-protocol.md",
  ]) {
    assert.match(read(path), /ledger open/, path);
  }
  assert.match(read("skills/architect/steps/design-delta.md"), /ledger open architect --type provisional/);
  assert.match(read("skills/close-cycle/steps/collect.md"), /ledger list/);
  assert.match(read("skills/close-cycle/steps/G10.md"), /ledger decide close <ID> \{cycle\}.*--by user/);
  assert.match(read("skills/planner/steps/G1.md"), /`profile`/);
  assert.match(read("skills/builder/references/templates.md"), /未決事項の ID だけを1件1行で書く/);
  assert.match(read("skills/builder/steps/review.md"), /未決事項として記録する/);
  assert.match(read("skills/builder/steps/pr.md"), /未決事項の ID と要点/);
  // design-conflict を記録してから step next で delegation に従い、そのあと選択肢を示す
  const ret = read("skills/builder/references/return.md");
  assert.ok(ret.indexOf("--ask design-conflict") < ret.indexOf("（ask: design-conflict）"));
  for (const skill of ["architect", "builder"]) assert.match(read(`skills/${skill}/steps/delegation.md`), /（ask: delegation）/);
  assert.equal(existsSync(join(ROOT, "skills/conductor/references/headless-protocol.md")), true);
});
