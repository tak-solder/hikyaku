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
import type { PrView, ReviewThread } from "./conductor.mts";

export const run = promisify(execFile);

/**
 * gh の応答を検証する。
 *
 * 検証の代わりに型だけキャストして欠けたフィールドを空や false として扱うと、CI やレビューの
 * 状態を取得できなかった応答が「CI なし・依頼なし・Ready」として合格してしまう。取り込みの
 * 検証は fail-closed にする: 必須のフィールドが無い、型が違う応答は、判定せずにエラーにする。
 * 実際の gh は CI が無い PR でも statusCheckRollup を空配列で返すので、空配列は正常
 */
function requireFields(raw: unknown, what: string, checks: Record<string, (value: unknown) => boolean>): Record<string, any> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HikyakuError(`${what} の応答が JSON のオブジェクトではありません`, "取り込めるかを判定できないので止めます。");
  }
  const bad = Object.entries(checks).filter(([key, valid]) => !valid((raw as Record<string, unknown>)[key])).map(([key]) => key);
  if (bad.length > 0) {
    throw new HikyakuError(
      `${what} の応答に、必須のフィールドが無いか、型が違います: ${bad.join(", ")}`,
      "CI やレビューの状態を取得できていない可能性があるので、判定せずに止めます。gh を更新して、もう一度実行してください。",
    );
  }
  return raw as Record<string, any>;
}

/**
 * gh の応答に現れるレビュアー・依頼先・レビューから名前を取り出す。
 * User・Bot は login、Team は slug（無ければ name）、レビューは author.login を持つ
 */
export function reviewerLogin(entry: unknown): string | undefined {
  const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
  const author = typeof item["author"] === "object" && item["author"] !== null ? (item["author"] as Record<string, unknown>) : {};
  const name = item["login"] ?? item["slug"] ?? item["name"] ?? author["login"];
  return typeof name === "string" ? name : undefined;
}

const isString = (value: unknown): boolean => typeof value === "string" && value !== "";
const isArray = (value: unknown): boolean => Array.isArray(value);

/** check-pr が gh pr view --json に渡すフィールド */
export const PR_VIEW_FIELDS = "number,state,isDraft,baseRefName,headRefName,headRefOid,statusCheckRollup,reviews";

/** gh pr view --json {PR_VIEW_FIELDS} の結果 */
export function parsePrView(raw: unknown): PrView {
  const view = requireFields(raw, "gh pr view", {
    number: (value) => Number.isInteger(value),
    state: isString,
    isDraft: (value) => typeof value === "boolean",
    baseRefName: isString,
    headRefName: isString,
    headRefOid: (value) => typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value),
    statusCheckRollup: isArray,
    reviews: isArray,
  });
  return {
    number: view["number"],
    state: view["state"],
    isDraft: view["isDraft"],
    baseRefName: view["baseRefName"],
    headRefName: view["headRefName"],
    headRefOid: view["headRefOid"],
    statusCheckRollup: view["statusCheckRollup"],
    reviews: view["reviews"],
    reviewRequests: [],
  };
}

/** gh pr view --json number,baseRefName,author,latestReviews の結果（レビュアーのアサイン用） */
export function parsePrReviewState(raw: unknown): {
  number: number;
  baseRefName: string;
  author: string;
  latestReviews: unknown[];
} {
  const view = requireFields(raw, "gh pr view", {
    number: (value) => Number.isInteger(value),
    baseRefName: isString,
    author: (value) => typeof value === "object" && value !== null && isString((value as Record<string, unknown>)["login"]),
    latestReviews: isArray,
  });
  return {
    number: view["number"],
    baseRefName: view["baseRefName"],
    author: view["author"]["login"],
    latestReviews: view["latestReviews"],
  };
}

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
    // 依頼とスレッドの一覧が取れていない応答を、「依頼なし・未解決なし」として扱わない
    if (!Array.isArray(pr.reviewRequests?.nodes)) throw new Error("reviewRequests が応答に含まれていません");
    if (!Array.isArray(pr.reviewThreads?.nodes)) throw new Error("reviewThreads が応答に含まれていません");
    const requests: Record<string, any>[] = pr.reviewRequests.nodes;
    const nodes: Record<string, any>[] = pr.reviewThreads.nodes;
    return {
      // 依頼先を読めない依頼（null など）も、依頼が残っているものとして数える
      reviewRequests: requests.map((node) =>
        typeof node?.["requestedReviewer"] === "object" && node["requestedReviewer"] !== null
          ? (node["requestedReviewer"] as RequestedReviewer)
          : { __typename: "Unknown", login: "（不明なレビュアー）" },
      ),
      threads: {
        truncated: pr.reviewThreads.pageInfo?.hasNextPage === true,
        // 解決済みと確認できないスレッドは、未解決として扱う
        unresolved: nodes
          .filter((node) => node?.["isResolved"] !== true)
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
