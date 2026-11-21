/**
 * build-manager（内部スキル）のステップ。
 *
 * 並びは移行前の SKILL.md の Step 0〜4。architect（design/）と
 * builder（build-NN/）から呼ばれ、step の --skill build-manager で呼び出し元の作業単位を
 * 進める。記録は呼び出し元と同じ progress.jsonl に入り、呼び出し元が最後に報告したあとの
 * 記録だけが今回の呼び出しの分になる（engine.mts）。
 */

import { formatK } from "../tokens.mts";
import { currentEvents, type SkillSteps, type StepContext } from "./engine.mts";

/** 予測ピークの判定の帯（[context] limit × merge_ratio / estimate_ratio） */
function bands(ctx: StepContext): Record<string, string> {
  return { mergeHint: formatK(ctx.config.peakBands.mergeHint), estimateLimit: formatK(ctx.config.peakBands.estimateLimit) };
}

/**
 * 今回の呼び出しで tasklist-review を done で終えた位置（今回の記録の中の添字）。終えていなければ -1。
 * doc のレビューは1回だけなので（config.mts の doc の maxRounds）、指摘を反映して scope から
 * やり直しても、同じ呼び出しの中では回し直さない（#139）。呼び直し（step restart）で回が変われば数え直す
 */
function reviewedAt(ctx: StepContext): number {
  const events = currentEvents({ skill: "build-manager", internal: true }, ctx.events);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.skill === "build-manager" && event.step === "tasklist-review" && event.result === "done") return i;
  }
  return -1;
}

/** レビューを終えたあとに scope から整理し直したか（G6 で、レビューを経ていない変更を分けて示すため） */
function revisedAfterReview(ctx: StepContext): boolean {
  const at = reviewedAt(ctx);
  if (at === -1) return false;
  const events = currentEvents({ skill: "build-manager", internal: true }, ctx.events);
  return events.slice(at + 1).some((event) => event.skill === "build-manager" && event.step === "scope" && event.result === "done");
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
      // 終えたあとは手順から外す（off）。scope からやり直しても、レビューを待たずに G6 へ進む
      when: (ctx) => ctx.config.reviews.tasklist && !revisedAfterReview(ctx),
      countsFindings: true,
      args: (ctx) => ({ caller: ctx.unit }),
    },
    {
      id: "G6",
      kind: "gate",
      title: "tasklist と issue.md の変更の承認",
      consent: false,
      ask: "G6",
      args: (ctx) => ({ revisedAfterReview: revisedAfterReview(ctx) }),
    },
    { id: "write", kind: "run", title: "tasklist と issue.md の書き込み" },
  ],
};
