/** pr ready — 設定・実行元・GitHub の状態から Ready への切り替えを決める。 */
import { flagBoolean, flagString } from "../lib/args.mts";
import { branchName } from "../lib/branch.mts";
import { HikyakuError } from "../lib/errors.mts";
import { run } from "../lib/github.mts";
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
    "GitHub の現在の状態を毎回読み、既に Ready なら何もしません。--dry-run は書き込みません。",
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
    const { stdout } = await run("gh", ["pr", "view", pr, "--json", "number,state,isDraft,baseRefName"], { cwd: config.repoRoot, timeout: 30_000 });
    const view: unknown = JSON.parse(stdout);
    if (typeof view !== "object" || view === null || !Number.isInteger((view as any).number) ||
        (view as any).state !== "OPEN" || typeof (view as any).isDraft !== "boolean" || typeof (view as any).baseRefName !== "string") {
      throw new HikyakuError("開いている PR の状態を確認できません", "Draft / Ready を推測せず、gh pr view の応答を確かめてください。");
    }
    const state = view as { number: number; state: string; isDraft: boolean; baseRefName: string };
    if (forMerge && (cycle === undefined || state.baseRefName !== branchName(config.branch, "conductor", cycle))) {
      throw new HikyakuError("取り込む PR の向き先が、このサイクルの conductor ブランチではありません");
    }
    const reason = !state.isDraft ? "already-ready" : child ? "conductor-child" : !forMerge && !config.pr.autoReady ? "auto-ready-off" : "ready";
    const ready = reason === "ready";
    if (ready && !dryRun) {
      try {
        await run("gh", ["pr", "ready", String(state.number)], { cwd: config.repoRoot, timeout: 30_000 });
      } catch (error) {
        throw new HikyakuError(`PR #${state.number} を Ready にできませんでした`, `${String(error)}\n再実行: hikyaku pr ready ${phase} ${cycle ?? ""} --pr ${state.number}${forMerge ? " --for-merge" : ""}`);
      }
    }
    emit({ pr: state.number, ready, reason, dryRun }, () => {
      if (reason === "conductor-child") return "Draft のまま監督へ渡します";
      if (reason === "auto-ready-off") return `Draft のまま残します。確認後に gh pr ready ${state.number} を実行してください`;
      if (reason === "already-ready") return "既に Ready for Review です";
      return dryRun ? `PR #${state.number} を Ready にします（--dry-run）` : `PR #${state.number} を Ready にしました`;
    });
  },
});
