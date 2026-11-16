/** diff facts — ビルドの差分から、問題を変えうる変更を事実として並べる（読み取り専用） */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flagBoolean, flagString } from "../lib/args.mts";
import { AGREEMENT_FILE, collectDiffFacts, renderFactsPr, renderFactsText } from "../lib/diff-facts.mts";
import { HikyakuError } from "../lib/errors.mts";
import { emit, isJsonMode } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { requirePhase, resolvePrBase, scopeFor } from "../lib/stack.mts";

const FORMATS = ["text", "json", "pr"] as const;
type Format = (typeof FORMATS)[number];

register({
  name: "diff facts",
  summary: "ビルドの差分から、テストの削除・スキップ・アサーション・設定の宣言・合意の文書の書き換えを事実として並べる",
  usage: "hikyaku diff facts <build-NN> [<cycle>] [--format text|json|pr] [--no-fetch] [--root <path>] [--json]",
  options: ["format", "no-fetch"],
  maxOperands: 2,
  details: [
    "PR のマージ先（hikyaku pr base と同じ）と HEAD の merge-base から、作業ツリーまでを比べます。",
    "未コミットの変更と未追跡のファイルも含めます。このビルドの成果物（plan.md・progress.jsonl など）は一覧から除きます。",
    "",
    "並べるもの:",
    "  変更ファイルと種類（追加・変更・削除・リネームと、実装・テスト・生成物の分類）",
    "  テストファイルの削除（リネームでテストの分類から外れたものを含む）",
    "  削除されたテストの宣言・追加されたスキップの印・アサーションの行の変更（[diff] の印）",
    "  設定の宣言（[app]・[[app.areas]]・[boundaries]・[consent]）の変更",
    "  issue.md の変更と、G8 の承認より後の plan.md・test-spec.md の書き換え",
    "",
    "スコープの内か外か、アサーションの変更が緩和かどうかは判定しません。",
    "合意との突き合わせは、builder の agreement-review で doc-reviewer（context: agreement）が行います。",
    "",
    "  --format text  既定。レビュアーとユーザーが読む形",
    "  --format json  事実の全件（--json と同じ）",
    `  --format pr    PR 本文の節。変更ファイルの一覧は写さず、事実と ${AGREEMENT_FILE} の「返した理由」を並べる`,
    "",
    "基準を解決できないときも止めず、理由を注意に出します（終了コード 0）。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    if (!phase.startsWith("build-")) {
      throw new HikyakuError(`diff facts はビルド（build-NN）でだけ実行します: ${phase}`);
    }
    const raw = flagString(args, "format") ?? (isJsonMode() ? "json" : "text");
    if (!(FORMATS as readonly string[]).includes(raw)) {
      throw new HikyakuError(`--format の値が不正です: ${raw}`, `使用できる値: ${FORMATS.join(" | ")}`);
    }
    const format = raw as Format;
    const scope = scopeFor(args, phase, operands[1]);
    if (scope.context === undefined) throw new HikyakuError("対象のサイクルを決められません");
    const prBase = await resolvePrBase(scope, phase, { fetch: !flagBoolean(args, "no-fetch") });
    const buildDirectory = join(scope.context.directory, phase);
    const facts = await collectDiffFacts({
      config: scope.config,
      phase,
      buildDirectory,
      cycleDirectory: scope.context.directory,
      base: { name: prBase.base, ref: prBase.ref },
    });
    if (format === "pr") {
      const agreementPath = join(buildDirectory, AGREEMENT_FILE);
      const agreement = existsSync(agreementPath) ? readFileSync(agreementPath, "utf8") : undefined;
      process.stdout.write(`${renderFactsPr(facts, agreement)}\n`);
      return;
    }
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
      return;
    }
    emit(facts, () => renderFactsText(facts));
  },
});
