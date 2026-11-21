/** pr ready — 設定・実行元・GitHub の状態から Ready への切り替えを決める。 */
import { flagBoolean, flagString } from "../lib/args.mts";
import { branchName } from "../lib/branch.mts";
import { shellQuote } from "../lib/conductor.mts";
import { HikyakuError } from "../lib/errors.mts";
import { ghFailure, type GhFailure } from "../lib/gh-failure.mts";
import { ghRest, isGraphqlUnavailable, markReadyRest, parseRestPull, prRef, run } from "../lib/github.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { requirePhase, scopeFor } from "../lib/stack.mts";

register({
  name: "pr ready",
  summary: "設定と実行元に従って Draft PR を Ready for Review にする",
  usage: "hikyaku pr ready <phase> [<cycle>] --pr <number|url> [--for-merge] [--dry-run] [--json]",
  options: ["pr", "for-merge"],
  maxOperands: 2,
  writes: true,
  details: [
    "通常は [pr] auto_ready に従います。conductor の子（HIKYAKU_CONDUCTOR_CHILD=1）は Ready にしません。",
    "監督は取り込む直前の architect / build-NN の PR に --for-merge を指定します。",
    "その場合は実際の向き先が conductor ブランチであることを確かめ、auto_ready より優先します。",
    "GitHub の現在の状態を毎回読み、既に Ready なら何もしません（子は読まずに Draft のまま返します）。",
    "--dry-run は書き込みません。",
    "",
    "**gh が使えなくても手順を止めません。** gh pr view か gh pr ready が失敗したら、applied が false、",
    "reason（gh-unavailable / gh-failed）、stage、manual（ユーザーが代わりに行うこと）を返し、終了コード 0 で終わります。",
    "--for-merge だけは、取り込みの判定に使うので終了コード 1 で止めます。応答の形が想定外のときも 1 です。",
    "",
    "gh の GraphQL が「GraphQL is not available」で拒まれる環境（Claude Code のクラウドのセッションなど）では、",
    "PR の状態を REST（pulls/{n}）で読み、Ready への切り替えを CCR のルート（pulls/{n}/ccr/ready_for_review）で行います。",
    "出力の via が rest になります。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    const pr = flagString(args, "pr");
    if (pr === undefined) throw new HikyakuError("--pr に PR の番号か URL を指定してください");
    const { config, cycle } = scopeFor(args, phase, operands[1]);
    const forMerge = flagBoolean(args, "for-merge");
    const child = process.env["HIKYAKU_CONDUCTOR_CHILD"] === "1";
    if (forMerge && (child || (phase !== "architect" && !phase.startsWith("build-")))) {
      throw new HikyakuError("--for-merge は監督が architect / build-NN の PR を取り込むときだけ指定できます");
    }
    const dryRun = flagBoolean(args, "dry-run");
    // GitHub を読まない経路でも、pr は他の経路と同じく番号で返す（読めなければ渡された値のまま）
    const number = /^#?(\d+)$|\/pull\/(\d+)/.exec(pr.trim());
    const prNumber = number === null ? pr : Number(number[1] ?? number[2]);
    // 子では Ready にしないので、GitHub の状態を読む必要が無い（gh が使えない環境でも止めない）。
    // PR の存在と状態は、監督が取り込む直前の --for-merge と check-pr で確かめる
    if (child) {
      emit({ pr: prNumber, ready: false, applied: true, reason: "conductor-child", dryRun }, () => "Draft のまま監督へ渡します");
      return;
    }
    const retry = `hikyaku pr ready ${phase} ${cycle ?? ""} --pr ${shellQuote(pr)}${forMerge ? " --for-merge" : ""}`;
    /**
     * gh が使えないときは止めずに、できなかったことと代わりに行うことを返す（US-18）。Draft のまま残るだけなので
     * 安全側。監督が取り込む直前の --for-merge は、向き先の確認と取り込みの判定に使うので止める
     */
    const unavailable = (failure: GhFailure): void => {
      if (forMerge) {
        throw new HikyakuError(`PR ${pr} を Ready にできませんでした（${failure.stage}: ${failure.error}）`, `取り込まずに止まってください。再実行: ${retry}`);
      }
      const manual = `PR ${pr} は Draft のままです。gh pr ready ${shellQuote(pr)} を実行するか、GitHub の PR の画面で Ready for review にしてください。`;
      emit(
        { pr: prNumber, ready: false, applied: false, reason: failure.reason, stage: failure.stage, error: failure.error, manual, dryRun },
        () => [`Ready への切り替えをできませんでした（${failure.stage}: ${failure.error}）。`, manual].join("\n"),
      );
    };
    // GraphQL が使えない環境（Claude Code のセッションなど）では、REST と CCR のルートで読み書きする
    let rest = false;
    let view: unknown;
    try {
      const { stdout } = await run("gh", ["pr", "view", pr, "--json", "number,state,isDraft,baseRefName"], { cwd: config.repoRoot, timeout: 30_000 });
      try {
        view = JSON.parse(stdout);
      } catch {
        view = undefined;
      }
    } catch (error) {
      if (!isGraphqlUnavailable(error)) {
        unavailable(ghFailure("gh pr view", error));
        return;
      }
      rest = true;
      let pull: Record<string, any>;
      try {
        const ref = prRef(pr);
        pull = parseRestPull(await ghRest(config.repoRoot, `repos/${ref.repo}/pulls/${ref.number}`));
      } catch (restError) {
        if (restError instanceof HikyakuError) throw restError;
        unavailable(ghFailure("gh api pulls", restError));
        return;
      }
      view = { number: pull["number"], state: pull["normalizedState"], isDraft: pull["draft"], baseRefName: pull["base"]["ref"] };
    }
    if (typeof view !== "object" || view === null || !Number.isInteger((view as any).number) ||
        (view as any).state !== "OPEN" || typeof (view as any).isDraft !== "boolean" || typeof (view as any).baseRefName !== "string") {
      throw new HikyakuError("開いている PR の状態を確認できません", "Draft / Ready を推測せず、gh pr view の応答を確かめてください。");
    }
    const state = view as { number: number; state: string; isDraft: boolean; baseRefName: string };
    if (forMerge && (cycle === undefined || state.baseRefName !== branchName(config.branch, "conductor", cycle))) {
      throw new HikyakuError("取り込む PR の向き先が、このサイクルの conductor ブランチではありません");
    }
    const reason = !state.isDraft ? "already-ready" : !forMerge && !config.pr.autoReady ? "auto-ready-off" : "ready";
    const ready = reason === "ready";
    if (ready && !dryRun) {
      try {
        if (rest) await markReadyRest(config.repoRoot, pr);
        else await run("gh", ["pr", "ready", pr], { cwd: config.repoRoot, timeout: 30_000 });
      } catch (error) {
        if (rest || !isGraphqlUnavailable(error)) {
          unavailable(ghFailure(rest ? "gh api ccr/ready_for_review" : "gh pr ready", error));
          return;
        }
        try {
          rest = true;
          await markReadyRest(config.repoRoot, pr);
        } catch (restError) {
          unavailable(ghFailure("gh api ccr/ready_for_review", restError));
          return;
        }
      }
    }
    emit({ pr: state.number, ready, applied: true, reason, via: rest ? "rest" : "graphql", dryRun }, () => {
      if (reason === "auto-ready-off") return `Draft のまま残します。確認後に gh pr ready ${shellQuote(pr)} を実行してください`;
      if (reason === "already-ready") return "既に Ready for Review です";
      return dryRun ? `PR #${state.number} を Ready にします（--dry-run）` : `PR #${state.number} を Ready にしました`;
    });
  },
});
