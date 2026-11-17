/** gate brief — G4・G8 で示す中身を組み立てる（読み取り専用。US-12） */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flagBoolean } from "../lib/args.mts";
import { HikyakuError } from "../lib/errors.mts";
import { boundaryChanges, DESIGN_DELTA, g8Brief, renderG4Brief, renderG8Brief, type G4Brief } from "../lib/gate-brief.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { open } from "../lib/steps/directive.mts";

const GATES = ["G4", "G8"] as const;

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

register({
  name: "gate brief",
  summary: "G4・G8 でユーザーに示す中身（境界の変更・解釈で決めた振る舞い・未対応の受け入れ基準）を組み立てる",
  usage: "hikyaku gate brief G4|G8 <phase> [<cycle>] [--full] [--root <path>] [--json]",
  options: ["full", "root"],
  maxOperands: 3,
  details: [
    "G4 は architect、G8 は build-NN のフェーズでだけ実行します。",
    "",
    "  G4  design-delta.md とこのサイクルの ADR が触れるパスを [boundaries] の external / internal と照合し、",
    "      外との境界の変更（同意が要る）と内部の境界の変更（確かめる）を分けて示します。境界は、作業ツリーと",
    "      基準のブランチ（merge-base）の宣言の和です。G3 の申告に無い重い領域（G4 の args と同じ）も並べます。",
    "      [boundaries] を宣言していなければ、従来どおりの提示（design-delta と指摘への対処）を案内します",
    "  G8  test-spec.md の「（解釈）」の印が付いたシナリオと、どのシナリオの「- 対応:」にも無い受け入れ基準だけを",
    "      示します。番号で追跡できないときは issue.md の受け入れ基準の節を、test-spec が無いときは plan.md の",
    "      提示を案内します",
    "",
    "  --full  G4 は design-delta.md、G8 は plan.md と test-spec.md の全文を添える（ユーザーが求めたとき）",
    "",
    "文書がまだ無くても止めずに、その旨を出します。終了コードは 0 です。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const gate = operands[0] as (typeof GATES)[number];
    if (!(GATES as readonly string[]).includes(gate)) {
      throw new HikyakuError(`ゲートの値が不正です: ${operands[0]}`, `使用できる値: ${GATES.join(" | ")}`);
    }
    const phase = operands[1];
    if (phase === undefined) throw new HikyakuError("フェーズを指定してください", "G4 は architect、G8 は build-NN です。");
    if (gate === "G4" && phase !== "architect") {
      throw new HikyakuError(`G4 は architect のフェーズでだけ実行します: ${phase}`);
    }
    if (gate === "G8" && !phase?.startsWith("build-")) {
      throw new HikyakuError(`G8 はビルド（build-NN）のフェーズでだけ実行します: ${phase}`);
    }
    const opened = open(args, phase, operands[2]);
    const full = flagBoolean(args, "full");
    const directory = opened.ctx.unitDirectory;

    if (gate === "G4") {
      const changes = boundaryChanges(opened.ctx.config, directory);
      // G3 の申告の裏取りは、step next と同じ文脈で G4 の args を評価して受け取る（同じ判定を二重に持たない）
      const definition = opened.skill.steps.find((step) => step.id === "G4");
      const values = (definition?.args?.(opened.ctx) ?? {}) as { undeclaredAreas?: G4Brief["undeclaredAreas"]; verified?: boolean };
      const brief: G4Brief = {
        boundaries: changes instanceof Error ? { error: changes.message } : changes,
        undeclaredAreas: values.undeclaredAreas ?? [],
        verified: values.verified !== false,
      };
      const delta = readIfExists(join(directory, DESIGN_DELTA));
      emit(brief, () => {
        const text = renderG4Brief(brief, full ? (delta ?? `（${DESIGN_DELTA} がありません）`) : undefined);
        return changes instanceof Error || changes.declared || delta !== undefined ? text : `${text}\n\n! ${DESIGN_DELTA} がまだありません`;
      });
      return;
    }

    const cycleDirectory = opened.ctx.cycle?.directory;
    if (cycleDirectory === undefined) throw new HikyakuError("対象のサイクルを決められません");
    const brief = g8Brief(cycleDirectory, directory);
    const fullText = full
      ? { plan: readIfExists(join(directory, "plan.md")), testSpec: readIfExists(join(directory, "test-spec.md")) }
      : undefined;
    emit(brief, () => renderG8Brief(brief, fullText));
  },
});
