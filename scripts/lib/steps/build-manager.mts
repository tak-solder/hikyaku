/**
 * build-manager（内部スキル）のステップ。
 *
 * 並びは移行前の SKILL.md の Step 0〜4。architect（design/）と
 * builder（build-NN/）から呼ばれ、step の --skill build-manager で呼び出し元の作業単位を
 * 進める。記録は呼び出し元と同じ progress.jsonl に入り、呼び出し元が最後に報告したあとの
 * 記録だけが今回の呼び出しの分になる（engine.mts）。
 */

import { formatK } from "../tokens.mts";
import { currentEvents } from "./engine.mts";
import type { SkillSteps, StepContext } from "./engine.mts";

/** 予測ピークの判定の帯（[context] limit × merge_ratio / estimate_ratio） */
function bands(ctx: StepContext): Record<string, string> {
  return { mergeHint: formatK(ctx.config.peakBands.mergeHint), estimateLimit: formatK(ctx.config.peakBands.estimateLimit) };
}

/**
 * tasklist-review を done にしたか（今回の呼び出しで、最後の G6 の差し戻しより後）。
 * G6 の差し戻しはユーザーの判断なので、そのあとの再レビューは数えない
 */
function reviewedInThisCall(ctx: StepContext): boolean {
  const events = currentEvents(BUILD_MANAGER_STEPS, ctx.events).filter((event) => event.skill === "build-manager");
  const rejected = events.map((event) => event.step === "G6" && event.result === "rejected").lastIndexOf(true);
  return events.slice(rejected + 1).some((event) => event.step === "tasklist-review" && event.result === "done");
}

export const BUILD_MANAGER_STEPS: SkillSteps = {
  skill: "build-manager",
  internal: true,
  steps: [
    {
      id: "load",
      kind: "run",
      title: "テンプレート・見積もりのガイド・tasklist の読み込み",
      args: (ctx) => ({ caller: ctx.unit, ...bands(ctx) }),
    },
    { id: "scope", kind: "run", title: "変更内容（追加・更新・分割）の整理" },
    {
      id: "estimate",
      kind: "run",
      title: "予測ピークの見積もりと分割の判断",
      args: (ctx) => bands(ctx),
    },
    { id: "dry-run", kind: "run", title: "tasklist の差分の取得（--dry-run）" },
    {
      id: "tasklist-review",
      kind: "run",
      title: "doc-reviewer による tasklist のレビュー",
      // ドキュメントのレビューは1回だけ（max_rounds は doc に効かない）。反映して scope から
      // やり直しても、この回で done 済みなら再び回さない。残りの指摘は G6 の提示に回す
      when: (ctx) => ctx.config.reviews.tasklist && !reviewedInThisCall(ctx),
      countsFindings: true,
      args: (ctx) => ({ caller: ctx.unit }),
    },
    { id: "G6", kind: "gate", title: "tasklist と issue.md の変更の承認", consent: false, ask: "G6" },
    { id: "write", kind: "run", title: "tasklist と issue.md の書き込み" },
  ],
};
