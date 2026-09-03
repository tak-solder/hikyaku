/** next — 着手可能なビルドを返す */

import { flagString } from "../lib/args.mts";
import { branchName, buildPhase } from "../lib/branch.mts";
import { loadConfig } from "../lib/config.mts";
import { listRemoteBranches } from "../lib/git.mts";
import { deriveState, suggestCommand } from "../lib/phase.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { blockedBuilds, buildDirName, isComplete, readyBuilds } from "../lib/tasklist.mts";
import { resolveCycle } from "../lib/workspace.mts";

register({
  name: "next",
  summary: "着手可能なビルドを返す（複数返る場合は並行実行できる）",
  usage: "hikyaku next [<cycle>] [--root <path>] [--json]",
  details: [
    "依存関係のあるビルドは、先行ビルドがデフォルトブランチにマージ済み",
    "（tasklist.md の PR 列が非空）であることが着手の条件です。",
    "依存関係がないビルドは並行実行できるため、候補は複数返ります。",
    "",
    "着手中の表示には origin のブランチ一覧を使いますが、到達できなくても",
    "着手可能・待機の判定には影響しません（判定は PR 列だけで行うため）。",
    "",
    "マージ後にブランチを削除しない設定のリポジトリでは残存ブランチが",
    "「着手中」に見えるため、PR 列が非空のビルドは着手中として扱いません。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const ctx = resolveCycle(config.hikyakuRoot, operands[0]);
    const state = deriveState(ctx.directory, ctx.record, ctx.builds);

    const ready = readyBuilds(ctx.builds);
    const blocked = blockedBuilds(ctx.builds);
    const remote = await listRemoteBranches(config.repoRoot);

    const started = new Set(
      ready
        .filter((build) =>
          remote.names.includes(branchName(config.branch, buildPhase(build.id), ctx.name)),
        )
        .map((build) => build.id),
    );

    const available = ready.filter((build) => !started.has(build.id));
    const inProgress = ready.filter((build) => started.has(build.id));

    emit(
      {
        cycle: ctx.name,
        phase: state.phase,
        available: available.map((b) => b.id),
        inProgress: inProgress.map((b) => b.id),
        blocked: blocked.map((b) => b.id),
        remoteUnavailable: remote.unavailable,
      },
      () => {
        const lines = [`cycle ${ctx.name}: ${state.phase}`, ""];

        if (state.phase !== "building") {
          lines.push(`このサイクルはまだビルド段階ではありません。`, "", `  ${suggestCommand(state.phase, relativeRoot(config), ctx.name)}`);
          return lines.join("\n");
        }

        lines.push("着手可能:");
        if (available.length === 0) {
          lines.push("  （なし）");
        } else {
          for (const build of available) {
            lines.push(`  ${buildDirName(build.id)}  ${build.title}${dependencyNote(build.dependsOn)}`);
          }
        }

        if (inProgress.length > 0) {
          lines.push("", "着手中（他セッションが作業中の可能性）:");
          for (const build of inProgress) {
            lines.push(
              `  ${buildDirName(build.id)}  ${build.title}  ${branchName(config.branch, buildPhase(build.id), ctx.name)}`,
            );
          }
        }

        if (blocked.length > 0) {
          lines.push("", "待機中:");
          for (const build of blocked) {
            const waiting = build.dependsOn.filter((dep) => {
              const target = ctx.builds.find((b) => b.id === dep);
              return target === undefined || !isComplete(target);
            });
            lines.push(
              `  ${buildDirName(build.id)}  ${build.title}  依存: ${waiting.map(buildDirName).join(", ")} が未マージ`,
            );
          }
        }

        if (remote.unavailable !== undefined) {
          lines.push("", "! origin に到達できないため、着手中の判別ができません");
        }

        if (available.length > 0) {
          const first = available[0];
          lines.push("", `実行: /hikyaku:builder ${relativeRoot(config)} ${ctx.name} ${first?.id ?? ""}`);
        }
        return lines.join("\n");
      },
    );
  },
});

function dependencyNote(dependsOn: string[]): string {
  return dependsOn.length === 0 ? "  依存: なし" : `  依存: ${dependsOn.map(buildDirName).join(", ")}（完了）`;
}

function relativeRoot(config: { repoRoot: string; hikyakuRoot: string }): string {
  return config.hikyakuRoot.startsWith(config.repoRoot)
    ? config.hikyakuRoot.slice(config.repoRoot.length + 1) || "."
    : config.hikyakuRoot;
}
