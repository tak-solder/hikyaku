/** next — 着手可能なビルドを返す */

import { relative } from "node:path";
import { branchName, buildPhase } from "../lib/branch.mts";
import type { ResolvedConfig } from "../lib/config.mts";
import { defaultBranch, listRemoteBranches, readFileAtDefaultBranch } from "../lib/git.mts";
import { deriveState, suggestCommand } from "../lib/phase.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import {
  blockedBuilds,
  buildDirName,
  isComplete,
  parseTasklist,
  readyBuilds,
  tasklistPath,
  type BuildRecord,
} from "../lib/tasklist.mts";
import { openCycle, type CycleContext } from "../lib/workspace.mts";

register({
  name: "next",
  summary: "着手可能なビルドを返す（複数返る場合は並行実行できる）",
  usage: "hikyaku next [<cycle>] [--root <path>] [--json]",
  details: [
    "依存関係のあるビルドは、先行ビルドがデフォルトブランチにマージ済み",
    "（tasklist.md の PR 列が非空）であることが着手の条件です。",
    "依存関係がないビルドは並行実行できるため、候補は複数返ります。",
    "",
    "完了判定に使う PR 列は、作業ツリーではなくデフォルトブランチの tree から",
    "読みます。ビルドブランチ上では自分の PR 列を埋めた直後の tasklist が見えるため、",
    "作業ツリーを読むと未マージのビルドを完了と誤判定します。",
    "ビルドの一覧（ID・依存）は作業ツリーから取ります。まだマージされていない",
    "tasklist の追加分も候補に出すためです。",
    "",
    "着手中の表示には origin のブランチ一覧を使いますが、到達できなくても",
    "着手可能・待機の判定には影響しません（判定は PR 列だけで行うため）。",
    "",
    "マージ後にブランチを削除しない設定のリポジトリでは残存ブランチが",
    "「着手中」に見えるため、PR 列が非空のビルドは着手中として扱いません。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const { config, context: ctx } = openCycle(args, operands[0]);

    const merged = await mergedBuilds(config, ctx);
    const builds = merged.builds;

    // フェーズ判定も merged を使う。作業ツリーを渡すと、最後のビルドで
    // tasklist done した直後に「completed」と出て close-cycle を勧めてしまう
    const state = deriveState(ctx.directory, ctx.record, builds);

    const ready = readyBuilds(builds);
    const blocked = blockedBuilds(builds);
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
        completionRef: merged.ref ?? null,
        completionUnavailable: merged.unavailable ?? null,
      },
      () => {
        const lines = [`cycle ${ctx.name}: ${state.phase}`, ""];

        if (state.phase !== "building") {
          lines.push(`このサイクルはまだビルド段階ではありません。`, "", `  ${suggestCommand(state.phase, ctx.name)}`);
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
              const target = builds.find((b) => b.id === dep);
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

        if (merged.unavailable !== undefined) {
          lines.push(
            "",
            "! デフォルトブランチの tasklist.md を読めないため、完了判定に作業ツリーを使いました。",
            "  ビルドブランチ上では未マージのビルドが完了に見えます。マージ済みかを目視で確認してください。",
          );
        }

        if (available.length > 0) {
          const first = available[0];
          lines.push("", `実行: /hikyaku:builder ${ctx.name} ${first?.id ?? ""}`);
        }
        return lines.join("\n");
      },
    );
  },
});

interface MergedBuilds {
  builds: BuildRecord[];
  /** 完了判定に使った ref。作業ツリーへフォールバックした場合は undefined */
  ref: string | undefined;
  unavailable: string | undefined;
}

/**
 * ビルドの一覧は作業ツリーから、完了（PR 列）はデフォルトブランチの tree から取る。
 *
 * 一覧まで base から取ると、architect が tasklist を作った直後の（まだマージされて
 * いない）ビルドが候補から消える。逆に完了を作業ツリーから取ると、`tasklist done`
 * した直後の自分のビルドを完了とみなし、依存ビルドを着手可能として返してしまう。
 */
async function mergedBuilds(config: ResolvedConfig, ctx: CycleContext): Promise<MergedBuilds> {
  const base = config.baseBranch ?? defaultBranch(config.repoRoot);
  if (base === undefined) {
    return { builds: ctx.builds, ref: undefined, unavailable: "デフォルトブランチを特定できません" };
  }

  const relativePath = relative(config.repoRoot, tasklistPath(ctx.directory));
  const file = await readFileAtDefaultBranch(config.repoRoot, base, relativePath);
  if (file.content === undefined) {
    return { builds: ctx.builds, ref: undefined, unavailable: file.unavailable };
  }

  // base に tasklist が無い（このサイクルがまだマージされていない）場合も、
  // 「完了しているビルドは1つも無い」という正しい答えになる
  let mergedPr: Map<string, string>;
  try {
    mergedPr = new Map(parseTasklist(file.content).map((build) => [build.id, build.pr]));
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { builds: ctx.builds, ref: undefined, unavailable: message };
  }

  return {
    builds: ctx.builds.map((build) => ({ ...build, pr: mergedPr.get(build.id) ?? "" })),
    ref: file.ref,
    unavailable: undefined,
  };
}

function dependencyNote(dependsOn: string[]): string {
  return dependsOn.length === 0 ? "  依存: なし" : `  依存: ${dependsOn.map(buildDirName).join(", ")}（完了）`;
}
