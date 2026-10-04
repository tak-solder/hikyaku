/** pr request-reviewers — 設定に従って、作成した PR にレビュアーをアサインする */

import { flagBoolean, flagString } from "../lib/args.mts";
import { branchName } from "../lib/branch.mts";
import { HikyakuError } from "../lib/errors.mts";
import { fetchPrGraphql, run } from "../lib/github.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { planReviewers } from "../lib/reviewers.mts";
import { requirePhase, scopeFor } from "../lib/stack.mts";

interface PrReviewState {
  number: number;
  baseRefName: string;
  author: { login: string };
  latestReviews: unknown[];
}

function nameOf(entry: unknown): string | undefined {
  const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
  const author = typeof item["author"] === "object" && item["author"] !== null ? (item["author"] as Record<string, unknown>) : {};
  const name = item["login"] ?? item["slug"] ?? item["name"] ?? author["login"];
  return typeof name === "string" ? name : undefined;
}

register({
  name: "pr request-reviewers",
  summary: "設定（[pr] reviewers）に従って、作成した PR にレビュアーをアサインする",
  usage: "hikyaku pr request-reviewers <phase> [<cycle>] --pr <number|url> [--dry-run] [--root <path>] [--json]",
  details: [
    "PR を作成した直後に、各スキルが呼びます。設定が空、またはこのフェーズのアサインが",
    "オフ（[pr] reviewers_skip）なら何もしません。",
    "",
    "どの一覧を使うかは、PR の実際のマージ先で決めます。",
    "",
    "  conductor ブランチ向け   [conductor] phase_reviewers",
    "  それ以外                 [pr] reviewers（デフォルトブランチ向けの PR）",
    "",
    "conductor ブランチ向けを分けるのは、人間のレビュアーを入れると、/hikyaku:conductor が",
    "フェーズごとの取り込みで、レビューが付くまで止まってしまうためです。",
    "",
    "次のレビュアーには依頼しません。理由は excluded に返します。",
    "",
    "  PR の作成者本人   GitHub は作成者本人を依頼先にできない",
    "  依頼済み          二重に依頼しない。Copilot などの Bot の依頼は gh pr view に現れないので",
    "                    GraphQL から取得する（リポジトリの設定などで既に依頼されていても、重ねて依頼しない）",
    "  レビュー済み      gh pr edit --add-reviewer はレビュー済みの人にも再依頼するため",
    "",
    "依頼は gh pr edit --add-reviewer で行うので、@copilot（Copilot への依頼）も使えます。",
    "gh pr create --reviewer は人とチームしか扱えるか分からないため使いません。",
    "",
    "--dry-run では、依頼する予定のレビュアーだけを返し、GitHub には何も書き込みません。",
  ].join("\n"),
  writes: true,
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    const pr = flagString(args, "pr");
    if (pr === undefined) throw new HikyakuError("--pr に PR の番号か URL を指定してください");
    const { config, cycle } = scopeFor(args, phase, operands[1]);
    const dryRun = flagBoolean(args, "dry-run");

    let state: PrReviewState;
    try {
      const { stdout } = await run(
        "gh",
        ["pr", "view", pr, "--json", "number,baseRefName,author,latestReviews"],
        { cwd: config.repoRoot, timeout: 30_000 },
      );
      state = JSON.parse(stdout) as PrReviewState;
    } catch (error) {
      throw new HikyakuError(
        `PR ${pr} の状態を gh pr view で取得できませんでした`,
        error instanceof Error ? error.message : String(error),
      );
    }

    // 依頼済みは GraphQL から取る。gh pr view には Bot（Copilot など）の依頼が現れず、
    // リポジトリの設定などで既に Copilot が依頼されている場合に、重ねて再依頼してしまう
    const graphql = await fetchPrGraphql(config.repoRoot, state.number);

    const names = (list: unknown): string[] =>
      (Array.isArray(list) ? list : []).map(nameOf).filter((name): name is string => name !== undefined);

    const plan = planReviewers({
      phase,
      baseRefName: state.baseRefName,
      conductorBranch: cycle === undefined ? undefined : branchName(config.branch, "conductor", cycle),
      reviewers: config.pr.reviewers,
      skip: config.pr.reviewersSkip,
      phaseReviewers: config.conductor.phaseReviewers,
      author: state.author?.login ?? "",
      requested: names(graphql.reviewRequests),
      reviewed: names(state.latestReviews),
    });

    let requested = false;
    if (plan.request.length > 0 && !dryRun) {
      try {
        await run("gh", ["pr", "edit", String(state.number), "--add-reviewer", plan.request.join(",")], {
          cwd: config.repoRoot,
          timeout: 30_000,
        });
        requested = true;
      } catch (error) {
        throw new HikyakuError(
          `PR #${state.number} へのレビュアーの依頼に失敗しました: ${plan.request.join(", ")}`,
          [
            error instanceof Error ? error.message : String(error),
            "PR 自体は作成済みです。権限やレビュアーの名前を確かめて、手で依頼してください。",
          ].join("\n"),
        );
      }
    }

    emit(
      { phase, pr: state.number, base: state.baseRefName, dryRun, requested, ...plan },
      () => {
        if (plan.skipped) return `${phase} のレビュアーのアサインはオフです（[pr] reviewers_skip）`;
        if (plan.source === "none") return "アサインするレビュアーは設定されていません";
        const lines = [
          `${plan.source === "conductor" ? "[conductor] phase_reviewers" : "[pr] reviewers"} から選びました（PR #${state.number} → ${state.baseRefName}）`,
          plan.request.length === 0
            ? "新しく依頼するレビュアーはいません"
            : `${dryRun ? "依頼予定（--dry-run）" : "依頼しました"}: ${plan.request.join(", ")}`,
          ...plan.excluded.map((item) => `  除外: ${item.reviewer}（${item.reason}）`),
        ];
        return lines.join("\n");
      },
    );
  },
});
