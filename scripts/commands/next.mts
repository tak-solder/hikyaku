/** next — 着手可能なビルドを返す */

import { flagBoolean } from "../lib/args.mts";
import { branchName, buildPhase } from "../lib/branch.mts";
import { listRemoteBranches } from "../lib/git.mts";
import { deriveState, suggestCommand } from "../lib/phase.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import {
  blockedBuilds,
  buildDirName,
  isComplete,
  readyBuilds,
  type BuildRecord,
} from "../lib/tasklist.mts";
import { resolveViews, sectionNote, type TasklistViews } from "../lib/views.mts";
import { openCycle } from "../lib/workspace.mts";

register({
  name: "next",
  summary: "着手可能なビルドを返す（複数返る場合は並行実行できる）",
  usage: "hikyaku next [<cycle>] [--no-fetch] [--root <path>] [--json]",
  details: [
    "答える問いは「依存ビルドがマージされたか」ではなく、",
    "**「依存ビルドの成果が、いま居るブランチの履歴に在るか」** です。",
    "マージは成果が履歴に入る経路の1つで、先行ビルドのブランチから積む",
    "（スタックする）のがもう1つです。**どちらでも着手できます。**",
    "",
    "tasklist.md を3つの断面で読み、buildID で突き合わせます。",
    "",
    "  一覧・依存グラフ   作業ツリー    まだコミットしていない追加分も候補に出すため",
    "  PR 列（着手判定）  HEAD          「実装が自分の履歴に在る」ことの確認",
    "  PR 列（マージ済み） origin/{base} 依存のラベルと、サイクルが完了したかの判定",
    "",
    "PR 列の更新は実装と同じコミットに同梱されるため、**HEAD で PR 列が非空で",
    "あること自体が、その実装が自分の履歴に在ることを意味します**。作業ツリーを",
    "読むと未コミットの編集まで数えてしまうため、HEAD を見ます。",
    "",
    "縮退は常に安全側に倒れます。デフォルトブランチに居て先行ビルドが未マージなら",
    "PR 列は空なので待機中になり、手元に無いコードの上に実装を始めることはありません。",
    "**着手判定は HEAD までで閉じるので、ネットワークにもリモート追跡参照にも",
    "依存しません。**",
    "",
    "origin/{base} がリモートの先端と食い違う場合だけ、その追跡参照を1本",
    "更新します（作業ツリーにもローカルの {base} にも触りません）。失敗しても",
    "警告するだけで、着手可能・待機の判定は変わりません。--no-fetch で無効にできます。",
    "",
    "着手中の表示には origin のブランチ一覧を使いますが、これも判定には影響しません。",
    "マージ後にブランチを削除しない設定のリポジトリでは残存ブランチが「着手中」に",
    "見えるため、PR 列が非空のビルドは着手中として扱いません。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const { config, context: ctx } = openCycle(args, operands[0]);

    const remote = await listRemoteBranches(config.repoRoot);
    const views = await resolveViews(config, ctx, {
      remoteTips: remote.tips,
      fetch: !flagBoolean(args, "no-fetch"),
    });

    // 一覧は作業ツリー、PR 列は HEAD。これが「このツリーから着手できるか」の答え
    const builds = views.builds;
    const ready = readyBuilds(builds);
    const blocked = blockedBuilds(builds);

    const state = deriveState(ctx.directory, ctx.record, builds, views.mergedIds);

    const branchFor = (build: BuildRecord): string =>
      branchName(config.branch, buildPhase(build.id), ctx.name);
    const hasBranch = (build: BuildRecord): boolean => remote.names.includes(branchFor(build));

    const available = ready.filter((build) => !hasBranch(build));
    const inProgress = ready.filter((build) => hasBranch(build));
    // 待機中のビルドにブランチがあるなら、他セッションが積んで作業している可能性がある
    const blockedWithBranch = blocked.filter((build) => hasBranch(build));

    // 依存が HEAD には在るが base には無い＝スタックしている
    const stacked =
      views.mergedIds !== undefined &&
      ready.some((build) => build.dependsOn.some((dep) => !views.mergedIds?.has(dep)));

    emit(
      {
        cycle: ctx.name,
        phase: state.phase,
        available: available.map((b) => b.id),
        inProgress: inProgress.map((b) => b.id),
        blocked: blocked.map((b) => b.id),
        blockedWithBranch: blockedWithBranch.map((b) => b.id),
        mergePending: state.mergePending,
        stacked,
        list: { source: "worktree", path: views.relativePath },
        readiness: sectionJson(views.head),
        merged: {
          ...sectionJson(views.base),
          ids: views.mergedIds === undefined ? null : [...views.mergedIds],
        },
        base: {
          branch: views.baseBranch ?? null,
          stale: views.freshness.stale ?? null,
          remote: views.freshness.remote ?? null,
          local: views.freshness.local ?? null,
          fetched: views.fetched,
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
            "",
            sectionNote("判定", views.head, " の PR 列（未コミットの変更は数えません）"),
            sectionNote("マージ状況", views.base, " の PR 列"),
          );
          if (views.fetched) lines.push(`  origin/${views.baseBranch} を更新しました`);
          return lines.join("\n");
        }

        lines.push("着手可能:");
        if (available.length === 0) {
          lines.push("  （なし）");
        } else {
          for (const build of available) {
            lines.push(`  ${buildDirName(build.id)}  ${build.title}${dependencyNote(build, views)}`);
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

        if (ready.length === 0 && blocked.length === 0 && state.mergePending.length > 0) {
          lines.push(
            "",
            `このツリーの全ビルドは完了しています。マージ待ち: ${state.mergePending
              .map(buildDirName)
              .join(", ")}`,
            "  マージされると close-cycle に進めます。",
          );
        }

        lines.push(
          "",
          sectionNote("判定", views.head, " の PR 列（未コミットの変更は数えません）"),
          `  一覧と依存グラフは作業ツリーの ${views.relativePath} から`,
          sectionNote("マージ状況", views.base, " の PR 列"),
        );

        if (views.fetched) {
          lines.push(`  origin/${views.baseBranch} を更新しました`);
        }

        if (stacked) {
          lines.push(
            "",
            "! 依存ビルドがデフォルトブランチに入っていません（スタック）。",
            "  成果はこのツリーに在るので着手できますが、**PR の base はデフォルト",
            "  ブランチではなくスタック元のブランチ**になります。",
            `  base は hikyaku pr base build-NN ${ctx.name} で確認してください。`,
          );
        }

        if (views.freshness.stale === true) {
          lines.push(
            "",
            `! ローカルの origin/${views.baseBranch} がリモートより古いままです` +
              `（リモート: ${short(views.freshness.remote)} / 手元: ${short(views.freshness.local)}）。`,
            "  マージ済みラベルが古く見えます。着手可能・待機の判定には影響しません。",
            `  git fetch origin ${views.baseBranch} で更新できます。`,
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

/** 依存が「マージ済み」か「このツリーにしか無い（スタック）」かを添える */
function dependencyNote(build: BuildRecord, views: TasklistViews): string {
  if (build.dependsOn.length === 0) return "  依存: なし";

  const labelled = build.dependsOn.map((dep) => {
    if (views.mergedIds === undefined) return buildDirName(dep);
    return views.mergedIds.has(dep)
      ? `${buildDirName(dep)}（マージ済み）`
      : `${buildDirName(dep)}（このツリーに含まれる）`;
  });
  return `  依存: ${labelled.join(", ")}`;
}

function sectionJson(section: TasklistViews["head"]): Record<string, unknown> {
  return {
    source: section.source,
    ref: section.ref ?? null,
    sha: section.sha ?? null,
    committedAt: section.committedAt ?? null,
    unavailable: section.unavailable ?? null,
  };
}

function short(sha: string | undefined): string {
  return sha === undefined ? "?" : sha.slice(0, 7);
}
