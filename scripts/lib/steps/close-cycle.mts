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
import { declarationArgs } from "../premises.mts";
import type { ProgressEvent } from "../progress.mts";
import { collectPromotions, promotionConsent, type PromotionConsent } from "../promotions.mts";
import { metricsComparison } from "../quality-metrics.mts";
import { collectRemovalCandidates } from "../rules.mts";
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

/**
 * 1回の評価（同じ記録の配列）の中では作業ツリーも記録も変わらないので、git を読む判定を1回にまとめる。
 * consent・reopens・args・accepts が同じ評価で何度も呼ぶため
 */
const consentCache = new WeakMap<object, PromotionConsent>();

/** G10 の判定の材料（promotions.mts の promotionConsent が唯一の判定）。サイクルが無ければ変更なし */
function consentState(ctx: StepContext): PromotionConsent {
  if (ctx.cycle === undefined) return { changes: [] };
  const cached = consentCache.get(ctx.events);
  if (cached !== undefined) return cached;
  const state = promotionConsent(ctx.config, ctx.cycle.directory, cycleClosed(ctx));
  consentCache.set(ctx.events, state);
  return state;
}

/**
 * 今回の回の G10 の最後の承認。差し戻しのあと・collect をやり直したあとは無い
 * （collect をやり直すと G10 もやり直しになるので、それより前の承認は数えない）
 */
function g10Approval(ctx: StepContext): ProgressEvent | undefined {
  const events = currentEvents(CLOSE_CYCLE_STEPS, ctx.events).filter((event) => event.skill === "close-cycle");
  let latest: ProgressEvent | undefined;
  for (const event of events) {
    if (event.step === "collect") latest = undefined;
    else if (event.step === "G10") latest = event.result === "approved" ? event : undefined;
  }
  return latest;
}

export const CLOSE_CYCLE_STEPS: SkillSteps = {
  skill: "close-cycle",
  unit: (phase) => (phase === "close" ? "" : undefined),
  steps: [
    { id: "collect", kind: "run", title: "候補の収集（hikyaku promotions）" },
    // 候補は会話の中で整理して提示するのでファイルに結びつけない。profile の管轄外で、常に行う
    {
      id: "G10",
      kind: "gate",
      title: "候補の整理と、昇格の承認",
      // decisions・constraints の変更（候補か作業ツリーの差分）があれば同意。無ければ確認で promotion_gate に従う
      consent: (ctx) => {
        const state = consentState(ctx);
        if (state.problem !== undefined) return { timing: "now", reason: `decisions・constraints の変更を確かめられません（${state.problem}）` };
        if (state.changes.length > 0) return { timing: "now", reason: "decisions・constraints の変更を含む昇格" };
        return false;
      },
      enabled: (ctx) => ctx.config.gates.promotion,
      // 確認として承認したあとに同意が要る変更が出たら、同意として取り直す
      // 承認の種類の無い記録（このビルドより前）は、G10 が常に同意だったので同意として扱う
      reopens: (ctx, approval) => {
        if (approval.approval !== "confirm") return undefined;
        const state = consentState(ctx);
        return state.changes.length > 0 || state.problem !== undefined
          ? "確認として承認したあとに、decisions・constraints の変更（同意が要る変更）が出ました。同意として提示し直してください"
          : undefined;
      },
      ask: "G10",
      args: (ctx) => {
        const state = consentState(ctx);
        return {
          consentChanges: state.changes.map((change) => `${change.doc}: ${change.text}`),
          consentProblem: state.problem ?? false,
          // 書き込みが始まってから戻った回（作業ツリーに同意が要る差分がある）
          returned: state.changes.some((change) => change.source === "diff"),
        };
      },
    },
    {
      // フックの候補があるときだけ、G10 の決定を記録する。採らないなら理由を添えてスキップする
      id: "hooks",
      kind: "run",
      title: "フックを採るかの記録（G10 の決定）",
      // G10 を省いた回は、フックを採ると決まらないので記録しない（followups もフックを作らない）
      when: (ctx) => hookCandidates(ctx) && g10Approval(ctx) !== undefined,
      skippable: true,
    },
    {
      id: "write",
      kind: "run",
      title: "承認された内容の書き込みと検証",
      // 同意が要る差分があるのに、今回の回に同意としての G10 の承認が無ければ受け付けない（G10 へ戻る）
      accepts: (ctx) => {
        const state = consentState(ctx);
        if (state.changes.length === 0 && state.problem === undefined) return undefined;
        const approval = g10Approval(ctx);
        if (approval !== undefined && approval.approval !== "confirm") return undefined;
        return [
          `同意が要る変更（${state.problem ?? state.changes.map((c) => `${c.doc}: ${c.text}`).join(" / ")}）が、G10 で同意として承認されていません。`,
          "step next で G10 へ戻り、同意が要る変更を示してユーザーの承認を得てください",
        ].join("");
      },
      args: (ctx) => ({ promotionGate: g10Approval(ctx) === undefined ? "skipped" : "approved" }),
    },
    { id: "close", kind: "run", title: "サイクルの終了（cycle close）", evidence: cycleClosed },
    { id: "pr", kind: "run", title: "PR の作成", recordsPr: true, args: declarationArgs },
    publicationStep("close-cycle"),
    {
      id: "followups",
      kind: "run",
      title: "別の PR にするもの（見積もりのガイドの見直し・フックの提案・基準を試しに消す）",
      // 基準を消す PR を作ったら --pr に添える。後続のサイクルの指標の比較の起点になる
      recordsPr: "optional",
      args: (ctx) => {
        const review = ctx.cycle === undefined ? undefined : guideReview(collectPeakRecords(ctx.config.hikyakuRoot, [ctx.cycle.record]));
        const base = {
          guideReview: review?.needed ?? false,
          guideReviewReason: review?.reason ?? "",
          hooks: hookCandidates(ctx) && hooksAccepted(ctx),
          g10Input: g10Approval(ctx)?.input ?? "",
        };
        // 位置だけを読む経路（Stop フック・step where）では、git と全サイクルの記録を読まない
        if (ctx.positionOnly === true) return base;
        return {
          ...base,
          ruleRemovals: collectRemovalCandidates(ctx.config, ctx.cycle?.directory),
          metricsComparison: metricsComparison(ctx.config),
        };
      },
    },
  ],
};
