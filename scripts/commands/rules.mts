/** rules check — パス指定の rule の広さと大きさを測る */

import { flagString } from "../lib/args.mts";
import { loadConfig } from "../lib/config.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { emit, table } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { RULES_DIR, RULE_LOAD_WARNING, listRuleFiles, measureRules, trackedFiles } from "../lib/rules.mts";

register({
  name: "rules check",
  summary: "パス指定の rule（.claude/rules/）の広さと大きさを測り、効かなくなった rule を見つける",
  usage: "hikyaku rules check [--root <path>] [--json]",
  details: [
    "rule ごとに、paths の glob に一致する追跡ファイルの数・一致率・本文の文字数と、",
    "掛け合わせた読み込み量（一致率 × 文字数）を返します。",
    "",
    "rule は一致するファイルを読み書きしたときに読み込まれます。glob が広くて本文が長いと、",
    "関係のない作業でも毎回読み込まれます。広いが短い rule、長いが狭い rule は問題にしません。",
    "",
    `  読み込み量が ${RULE_LOAD_WARNING} を超える   知らせます。glob を狭めるか、狭い glob のファイルに分けてください`,
    "  paths が無い                  起動時に常に読み込まれます（一致率 100% として数えます）",
    "  どのファイルにも一致しない    もう読み込まれません。パスの移動に追従させるか、削除してください",
    "",
    "生成物（[diff] exclude の glob に当たるファイル）は、触って読むファイルではないので分母から除きます。",
    "",
    "どのファイルにも一致しない rule があれば、終了コード 2 で終了します。",
  ].join("\n"),
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const rules = listRuleFiles(config.repoRoot);
    const files = trackedFiles(config.repoRoot);
    if (files === undefined) {
      throw new HikyakuError("追跡ファイルの一覧を取得できません", "Git リポジトリの中で実行してください。");
    }
    const { measures, total } = measureRules(rules, files, config.diff.exclude);
    const stale = measures.filter((m) => m.stale);
    const heavy = measures.filter((m) => m.heavy);

    emit({ directory: RULES_DIR, total, warningAbove: RULE_LOAD_WARNING, rules: measures }, () => {
      if (measures.length === 0) return `${RULES_DIR}/ に rule はありません。`;
      const lines = [
        table(
          measures.map((m) => [
            m.path,
            m.paths === undefined ? "（常時）" : m.paths.join(", "),
            String(m.matched),
            `${(m.share * 100).toFixed(1)}%`,
            String(m.characters),
            String(m.load),
            m.stale ? "一致なし" : m.heavy ? "広くて長い" : "",
          ]),
          ["rule", "paths", "一致", "一致率", "文字数", "読み込み量", ""],
        ),
        "",
        `分母: 追跡ファイル ${total} 件（生成物を除く）。読み込み量 = 一致率 × 文字数。`,
      ];
      for (const m of heavy) {
        lines.push(`! ${m.path}: 読み込み量 ${m.load} が目安（${RULE_LOAD_WARNING}）を超えています。glob を狭めるか、狭い glob のファイルに分けてください`);
      }
      for (const m of stale) {
        lines.push(`✗ ${m.path}: paths がどのファイルにも一致しません。もう読み込まれていません`);
      }
      return lines.join("\n");
    });

    if (stale.length > 0) {
      throw new ValidationError(stale.map((m) => `${m.path}: paths がどのファイルにも一致しません`));
    }
  },
});
