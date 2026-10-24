/**
 * builder（BUILD フェーズ）のステップ。
 *
 * 並びは SKILL.md の Step 3〜9 と同じ。Step 0〜2（設定の解決・対象ビルドの決定・
 * コンテキスト復元・ブランチ）はセッションごとにやり直す準備なので、ここには含めず
 * SKILL.md に置く。進捗はビルドのブランチ上の progress.jsonl にあるので、
 * ブランチを決めるまでは現在地を導出できない。
 */

import { readReturn, RETURN_FILE } from "../phase.mts";
import { buildDirName, loadTasklist, normalizeBuildId } from "../tasklist.mts";
import { latestBp, type SkillSteps, type StepContext } from "./engine.mts";

function testSpecSkipped(ctx: StepContext): boolean {
  const events = ctx.events.filter((event) => event.skill === "builder" && event.step === "test-spec");
  return events[events.length - 1]?.result === "skipped";
}

/** 再算出した BP が bp_max − 2 以上なら、分割を検討する（build-manager） */
function splitThreshold(ctx: StepContext): number {
  return ctx.config.bpMax - 2;
}

function needsSplit(ctx: StepContext): boolean {
  const bp = latestBp(ctx.events.filter((event) => event.skill === "builder"));
  return bp !== undefined && bp >= splitThreshold(ctx);
}

/** tasklist.md（作業ツリー）の PR 列が埋まっているか */
function prRecorded(ctx: StepContext): boolean {
  if (ctx.cycle === undefined) return false;
  const id = normalizeBuildId(ctx.unit);
  return loadTasklist(ctx.cycle.directory).some((build) => build.id === id && build.pr.trim() !== "");
}

export const BUILDER_STEPS: SkillSteps = {
  skill: "builder",
  unit: (phase) => (phase.startsWith("build-") ? buildDirName(normalizeBuildId(phase)) : undefined),
  // 差し戻し中のブランチでは builder は進まない（再設計は architect がこのブランチで行う）
  stop: (ctx) => {
    if (ctx.cycle === undefined || readReturn(ctx.cycle.directory) === undefined) return undefined;
    return [
      `このブランチは architect に差し戻されています（${RETURN_FILE}）。設計を見直している最中なので、作業を始めずに止まります。`,
      `再開のコマンド: /hikyaku:architect ${ctx.cycle.name} ${ctx.unit}`,
    ].join("\n");
  },
  steps: [
    { id: "plan", kind: "run", title: "plan.md の作成と BP の再算出", produces: ["plan.md"], reportsBp: true },
    {
      id: "plan-review",
      kind: "run",
      title: "doc-reviewer による plan.md のレビュー",
      when: (ctx) => ctx.config.reviews.plan,
      reportsBp: true,
    },
    {
      id: "split",
      kind: "call",
      title: "分割の検討（build-manager）",
      call: "build-manager",
      when: needsSplit,
      reason: (ctx) =>
        `再算出した BP が ${latestBp(ctx.events.filter((event) => event.skill === "builder")) ?? "?"} で、bp_max − 2（${splitThreshold(ctx)}）以上です`,
    },
    {
      id: "G7",
      kind: "gate",
      title: "plan.md 単独の承認",
      when: (ctx) => ctx.config.gates.plan,
      binds: ["plan.md"],
      ask: "G7",
    },
    {
      id: "test-spec",
      kind: "run",
      title: "test-spec.md の生成（Agent に委任）",
      produces: ["test-spec.md"],
      skippable: true,
    },
    {
      id: "test-spec-review",
      kind: "run",
      title: "doc-reviewer による test-spec.md のレビュー",
      when: (ctx) => ctx.config.reviews.testSpec && !testSpecSkipped(ctx),
    },
    {
      id: "G8",
      kind: "gate",
      title: "plan.md と test-spec.md の承認",
      binds: ["plan.md", "test-spec.md"],
      ask: "G8",
      checkpoint: "approval",
    },
    { id: "implement", kind: "run", title: "実装とテストコードの生成", checkpoint: "implement" },
    { id: "verify", kind: "run", title: "ローカル検証" },
    {
      id: "review",
      kind: "run",
      title: "コードレビュー",
      checkpoint: "review",
      args: (ctx) => ({ codeReview: ctx.config.reviews.code, securityReview: ctx.config.reviews.security }),
    },
    { id: "handoff", kind: "run", title: "handoff.md の作成", produces: ["handoff.md"] },
    { id: "pr", kind: "run", title: "PR の作成と完了の記録", evidence: prRecorded },
    {
      id: "retrospective",
      kind: "call",
      title: "振り返り",
      call: "retrospective",
      when: (ctx) => ctx.config.reviews.retrospective !== "skip",
      reason: () => "ビルドの最後の振り返り",
    },
  ],
};
