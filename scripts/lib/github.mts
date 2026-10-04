/**
 * gh 経由の GitHub の読み取り。
 *
 * レビューの依頼とスレッドは、gh pr view / REST では足りない。Copilot などの Bot への
 * 依頼は、GraphQL の reviewRequests にしか現れない（gh pr view --json reviewRequests と
 * REST の requested_reviewers は空で返る）。Bot の依頼を見落とすと、レビューが付く前に
 * 取り込んだり、依頼済みの Copilot に重ねて再依頼したりする。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HikyakuError } from "./errors.mts";
import type { ReviewThread } from "./conductor.mts";

export const run = promisify(execFile);

/** 依頼先。User・Bot・Mannequin は login、Team は slug を持つ */
export interface RequestedReviewer {
  __typename?: string;
  login?: string;
  slug?: string;
}

export interface PrGraphql {
  reviewRequests: RequestedReviewer[];
  threads: { unresolved: ReviewThread[]; truncated: boolean };
}

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewRequests(first: 50) {
        nodes {
          requestedReviewer {
            __typename
            ... on User { login }
            ... on Bot { login }
            ... on Mannequin { login }
            ... on Team { slug }
          }
        }
      }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          isResolved
          path
          line
          comments(first: 1) { nodes { author { login } url } }
        }
      }
    }
  }
}`;

/** この PR の、未解決のレビュースレッドとレビューの依頼を取得する */
export async function fetchPrGraphql(cwd: string, number: number): Promise<PrGraphql> {
  try {
    const { stdout } = await run(
      "gh",
      ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-F", `number=${number}`, "-f", `query=${QUERY}`],
      { cwd, timeout: 30_000 },
    );
    const pr = JSON.parse(stdout)?.data?.repository?.pullRequest;
    if (pr === undefined || pr === null) throw new Error("PR が見つかりません");
    const requests: Record<string, any>[] = Array.isArray(pr.reviewRequests?.nodes) ? pr.reviewRequests.nodes : [];
    const nodes: Record<string, any>[] = Array.isArray(pr.reviewThreads?.nodes) ? pr.reviewThreads.nodes : [];
    return {
      reviewRequests: requests
        .map((node) => node["requestedReviewer"])
        .filter((reviewer): reviewer is RequestedReviewer => typeof reviewer === "object" && reviewer !== null),
      threads: {
        truncated: pr.reviewThreads?.pageInfo?.hasNextPage === true,
        unresolved: nodes
          .filter((node) => node["isResolved"] === false)
          .map((node) => ({
            path: String(node["path"] ?? ""),
            line: typeof node["line"] === "number" ? node["line"] : null,
            author: String(node["comments"]?.nodes?.[0]?.author?.login ?? "（不明）"),
            url: String(node["comments"]?.nodes?.[0]?.url ?? ""),
          })),
      },
    };
  } catch (error) {
    throw new HikyakuError(
      `PR #${number} のレビューの依頼とスレッドを gh api graphql で取得できませんでした`,
      error instanceof Error ? error.message : String(error),
    );
  }
}
