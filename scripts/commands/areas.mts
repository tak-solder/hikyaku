/** areas dormant — 長く触られていなかった領域と、それに結び付いた基準を示す */

import { flagList, flagString } from "../lib/args.mts";
import { dormantAreas } from "../lib/areas.mts";
import { loadConfig } from "../lib/config.mts";
import { HikyakuError } from "../lib/errors.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";

register({
  name: "areas dormant",
  summary: "変更するパスのうち長く触られていなかった領域と、結び付いた rule・ADR・constraints の項目を示す",
  usage: "hikyaku areas dormant --paths <glob,...> [--root <path>] [--json]",
  options: ["paths", "root"],
  details: [
    "--paths に渡した glob（rule の paths と同じ書き方）ごとに、当たる追跡ファイルの最終コミットからの日数を求め、",
    "[areas] dormant_days（既定 180）を超えていれば休眠とみなします。期間ちょうどは休眠ではありません。",
    "当たる追跡ファイルが無い（新しいパス）ものは休眠とみなしません。",
    "",
    "休眠した領域には、重なる基準を並べます。",
    "  rule          .claude/rules/ の paths",
    "  ADR           decisions の「- **領域**: `<glob>`」の行（superseded は読まない）",
    "  constraints   constraints の項目（見出し）ごとの「領域」の行",
    "",
    "長く触られていなかったこと自体が、前提が変わったかもしれないという信号です。示された基準を、",
    "設計（architect の survey の後・builder の plan）の前に見直してください。読み取り専用で、終了コードは常に 0 です。",
  ].join("\n"),
  run: async ({ args }) => {
    const globs = flagList(args, "paths");
    if (globs === undefined || globs.length === 0) {
      throw new HikyakuError("--paths が必要です", "変更するパスの glob をカンマ区切りで渡してください（例: --paths 'src/billing/**,db/migrations/**'）。");
    }
    const config = loadConfig({ root: flagString(args, "root") });
    const result = await dormantAreas(config, globs);
    emit(result, () => {
      const lines: string[] = [];
      for (const area of result.areas) {
        const age = area.days === null ? "履歴なし" : `${area.days} 日前`;
        lines.push(`${area.dormant ? "休眠" : "活動"}  ${area.glob}  最終変更 ${age}`);
        for (const linked of area.linked) lines.push(`    ${linked.kind}  ${linked.source}${linked.kind === "adr" ? `  ${linked.title}` : ""}`);
      }
      const dormant = result.areas.filter((a) => a.dormant);
      lines.push(
        "",
        dormant.length === 0
          ? `休眠した領域はありません（期間 ${result.dormantDays} 日。[areas] dormant_days）。`
          : `${result.dormantDays} 日（[areas] dormant_days）を超えて触られていない領域があります。結び付いた基準を、設計の前に見直してください。`,
      );
      for (const notice of result.notices) lines.push(`! ${notice}`);
      return lines.join("\n");
    });
  },
});
