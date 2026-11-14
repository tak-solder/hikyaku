/**
 * close-cycle（CLOSE フェーズ）のステップ。
 *
 * Step 0（設定・ブランチ・完了の確認・セッション名）はセッションごとにやり直す準備なので、
 * ここには含めず SKILL.md に置く。
 *
 * 作業単位はサイクルのディレクトリの直下にする（progress.jsonl は cycles/{cycle}/progress.jsonl）。
 *
 *   - CLOSE の成果物はサイクルの外（永続ドキュメント・instructions.md・cycles.md）にあり、
 *     planning/ や build-NN/ のように「このフェーズの成果物を置くディレクトリ」が無い
 *   - CLOSE はサイクルの最後のフェーズで、ほかのフェーズが直下に記録を置くことはない。
 *     置いたとしても、記録はスキル名で分かれるので混ざらない
 *
 * CLOSE 自身の振り返りは行わない。昇格の素材にするには昇格より先に行う必要があり、その時点では
 * 振り返る中身がまだ無い。
 *
 * PR を作ったあとの followups は、close の PR に混ぜずに別のブランチの PR にするもの
 * （見積もりのガイドの見直し・フックの提案）。必要かどうかはここで判定して指示に添える。
 * フックは、候補があるだけでは作らない。G10 で採ると決まったことを hooks ステップに記録し、
 * その記録から判定する。
 * どちらも採否は人間がマージで決めるので、ゲートを置かない。該当が無くても手順の最後に置く
 * （最後のステップが条件付きだと、記録だけからは手順を終えたかが分からなくなる）。
 */

import { publicationStep } from "./publication.mts";
import { collectPromotions } from "../promotions.mts";
import { collectPeakRecords, guideReview } from "../tokens-history.mts";
import { currentEvents, type SkillSteps, type StepContext } from "./engine.mts";

/** cycle close で closed / abandoned になったか */
function cycleClosed(ctx: StepContext): boolean {
  return ctx.cycle !== undefined && ctx.cycle.record.status !== "active";
}

/** サイクルの記録に、フックにする候補があるか（採るかは G10 で決まる） */
function hookCandidates(ctx: StepContext): boolean {
  if (ctx.cycle === undefined) return false;
  return collectPromotions(ctx.cycle.directory).candidates.some((candidate) => candidate.kind === "hook");
}

/**
 * G10 で、フックを採ると決まったか。hooks ステップの最後の記録で決める（done = 採る、skipped = 採らない）。
 * 候補が記録にあるかだけで決めると、G10 で却下したフックの PR を作る手順へ進んでしまう。
 * 承認の答え（--input）は自由な文章なので、判定には使わない
 */
function hooksAccepted(ctx: StepContext): boolean {
  const events = currentEvents(CLOSE_CYCLE_STEPS, ctx.events).filter((event) => event.skill === "close-cycle" && event.step === "hooks");
  return events[events.length - 1]?.result === "done";
}

export const CLOSE_CYCLE_STEPS: SkillSteps = {
  skill: "close-cycle",
  unit: (phase) => (phase === "close" ? "" : undefined),
  steps: [
    { id: "collect", kind: "run", title: "候補の収集（hikyaku promotions）" },
    // 候補は会話の中で整理して提示するのでファイルに結びつけない。profile の管轄外で、常に行う
    { id: "G10", kind: "gate", title: "候補の整理と、昇格の承認", ask: "G10" },
    {
      // フックの候補があるときだけ、G10 の決定を記録する。採らないなら理由を添えてスキップする
      id: "hooks",
      kind: "run",
      title: "フックを採るかの記録（G10 の決定）",
      when: hookCandidates,
      skippable: true,
    },
    { id: "write", kind: "run", title: "承認された内容の書き込みと検証" },
    { id: "close", kind: "run", title: "サイクルの終了（cycle close）", evidence: cycleClosed },
    { id: "pr", kind: "run", title: "PR の作成", recordsPr: true },
    publicationStep("close-cycle"),
    {
      id: "followups",
      kind: "run",
      title: "別の PR にするもの（見積もりのガイドの見直し・フックの提案）",
      args: (ctx) => {
        const review = ctx.cycle === undefined ? undefined : guideReview(collectPeakRecords(ctx.config.hikyakuRoot, [ctx.cycle.record]));
        return {
          guideReview: review?.needed ?? false,
          guideReviewReason: review?.reason ?? "",
          hooks: hookCandidates(ctx) && hooksAccepted(ctx),
        };
      },
    },
  ],
};
