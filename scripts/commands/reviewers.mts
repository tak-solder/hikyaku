/** pr request-reviewers — 設定に従って、作成した PR にレビュアーをアサインする */

import { flagBoolean, flagString } from "../lib/args.mts";
import { branchName } from "../lib/branch.mts";
import { HikyakuError } from "../lib/errors.mts";
import { ghFailure, type GhFailure } from "../lib/gh-failure.mts";
import { fetchPrGraphql, parsePrReviewState, reviewerLogin, run } from "../lib/github.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { planReviewers, planWithoutPr, type ReviewerPlan } from "../lib/reviewers.mts";
import { requirePhase, scopeFor } from "../lib/stack.mts";

register({
  name: "pr request-reviewers",
  summary: "設定（[pr] reviewers）に従って、作成した PR にレビュアーをアサインする",
  usage: "hikyaku pr request-reviewers <phase> [<cycle>] --pr <number|url> [--dry-run] [--root <path>] [--json]",
  details: [
    "PR を作成した直後に、各スキルが呼びます。設定が空、またはこのフェーズのアサインが",
    "オフ（[pr] reviewers_skip）なら、gh を呼ばずに何もしません。",
    "",
    "どの一覧を使うかは、PR の実際のマージ先で決めます。",
    "",
    "  conductor ブランチ向け   [conductor] phase_reviewers",
    "  それ以外                 [pr] reviewers（デフォルトブランチ向けの PR）",
    "",
    "conductor ブランチ向けを分けるのは、ユーザーのレビュアーを入れると、/hikyaku:conductor が",
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
    "",
    "**gh が使えなくても手順を止めません。** gh が無い・認証できない・依頼に失敗したときは、",
    "applied が false、reason（gh-unavailable / gh-failed）、stage（失敗した呼び出し）、manual",
    "（ユーザーが代わりに行うこと）を返し、終了コード 0 で終わります。PR は作成済みなので、",
    "レビュアーの依頼が通らないことは、PR の後の手順を止める理由にならないためです。",
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
    const conductorBranch = cycle === undefined ? undefined : branchName(config.branch, "conductor", cycle);
    const settings = {
      phase,
      conductorBranch,
      reviewers: config.pr.reviewers,
      skip: config.pr.reviewersSkip,
      phaseReviewers: config.conductor.phaseReviewers,
    };

    const decided = planWithoutPr(settings);
    if (decided !== undefined) {
      emitPlan({ phase, pr: null, base: null, dryRun, requested: false, applied: true, ...decided });
      return;
    }

    /** gh の失敗。マージ先が分からなければ、どちらの一覧を依頼すればよいかも両方示す */
    const fail = (failure: GhFailure, plan?: ReviewerPlan, number?: number): void => {
      const target = number === undefined ? `PR ${pr}` : `PR #${number}`;
      const lists =
        plan !== undefined
          ? [`${plan.request.join(", ")}`]
          : conductorBranch !== undefined && config.conductor.phaseReviewers.length > 0
            ? [
                `${conductorBranch} 向けなら [conductor] phase_reviewers: ${config.conductor.phaseReviewers.join(", ") || "（なし）"}`,
                `それ以外なら [pr] reviewers: ${config.pr.reviewers.join(", ") || "（なし）"}`,
              ]
            : [config.pr.reviewers.join(", ")];
      const manual = [`GitHub の ${target} の画面で、次のレビュアーに依頼してください（PR の作成者本人と依頼済みの人は除く）:`, ...lists.map((line) => `  ${line}`)].join("\n");
      emit(
        { phase, pr: number ?? null, dryRun, requested: false, applied: false, reason: failure.reason, stage: failure.stage, error: failure.error, manual },
        () => [`レビュアーの依頼をできませんでした（${failure.stage}: ${failure.error}）。PR 自体は作成済みです。`, manual].join("\n"),
      );
    };

    let stdout: string;
    try {
      ({ stdout } = await run("gh", ["pr", "view", pr, "--json", "number,baseRefName,author,latestReviews"], {
        cwd: config.repoRoot,
        timeout: 30_000,
      }));
    } catch (error) {
      fail(ghFailure("gh pr view", error));
      return;
    }
    let state: ReturnType<typeof parsePrReviewState>;
    try {
      state = parsePrReviewState(JSON.parse(stdout));
    } catch (error) {
      fail({ reason: "gh-failed", stage: "gh pr view", error: `応答を読めません: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    // 依頼済みは GraphQL から取る。gh pr view には Bot（Copilot など）の依頼が現れず、
    // リポジトリの設定などで既に Copilot が依頼されている場合に、重ねて再依頼してしまう
    let graphql: Awaited<ReturnType<typeof fetchPrGraphql>>;
    try {
      graphql = await fetchPrGraphql(config.repoRoot, state.number);
    } catch (error) {
      fail(ghFailure("gh api graphql", error), undefined, state.number);
      return;
    }

    const names = (list: unknown): string[] =>
      (Array.isArray(list) ? list : []).map(reviewerLogin).filter((name): name is string => name !== undefined);

    const plan = planReviewers({
      ...settings,
      baseRefName: state.baseRefName,
      author: state.author,
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
        fail(ghFailure("gh pr edit", error), plan, state.number);
        return;
      }
    }

    emitPlan({ phase, pr: state.number, base: state.baseRefName, dryRun, requested, applied: true, ...plan });
  },
});

function emitPlan(output: ReviewerPlan & { phase: string; pr: number | null; base: string | null; dryRun: boolean; requested: boolean; applied: boolean }): void {
  emit(output, () => {
    if (output.skipped) return `${output.phase} のレビュアーのアサインはオフです（[pr] reviewers_skip）`;
    if (output.source === "none") return "アサインするレビュアーは設定されていません";
    const lines = [
      `${output.source === "conductor" ? "[conductor] phase_reviewers" : "[pr] reviewers"} から選びました（PR #${output.pr} → ${output.base}）`,
      output.request.length === 0
        ? "新しく依頼するレビュアーはいません"
        : `${output.dryRun ? "依頼予定（--dry-run）" : "依頼しました"}: ${output.request.join(", ")}`,
      ...output.excluded.map((item) => `  除外: ${item.reviewer}（${item.reason}）`),
    ];
    return lines.join("\n");
  });
}
