/** promotions — サイクルの記録から、永続化の候補と「役に立たなかった記述」を集める */

import { relative } from "node:path";
import { loadGuide } from "../lib/docs.mts";
import { emit, table } from "../lib/output.mts";
import {
  PROMOTE_HEADING,
  UNHELPFUL_HEADING,
  collectPromotions,
  groupCandidates,
  groupUnhelpful,
  type Candidate,
} from "../lib/promotions.mts";
import { register } from "../lib/registry.mts";
import { openCycle } from "../lib/workspace.mts";

register({
  name: "promotions",
  summary: "サイクルの記録から、永続化の候補と役に立たなかった記述を集める",
  usage: "hikyaku promotions [<cycle>] [--root <path>] [--json]",
  details: [
    "読むのは、サイクルの design-delta.md・各ビルドの handoff.md・各フェーズの retrospective.md と、",
    "サイクルに属す patch の handoff.md（patches/{YYYYMM}/{slug}/handoff.md）です。",
    `「${PROMOTE_HEADING}」と「${UNHELPFUL_HEADING}」の節の箇条書きを、宛先・場所ごとに束ねて返します。`,
    "design-delta.md の「永続ドキュメントの更新予定」は予定として並べます。",
    "",
    "集めて束ねるだけで、取捨選択はしません。重複の判定、マージ済みのコードとの照合、",
    "重要度の見直しは close-cycle が行います。",
    "",
    "書式どおりに読めなかった行は「読めなかった行」として返します。捨てずに、",
    "内容を見て候補に含めるかを判断してください。",
    "",
    "宛先が論理名のとき、document-guide.md で「対象外」になっていれば印を付けます",
    "（意図的に持たない文書へは昇格させません）。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const { config, context: ctx } = openCycle(args, operands[0]);
    const collected = collectPromotions(ctx.directory);
    const guide = loadGuide(config.hikyakuRoot);
    const excluded = new Set(guide.filter((e) => e.ownership === "対象外").map((e) => e.name));
    const uncreated = new Set(guide.filter((e) => e.ownership === "未作成").map((e) => e.name));
    const cycleRel = relative(config.repoRoot, ctx.directory);

    const candidates = [...groupCandidates(collected.candidates)].map(([target, items]) => ({
      target,
      kind: (items[0] as Candidate).kind,
      note: excluded.has(target) ? "対象外" : uncreated.has(target) ? "未作成" : undefined,
      items,
    }));
    const unhelpful = groupUnhelpful(collected.unhelpful);

    emit(
      {
        cycle: ctx.name,
        directory: cycleRel,
        sources: collected.sources,
        candidates,
        planned: collected.planned,
        unhelpful,
        unparsed: collected.unparsed,
      },
      () => {
        const lines = [`${ctx.name} の永続化の候補（${cycleRel}/ の ${collected.sources.length} ファイルから）`, ""];

        if (candidates.length === 0) {
          lines.push(`${PROMOTE_HEADING}: なし`, "");
        }
        for (const group of candidates) {
          const mark = group.note === undefined ? "" : `（${group.note}）`;
          lines.push(`${group.target}${mark}`);
          for (const item of group.items) {
            const tags = [item.importance, item.written ? "済" : undefined].filter((t) => t !== undefined).join("・");
            lines.push(`  ${tags === "" ? "" : `[${tags}] `}${item.text}  ← ${item.source}`);
          }
          lines.push("");
        }

        if (collected.planned.length > 0) {
          lines.push("design-delta.md の更新予定（実装の結果と照らして昇格させる）");
          for (const item of collected.planned) lines.push(`  ${item.text}`);
          lines.push("");
        }

        if (unhelpful.length > 0) {
          lines.push(UNHELPFUL_HEADING);
          lines.push(
            table(
              unhelpful.map((g) => [
                `${g.location}「${g.quote}」`,
                Object.entries(g.reasons)
                  .map(([reason, count]) => `${reason} ${count}`)
                  .join(" / "),
                g.sources.join(", "),
              ]),
              ["記述", "理由と件数", "出どころ"],
            ),
            "",
          );
          for (const g of unhelpful) {
            for (const note of g.notes) lines.push(`  ${g.location}「${g.quote}」 ${note}`);
          }
          if (unhelpful.some((g) => g.notes.length > 0)) lines.push("");
        }

        if (collected.unparsed.length > 0) {
          lines.push("読めなかった行（内容を見て判断する）");
          for (const item of collected.unparsed) {
            lines.push(`  ${item.source}「${item.heading}」: ${item.line}`, `    → ${item.problem}`);
          }
          lines.push("");
        }

        return lines.join("\n").trimEnd();
      },
    );
  },
});
