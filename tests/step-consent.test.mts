/**
 * 承認の種類（確認と同意）— ステップ定義の consent / enabled と、エンジン・directive・conductor の扱い（原則11）
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ResolvedConfig } from "../scripts/lib/config.mts";
import { buildDirective, type Opened } from "../scripts/lib/steps/directive.mts";
import {
  consentOf,
  evaluate,
  isOn,
  lintApproval,
  type SkillSteps,
  type StepContext,
  type StepDefinition,
} from "../scripts/lib/steps/engine.mts";
import { PATCH_STEPS } from "../scripts/lib/steps/patch.mts";
import { ARCHITECT_STEPS } from "../scripts/lib/steps/architect.mts";
import { SKILL_STEPS } from "../scripts/lib/steps/index.mts";
import { CONSENT_WHEN, DEFAULT_CONDUCTOR, resolveAsk, type AskSettings } from "../scripts/lib/conductor.mts";
import { cli, cliWith, repository, returnRecord, snapshot, succeeds, temporaryDirectory, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const DESIGN = `${CYCLE}/design`;
const BUILD = `${CYCLE}/build-01`;
const SESSION = "s-1";

const ctx = { config: {} as ResolvedConfig, cycle: undefined, unit: "design", unitDirectory: "/unused", events: [] } as StepContext;

function gate(overrides: Partial<StepDefinition>): StepDefinition {
  return { id: "G9", kind: "gate", title: "t", ask: "G9", ...overrides };
}

const ASK_SETTINGS: AskSettings = {
  gates: { codebaseSurvey: false, designChoice: true, architecture: true, plan: false, promotion: true },
  reviews: {
    userStories: true, architecture: true, tasklist: true, plan: true, testSpec: true, code: true,
    security: "recommended", retrospective: "auto", validate: "manual",
  },
};

const now = () => ({ timing: "now" as const, reason: "r" });
const deferred = () => ({ timing: "deferred" as const, reason: "r" });

// ---------------------------------------------------------------------------
// engine

test("engine: consent を持たない・false の定義は確認になり、関数なら回ごとの判定を返す", () => {
  assert.equal(consentOf({ id: "x", kind: "run", title: "t" }, ctx), false);
  assert.equal(consentOf(gate({ consent: false }), ctx), false);
  assert.deepEqual(consentOf(gate({ consent: () => ({ timing: "now", reason: "要件の合意" }) }), ctx), { timing: "now", reason: "要件の合意" });
  const byUnit = gate({ consent: (c) => (c.unit === "design" ? { timing: "now", reason: "r" } : false) });
  assert.deepEqual(consentOf(byUnit, ctx), { timing: "now", reason: "r" });
  assert.equal(consentOf(byUnit, { ...ctx, unit: "build-01" }), false);
});

test("engine: on = when && (consent が now || enabled !== false)", () => {
  const yes = () => true;
  const no = () => false;
  assert.equal(isOn(gate({ when: yes, consent: now, enabled: no }), ctx), true, "同意の回は設定で外さない");
  assert.equal(isOn(gate({ when: yes, consent: false, enabled: no }), ctx), false);
  assert.equal(isOn(gate({ when: yes, consent: false, enabled: yes }), ctx), true);
  assert.equal(isOn(gate({ when: yes, consent: false }), ctx), true, "enabled の省略は有効");
  assert.equal(isOn({ id: "x", kind: "run", title: "t" }, ctx), true);
  assert.equal(isOn(gate({ when: no, consent: now, enabled: yes }), ctx), false, "構造の条件は同意でも外す");
  assert.equal(isOn(gate({ when: yes, consent: deferred, enabled: no }), ctx), false, "deferred の回は enabled で決まる");
  assert.equal(isOn(gate({ when: yes, consent: deferred, enabled: yes }), ctx), true);
});

test("engine: evaluate は同意の回のゲートを off にしない", () => {
  const skill: SkillSteps = {
    skill: "synthetic",
    steps: [gate({ id: "A", consent: now, enabled: () => false }), gate({ id: "B", consent: false, enabled: () => false })],
  };
  const statuses = evaluate(skill, ctx).steps.map((step) => `${step.definition.id}:${step.status}`);
  assert.deepEqual(statuses, ["A:pending", "B:off"]);
});

// ---------------------------------------------------------------------------
// directive（合成した定義）

function opened(definition: StepDefinition): Opened {
  const skill: SkillSteps = { skill: "synthetic", steps: [definition] };
  const config = { retired: [], context: { approval: 250_000, implement: 300_000, review: 400_000 } } as unknown as ResolvedConfig;
  return { phase: "build-01", skill, ctx: { ...ctx, config } };
}

test("directive: deferred の回は確認として示し、now は同意と理由を示す", () => {
  const later = opened(gate({ consent: deferred, enabled: () => true }));
  const directive = buildDirective(later, evaluate(later.skill, later.ctx), { measure: false });
  assert.equal(directive.approval, "confirm");
  assert.equal(directive.approvalReason, null);

  const consent = opened(gate({ consent: now }));
  const now_ = buildDirective(consent, evaluate(consent.skill, consent.ctx), { measure: false });
  assert.equal(now_.approval, "consent");
  assert.equal(now_.approvalReason, "r");

  const run = opened({ id: "x", kind: "run", title: "t" });
  assert.equal(buildDirective(run, evaluate(run.skill, run.ctx), { measure: false }).approval, undefined);
});

test("patch: P1（対応方針の合意）と P2（decisions・constraints を含みうる更新）は同意", () => {
  for (const id of ["P1", "P2"]) {
    const judged = consentOf(PATCH_STEPS.steps.find((step) => step.id === id) as StepDefinition, ctx);
    assert.ok(judged !== false && judged.timing === "now" && judged.reason !== "", id);
  }
});

test("architect: options をスキップした回でも、G3 を行う設定なら designChoiceGate は true のまま", () => {
  const pr = ARCHITECT_STEPS.steps.find((definition) => definition.id === "pr") as StepDefinition;
  const events = [{ at: "2026-11-16T00:00:00Z", skill: "architect", step: "options", result: "skipped" as const, reason: "分岐なし" }];
  // pr の args は宣言の変更（declarationChanged）も読むので、git の無い repoRoot を渡す
  const config = (designChoice: boolean) => ({ gates: { designChoice }, repoRoot: "/nonexistent" }) as unknown as ResolvedConfig;
  assert.equal(pr.args?.({ ...ctx, config: config(true), events })["designChoiceGate"], true);
  assert.equal(pr.args?.({ ...ctx, config: config(false), events })["designChoiceGate"], false);
});

test("conductor: CONSENT_WHEN は、回によって同意になるゲート（consent が関数で enabled を持つ）と一致する", () => {
  const roundDependent = SKILL_STEPS.flatMap((skill) => skill.steps)
    .filter((definition) => definition.kind === "gate" && typeof definition.consent === "function" && definition.enabled !== undefined)
    .map((definition) => definition.ask ?? definition.id);
  assert.deepEqual([...new Set(roundDependent)].sort(), Object.keys(CONSENT_WHEN).sort());
});

test("conductor: 中止・分類できない問いは、子の手順が確認と返しても固定のまま", () => {
  const unknown = resolveAsk("Z9", DEFAULT_CONDUCTOR, ASK_SETTINGS, "confirm");
  assert.deepEqual([unknown.category, unknown.handler, unknown.source], ["unknown", "user", "fixed"]);
  const confirm = resolveAsk("G3", DEFAULT_CONDUCTOR, ASK_SETTINGS, "confirm");
  assert.deepEqual([confirm.category, confirm.handler, confirm.source], ["confirm", "supervisor", "default"]);
});

// ---------------------------------------------------------------------------
// step lint

test("step lint: gate は consent を持ち、gate でないステップは consent / enabled を持たない", () => {
  const problems = lintApproval({
    skill: "synthetic",
    steps: [
      gate({ id: "G9" }),
      gate({ id: "G8", consent: false }),
      { id: "x", kind: "run", title: "t", consent: false },
      { id: "y", kind: "run", title: "t", enabled: () => true },
    ],
  });
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems[0] ?? "", /G9 が承認の種類/);
  assert.match(problems[1] ?? "", /x は gate でないのに consent/);
  assert.match(problems[2] ?? "", /y は gate でないのに enabled/);
});

test("step lint: プラグイン本体のゲートはすべて承認の種類を持つ", (t) => {
  const directory = temporaryDirectory(t);
  assert.match(succeeds(directory, "step", "lint"), /揃っています/);
});

// ---------------------------------------------------------------------------
// CLI

/** 指定の profile のサイクル 001-test を持つワークスペース */
function workspaceWith(t: TestContext, profile: string, ...rootLines: string[]): string {
  const directory = repository(t);
  succeeds(directory, "init", "--root", "docs/hikyaku");
  succeeds(directory, "cycle", "new", "test", "--profile", profile);
  if (rootLines.length > 0) {
    const path = join(directory, ".hikyaku.config");
    writeFileSync(path, `${rootLines.join("\n")}\n${readFileSync(path, "utf8")}`);
  }
  return directory;
}

interface Directive {
  kind: string;
  step?: string;
  approval?: string;
  approvalReason?: string | null;
  args?: Record<string, unknown>;
  message?: string;
}

function env(t: TestContext): NodeJS.ProcessEnv {
  return { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CONFIG_DIR: temporaryDirectory(t) };
}

function step(t: TestContext, directory: string, ...args: string[]): Directive {
  const result = cliWith(directory, env(t), "step", ...args, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function statuses(directory: string, phase: string): string[] {
  return (JSON.parse(succeeds(directory, "step", "status", phase, "001", "--json")).steps as { id: string; status: string }[])
    .map((entry) => `${entry.id}:${entry.status}`);
}

/** planner を G1 の手前まで進める */
function upToG1(t: TestContext, directory: string): Directive {
  step(t, directory, "report", "plan", "inputs", "001", "--result", "done");
  step(t, directory, "report", "plan", "scope", "001", "--result", "done");
  write(directory, `${CYCLE}/planning/user-stories.md`);
  let directive = step(t, directory, "report", "plan", "user-stories", "001", "--result", "done");
  if (directive.step === "review") directive = step(t, directory, "report", "plan", "review", "001", "--result", "done");
  return directive;
}

for (const profile of ["express", "economy", "standard", "thorough"]) {
  test(`planner: ${profile} でも G1 は同意として返る`, (t) => {
    const directory = workspaceWith(t, profile, 'retrospective = "skip"');
    const directive = upToG1(t, directory);
    assert.deepEqual([directive.kind, directive.step, directive.approval], ["gate", "G1", "consent"]);
    assert.match(directive.approvalReason ?? "", /要件の合意/);
  });
}

test("planner: 関連するキーをすべて外しても G1 は外れず、テキストに「承認: 同意（…）」を出す", (t) => {
  const directory = workspaceWith(
    t, "express",
    "user_stories_review = false", "codebase_survey_gate = false", "design_choice_gate = false",
    "architecture_gate = false", "plan_gate = false", 'retrospective = "skip"',
  );
  assert.equal(upToG1(t, directory).step, "G1");
  assert.ok(statuses(directory, "plan").includes("G1:pending"));
  assert.match(succeeds(directory, "step", "next", "plan", "001"), /承認: 同意（要件の合意/);
});

test("設定: user_stories_gate は値に関わらず、移行のヒントつきのエラーにして設定を書き換えない", (t) => {
  for (const value of ["false", "true"]) {
    const directory = workspaceWith(t, "standard", `user_stories_gate = ${value}`);
    const before = snapshot(directory);
    const result = cli(directory, "config", "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /user_stories_gate は v3 で廃止/);
    assert.match(result.stderr, /同意/);
    assert.deepEqual(snapshot(directory), before);
  }
});

test("設定: サイクル設定の user_stories_gate は step で止まる", (t) => {
  const directory = workspaceWith(t, "standard");
  write(directory, `${CYCLE}/.hikyaku.config`, "user_stories_gate = false\n");
  const before = snapshot(directory);
  const directive = step(t, directory, "next", "plan", "001");
  assert.equal(directive.kind, "stop");
  assert.match(directive.message ?? "", /user_stories_gate/);
  assert.deepEqual(snapshot(directory), before);
});

test("設定: 解決した gates に userStories は無く、表示は G1 を常に有効（同意）と示す", (t) => {
  const directory = workspaceWith(t, "economy");
  const config = JSON.parse(succeeds(directory, "config", "001", "--json"));
  assert.deepEqual(Object.keys(config.gates).sort(), ["architecture", "codebaseSurvey", "designChoice", "plan", "promotion"]);
  assert.match(succeeds(directory, "config", "001"), /G1 user-stories\s+常に有効（同意）/);
});

/** 差し戻しからの再設計の回を区切り、options まで報告する。返り値は options の報告の次の1手 */
function redesignUpToOptions(t: TestContext, directory: string): { options: Directive; next: Directive } {
  write(directory, `${CYCLE}/return.md`, returnRecord());
  step(t, directory, "restart", "architect", "001", "--round", "return", "--reason", "build-01 からの差し戻し");
  step(t, directory, "report", "architect", "delegation", "001", "--result", "approved", "--input", "委任を続ける");
  write(directory, `${DESIGN}/codebase-survey.md`);
  step(t, directory, "report", "architect", "survey", "001", "--result", "done");
  const options = step(t, directory, "report", "architect", "questions", "001", "--result", "done");
  return { options, next: step(t, directory, "report", "architect", "options", "001", "--result", "done") };
}

test("architect: express の再設計の回は G3・G4 が同意として返り、options・adr は G3 があることを受け取る", (t) => {
  const directory = workspaceWith(t, "express", 'retrospective = "skip"');
  const { options, next } = redesignUpToOptions(t, directory);
  assert.equal(options.args?.["designChoiceGate"], true);
  assert.deepEqual([next.kind, next.step, next.approval], ["gate", "G3", "consent"]);

  const adr = step(t, directory, "report", "architect", "G3", "001", "--result", "approved", "--input", "Minimal 案で");
  assert.equal(adr.step, "adr");
  assert.equal(adr.args?.["designChoiceGate"], true);
  step(t, directory, "report", "architect", "adr", "001", "--result", "done");
  write(directory, `${DESIGN}/design-delta.md`);
  step(t, directory, "report", "architect", "design-delta", "001", "--result", "done");
  const g4 = step(t, directory, "report", "architect", "architecture-review", "001", "--result", "done");
  assert.deepEqual([g4.kind, g4.step, g4.approval], ["gate", "G4", "consent"]);
  assert.match(g4.approvalReason ?? "", /差し戻しからの再設計/);
});

test("architect: 全ゲートを off にしても再設計の回は G3・G4 が返り、profile と設定は変わらない", (t) => {
  const directory = workspaceWith(
    t, "standard",
    "codebase_survey_gate = false", "design_choice_gate = false", "architecture_gate = false", "plan_gate = false",
  );
  const cyclesBefore = readFileSync(join(directory, "docs/hikyaku/cycles.md"), "utf8");
  assert.equal(redesignUpToOptions(t, directory).next.step, "G3");
  step(t, directory, "report", "architect", "G3", "001", "--result", "approved", "--input", "OK");
  step(t, directory, "report", "architect", "adr", "001", "--result", "done");
  write(directory, `${DESIGN}/design-delta.md`);
  step(t, directory, "report", "architect", "design-delta", "001", "--result", "done");
  assert.equal(step(t, directory, "report", "architect", "architecture-review", "001", "--result", "done").step, "G4");

  const before = snapshot(directory);
  step(t, directory, "next", "architect", "001");
  assert.deepEqual(snapshot(directory), before, "step next は何も書き換えない");
  const config = JSON.parse(succeeds(directory, "config", "001", "--json"));
  assert.deepEqual([config.profile, config.gates.designChoice, config.gates.architecture], ["standard", false, false]);
  assert.equal(readFileSync(join(directory, "docs/hikyaku/cycles.md"), "utf8"), cyclesBefore);
});

test("architect: 再設計の回でも options をスキップすれば G3 は返らない", (t) => {
  const directory = workspaceWith(t, "express");
  write(directory, `${CYCLE}/return.md`, returnRecord());
  step(t, directory, "restart", "architect", "001", "--round", "return", "--reason", "x");
  step(t, directory, "report", "architect", "delegation", "001", "--result", "approved", "--input", "委任を続ける");
  write(directory, `${DESIGN}/codebase-survey.md`);
  step(t, directory, "report", "architect", "survey", "001", "--result", "done");
  step(t, directory, "report", "architect", "questions", "001", "--result", "done");
  const next = step(t, directory, "report", "architect", "options", "001", "--result", "skipped", "--reason", "分岐なし");
  assert.equal(next.step, "design-delta");
});

test("architect: express の通常の回は G3・G4 を外し、designChoiceGate は false。standard では true", (t) => {
  const express = workspaceWith(t, "express");
  write(express, `${DESIGN}/codebase-survey.md`);
  step(t, express, "report", "architect", "survey", "001", "--result", "done");
  assert.equal(step(t, express, "report", "architect", "questions", "001", "--result", "done").args?.["designChoiceGate"], false);
  assert.equal(step(t, express, "report", "architect", "options", "001", "--result", "done").step, "adr");
  write(express, `${DESIGN}/design-delta.md`);
  step(t, express, "report", "architect", "adr", "001", "--result", "done");
  step(t, express, "report", "architect", "design-delta", "001", "--result", "done");
  assert.equal(step(t, express, "report", "architect", "architecture-review", "001", "--result", "done").step, "build-split");
  const offs = statuses(express, "architect");
  assert.ok(offs.includes("G3:off") && offs.includes("G4:off"), offs.join(", "));

  const standard = workspaceWith(t, "standard");
  write(standard, `${DESIGN}/codebase-survey.md`);
  step(t, standard, "report", "architect", "survey", "001", "--result", "done");
  assert.equal(step(t, standard, "report", "architect", "questions", "001", "--result", "done").args?.["designChoiceGate"], true);
});

test("architect: express の追加設計の回では G3 は返らない（同意になるのは差し戻しの回だけ）", (t) => {
  const directory = workspaceWith(t, "express");
  step(t, directory, "restart", "architect", "001", "--round", "add", "--reason", "認可の抜け");
  step(t, directory, "report", "architect", "design-change", "001", "--result", "done");
  step(t, directory, "report", "architect", "questions", "001", "--result", "done");
  assert.equal(step(t, directory, "report", "architect", "options", "001", "--result", "done").step, "adr");
});

test("architect: codebase_survey_gate を有効にすると G2 は確認として返り、テキストに「承認: 確認」を出す", (t) => {
  const directory = workspaceWith(t, "standard", "codebase_survey_gate = true");
  write(directory, `${DESIGN}/codebase-survey.md`);
  const g2 = step(t, directory, "report", "architect", "survey", "001", "--result", "done");
  assert.deepEqual([g2.step, g2.approval, g2.approvalReason], ["G2", "confirm", null]);
  const text = succeeds(directory, "step", "next", "architect", "001");
  assert.match(text, /承認: 確認/);
  assert.doesNotMatch(text, /承認: 同意/);
});

test("builder: G7 は plan_gate で確認として外せる", (t) => {
  for (const [value, expected] of [["false", "test-spec"], ["true", "G7"]] as const) {
    const directory = workspaceWith(t, "standard", `plan_gate = ${value}`);
    succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
    write(directory, `${BUILD}/issue.md`);
    write(directory, `${BUILD}/plan.md`);
    step(t, directory, "report", "build-01", "plan", "001", "--result", "done", "--peak", "350k");
    const next = step(t, directory, "report", "build-01", "plan-review", "001", "--result", "done");
    assert.equal(next.step, expected);
    if (expected === "G7") assert.equal(next.approval, "confirm");
    else assert.ok(statuses(directory, "build-01").includes("G7:off"));
  }
});

test("build-manager と close-cycle: express でも G6 は確認、G10 は同意が要る変更が無ければ省かれる", (t) => {
  const directory = workspaceWith(t, "express");
  for (const id of ["load", "scope", "estimate"]) {
    step(t, directory, "report", "architect", id, "001", "--skill", "build-manager", "--result", "done");
  }
  const g6 = step(t, directory, "report", "architect", "dry-run", "001", "--skill", "build-manager", "--result", "done");
  const gateG6 = g6.step === "tasklist-review"
    ? step(t, directory, "report", "architect", "tasklist-review", "001", "--skill", "build-manager", "--result", "done")
    : g6;
  assert.deepEqual([gateG6.step, gateG6.approval, gateG6.approvalReason], ["G6", "confirm", null]);

  // 同意が要る変更（decisions・constraints）が無ければ確認で、express では promotion_gate が off
  const afterCollect = step(t, directory, "report", "close", "collect", "001", "--result", "done");
  assert.equal(afterCollect.step, "write");
});

// ---------------------------------------------------------------------------
// conductor parse

function result(id: string): string {
  return JSON.stringify({
    type: "result", subtype: "success", is_error: false, result: `<hikyaku-gate id="${id}">\n承認しますか？\n</hikyaku-gate>`,
    session_id: SESSION, total_cost_usd: 1,
  });
}

function parse(directory: string): Record<string, any> {
  const digest = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json")).digest;
  return JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest, "--json"));
}

test("conductor parse: express の再設計の回の G3 は、delegate に書いてあってもユーザーに上げ、profile を変えない", (t) => {
  const directory = workspaceWith(t, "express");
  redesignUpToOptions(t, directory);
  write(directory, "r.json", result("G3"));
  const asksBefore = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json"));
  const output = parse(directory);
  assert.deepEqual([output.ask.category, output.ask.handler, output.ask.source], ["consent", "user", "fixed"]);
  assert.equal(output.step.approval, "consent");
  assert.match(output.step.approvalReason, /差し戻しからの再設計/);
  const asksAfter = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json"));
  assert.deepEqual([asksAfter.profile, asksAfter.digest], [asksBefore.profile, asksBefore.digest]);

  const path = join(directory, ".hikyaku.config");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n[conductor]\ndelegate = ["G3"]\n`);
  const delegated = parse(directory);
  assert.deepEqual([delegated.ask.handler, delegated.ask.source], ["user", "fixed"]);

  // ステップの途中の問いには、手順のゲートの承認の種類を当てない
  write(directory, "r.json", result("questions"));
  assert.equal(parse(directory).ask.category, "spec");
});

test("conductor parse: 通常の回の G3 は確認として監督に振る", (t) => {
  const directory = workspaceWith(t, "standard");
  write(directory, `${DESIGN}/codebase-survey.md`);
  step(t, directory, "report", "architect", "survey", "001", "--result", "done");
  step(t, directory, "report", "architect", "questions", "001", "--result", "done");
  step(t, directory, "report", "architect", "options", "001", "--result", "done");
  write(directory, "r.json", result("G3"));
  const output = parse(directory);
  assert.deepEqual([output.ask.category, output.ask.handler], ["confirm", "supervisor"]);
  assert.deepEqual([output.step.approval, output.step.approvalReason], ["confirm", null]);
});

test("conductor asks: G3・G4 が再設計の回に同意になることを示し、「人間」と書かない", (t) => {
  const directory = workspaceWith(t, "express");
  const json = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json"));
  assert.equal(typeof json.consentWhen.G3, "string");
  assert.equal(typeof json.consentWhen.G4, "string");
  const text = succeeds(directory, "conductor", "asks", "001");
  assert.match(text, /ユーザーに上げる同意ゲート: delegation/);
  assert.match(text, /G10（decisions・constraints の変更を含む回は同意/);
  assert.match(text, /この profile では出ない問い: .*G3（差し戻しからの再設計の回は同意/);
  assert.doesNotMatch(text, /人間/);
});

test("conductor parse: 子の手順の位置を確かめられないとき、回によって同意になるゲートは同意の側に倒す", (t) => {
  const directory = workspaceWith(t, "express");
  const path = join(directory, ".hikyaku.config");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n[conductor]\ndelegate = ["G4"]\n`);
  write(directory, "r.json", result("G4"));
  const output = parse(directory);
  assert.equal(output.step, null, "子の記録が無い");
  assert.deepEqual([output.ask.category, output.ask.handler, output.ask.source], ["consent", "user", "fixed"]);
});
