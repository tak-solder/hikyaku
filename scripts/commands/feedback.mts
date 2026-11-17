/** feedback export — Hikyaku へのフィードバックを、中身を含まない記録から書き出す */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { flagBoolean, flagString } from "../lib/args.mts";
import { loadConfig } from "../lib/config.mts";
import { HikyakuError } from "../lib/errors.mts";
import { collectFeedback, FEEDBACK_DIR, feedbackDate, freshFeedbackPath, insideWorkTree, isIgnored, renderFeedback } from "../lib/feedback.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";

register({
  name: "feedback export",
  summary: "Hikyaku へのフィードバックを、中身を含まない記録から書き出す",
  usage: "hikyaku feedback export [--root <path>] [--dry-run] [--json]",
  writes: true,
  details: [
    `{HIKYAKU_ROOT}/${FEEDBACK_DIR}/{YYYYMMDD}.md に書き出します（同じ日に既にあれば {YYYYMMDD}-2.md など。`,
    "送る前に削った書き出しを上書きしません）。中身は次のとおりです。",
    "",
    "  - 止まった手順: progress.jsonl の failed を、スキルとステップごとに数えたもの",
    "  - ゲートにかかった時間: ゲートの記録と直前の記録の日時の差の中央値（スキルとステップごと）",
    "  - upstream: handoff.md・retrospective.md の「永続化すること」に宛先 upstream で書かれた本文",
    "  - 起票の下書き: issue の本文の枠",
    "",
    "progress.jsonl から読むのは at / skill / step / result / hikyaku の欄だけです。",
    "サイクルに属さない patch の記録（{HIKYAKU_ROOT}/patches/）は読みません（マージのたびに増えるため）。",
    "ユーザーの答え（input）・理由（reason）・PR・セッションは読みません。サイクル名・ビルド番号・",
    "patch の slug・作業単位のパスは出力に含めません。",
    "",
    "upstream の本文は自由文なので、リポジトリの中身を含みうります。送る前に全文を読んでください。",
    "外部に送る処理はありません。送るかどうかと起票はユーザーが行います。",
    "",
    `書き出し先が git の追跡対象なら、書き出さずに止まります（{HIKYAKU_ROOT}/.gitignore に ${FEEDBACK_DIR}/ を`,
    "足してください。init が足します）。コミットされると、送るかを決める前に共有されるためです。",
  ].join("\n"),
  maxOperands: 0,
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const dryRun = flagBoolean(args, "dry-run");
    const date = feedbackDate();
    const path = freshFeedbackPath(config.hikyakuRoot, date);
    const relPath = relative(config.repoRoot, path);

    if (!insideWorkTree(config.repoRoot)) {
      throw new HikyakuError(
        `${config.repoRoot} が git の作業ツリーとして読めないため、${relPath} が追跡対象かを確かめられません`,
        "git が使えること、ワークスペースが git のリポジトリの中にあることを確かめてください（確かめられないまま書き出すと、コミットされるおそれがあるため止めています）。",
      );
    }
    if (!isIgnored(config.repoRoot, path)) {
      throw new HikyakuError(
        `${relPath} が git の追跡対象のため、書き出しません`,
        `${relative(config.repoRoot, config.hikyakuRoot)}/.gitignore に ${FEEDBACK_DIR}/ を足してください（hikyaku init でも足せます）。`,
      );
    }

    const content = renderFeedback(collectFeedback(config), date);
    emit({ file: relPath, dryRun, content }, () =>
      dryRun
        ? [content, "", `(--dry-run のため ${relPath} に書き込んでいません)`].join("\n")
        : `${relPath} に書き出しました。送る前に全文を読んでください（外部には何も送っていません）。`,
    );
    if (dryRun) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
});
