/** next — 着手可能なビルドを返す */

import { relative } from "node:path";
import { branchName, buildPhase } from "../lib/branch.mts";
import type { ResolvedConfig } from "../lib/config.mts";
import {
  baseFreshness,
  defaultBranch,
  listRemoteBranches,
  readFileAtDefaultBranch,
  type BaseFreshness,
} from "../lib/git.mts";
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
    "答える問いは「依存ビルドがマージされたか」ではなく、",
    "**「依存ビルドの成果が、いま居る作業ツリーに在るか」** です。",
    "マージは成果がツリーに入る経路の1つで、先行ビルドのブランチから積む",
    "（スタックする）のがもう1つです。どちらでも着手できます。",
    "",
    "判定は作業ツリーの tasklist.md の PR 列で行います。PR 列の更新は当該ビルドの",
    "実装と同じブランチに同梱されるため、**作業ツリーで PR 列が非空であること自体が、",
    "その実装が自分のツリーの履歴に在ることを意味します**。マージで入ってきた場合も、",
    "スタックで積んだ場合も同じです。",
    "",
    "縮退は常に安全側に倒れます。デフォルトブランチに居て先行ビルドが未マージなら",
    "PR 列は空なので待機中になり、手元に無いコードの上に実装を始めることはありません。",
    "ネットワークにもリモート追跡参照にも依存しないため、古い origin/{base} で",
    "判定が変わることもありません。",
    "",
    "デフォルトブランチの tasklist.md は「マージ済みかどうか」のラベル付けと、",
    "フェーズ判定（サイクルが完了したか）にだけ使います。読めなくても",
    "着手可能・待機の判定には影響しません。",
    "",
    "着手中の表示には origin のブランチ一覧を使いますが、これも判定には影響しません。",
    "マージ後にブランチを削除しない設定のリポジトリでは残存ブランチが「着手中」に",
    "見えるため、PR 列が非空のビルドは着手中として扱いません。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const { config, context: ctx } = openCycle(args, operands[0]);

    // 着手可能・待機は作業ツリーで判定する。これが「このツリーから着手できるか」の答え
    const builds = ctx.builds;
    const ready = readyBuilds(builds);
    const blocked = blockedBuilds(builds);

    const remote = await listRemoteBranches(config.repoRoot);
    const merged = await mergedView(config, ctx, remote.tips);

    // フェーズ判定だけは base の tasklist を使う。作業ツリーを渡すと、最後のビルドで
    // tasklist done した直後に「completed」と出て close-cycle を勧めてしまう
    const state = deriveState(ctx.directory, ctx.record, merged.builds);

    const branchFor = (build: BuildRecord): string =>
      branchName(config.branch, buildPhase(build.id), ctx.name);
    const hasBranch = (build: BuildRecord): boolean => remote.names.includes(branchFor(build));

    const available = ready.filter((build) => !hasBranch(build));
    const inProgress = ready.filter((build) => hasBranch(build));
    // 待機中のビルドにブランチがあるなら、他セッションが積んで作業している可能性がある
    const blockedWithBranch = blocked.filter((build) => hasBranch(build));

    // 依存が作業ツリーにしか無い＝スタックしている
    const stacked = ready.some((build) =>
      build.dependsOn.some((dep) => !merged.mergedIds.has(dep)),
    );

    emit(
      {
        cycle: ctx.name,
        phase: state.phase,
        available: available.map((b) => b.id),
        inProgress: inProgress.map((b) => b.id),
        blocked: blocked.map((b) => b.id),
        blockedWithBranch: blockedWithBranch.map((b) => b.id),
        stacked,
        readiness: { source: "worktree", path: merged.relativePath },
        merged: {
          source: merged.source,
          ref: merged.ref ?? null,
          sha: merged.sha ?? null,
          committedAt: merged.committedAt ?? null,
          ids: [...merged.mergedIds],
          unavailable: merged.unavailable ?? null,
        },
        base: {
          branch: merged.base ?? null,
          stale: merged.freshness.stale ?? null,
          remote: merged.freshness.remote ?? null,
          local: merged.freshness.local ?? null,
        },
        remoteUnavailable: remote.unavailable,
      },
      () => {
        const lines = [`cycle ${ctx.name}: ${state.phase}`, ""];

        if (state.phase !== "building") {
          lines.push(
            `このサイクルはまだビルド段階ではありません。`,
            "",
            `  ${suggestCommand(state.phase, ctx.name)}`,
          );
          return lines.join("\n");
        }

        lines.push("着手可能:");
        if (available.length === 0) {
          lines.push("  （なし）");
        } else {
          for (const build of available) {
            lines.push(
              `  ${buildDirName(build.id)}  ${build.title}${dependencyNote(build, merged)}`,
            );
          }
        }

        if (inProgress.length > 0) {
          lines.push("", "着手中（他セッションが作業中の可能性）:");
          for (const build of inProgress) {
            lines.push(`  ${buildDirName(build.id)}  ${build.title}  ${branchFor(build)}`);
          }
        }

        if (blocked.length > 0) {
          lines.push("", "待機中:");
          for (const build of blocked) {
            const waiting = build.dependsOn.filter((dep) => {
              const target = builds.find((b) => b.id === dep);
              return target === undefined || !isComplete(target);
            });
            const note = hasBranch(build) ? "  ブランチあり（他セッションが着手済みの可能性）" : "";
            lines.push(
              `  ${buildDirName(build.id)}  ${build.title}  ` +
                `依存: ${waiting.map(buildDirName).join(", ")} の成果がこのツリーにありません${note}`,
            );
          }
        }

        lines.push("", `判定: 作業ツリーの ${merged.relativePath}`, mergedSourceNote(merged));

        if (stacked) {
          lines.push(
            "",
            "! 依存ビルドがデフォルトブランチに入っていません（スタック）。",
            "  成果はこのツリーに在るので着手できますが、**PR の base はデフォルトブランチ",
            "  ではなくスタック元のブランチ**になります。",
            `  base は hikyaku pr base build-NN ${ctx.name} で確認してください。`,
          );
        }

        if (merged.freshness.stale === true) {
          lines.push(
            "",
            `! ローカルの origin/${merged.base} はリモートより古いようです` +
              `（リモート: ${short(merged.freshness.remote)} / 手元: ${short(merged.freshness.local)}）。`,
            "  マージ済みラベルが古く見えます。着手可能・待機の判定には影響しません。",
            `  git fetch origin ${merged.base} で更新できます。`,
          );
        }

        if (remote.unavailable !== undefined) {
          lines.push("", "! origin に到達できないため、着手中の判別ができません");
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

/** マージ済みラベルとフェーズ判定に使う、デフォルトブランチ側の見え方 */
interface MergedView {
  /** フェーズ判定に渡すビルド（PR 列は base 由来） */
  builds: BuildRecord[];
  /** base 上で PR 列が埋まっている＝マージ済みのビルド */
  mergedIds: Set<string>;
  /**
   * ref      … base の tasklist を読めた
   * absent   … base に tasklist がまだ無い（＝マージ済み0件と確定）
   * worktree … base を読めず、フェーズ判定も作業ツリーに縮退した
   */
  source: "ref" | "absent" | "worktree";
  base: string | undefined;
  ref: string | undefined;
  sha: string | undefined;
  committedAt: string | undefined;
  unavailable: string | undefined;
  freshness: BaseFreshness;
  /** 判定に使った作業ツリーの tasklist（リポジトリ相対） */
  relativePath: string;
}

/**
 * デフォルトブランチ側の tasklist を読む。
 *
 * **着手可能・待機の判定には使わない。** 使うのはマージ済みラベルと、
 * 「サイクルが完了したか」というリポジトリ全体の問い（フェーズ判定）だけ。
 * ここが古くても読めなくても、着手可能の判定は変わらない。
 *
 * base に tasklist が無い（architect の PR がまだマージされていない）場合は
 * 「マージ済み0件」と確定できるので、作業ツリーへ縮退しない。縮退すると
 * ビルドブランチ上の自分の PR 列を「マージ済み」として拾ってしまう。
 */
async function mergedView(
  config: ResolvedConfig,
  ctx: CycleContext,
  remoteTips: Map<string, string>,
): Promise<MergedView> {
  const relativePath = relative(config.repoRoot, tasklistPath(ctx.directory));
  const base = config.baseBranch ?? defaultBranch(config.repoRoot);

  const fallback = (unavailable: string, freshness: BaseFreshness): MergedView => ({
    builds: ctx.builds,
    mergedIds: new Set(ctx.builds.filter(isComplete).map((b) => b.id)),
    source: "worktree",
    base,
    ref: undefined,
    sha: undefined,
    committedAt: undefined,
    unavailable,
    freshness,
    relativePath,
  });

  if (base === undefined) {
    return fallback("デフォルトブランチを特定できません", {
      remote: undefined,
      local: undefined,
      stale: undefined,
    });
  }

  const freshness = await baseFreshness(config.repoRoot, base, remoteTips.get(base));
  const file = await readFileAtDefaultBranch(config.repoRoot, base, relativePath);

  if (file.state === "unreadable") {
    return fallback(file.unavailable ?? "デフォルトブランチを読めません", freshness);
  }

  if (file.state === "absent") {
    return {
      builds: ctx.builds.map((build) => ({ ...build, pr: "" })),
      mergedIds: new Set(),
      source: "absent",
      base,
      ref: file.ref,
      sha: file.sha,
      committedAt: file.committedAt,
      unavailable: undefined,
      freshness,
      relativePath,
    };
  }

  let mergedPr: Map<string, string>;
  try {
    mergedPr = new Map(parseTasklist(file.content ?? "").map((build) => [build.id, build.pr]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallback(message.split("\n")[0] ?? message, freshness);
  }

  const mergedIds = new Set(
    [...mergedPr].filter(([, pr]) => pr !== "").map(([id]) => id),
  );

  return {
    builds: ctx.builds.map((build) => ({ ...build, pr: mergedPr.get(build.id) ?? "" })),
    mergedIds,
    source: "ref",
    base,
    ref: file.ref,
    sha: file.sha,
    committedAt: file.committedAt,
    unavailable: undefined,
    freshness,
    relativePath,
  };
}

/** 依存が「マージ済み」か「このツリーにしか無い（スタック）」かを添える */
function dependencyNote(build: BuildRecord, merged: MergedView): string {
  if (build.dependsOn.length === 0) return "  依存: なし";

  const labelled = build.dependsOn.map((dep) => {
    if (merged.source === "worktree") return buildDirName(dep);
    return merged.mergedIds.has(dep)
      ? `${buildDirName(dep)}（マージ済み）`
      : `${buildDirName(dep)}（このツリーに含まれる）`;
  });
  return `  依存: ${labelled.join(", ")}`;
}

function mergedSourceNote(merged: MergedView): string {
  const stamp = merged.committedAt === undefined ? "" : `, ${merged.committedAt.slice(0, 10)}`;
  const at = `${merged.ref}（${merged.sha ?? "?"}${stamp}）`;

  if (merged.source === "ref") return `マージ状況: ${at} の tasklist.md より`;
  if (merged.source === "absent") {
    return `マージ状況: ${at} に tasklist.md がまだありません（マージ済み0件として扱いました）`;
  }
  return (
    `マージ状況: 不明（${merged.unavailable}）。` +
    "マージ済みラベルとフェーズ判定だけが作業ツリー基準に縮退しています"
  );
}

function short(sha: string | undefined): string {
  return sha === undefined ? "?" : sha.slice(0, 7);
}
