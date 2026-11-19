/**
 * build-17: 同意ゲートで退けた項目の作り直しの経路（reworkFrom・前のフェーズの差し戻し・ledger return-draft）。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
// ledger.mts を先に読む（steps/<skill>.mts から読むと、steps/index.mts との循環 import で未初期化の値を読む）
import { type DecideRecord, type LedgerItem, type OpenRecord, LEDGER_FILE } from "../scripts/lib/ledger.mts";
import { checkEscalation } from "../scripts/lib/escalation.mts";
import { ARCHITECT_STEPS } from "../scripts/lib/steps/architect.mts";
import { BUILDER_STEPS } from "../scripts/lib/steps/builder.mts";
import { consentProblem, consentRejections, reworkStepOf } from "../scripts/lib/steps/consent.mts";
import type { SkillSteps, StepContext, StepDefinition } from "../scripts/lib/steps/engine.mts";
import { PATCH_STEPS } from "../scripts/lib/steps/patch.mts";
import { cli, snapshot, succeeds, temporaryDirectory, workspace, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const BUILD = `${CYCLE}/build-01`;
delete process.env["HIKYAKU_CONDUCTOR_CHILD"];

// ---------------------------------------------------------------------------
// 単体

function builderContext(t: TestContext, overrides: Partial<StepContext> = {}, splitAbove = 450_000): StepContext {
  const cycleDirectory = temporaryDirectory(t);
  const unitDirectory = join(cycleDirectory, "build-01");
  mkdirSync(unitDirectory, { recursive: true });
  const config = {
    reviews: { plan: true, testSpec: true, retrospective: "auto" },
    peakBands: { splitAbove },
    gates: { plan: false },
  } as unknown as StepContext["config"];
  return { config, cycle: { directory: cycleDirectory } as StepContext["cycle"], unit: "build-01", unitDirectory, events: [], ...overrides };
}

const at = (minute: number) => `2026-11-17T00:${String(minute).padStart(2, "0")}:00.000Z`;

function open(id: string, overrides: Partial<OpenRecord> = {}): OpenRecord {
  return {
    record: "open", at: at(0), id, unit: "build-01", step: "implement", type: "risk", summary: "キャッシュの無効化を遅らせる",
    when: "merge@build-01", who: "user", premises: ["app.data"], loses: "古いデータを返さない", ...overrides,
  };
}

function rejected(o: OpenRecord, when = at(10)): LedgerItem {
  const d: DecideRecord = { record: "decide", at: when, id: o.id, unit: "build-01", decision: "rejected", by: "user", input: "受け入れない" };
  return { open: o, decisions: [d], latest: d };
}

function writeLedger(ctx: StepContext, relative: string, records: (OpenRecord | DecideRecord)[]): void {
  const directory = join(ctx.cycle?.directory ?? "", relative);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, LEDGER_FILE), records.map((record) => `${JSON.stringify(record)}\n`).join(""));
}

const done = (step: string, minute: number, skill = "builder") => ({ at: at(minute), skill, step, result: "done" as const });

test("reworkStepOf: ゲートは対応する run へ戻す（G7・G8→plan、P1→scope、G3→options、G4→design-delta）", (t) => {
  const ctx = builderContext(t);
  assert.equal(reworkStepOf(BUILDER_STEPS, "G8", ctx), "plan");
  assert.equal(reworkStepOf(BUILDER_STEPS, "G7", ctx), "plan");
  assert.equal(reworkStepOf(PATCH_STEPS, "P1", ctx), "scope");
  const architect = { ...ctx, unit: "architect" };
  // architect の when は設定を広く読むので、評価が投げても手順に入っているとみなす（安全側）
  assert.equal(reworkStepOf(ARCHITECT_STEPS, "G3", architect), "options");
  assert.equal(reworkStepOf(ARCHITECT_STEPS, "G4", architect), "design-delta");
});

test("reworkStepOf: 対応先が手順から外れていれば、ゲートより前で最も近い手順に入っている run へ戻す", () => {
  const skill: SkillSteps = {
    skill: "architect",
    steps: [
      { id: "questions", kind: "run", title: "t" },
      { id: "options", kind: "run", title: "t", when: () => false },
      { id: "G3", kind: "gate", title: "t", consent: false, reworks: "options" },
    ],
  };
  assert.equal(reworkStepOf(skill, "G3", {} as StepContext), "questions");
});

test("reworkStepOf: 同意ゲートより後ろ（pr）で記録した事項は、ゲートより前で最も近い run へ戻す", (t) => {
  const ctx = builderContext(t);
  assert.equal(reworkStepOf(BUILDER_STEPS, "pr", ctx), "handoff");
  assert.equal(reworkStepOf(BUILDER_STEPS, "publish", ctx), "handoff");
  assert.equal(reworkStepOf(PATCH_STEPS, "publish", ctx), "persist", "サイクルに属す patch では write が外れる");
  // 同意ゲートの無いスキルは、PR を作るステップより前の run
  const planner: SkillSteps = {
    skill: "planner",
    steps: [{ id: "write", kind: "run", title: "t" }, { id: "G1", kind: "gate", title: "t", consent: false }, { id: "pr", kind: "run", title: "t" }],
  };
  assert.equal(reworkStepOf(planner, "pr", {} as StepContext), "write");
});

test("reworkStepOf: 同じ ID を持つ内部スキル（write）は、記録の時刻までに最後に記録を残した内部スキルで見分ける", (t) => {
  const over = { at: at(1), skill: "builder", step: "plan", result: "done" as const, peak: 500_000 };
  const retro = { at: at(5), skill: "retrospective", step: "analyze", result: "done" as const };
  const manager = { at: at(3), skill: "build-manager", step: "load", result: "done" as const };
  assert.equal(reworkStepOf(BUILDER_STEPS, "write", builderContext(t, { events: [over, manager, retro] }), at(6)), "retrospective");
  assert.equal(reworkStepOf(BUILDER_STEPS, "write", builderContext(t, { events: [over, manager, retro] }), at(4)), "split");
  assert.equal(reworkStepOf(BUILDER_STEPS, "write", builderContext(t, { events: [over] }), at(4)), "split", "見分けられなければ手順で前の call");
});

test("lintApproval: ゲートの reworks は、それより前の run ステップでなければならない", async () => {
  const { lintApproval } = await import("../scripts/lib/steps/engine.mts");
  const bad: SkillSteps = {
    skill: "synthetic",
    steps: [
      { id: "a", kind: "run", title: "t" },
      { id: "G", kind: "gate", title: "t", consent: false, reworks: "b" },
      { id: "b", kind: "run", title: "t" },
      { id: "H", kind: "gate", title: "t", consent: false, reworks: "missing" },
      { id: "c", kind: "run", title: "t", reworks: "a" },
    ],
  };
  const problems = lintApproval(bad);
  assert.ok(problems.some((problem) => problem.includes("G の reworks")));
  assert.ok(problems.some((problem) => problem.includes("H の reworks")));
  assert.ok(problems.some((problem) => problem.includes("c は gate でないのに reworks")));
  for (const skill of [ARCHITECT_STEPS, BUILDER_STEPS, PATCH_STEPS]) assert.deepEqual(lintApproval(skill), [], skill.skill);
});

test("reworkStepOf: 表に無いゲートは、それより前で最も近い手順に入っている run へ戻す", (t) => {
  const ctx = builderContext(t);
  assert.equal(reworkStepOf(BUILDER_STEPS, "consent", ctx), "handoff");
  // delegation（割り込みのゲート）は前に run が無いので、最初の run
  assert.equal(reworkStepOf(BUILDER_STEPS, "delegation", ctx), "plan");
});

test("reworkStepOf: 手順に入っている run・call はそのまま、外れた run は前の run へ戻す", (t) => {
  const ctx = builderContext(t);
  assert.equal(reworkStepOf(BUILDER_STEPS, "implement", ctx), "implement");
  assert.equal(reworkStepOf(BUILDER_STEPS, "retrospective", ctx), "retrospective");
  assert.equal(reworkStepOf(ARCHITECT_STEPS, "build-split", { ...ctx, unit: "architect" }), "build-split");
  const noReview = { ...ctx, config: { ...ctx.config, reviews: { ...ctx.config.reviews, plan: false } } } as StepContext;
  assert.equal(reworkStepOf(BUILDER_STEPS, "plan-review", noReview), "plan");
});

test("reworkStepOf: 内部スキルのステップは、それを呼ぶ call として扱う", (t) => {
  const ctx = builderContext(t);
  assert.equal(reworkStepOf(ARCHITECT_STEPS, "G6", { ...ctx, unit: "architect" }), "build-split");
  assert.equal(reworkStepOf(BUILDER_STEPS, "analyze", ctx), "retrospective");
  // split は予測ピークが split_above を超えたときだけ手順に入る
  const over = { ...ctx, events: [{ at: at(1), skill: "builder", step: "plan", result: "done" as const, peak: 500_000 }] };
  assert.equal(reworkStepOf(BUILDER_STEPS, "G6", over), "split");
  assert.equal(reworkStepOf(BUILDER_STEPS, "G6", ctx), "plan-review", "split が外れていれば前の run");
});

test("reworkStepOf: 記録の無い step・手順に無い step は最初の run、when が投げたら入っているとみなす", (t) => {
  const ctx = builderContext(t);
  assert.equal(reworkStepOf(BUILDER_STEPS, undefined, ctx), "plan");
  assert.equal(reworkStepOf(BUILDER_STEPS, "unknown-step", ctx), "plan");
  const throwing: SkillSteps = {
    skill: "synthetic",
    steps: [{ id: "a", kind: "run", title: "t" }, { id: "b", kind: "run", title: "t", when: () => { throw new Error("x"); } }],
  };
  assert.equal(reworkStepOf(throwing, "b", {} as StepContext), "b");
});

test("consentRejections: 同じ単位は戻り先を退けより後に done で報告し直したかで分け、別の単位は returns", (t) => {
  const same = rejected(open("build-01.1-aaaa", { step: "G8" }));
  const other = rejected(open("architect.1-bbbb", { unit: "architect", step: "options" }));
  const before = consentRejections("builder", [same, other], builderContext(t, { events: [done("plan", 5)] }));
  assert.deepEqual(before, { rework: [{ id: same.open.id, step: "plan" }], reworked: [], returns: [other.open.id], resumed: [] }, "退けの前の報告は再開に数えない");
  const resumed = consentRejections("builder", [other], builderContext(t, { events: [done("plan", 11)] }));
  assert.deepEqual(resumed.resumed, [other.open.id], "退けのあとに報告がある（再開した）");
  // skippable な戻り先を作り直しで skipped にした回も作り直しに数える
  const skipped = consentRejections("builder", [same], builderContext(t, { events: [{ at: at(11), skill: "builder", step: "plan", result: "skipped" as const, reason: "x" }] }));
  assert.deepEqual(skipped.reworked, [same.open.id]);
  const equal = consentRejections("builder", [same], builderContext(t, { events: [done("plan", 10)] }));
  assert.deepEqual(equal.reworked, [], "同じ時刻は作り直していない扱い");
  const after = consentRejections("builder", [same], builderContext(t, { events: [done("plan", 11)] }));
  assert.deepEqual(after, { rework: [], reworked: [same.open.id], returns: [], resumed: [] });
  // step restart の区切りより前の報告し直しは数えない
  const restart = { at: at(12), skill: "builder", step: "*", result: "restart" as const };
  const restarted = consentRejections("builder", [same], builderContext(t, { events: [done("plan", 11), restart] }));
  assert.deepEqual(restarted.reworked, []);
});

test("consentStep(args): 退けがあるときだけ reworkFrom・rework・returns を足す", (t) => {
  const gate = BUILDER_STEPS.steps.find((step) => step.id === "consent") as StepDefinition;
  const ctx = builderContext(t);
  const a = open("build-01.1-aaaa", { step: "implement" });
  const b = open("build-01.2-bbbb", { step: "G8" });
  writeLedger(ctx, "build-01", [a, b]);
  assert.deepEqual(gate.args?.(ctx), { items: [a.id, b.id] });
  writeLedger(ctx, "build-01", [a, b, ...rejected(a).decisions, ...rejected(b).decisions]);
  assert.deepEqual(gate.args?.(ctx), {
    items: [a.id, b.id], reworkFrom: "plan", rework: [{ id: a.id, step: "implement" }, { id: b.id, step: "plan" }],
  });
  const c = open("architect.1-cccc", { unit: "architect" });
  writeLedger(ctx, "design", [c]);
  writeLedger(ctx, "build-01", [a, b, ...rejected(c).decisions]);
  assert.deepEqual(gate.args?.(ctx), { items: [c.id, a.id, b.id], returns: [c.id] }, "記録の読み順（design が build-01 より前）");
});

test("consentProblem: 作り直していない退けは戻り先、前のフェーズの退けは差し戻しの案内。作り直せば resolved の前でも受け付ける", (t) => {
  const ctx = builderContext(t);
  const a = open("build-01.1-aaaa", { step: "G7" });
  writeLedger(ctx, "build-01", [a, ...rejected(a).decisions]);
  const problem = consentProblem("builder")(ctx) ?? "";
  assert.match(problem, /build-01\.1-aaaa → plan/);
  assert.match(problem, /done で報告し直して/);
  assert.equal(consentProblem("builder")({ ...ctx, events: [done("plan", 20)] }), undefined, "作り直したあと");

  const c = open("architect.1-cccc", { unit: "architect" });
  writeLedger(ctx, "design", [c]);
  writeLedger(ctx, "build-01", [...rejected(c).decisions]);
  const back = consentProblem("builder")(ctx) ?? "";
  assert.match(back, /architect\.1-cccc/);
  assert.match(back, /references\/return\.md/);
  assert.match(back, /resolved/);
  // patch・architect は記録したフェーズで作り直す
  const patch = consentProblem("patch")(ctx) ?? "";
  assert.doesNotMatch(patch, /return\.md/);
  assert.match(patch, /記録したフェーズで作り直して/);
  // 退けのあとに作業を再開していれば（差し戻しの再設計を経た）、もう一度差し戻さず resolved を尋ねる
  const resumedProblem = consentProblem("builder")({ ...ctx, events: [done("plan", 20)] }) ?? "";
  assert.doesNotMatch(resumedProblem, /return\.md/);
  assert.match(resumedProblem, /作業を再開しています/);
  assert.match(resumedProblem, /--decision resolved/);
  const resolved: DecideRecord ={ record: "decide", at: at(30), id: c.id, unit: "build-01", decision: "resolved", by: "user", input: "作り直した" };
  writeLedger(ctx, "build-01", [...rejected(c).decisions, resolved]);
  assert.equal(consentProblem("builder")(ctx), undefined);
});

// ---------------------------------------------------------------------------
// CLI（builder の手順）

interface Directive {
  kind: string;
  step?: string;
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

function report(directory: string, step: string, ...extra: string[]): Directive {
  const result = cli(directory, "step", "report", "build-01", step, "001", ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function upToG8(directory: string): void {
  write(directory, `${BUILD}/plan.md`, "# plan\n");
  report(directory, "plan", "--result", "done", "--peak", "350k");
  report(directory, "plan-review", "--result", "done", "--findings", "0", "--adopted", "0");
  write(directory, `${BUILD}/test-spec.md`, "# test-spec\n");
  report(directory, "test-spec", "--result", "done");
  report(directory, "test-spec-review", "--result", "done", "--findings", "0", "--adopted", "0");
}

function fromG8ToHandoff(directory: string): Directive {
  report(directory, "G8", "--result", "approved", "--input", "OK");
  report(directory, "implement", "--result", "done");
  report(directory, "verify", "--result", "done");
  write(directory, `${BUILD}/agreement.md`);
  report(directory, "agreement-review", "--result", "done");
  report(directory, "review", "--result", "done");
  write(directory, `${BUILD}/handoff.md`);
  return report(directory, "handoff", "--result", "done");
}

function openRisk(directory: string, phase = "build-01", when = "merge"): string {
  const output = succeeds(
    directory, "ledger", "open", phase, "001", "--type", "risk", "--when", when, "--who", "user",
    "--summary", "キャッシュの無効化を遅らせる", "--premises", "app.data", "--loses", "古いデータを返さない", "--json",
  );
  return (JSON.parse(output) as { record: OpenRecord }).record.id;
}

function decideByUser(directory: string, id: string, decision: string): void {
  succeeds(directory, "ledger", "decide", "build-01", id, "001", "--decision", decision, "--by", "user", "--input", "一覧を見て決めた");
}

const PR = "https://github.com/o/r/pull/12";

test("CLI: 同じ単位の退けは reworkFrom を示し、戻り先を報告し直すまで承認も pr も完了しない。作り直したあとも resolved まで未解決の退けに出る", (t) => {
  const directory = built(t);
  upToG8(directory);
  const id = openRisk(directory); // 現在地は G8
  const gate = fromG8ToHandoff(directory);
  assert.equal(gate.step, "consent");
  decideByUser(directory, id, "rejected");
  const back = JSON.parse(succeeds(directory, "step", "next", "build-01", "001", "--json")) as { directive: Directive };
  assert.equal(back.directive.args?.["reworkFrom"], "plan");
  const refused = cli(directory, "step", "report", "build-01", "consent", "001", "--result", "approved", "--input", "OK");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /→ plan/);

  // 戻り先を報告し直すと、後ろはやり直し。同意ゲートに戻ってくれば承認も pr も通る
  assert.equal(report(directory, "plan", "--result", "done", "--peak", "350k").step, "plan-review");
  report(directory, "plan-review", "--result", "done", "--findings", "0", "--adopted", "0");
  report(directory, "test-spec", "--result", "done");
  report(directory, "test-spec-review", "--result", "done", "--findings", "0", "--adopted", "0");
  const again = fromG8ToHandoff(directory);
  assert.equal(again.step, "consent");
  assert.equal(again.args?.["reworkFrom"], undefined, "作り直したので戻り先は示さない");
  assert.equal(report(directory, "consent", "--result", "approved", "--input", "作り直しを確認").step, "pr");
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", PR);
  assert.equal(report(directory, "pr", "--result", "done", "--pr", PR).step, "publish");

  const section = JSON.parse(succeeds(directory, "ledger", "pr-section", "build-01", "001", "--json")) as { section: string; rejected: string[] };
  assert.deepEqual(section.rejected, [id]);
  assert.match(section.section, /## 未解決の退け/);
  const status = JSON.parse(succeeds(directory, "cycle", "status", "001", "--json")) as { ledger: { rejected: { id: string }[] } };
  assert.deepEqual(status.ledger.rejected.map((item) => item.id), [id]);
  decideByUser(directory, id, "resolved");
  const cleared = JSON.parse(succeeds(directory, "ledger", "pr-section", "build-01", "001", "--json")) as { rejected: string[] };
  assert.deepEqual(cleared.rejected, []);
});

test("CLI: 前のフェーズの退けは returns に出て、resolved を記録するまで同意ゲートも pr も受け付けない", (t) => {
  const directory = built(t);
  upToG8(directory);
  const own = openRisk(directory);
  const other = openRisk(directory, "architect", "merge@build-01");
  assert.equal(fromG8ToHandoff(directory).step, "consent");
  decideByUser(directory, own, "consented");
  decideByUser(directory, other, "rejected");
  const back = JSON.parse(succeeds(directory, "step", "next", "build-01", "001", "--json")) as { directive: Directive };
  assert.deepEqual(back.directive.args?.["returns"], [other]);
  const refused = cli(directory, "step", "report", "build-01", "consent", "001", "--result", "approved", "--input", "OK");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /references\/return\.md/);
  decideByUser(directory, other, "resolved");
  assert.equal(report(directory, "consent", "--result", "approved", "--input", "作り直しを確認").step, "pr");
});

// ---------------------------------------------------------------------------
// ledger return-draft

test("ledger return-draft: 前のフェーズの退けから下書きを出し、書き込まない。不正な入力はエラー", (t) => {
  const directory = built(t);
  const own = openRisk(directory);
  const other = openRisk(directory, "architect", "merge@build-01");
  const pending = openRisk(directory, "architect", "merge@build-01");
  decideByUser(directory, own, "rejected");
  decideByUser(directory, other, "rejected");

  const before = snapshot(directory);
  const draft = succeeds(directory, "ledger", "return-draft", "build-01", "001", "--items", other);
  assert.deepEqual(snapshot(directory), before, "書き込まない");
  assert.match(draft, /^# 差し戻し: build-01/);
  for (const heading of ["## 何が崩れたか", "## 退けた項目", "## 試したこと", "## 問題を変える選択肢", "## 推奨", "## このビルドの状態"]) {
    assert.ok(draft.includes(heading), heading);
  }
  assert.match(draft, new RegExp(`${other.replace(".", "\\.")}: キャッシュの無効化を遅らせる（記録: architect`));
  assert.match(draft, /拠り所: app\.data/);
  assert.match(draft, /一覧を見て決めた/);
  assert.match(draft, /作り直しが要るもの: handoff\.md/);
  const json = JSON.parse(succeeds(directory, "ledger", "return-draft", "build-01", "001", "--items", other, "--json")) as { draft: string; items: string[] };
  assert.equal(json.draft.trim(), draft.trim());
  assert.deepEqual(json.items, [other]);

  const fails = (...args: string[]) => {
    const result = cli(directory, "ledger", "return-draft", ...args);
    assert.equal(result.status, 1, args.join(" "));
    return result.stderr;
  };
  assert.match(fails("build-01", "001", "--items", own), /reworkFrom/, "同じ単位");
  assert.match(fails("build-01", "001", "--items", pending), /rejected ではありません/);
  const question = (JSON.parse(succeeds(
    directory, "ledger", "open", "architect", "001", "--type", "question", "--when", "merge@build-01", "--who", "user", "--summary", "文言", "--json",
  )) as { record: OpenRecord }).record.id;
  decideByUser(directory, question, "rejected");
  assert.match(fails("build-01", "001", "--items", question), /同意ゲートの項目ではありません/);
  assert.match(fails("build-01", "001", "--items", "architect.99-ffff"), /ありません/);
  assert.match(fails("architect", "001", "--items", other), /builder/);
  fails("build-01", "001");
});

test("ledger return-draft: 下書きのままでは検査を通らず、選択肢と推奨を書けば architect の再設計の回を始められる", (t) => {
  const directory = built(t);
  const other = openRisk(directory, "architect", "merge@build-01");
  decideByUser(directory, other, "rejected");
  const draft = succeeds(directory, "ledger", "return-draft", "build-01", "001", "--items", other);
  const check = checkEscalation(draft);
  assert.equal(check.ok, false);
  assert.ok(!check.problems.some((problem) => problem.includes("試したこと")), "試したことは下書きがそろえる");

  write(directory, `${CYCLE}/return.md`, draft);
  const restart = () => cli(directory, "step", "restart", "architect", "001", "--round", "return", "--reason", "build-01 からの差し戻し");
  assert.equal(restart().status, 1);
  const filled = draft
    .replace(/- （退けた判断をどう決め直すか[^\n]*/, "- キャッシュを使わない設計に改める 失うもの: 応答の速さ")
    .replace("（どの選択肢を勧めるかと理由）", "キャッシュを使わない設計に改める。ユーザーが古いデータを受け入れないため");
  write(directory, `${CYCLE}/return.md`, filled);
  assert.equal(checkEscalation(filled).ok, true);
  const result = restart();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(directory, CYCLE, "design", "progress.jsonl")));
});
