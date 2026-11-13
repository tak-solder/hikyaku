/**
 * 区切りでのコンテキスト（#68 段階2）。
 *
 * 区切りの値は progress.jsonl のイベントから導出する。step next は書き込まないので、
 * 区切りに入った瞬間の値は、その直前の報告に記録されたコンテキストで代える。
 *
 *   approval   G8 を最初に提示したとき（最初の G8 の報告）
 *   implement  実装開始前（最後に G8 を承認したとき）
 *   review     レビュー前（最後にローカル検証を終えたとき）
 *
 * G8 の差し戻しが続くと、approval と implement の差に表れる。
 */

import type { ContextBudget } from "../config.mts";
import type { ProgressEvent } from "../progress.mts";

export const CHECKPOINT_LABELS: Record<keyof ContextBudget, string> = {
  approval: "G8（plan と test-spec の承認依頼時）",
  implement: "実装開始前",
  review: "レビュー前",
};

/** 区切りの値を記録するイベントのステップ。step lint が実在を検査する */
export const CHECKPOINT_STEPS: Record<keyof ContextBudget, { skill: string; step: string }> = {
  approval: { skill: "builder", step: "G8" },
  implement: { skill: "builder", step: "G8" },
  review: { skill: "builder", step: "verify" },
};

export interface Overrun {
  checkpoint: keyof ContextBudget;
  label: string;
  tokens: number;
  budget: number;
  over: boolean;
}

function of(events: ProgressEvent[], step: string, results: string[]): ProgressEvent[] {
  return events.filter((event) => event.skill === "builder" && event.step === step && results.includes(event.result));
}

/** 記録のある区切りの値。計測できなかった区切りは含めない */
export function checkpointsOf(events: ProgressEvent[], budget: ContextBudget): Overrun[] {
  const sources: [keyof ContextBudget, ProgressEvent | undefined][] = [
    ["approval", of(events, "G8", ["approved", "rejected"])[0]],
    ["implement", of(events, "G8", ["approved"]).at(-1)],
    ["review", of(events, "verify", ["done"]).at(-1)],
  ];
  return sources.flatMap(([checkpoint, event]) => {
    if (event?.context === undefined) return [];
    return [{
      checkpoint,
      label: CHECKPOINT_LABELS[checkpoint],
      tokens: event.context,
      budget: budget[checkpoint],
      over: event.context > budget[checkpoint],
    }];
  });
}
