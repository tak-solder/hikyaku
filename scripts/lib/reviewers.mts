/**
 * PR にアサインするレビュアーの決定。
 *
 * どの PR に誰をアサインするかは、設定と PR の状態だけで決まる。判断ではなく計算なので
 * CLI が担い、スキルは結果に従って依頼するだけにする。
 */

import type { ReviewerSkipTarget } from "./config.mts";

/** フェーズ名を、アサインをオフにできる単位に直す。build-NN は build */
export function skipTargetOf(phase: string): ReviewerSkipTarget | undefined {
  if (/^build-\d+$/.test(phase)) return "build";
  const fixed = ["init", "bp-guide", "create", "plan", "architect", "close", "conductor"];
  return fixed.includes(phase) ? (phase as ReviewerSkipTarget) : undefined;
}

export type ReviewerSource = "pr" | "conductor" | "none";

export interface ReviewerInput {
  phase: string;
  /** PR の実際のマージ先 */
  baseRefName: string;
  /** このサイクルの conductor ブランチ。サイクルに属さないフェーズでは undefined */
  conductorBranch: string | undefined;
  /** [pr] reviewers */
  reviewers: string[];
  /** [pr] reviewers_skip */
  skip: readonly string[];
  /** [conductor] phase_reviewers */
  phaseReviewers: string[];
  /** PR の作成者の login */
  author: string;
  /** 依頼済みのレビュアー（login か team の slug） */
  requested: string[];
  /** レビュー済みのレビュアーの login */
  reviewed: string[];
}

export interface ReviewerPlan {
  /** どの設定から選んだか。none は設定が空か、このフェーズがオフ */
  source: ReviewerSource;
  /** このフェーズのアサインがオフにされている */
  skipped: boolean;
  /** これから依頼する */
  request: string[];
  /** 依頼しなかったレビュアーと理由 */
  excluded: { reviewer: string; reason: string }[];
}

/** @copilot は Copilot の login（copilot-pull-request-reviewer など）として現れる */
function same(reviewer: string, login: string): boolean {
  const a = reviewer.toLowerCase();
  const b = login.toLowerCase();
  if (a === "@copilot") return b.includes("copilot");
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export function planReviewers(input: ReviewerInput): ReviewerPlan {
  const target = skipTargetOf(input.phase);
  if (target !== undefined && input.skip.includes(target)) {
    return { source: "none", skipped: true, request: [], excluded: [] };
  }

  // conductor ブランチ向けの PR だけ別の一覧を使う。人間のレビュアーを入れると、
  // フェーズごとの取り込みが止まるため、通常の PR とは分けて持つ
  const toConductor = input.conductorBranch !== undefined && input.baseRefName === input.conductorBranch;
  const list = toConductor ? input.phaseReviewers : input.reviewers;
  if (list.length === 0) return { source: "none", skipped: false, request: [], excluded: [] };

  const request: string[] = [];
  const excluded: { reviewer: string; reason: string }[] = [];
  for (const reviewer of list) {
    if (request.includes(reviewer)) continue;
    // GitHub は PR の作成者本人をレビュアーにできない。依頼が失敗すると PR の作成後の
    // 手順が止まるので、先に外す
    if (same(reviewer, input.author)) {
      excluded.push({ reviewer, reason: "PR の作成者本人" });
    } else if (input.requested.some((login) => same(reviewer, login))) {
      excluded.push({ reviewer, reason: "依頼済み" });
    } else if (input.reviewed.some((login) => same(reviewer, login))) {
      // gh pr edit --add-reviewer はレビュー済みの人にも再依頼してしまう
      excluded.push({ reviewer, reason: "レビュー済み" });
    } else {
      request.push(reviewer);
    }
  }
  return { source: toConductor ? "conductor" : "pr", skipped: false, request, excluded };
}
