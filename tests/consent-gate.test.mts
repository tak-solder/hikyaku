/**
 * build-06: 事後同意（PR を作る直前の同意ゲート）と、ledger consent-list / pr-section。
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  consentItemsOf,
  isConsentItem,
  undecidedConsentItems,
  unitHasConsentItems,
  type DecideRecord,
  type Ledger,
  type LedgerItem,
  type OpenRecord,
} from "../scripts/lib/ledger.mts";
import { ARCHITECT_STEPS } from "../scripts/lib/steps/architect.mts";
import { BUILDER_STEPS } from "../scripts/lib/steps/builder.mts";
import { CLOSE_CYCLE_STEPS } from "../scripts/lib/steps/close-cycle.mts";
import { asConductorChild, consentProblem } from "../scripts/lib/steps/consent.mts";
import type { SkillSteps, StepContext, StepDefinition } from "../scripts/lib/steps/engine.mts";
import { PATCH_STEPS } from "../scripts/lib/steps/patch.mts";
import { PLANNER_STEPS } from "../scripts/lib/steps/planner.mts";
import { cli, cliWith, snapshot, succeeds, temporaryDirectory, workspace, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const BUILD = `${CYCLE}/build-01`;
const CHILD = { HIKYAKU_CONDUCTOR_CHILD: "1" };
// 単体テストはこのプロセスの環境で consentStep を評価する。conductor の子の中で npm test を走らせても、
// 子の扱いを明記したテスト（withEnv）以外に持ち込まない
delete process.env["HIKYAKU_CONDUCTOR_CHILD"];

// ---------------------------------------------------------------------------
// 同意の対象（単体）

function open(id: string, overrides: Partial<OpenRecord> = {}): OpenRecord {
  return {
    record: "open", at: "2026-11-16T00:00:00.000Z", id, unit: "build-01", type: "risk", summary: "キャッシュの無効化を遅らせる",
    when: "merge@build-01", who: "user", premises: ["app.data"], loses: "古いデータを返さない", ...overrides,
  };
}

function decide(id: string, overrides: Partial<DecideRecord> = {}): DecideRecord {
  return { record: "decide", at: "2026-11-16T01:00:00.000Z", id, unit: "build-01", decision: "consented", by: "user", input: "同意する", ...overrides };
}

function item(o: OpenRecord, ds: DecideRecord[] = []): LedgerItem {
  return { open: o, decisions: ds, latest: ds[ds.length - 1] };
}

const ids = (items: LedgerItem[]) => items.map((entry) => entry.open.id);

test("isConsentItem: when=merge@その単位・who=user の risk / objection だけが対象で、記録した単位は問わない", () => {
  assert.equal(isConsentItem(item(open("a")), "build-01"), true);
  assert.equal(isConsentItem(item(open("a", { type: "objection", harm: "中" })), "build-01"), true);
  assert.equal(isConsentItem(item(open("a", { unit: "architect" })), "build-01"), true, "別の単位で記録した事項");
  assert.equal(isConsentItem(item(open("a", { type: "question" })), "build-01"), false);
  assert.equal(isConsentItem(item(open("a", { type: "provisional" })), "build-01"), false);
  assert.equal(isConsentItem(item(open("a", { who: "ai:build-01" })), "build-01"), false);
  assert.equal(isConsentItem(item(open("a", { who: "supervisor" })), "build-01"), false);
  assert.equal(isConsentItem(item(open("a", { when: "merge@build-02" })), "build-01"), false);
  assert.equal(isConsentItem(item(open("a", { when: "close" })), "build-01"), false);
  const ledger: Ledger = { items: [item(open("x")), item(open("y", { when: "merge@build-02" })), item(open("z", { unit: "architect" }))], orphans: [] };
  assert.deepEqual(ids(consentItemsOf(ledger, "build-01")), ["x", "z"]);
});

test("undecidedConsentItems: ユーザーの consented / decided / resolved を決定として数え、最新の決定で判定する", () => {
  assert.deepEqual(ids(undecidedConsentItems([item(open("none"))])), ["none"]);
  for (const decision of ["consented", "decided", "resolved"] as const) {
    assert.deepEqual(ids(undecidedConsentItems([item(open("a"), [decide("a", { decision })])])), [], decision);
  }
  assert.deepEqual(ids(undecidedConsentItems([item(open("a"), [decide("a", { decision: "rejected" })])])), ["a"], "rejected は数えない");
  assert.deepEqual(ids(undecidedConsentItems([item(open("a"), [decide("a"), decide("a", { decision: "rejected", at: "2026-11-16T02:00:00.000Z" })])])), ["a"]);
  assert.deepEqual(ids(undecidedConsentItems([item(open("a"), [decide("a", { decision: "rejected" }), decide("a", { decision: "resolved", at: "2026-11-16T02:00:00.000Z" })])])), []);
  assert.deepEqual(ids(undecidedConsentItems([item(open("a"), [decide("a", { by: "supervisor" })])])), ["a"], "ユーザーの決定でない");
  assert.deepEqual(ids(undecidedConsentItems([item(open("a"), [decide("a", { by: "ai:build-01" })])])), ["a"]);
});

test("undecidedConsentItems: 害が高の異議は受け入れの言葉の無い consented を数えない（中は数える）", () => {
  const high = open("h", { type: "objection", harm: "高" });
  assert.deepEqual(ids(undecidedConsentItems([item(high, [decide("h")])])), ["h"]);
  assert.deepEqual(ids(undecidedConsentItems([item(high, [decide("h", { accepts: "  " })])])), ["h"]);
  assert.deepEqual(ids(undecidedConsentItems([item(high, [decide("h", { accepts: "古いデータが返ることを受け入れる" })])])), []);
  assert.deepEqual(ids(undecidedConsentItems([item(high, [decide("h", { decision: "decided" })])])), []);
  assert.deepEqual(ids(undecidedConsentItems([item(high, [decide("h", { decision: "resolved" })])])), [], "作り直したあとの resolved");
  assert.deepEqual(ids(undecidedConsentItems([item(open("m", { type: "objection", harm: "中" }), [decide("m")])])), []);
});

test("unitHasConsentItems: その単位のファイル1つだけを読み、読めなければ true（安全側）", (t) => {
  const directory = temporaryDirectory(t);
  assert.equal(unitHasConsentItems(directory, "build-01"), false, "ファイルが無い");
  const path = join(directory, "decisions.jsonl");
  writeFileSync(path, `${JSON.stringify(open("b.1", { when: "merge@build-02" }))}\n${JSON.stringify(open("b.2", { type: "question" }))}\n`);
  assert.equal(unitHasConsentItems(directory, "build-01"), false, "対象が無い");
  writeFileSync(path, `${JSON.stringify(open("b.3"))}\n`);
  assert.equal(unitHasConsentItems(directory, "build-01"), true);
  writeFileSync(path, `${JSON.stringify(open("b.2", { type: "question" }))}\n{broken\n`);
  assert.equal(unitHasConsentItems(directory, "build-01"), true, "壊れていれば手順に入れる");
});

// ---------------------------------------------------------------------------
// 手順への配置（単体）

function stepOf(skill: SkillSteps, id: string): StepDefinition {
  const definition = skill.steps.find((step) => step.id === id);
  assert.ok(definition, `${skill.skill} に ${id} が無い`);
  return definition;
}

function stepIds(skill: SkillSteps): string[] {
  return skill.steps.map((step) => step.id);
}

/** サイクルのディレクトリに、作業単位ごとの decisions.jsonl を書いて ctx を作る */
function context(t: TestContext, unit: string, records: Record<string, (OpenRecord | DecideRecord)[]>, overrides: Partial<StepContext> = {}): StepContext {
  const cycleDirectory = temporaryDirectory(t);
  for (const [relative, lines] of Object.entries(records)) {
    mkdirSync(join(cycleDirectory, relative), { recursive: true });
    writeFileSync(join(cycleDirectory, relative, "decisions.jsonl"), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  }
  const unitDirectory = join(cycleDirectory, unit === "architect" ? "design" : unit === "plan" ? "planning" : unit);
  mkdirSync(unitDirectory, { recursive: true });
  return {
    config: {} as StepContext["config"],
    cycle: { directory: cycleDirectory } as StepContext["cycle"],
    unit, unitDirectory, events: [], ...overrides,
  };
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

test("配置: architect・builder は pr の直前、patch は publish の直前に同意ゲート。planner・close-cycle はゲートを持たず pr の accepts だけ", () => {
  for (const [skill, before] of [[ARCHITECT_STEPS, "pr"], [BUILDER_STEPS, "pr"], [PATCH_STEPS, "publish"]] as const) {
    const list = stepIds(skill);
    assert.equal(list[list.indexOf(before) - 1], "consent", skill.skill);
    const consent = stepOf(skill, "consent");
    assert.equal(consent.kind, "gate");
    assert.equal(consent.ask, "deferred-consent");
    assert.ok(stepOf(skill, before).accepts, `${skill.skill} の ${before} に accepts`);
  }
  for (const skill of [PLANNER_STEPS, CLOSE_CYCLE_STEPS]) {
    assert.ok(!stepIds(skill).includes("consent"), skill.skill);
    assert.ok(stepOf(skill, "pr").accepts, skill.skill);
  }
});

test("consentStep: 同意（now）で、サイクル・conductor の子・作業単位の記録・architect の差し戻しの回で手順に入るかが決まる", (t) => {
  const gate = stepOf(BUILDER_STEPS, "consent");
  const ctx = context(t, "build-01", { "build-01": [open("build-01.1-aaaa")] });
  assert.deepEqual(gate.consent !== false && gate.consent?.(ctx), { timing: "now", reason: "上限を超えるリスクの受け入れ（事後同意）" });
  assert.equal(gate.when?.(ctx), true);
  assert.equal(withEnv(CHILD, () => gate.when?.(ctx)), false, "conductor の子では手順に入れない");
  assert.equal(gate.when?.({ ...ctx, cycle: undefined }), false, "サイクルに属さない patch など");
  // 別の単位で記録した merge@build-01 だけでは現れない（pr の accepts が止める）
  assert.equal(gate.when?.(context(t, "build-01", { design: [open("architect.1-aaaa", { unit: "architect" })] })), false);
  assert.equal(gate.when?.(context(t, "build-01", {})), false, "対象が無い");

  const architect = stepOf(ARCHITECT_STEPS, "consent");
  const design = context(t, "architect", { design: [open("architect.1-aaaa", { unit: "architect", when: "merge@architect" })] });
  assert.equal(architect.when?.(design), true);
  const restart = { at: "2026-11-16T00:00:00.000Z", skill: "architect", step: "*", result: "restart" as const, round: "return" };
  assert.equal(architect.when?.({ ...design, events: [restart] }), false, "差し戻しからの再設計の回");
});

test("consentStep(args): 対象の ID を入れ、手順の位置だけを読む経路では空（ほかの単位が壊れていても落ちない）", (t) => {
  const gate = stepOf(BUILDER_STEPS, "consent");
  const ctx = context(t, "build-01", { "build-01": [open("build-01.1-aaaa")], "build-02": [] });
  assert.deepEqual(gate.args?.(ctx), { items: ["build-01.1-aaaa"] });
  writeFileSync(join(ctx.cycle?.directory ?? "", "build-02", "decisions.jsonl"), "{broken\n");
  assert.deepEqual(gate.args?.({ ...ctx, positionOnly: true }), { items: [] });
  // 読めないときは空の一覧だけを返さず、読めないことを示す
  const failed = gate.args?.(ctx) ?? {};
  assert.deepEqual(failed["items"], []);
  assert.match(String(failed["error"]), /読めません/);
  assert.equal(gate.when?.({ ...ctx, positionOnly: true }), true);
});

test("consentProblem: 決定が足りなければ ID と案内を返す。ゲートを持たないスキルはその場で示す案内、conductor の子は blocked", (t) => {
  const ctx = context(t, "build-01", { "build-01": [open("build-01.1-aaaa"), open("build-01.2-bbbb"), decide("build-01.2-bbbb")] });
  const problem = consentProblem("builder")(ctx) ?? "";
  assert.match(problem, /build-01\.1-aaaa/);
  assert.doesNotMatch(problem, /build-01\.2-bbbb/);
  assert.match(problem, /skills\/builder\/steps\/consent\.md/);
  assert.doesNotMatch(problem, /ledger decide/);
  assert.match(withEnv(CHILD, () => consentProblem("builder")(ctx)) ?? "", /blocked/);
  // ゲートを承認したあとに pr が止めたなら、consent.md（承認の報告で終わる）ではなくその場で示す案内
  const approved = { at: "2026-11-16T02:00:00.000Z", skill: "builder", step: "consent", result: "approved" as const };
  const afterGate = consentProblem("builder")({ ...ctx, events: [approved] }) ?? "";
  assert.doesNotMatch(afterGate, /consent\.md/);
  assert.match(afterGate, /その場で/);

  const plan = context(t, "plan", { planning: [open("plan.1-aaaa", { unit: "plan", when: "merge@plan" })] });
  const planner = stepOf(PLANNER_STEPS, "pr").accepts?.(plan) ?? "";
  assert.match(planner, /plan\.1-aaaa/);
  assert.match(planner, /その場で/);
  assert.doesNotMatch(planner, /consent\.md/);
  // ほかの単位で記録した対象だけなら同意ゲートは外れているので、consent.md ではなくその場で示す案内
  const cross = consentProblem("builder")(context(t, "build-01", { design: [open("architect.1-aaaa", { unit: "architect" })] })) ?? "";
  assert.match(cross, /architect\.1-aaaa/);
  assert.doesNotMatch(cross, /consent\.md/);
  assert.match(cross, /ledger decide build-01 <ID> --decision/);
  assert.equal(consentProblem("builder")({ ...ctx, cycle: undefined }), undefined, "サイクルに属さない");
  assert.equal(consentProblem("builder")(context(t, "build-01", {})), undefined, "対象が無い");
});

test("asConductorChild: 監督が子と同じ条件で評価し、評価のあとに環境を戻す", (t) => {
  const gate = stepOf(BUILDER_STEPS, "consent");
  const ctx = context(t, "build-01", { "build-01": [open("build-01.1-aaaa")] });
  assert.equal(asConductorChild(() => gate.when?.(ctx)), false);
  assert.equal(process.env["HIKYAKU_CONDUCTOR_CHILD"], undefined);
  assert.equal(gate.when?.(ctx), true);
  assert.equal(withEnv({ HIKYAKU_CONDUCTOR_CHILD: "0" }, () => (asConductorChild(() => undefined), process.env["HIKYAKU_CONDUCTOR_CHILD"])), "0");
});

test("consentProblem: 記録を読めなければ受け付けない（安全側）", (t) => {
  const ctx = context(t, "build-01", { "build-01": [] });
  writeFileSync(join(ctx.unitDirectory, "decisions.jsonl"), "{broken\n");
  assert.match(consentProblem("builder")(ctx) ?? "", /読めず/);
});

// ---------------------------------------------------------------------------
// CLI（builder の手順）

interface Directive {
  kind: string;
  step?: string;
  ask?: string;
  approval?: string;
  note?: string;
  args?: Record<string, unknown>;
}

function built(t: TestContext): string {
  const directory = workspace(t, true);
  const path = join(directory, ".hikyaku.config");
  writeFileSync(path, `retrospective = "skip"\n${readFileSync(path, "utf8")}`);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
  succeeds(directory, "tasklist", "add", "001", "--title", "画面", "--peak", "350k");
  write(directory, `${BUILD}/issue.md`);
  return directory;
}

function next(directory: string, env: Record<string, string> = {}): Directive {
  const result = cliWith(directory, env, "step", "next", "build-01", "001", "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function report(directory: string, step: string, ...extra: string[]): Directive {
  const result = cli(directory, "step", "report", "build-01", step, "001", ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

/** handoff まで進める（retrospective は skip） */
function upToHandoff(directory: string): void {
  write(directory, `${BUILD}/plan.md`, "# plan\n");
  report(directory, "plan", "--result", "done", "--peak", "350k");
  report(directory, "plan-review", "--result", "done");
  write(directory, `${BUILD}/test-spec.md`, "# test-spec\n");
  report(directory, "test-spec", "--result", "done");
  report(directory, "test-spec-review", "--result", "done");
  report(directory, "G8", "--result", "approved", "--input", "OK");
  report(directory, "implement", "--result", "done");
  report(directory, "verify", "--result", "done");
  write(directory, `${BUILD}/agreement.md`);
  report(directory, "agreement-review", "--result", "done");
  report(directory, "review", "--result", "done");
  write(directory, `${BUILD}/handoff.md`);
}

function openRisk(directory: string, phase = "build-01", when = "merge", summary = "キャッシュの無効化を遅らせる", type = "risk"): string {
  const output = succeeds(
    directory, "ledger", "open", phase, "001", "--type", type, "--when", when, "--who", "user",
    "--summary", summary, "--premises", "app.data", "--loses", "古いデータを返さない", "--json",
  );
  return (JSON.parse(output) as { record: OpenRecord }).record.id;
}

function decideByUser(directory: string, id: string, decision = "consented", phase = "build-01"): void {
  succeeds(directory, "ledger", "decide", phase, id, "001", "--decision", decision, "--by", "user", "--input", "一覧を見て決めた");
}

const PR = "https://github.com/o/r/pull/12";

test("CLI: 対象が無ければ同意ゲートは現れず、従来どおり pr を完了できる", (t) => {
  const directory = built(t);
  upToHandoff(directory);
  succeeds(directory, "ledger", "open", "build-01", "001", "--type", "question", "--when", "merge", "--who", "user", "--summary", "文言");
  assert.equal(report(directory, "handoff", "--result", "done").step, "pr");
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", PR);
  assert.equal(report(directory, "pr", "--result", "done", "--pr", PR).step, "publish");
  // PR を作ったあとに対象が足されても、承認の無いゲートを PR の前に戻さない（終えた pr をやり直しにしない）
  openRisk(directory);
  assert.equal(next(directory).step, "publish");
});

test("CLI: 対象があると pr の前に同意ゲートが現れ、全項目にユーザーの決定があるまで承認も pr も受け付けない", (t) => {
  const directory = built(t);
  upToHandoff(directory);
  const id = openRisk(directory);
  const gate = report(directory, "handoff", "--result", "done");
  assert.deepEqual([gate.kind, gate.step, gate.ask, gate.approval], ["gate", "consent", "deferred-consent", "consent"]);
  assert.deepEqual(gate.args?.["items"], [id]);

  const before = snapshot(directory);
  const refused = cli(directory, "step", "report", "build-01", "consent", "001", "--result", "approved", "--input", "一覧を確認した");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, new RegExp(id.replace(".", "\\.")));
  assert.match(refused.stderr, /skills\/builder\/steps\/consent\.md/);
  assert.doesNotMatch(refused.stderr, /ledger decide/);
  assert.deepEqual(snapshot(directory), before, "承認を記録しない");
  // 現在地の consent を飛ばして pr は報告できない
  assert.equal(cli(directory, "step", "report", "build-01", "pr", "001", "--result", "done", "--pr", PR).status, 1);

  // 最新が rejected のままなら承認できない
  decideByUser(directory, id, "rejected");
  assert.equal(cli(directory, "step", "report", "build-01", "consent", "001", "--result", "approved", "--input", "OK").status, 1);
  decideByUser(directory, id, "resolved");
  assert.equal(report(directory, "consent", "--result", "approved", "--input", "同意した").step, "pr");
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", PR);
  assert.equal(report(directory, "pr", "--result", "done", "--pr", PR).step, "publish");
});

test("CLI: 承認のあとに決定の無い対象が足されると、同意ゲートに戻る", (t) => {
  const directory = built(t);
  upToHandoff(directory);
  const first = openRisk(directory);
  report(directory, "handoff", "--result", "done");
  decideByUser(directory, first);
  assert.equal(report(directory, "consent", "--result", "approved", "--input", "同意した").step, "pr");
  const added = openRisk(directory, "build-01", "merge", "ログの保持を延ばす");
  const back = next(directory);
  assert.equal(back.step, "consent");
  assert.match(back.note ?? "", new RegExp(added.replace(".", "\\.")));
  assert.equal(cli(directory, "step", "report", "build-01", "pr", "001", "--result", "done", "--pr", PR).status, 1, "現在地は consent");
  // 足された項目にユーザーの決定が付けば、取り直しの理由は消える
  decideByUser(directory, added, "decided");
  assert.equal(next(directory).step, "pr");
});

test("CLI: 高の異議は受け入れの言葉の無い consented では承認できない", (t) => {
  const directory = built(t);
  upToHandoff(directory);
  const id = (JSON.parse(succeeds(
    directory, "ledger", "open", "build-01", "001", "--type", "objection", "--harm", "高", "--when", "merge", "--who", "user",
    "--summary", "個人データをログに残す", "--premises", "app.data", "--json",
  )) as { record: OpenRecord }).record.id;
  report(directory, "handoff", "--result", "done");
  decideByUser(directory, id);
  assert.equal(cli(directory, "step", "report", "build-01", "consent", "001", "--result", "approved", "--input", "OK").status, 1);
  succeeds(directory, "ledger", "decide", "build-01", id, "001", "--decision", "consented", "--by", "user", "--input", "進める", "--accepts", "ログに残ることを受け入れる");
  assert.equal(report(directory, "consent", "--result", "approved", "--input", "OK").step, "pr");
});

test("CLI: conductor の子では同意ゲートが現れないが、決定の無い項目があれば pr は完了しない", (t) => {
  const directory = built(t);
  upToHandoff(directory);
  const id = openRisk(directory);
  const done = cliWith(directory, CHILD, "step", "report", "build-01", "handoff", "001", "--result", "done", "--json");
  assert.equal(done.status, 0, done.stderr);
  assert.equal(next(directory, CHILD).step, "pr");
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", PR);
  const refused = cliWith(directory, CHILD, "step", "report", "build-01", "pr", "001", "--result", "done", "--pr", PR);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /pr の完了の条件を満たしていません/);
  assert.match(refused.stderr, new RegExp(id.replace(".", "\\.")));
  assert.match(refused.stderr, /blocked/);
  decideByUser(directory, id);
  decideByUser(directory, id, "rejected");
  assert.equal(cliWith(directory, CHILD, "step", "report", "build-01", "pr", "001", "--result", "done", "--pr", PR).status, 1, "最新が rejected");
  decideByUser(directory, id, "resolved");
  assert.equal(cliWith(directory, CHILD, "step", "report", "build-01", "pr", "001", "--result", "done", "--pr", PR).status, 0);
  // 子が終えた単位を、子でない環境（step next・Stop フック・再開したセッション）で評価しても位置は同じ
  assert.equal(next(directory).step, "publish");
});

test("CLI: 別の単位で記録した merge@build-01 の事項はゲートを出さず、pr の accepts が止める", (t) => {
  const directory = built(t);
  upToHandoff(directory);
  const id = openRisk(directory, "build-02", "merge@build-01");
  assert.equal(report(directory, "handoff", "--result", "done").step, "pr");
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", PR);
  const refused = cli(directory, "step", "report", "build-01", "pr", "001", "--result", "done", "--pr", PR);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, new RegExp(id.replace(".", "\\.")));
});

test("CLI: merge@build-01 の未決の事項は、同意ゲートに来たときに期限が来る", (t) => {
  const directory = built(t);
  upToHandoff(directory);
  const question = (JSON.parse(succeeds(
    directory, "ledger", "open", "build-01", "001", "--type", "question", "--when", "merge", "--who", "user", "--summary", "文言", "--json",
  )) as { record: OpenRecord }).record.id;
  openRisk(directory);
  const timing = () =>
    ((JSON.parse(succeeds(directory, "ledger", "list", "001", "--json")) as { open: { id: string; timing: string }[] }).open.find((entry) => entry.id === question))?.timing;
  assert.equal(timing(), "pending");
  report(directory, "handoff", "--result", "done");
  assert.equal(timing(), "due");
});

// ---------------------------------------------------------------------------
// ledger consent-list / pr-section

test("ledger consent-list: 1項目3行と決定の状態の見出し、--full で全文、--json で項目と決定", (t) => {
  const directory = built(t);
  assert.match(succeeds(directory, "ledger", "consent-list", "build-01", "001"), /同意する項目はありません。\n決定が足りない項目: なし/);
  const a = openRisk(directory);
  const b = openRisk(directory, "architect", "merge@build-01", "移行を後回しにする");
  decideByUser(directory, b, "consented", "build-01");
  const before = snapshot(directory);
  const text = succeeds(directory, "ledger", "consent-list", "build-01", "001");
  assert.match(text, /2 件（決定が足りない 1 件）/);
  assert.match(text, new RegExp(`${a.replace(".", "\\.")}（受け入れたリスク）\\[決定なし\\]\\n  受け入れたリスク: キャッシュの無効化を遅らせる\\n  拠り所の前提: app\\.data\\n  失うもの: 古いデータを返さない`));
  assert.match(text, new RegExp(`${b.replace(".", "\\.")}（受け入れたリスク）\\[決定あり（consented）\\]`));
  assert.doesNotMatch(text, /記録した単位/);
  assert.match(text, new RegExp(`\\n決定が足りない項目: ${a.replace(".", "\\.")}\\n?$`), "最後の行に決定が足りない項目");
  const full = succeeds(directory, "ledger", "consent-list", "build-01", "001", "--full");
  assert.match(full, /いつ: merge@build-01/);
  assert.match(full, /記録した単位: architect/);
  assert.match(full, /決定: .* consented（ユーザー・build-01） 答え「一覧を見て決めた」/);
  const json = JSON.parse(succeeds(directory, "ledger", "consent-list", "build-01", "001", "--json")) as {
    items: { id: string; decided: boolean; premises: string[]; loses: string; decisions: unknown[] }[]; undecided: string[];
  };
  // 並びは記録の読み順（作業単位のディレクトリ順: design が build-01 より前）
  assert.deepEqual(json.items.map((entry) => [entry.id, entry.decided, entry.decisions.length]), [[b, true, 1], [a, false, 0]]);
  assert.deepEqual(json.items[1]?.premises, ["app.data"]);
  assert.deepEqual(json.undecided, [a]);
  assert.deepEqual(snapshot(directory), before, "書き込まない");
});

test("ledger pr-section: 中身のある節だけを出し、どれも無ければ空", (t) => {
  const directory = built(t);
  assert.equal(succeeds(directory, "ledger", "pr-section", "build-01", "001").trim(), "");
  const accepted = openRisk(directory);
  decideByUser(directory, accepted);
  const undecided = openRisk(directory, "build-01", "merge", "ログの保持を延ばす");
  const rejected = openRisk(directory, "build-02", "merge@build-02", "退けた案");
  decideByUser(directory, rejected, "rejected", "build-02");
  const question = (JSON.parse(succeeds(
    directory, "ledger", "open", "build-01", "001", "--type", "provisional", "--when", "merge", "--who", "user", "--summary", "暫定の文言", "--json",
  )) as { record: OpenRecord }).record.id;
  const resolvedLater = openRisk(directory, "build-02", "merge@build-02", "後で解決");
  decideByUser(directory, resolvedLater, "rejected", "build-02");
  decideByUser(directory, resolvedLater, "resolved", "build-02");

  const before = snapshot(directory);
  const text = succeeds(directory, "ledger", "pr-section", "build-01", "001");
  const order = ["## 受け入れたリスク（事後同意）", "**同意の決定が無い項目**", "## 未解決の退け", "## マージの前に決める事項"].map((heading) => text.indexOf(heading));
  assert.ok(order.every((index, i) => index !== -1 && (i === 0 || index > (order[i - 1] ?? 0))), text);
  const acceptedPart = text.slice(0, text.indexOf("**同意の決定が無い項目**"));
  assert.match(acceptedPart, new RegExp(accepted.replace(".", "\\.")));
  assert.doesNotMatch(acceptedPart, new RegExp(undecided.replace(".", "\\.")), "決定の無い項目を「受け入れた」の下に出さない");
  assert.match(text.slice(text.indexOf("## 未解決の退け")), new RegExp(rejected.replace(".", "\\.")));
  assert.doesNotMatch(text, new RegExp(resolvedLater.replace(".", "\\.")), "resolved で消える");
  assert.match(text.slice(text.indexOf("## マージの前に決める事項")), new RegExp(question.replace(".", "\\.")));
  assert.doesNotMatch(text, /## 期限を過ぎた事項/);
  const json = JSON.parse(succeeds(directory, "ledger", "pr-section", "build-01", "001", "--json")) as Record<string, unknown>;
  assert.deepEqual([json["accepted"], json["undecided"], json["rejected"], json["beforeMerge"], json["overdue"]], [[accepted], [undecided], [rejected], [question], []]);
  assert.equal(json["section"], text.trimEnd());
  assert.equal(json["markdown"], undefined, "本文は section の1つだけ");
  assert.deepEqual(snapshot(directory), before, "書き込まない");
});

test("ledger pr-section: 期限を過ぎた未決の事項をサイクル全体から出す", (t) => {
  const directory = built(t);
  const overdue = (JSON.parse(succeeds(
    directory, "ledger", "open", "build-02", "001", "--type", "question", "--when", "phase:plan", "--who", "user", "--summary", "企画の問い", "--json",
  )) as { record: OpenRecord }).record.id;
  // 後のフェーズ（architect）の記録で phase:plan は過ぎる
  write(directory, `${CYCLE}/design/progress.jsonl`, `${JSON.stringify({ at: new Date(Date.now() + 1000).toISOString(), skill: "architect", step: "survey", result: "done" })}\n`);
  const text = succeeds(directory, "ledger", "pr-section", "build-01", "001");
  assert.match(text, /## 期限を過ぎた事項/);
  assert.match(text, new RegExp(overdue.replace(".", "\\.")));
});
