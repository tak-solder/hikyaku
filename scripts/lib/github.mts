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
import { sameReviewer } from "./reviewers.mts";

export const run = promisify(execFile);

/**
 * リモートの URL から GitHub の owner/repo を取り出す。github.com 以外なら undefined。
 * https://github.com/o/r(.git)・git@github.com:o/r(.git)・ssh://git@github.com/o/r(.git) に対応する
 */
export function githubRepositoryOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const match = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match?.[1];
}

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

// ---------------------------------------------------------------------------
// GraphQL が使えない環境（Claude Code のクラウドのセッションなど）の REST の経路

/**
 * gh の失敗が「GraphQL を使えない」ことによるか。Claude Code のセッションでは GraphQL が 403 で拒まれ、
 * その応答が REST と CCR のルート（/pulls/{n}/ccr/...）を案内する。この応答を見たときだけ REST に切り替える
 * （ほかの環境で CCR のルートを推測で叩かない）
 */
export function isGraphqlUnavailable(error: unknown): boolean {
  const parts: unknown[] = [error instanceof Error ? error.message : error];
  if (typeof error === "object" && error !== null) {
    parts.push((error as { stderr?: unknown }).stderr, (error as { hint?: unknown }).hint);
  }
  return parts.some((part) => typeof part === "string" && /GraphQL is not available/i.test(part));
}

/** PR の番号か URL。URL ならそのリポジトリ、番号なら gh が解決する既定のリポジトリ（{owner}/{repo}） */
export interface PrRef {
  repo: string;
  number: number;
}

export function prRef(pr: string): PrRef {
  const url = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(pr);
  if (url !== null) return { repo: url[1] as string, number: Number(url[2]) };
  const number = /^#?(\d+)$/.exec(pr.trim());
  if (number === null) throw new HikyakuError(`PR の番号か URL ではありません: ${pr}`);
  return { repo: "{owner}/{repo}", number: Number(number[1]) };
}

/** gh api で REST を呼び、JSON を返す。fields は -f（文字列）、typed は -F（真偽値・数値）で渡す */
export async function ghRest(
  cwd: string,
  path: string,
  options: { method?: string; fields?: Record<string, string>; typed?: Record<string, string | number | boolean>; arrays?: Record<string, string[]> } = {},
): Promise<any> {
  const args = ["api", path];
  if (options.method !== undefined) args.push("--method", options.method);
  for (const [key, value] of Object.entries(options.fields ?? {})) args.push("-f", `${key}=${value}`);
  for (const [key, value] of Object.entries(options.typed ?? {})) args.push("-F", `${key}=${value}`);
  for (const [key, values] of Object.entries(options.arrays ?? {})) for (const value of values) args.push("-f", `${key}[]=${value}`);
  const { stdout } = await run("gh", args, { cwd, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  if (stdout.trim() === "") return null;
  try {
    return JSON.parse(stdout);
  } catch {
    throw new HikyakuError(`gh api ${path} の応答を JSON として読めません`, stdout.slice(0, 200));
  }
}

/** REST の PR の state（open / closed）と merged を、gh pr view の state（OPEN / CLOSED / MERGED）にそろえる */
function prStateOf(pull: Record<string, any>): string {
  if (pull["state"] === "open") return "OPEN";
  return pull["merged"] === true || typeof pull["merged_at"] === "string" ? "MERGED" : "CLOSED";
}

/** GET /pulls/{n} を検証する（gh pr view と同じく fail-closed） */
export function parseRestPull(raw: unknown): Record<string, any> {
  const pull = requireFields(raw, "gh api pulls", {
    number: (value) => Number.isInteger(value),
    state: isString,
    draft: (value) => typeof value === "boolean",
    base: (value) => typeof value === "object" && value !== null && isString((value as Record<string, unknown>)["ref"]),
    head: (value) =>
      typeof value === "object" && value !== null && isString((value as Record<string, unknown>)["ref"]) &&
      typeof (value as Record<string, unknown>)["sha"] === "string" && /^[0-9a-f]{40,64}$/.test((value as Record<string, string>)["sha"] as string),
    user: (value) => typeof value === "object" && value !== null && isString((value as Record<string, unknown>)["login"]),
  });
  return { ...pull, normalizedState: prStateOf(pull) };
}

/** REST のレビュー（user.login・state）を、gh pr view の reviews の形（author.login・state）にそろえる */
function restReviews(raw: unknown): { author: { login: string }; state: string; authorType: string }[] {
  if (!Array.isArray(raw)) throw new HikyakuError("gh api pulls/{n}/reviews の応答が配列ではありません");
  return raw.map((review) => ({
    author: { login: String(review?.user?.login ?? "（不明）") },
    state: String(review?.state ?? ""),
    authorType: String(review?.user?.type ?? ""),
  }));
}

/**
 * CCR のレビュースレッドの一覧を、未解決のスレッドにする。応答の形が分からないスレッドは判定できないので止める
 * （「未解決なし」と読まない）
 */
export function parseCcrThreads(raw: unknown): { unresolved: ReviewThread[]; truncated: boolean } {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.threads) ? (raw as any).threads : undefined;
  if (list === undefined) {
    throw new HikyakuError("レビュースレッドの応答（ccr/review_threads）を読めません", "未解決のスレッドの有無を判定できないので止めます。");
  }
  const unresolved: ReviewThread[] = [];
  for (const thread of list as Record<string, any>[]) {
    const resolved = thread?.["is_resolved"] ?? thread?.["isResolved"] ?? thread?.["resolved"];
    if (typeof resolved !== "boolean") {
      throw new HikyakuError(
        "レビュースレッドの応答（ccr/review_threads）に、解決済みかどうかの欄がありません",
        "未解決のスレッドの有無を判定できないので止めます。",
      );
    }
    if (resolved) continue;
    const comments = thread["comments"];
    const first = Array.isArray(comments) ? comments[0] : Array.isArray(comments?.nodes) ? comments.nodes[0] : undefined;
    const line = thread["line"] ?? first?.["line"];
    unresolved.push({
      path: String(thread["path"] ?? first?.["path"] ?? ""),
      line: typeof line === "number" ? line : null,
      author: String(first?.["user"]?.["login"] ?? first?.["author"]?.["login"] ?? "（不明）"),
      url: String(first?.["html_url"] ?? first?.["url"] ?? ""),
    });
  }
  return { unresolved, truncated: list.length >= 100 };
}

/** REST の check-run（status・conclusion は小文字）を、gh の statusCheckRollup の CheckRun の形にそろえる */
function restCheckRuns(raw: unknown): unknown[] {
  const runs = (raw as any)?.check_runs;
  if (!Array.isArray(runs)) throw new HikyakuError("gh api commits/{sha}/check-runs の応答に check_runs がありません");
  if (typeof (raw as any)?.total_count === "number" && (raw as any).total_count > runs.length) {
    throw new HikyakuError("CI のチェックが多すぎて、全てを確かめられません", "取り込めるかを判定できないので止めます。");
  }
  return runs.map((check: Record<string, any>) => ({
    __typename: "CheckRun",
    name: check["name"],
    status: typeof check["status"] === "string" ? check["status"].toUpperCase() : "",
    conclusion: typeof check["conclusion"] === "string" ? check["conclusion"].toUpperCase() : "",
  }));
}

/** REST のコミットのステータス（combined status）を、statusCheckRollup の StatusContext の形にそろえる */
function restStatuses(raw: unknown): unknown[] {
  const statuses = (raw as any)?.statuses;
  if (!Array.isArray(statuses)) throw new HikyakuError("gh api commits/{sha}/status の応答に statuses がありません");
  return statuses.map((status: Record<string, any>) => ({ __typename: "StatusContext", context: status["context"], state: status["state"] }));
}

/**
 * check-pr が読む PR の状態を、REST と CCR のルートで組み立てる（GraphQL が使えないとき）。
 * REST では Bot（Copilot など）への依頼が見えないので、設定で依頼する Bot（botReviewers）のうち、
 * まだ Bot のレビューが付いていないものを unverifiedRequests に返す。コミットのステータスが読めない
 * （権限で 403 になる）ときは、check-runs だけで判定して warnings に残す
 */
export async function fetchPrViewRest(cwd: string, pr: string, botReviewers: string[] = []): Promise<PrView & { warnings: string[]; unverifiedRequests: string[] }> {
  const ref = prRef(pr);
  const base = `repos/${ref.repo}/pulls/${ref.number}`;
  const warnings: string[] = [];
  let pull: Record<string, any>;
  let reviews: ReturnType<typeof restReviews>;
  let threads: { unresolved: ReviewThread[]; truncated: boolean };
  let checks: unknown[];
  try {
    pull = parseRestPull(await ghRest(cwd, base));
    reviews = restReviews(await ghRest(cwd, `${base}/reviews?per_page=100`));
    threads = parseCcrThreads(await ghRest(cwd, `${base}/ccr/review_threads?per_page=100`));
    checks = restCheckRuns(await ghRest(cwd, `repos/${ref.repo}/commits/${pull["head"]["sha"]}/check-runs?per_page=100`));
  } catch (error) {
    if (error instanceof HikyakuError) throw error;
    throw new HikyakuError(`PR ${pr} の状態を REST（gh api）で取得できませんでした`, error instanceof Error ? error.message : String(error));
  }
  try {
    checks = [...checks, ...restStatuses(await ghRest(cwd, `repos/${ref.repo}/commits/${pull["head"]["sha"]}/status`))];
  } catch (error) {
    warnings.push(`コミットのステータス（commit status）を読めないので、CI は check-runs だけで判定しました（${firstLine(error)}）`);
  }
  const requested = [
    ...(Array.isArray(pull["requested_reviewers"]) ? pull["requested_reviewers"] : []).map((user: any) => ({ __typename: "User", login: user?.login })),
    ...(Array.isArray(pull["requested_teams"]) ? pull["requested_teams"] : []).map((team: any) => ({ __typename: "Team", slug: team?.slug })),
  ];
  const unverifiedRequests = botReviewers.filter(
    (bot) => !reviews.some((review) => review.authorType === "Bot" && sameReviewer(bot, review.author.login)),
  );
  return {
    number: pull["number"],
    state: pull["normalizedState"],
    isDraft: pull["draft"],
    baseRefName: pull["base"]["ref"],
    headRefName: pull["head"]["ref"],
    headRefOid: pull["head"]["sha"],
    statusCheckRollup: checks,
    reviews: reviews.map(({ author, state }) => ({ author, state })),
    reviewRequests: requested,
    reviewThreads: threads,
    warnings,
    unverifiedRequests,
  };
}

/** Draft の PR を Ready for Review にする（GraphQL が使えないときの CCR のルート） */
export async function markReadyRest(cwd: string, pr: string): Promise<void> {
  const ref = prRef(pr);
  await ghRest(cwd, `repos/${ref.repo}/pulls/${ref.number}/ccr/ready_for_review`, { method: "POST" });
}

function firstLine(error: unknown): string {
  const stderr = typeof error === "object" && error !== null ? (error as { stderr?: unknown }).stderr : undefined;
  const text = typeof stderr === "string" && stderr.trim() !== "" ? stderr : error instanceof Error ? error.message : String(error);
  return text.split("\n").find((line) => line.trim() !== "" && !line.startsWith("Command failed"))?.trim() ?? "理由不明";
}
