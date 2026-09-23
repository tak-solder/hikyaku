/**
 * bp actual — BP 実績の指標を測る。
 *
 * 見積もり（BP の算出）は扱わない。ここが返すのは実測値だけで、
 * bp-guide.md の基準表に当てはめるのは呼び出し元のスキルの仕事。
 */

import { relative } from "node:path";
import { flagBoolean, flagString } from "../lib/args.mts";
import { HikyakuError } from "../lib/errors.mts";
import { diffStats } from "../lib/git.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { requirePhase, resolvePrBase, scopeFor } from "../lib/stack.mts";

register({
  name: "bp actual",
  summary: "PR の base からの差分を数え、BP 実績の指標を返す",
  usage: "hikyaku bp actual <phase> [<cycle>] [--base <ref>] [--no-fetch] [--root <path>] [--json]",
  details: [
    "振り返りで、見積もった BP と実績を突き合わせるために使います。返すのは実測値",
    "だけで、BP の値そのものは返しません。基準表への当てはめは bp-guide.md を見て",
    "呼び出し元が行います。",
    "",
    "  newFiles      新規追加されたファイル数",
    "  changedFiles  差分に現れたファイル数（リネームは1件）",
    "  addedLines    追加行数",
    "  deletedLines  削除行数",
    "  binaryFiles   行数を数えられないファイル数（addedLines には含まれません）",
    "",
    "比較の起点は pr base と同じ導出です（スタックしていればスタック元）。",
    "PR に含まれる差分と、ここで測る差分を一致させるためで、基準がずれると",
    "先行ビルドの差分まで数えることになります。--base で明示もできます。",
    "",
    "起点は base の先端ではなく merge-base です。base 側が先に進んでいても、",
    "このブランチが加えた分だけを数えます。",
    "",
    "**ワークスペース（hikyaku_root）配下は数えません。** plan.md や handoff.md が",
    "実装行数に混ざると、見積もりの指標（実装コードの規模）と比較できなくなります。",
    "",
    "未コミットの変更は数えません。振り返りは成果物をコミットしたあとに走るため、",
    "作業ツリーを見ると「まだコミットしていない分だけ少ない」状態を測ってしまいます。",
    "",
    "base の ref を解決できない場合（Hikyaku の規則外のブランチで作業した等）は",
    "エラーになります。**推測値は返しません。** 実測できなかったことを、実測できた",
    "ことのように記録させないためです。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    const scope = scopeFor(args, phase, operands[1]);
    const { config, cycle } = scope;

    const override = flagString(args, "base");
    const resolved =
      override === undefined
        ? await resolvePrBase(scope, phase, { fetch: !flagBoolean(args, "no-fetch") })
        : undefined;
    const baseRef = override ?? resolved?.ref;

    if (baseRef === undefined) {
      throw new HikyakuError(
        `比較の起点を解決できません: ${resolved?.base ?? "?"}`,
        "git fetch でブランチを取得するか、--base <ref> で明示してください。",
      );
    }

    // hikyaku_root は絶対パスで解決済み。pathspec はリポジトリルートからの相対で渡す
    const excluded = relative(config.repoRoot, config.hikyakuRoot);
    const stats = await diffStats(config.repoRoot, baseRef, excluded === "" ? [] : [excluded]);

    if (stats === undefined) {
      throw new HikyakuError(
        `${baseRef} と HEAD の共通の祖先を見つけられません`,
        "履歴が浅い clone では git fetch --deepen が要ることがあります。",
      );
    }

    emit(
      {
        ...stats,
        baseRef,
        base: resolved?.base ?? null,
        stackedOn: resolved?.stacked?.name ?? null,
        excluded: excluded === "" ? null : excluded,
        phase,
        cycle,
      },
      () => {
        const lines = [
          `起点         ${baseRef}（merge-base ${stats.mergeBase.slice(0, 7)}）`,
          `除外         ${excluded === "" ? "(なし)" : excluded}`,
          "",
          `新規ファイル数  ${stats.newFiles}`,
          `変更ファイル数  ${stats.changedFiles}`,
          `追加行数        ${stats.addedLines}`,
          `削除行数        ${stats.deletedLines}`,
        ];
        if (stats.binaryFiles > 0) {
          lines.push(`バイナリ        ${stats.binaryFiles}（行数は数えていません）`);
        }
        if (resolved?.stacked !== undefined) {
          lines.push("", `（${resolved.stacked.name} に積んでいます。この分だけを数えました）`);
        }
        return lines.join("\n");
      },
    );
  },
});
