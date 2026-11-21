/** pr body — PR 本文に貼る事実の節をまとめて出す。同意の決定が足りなければ止める */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flagBoolean } from "../lib/args.mts";
import { isPatchPhase } from "../lib/branch.mts";
import { AGREEMENT_FILE, collectDiffFacts, renderFactsPr } from "../lib/diff-facts.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { cycleTimeline, readLedger } from "../lib/ledger.mts";
import { emit } from "../lib/output.mts";
import { declarationArgs, premisesPrSection, premisesReview } from "../lib/premises.mts";
import { cycleRefLine } from "../lib/refs.mts";
import { register } from "../lib/registry.mts";
import { consentTargets } from "../lib/steps/consent.mts";
import { open } from "../lib/steps/directive.mts";
import { resolvePrBase, scopeFor } from "../lib/stack.mts";
import { buildDirName, normalizeBuildId } from "../lib/tasklist.mts";
import { prSection } from "./ledger.mts";

register({
  name: "pr body",
  summary: "PR 本文に貼る事実の節（差分の事実・宣言の変更・未決事項・issue への参照）をまとめて出す",
  usage: "hikyaku pr body <phase> [<cycle>] [--no-fetch] [--root <path>] [--json]",
  options: ["no-fetch"],
  maxOperands: 2,
  details: [
    "各フェーズの PR を作る手順（planner・architect・builder・close-cycle の pr、patch の publish）が、本文にそのまま貼る",
    "部分を1回で出します。中身は次のコマンドの出力と同じで、中身の無い節は出しません。",
    "",
    "  差分の事実       diff facts <build-NN> --format pr（ビルドだけ）",
    "  宣言の変更       ledger premises --format pr（[app]・[[app.areas]] が変わったときだけ）",
    "  未決事項         ledger pr-section <phase>（サイクルに属す作業単位だけ）",
    "  issue への参照   external ref <phase>（本文の末尾。patch には付けない）",
    "",
    "**マージの前にユーザーが同意する項目に決定が足りなければ、本文を出さずに終了コード 2 で止まります。**",
    "判定は PR を作るステップ（pr。patch は publish）が done を受け付けるかと同じで、直し方も同じ文面で返します。",
    "PR を作ってから決定の不足に気づかないよう、本文を作る前に確かめるためです。",
    "",
    "書き込みはしません。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const { phase, skill, ctx } = open(args, operands[0], operands[1]);
    const gate = skill.steps.find((step) => (step.id === "pr" || step.id === "publish") && step.accepts !== undefined);
    if (gate === undefined) throw new HikyakuError(`${phase} には PR を作る手順がありません`);

    const problem = gate.accepts?.(ctx);
    if (problem !== undefined) {
      emit({ phase, ok: false, problem }, () => problem);
      throw new ValidationError(["マージの前にユーザーが同意する項目の決定が足りないので、本文を出しません"]);
    }

    const sections: { name: string; markdown: string }[] = [];
    if (/^build-\d+$/.test(phase)) sections.push({ name: "facts", markdown: await factsSection(args, phase, operands[1]) });
    if (declarationArgs(ctx)["declarationChanged"] !== false) {
      sections.push({ name: "premises", markdown: premisesPrSection(premisesReview(ctx.config)) });
    }
    if (ctx.cycle !== undefined) {
      const ledger = readLedger(ctx.cycle.directory);
      const section = prSection(ledger, cycleTimeline(ctx.config, ctx.cycle), phase, consentTargets(ledger, skill.skill, ctx), false);
      sections.push({ name: "ledger", markdown: section.markdown });
      // patch はサイクルの issue を参照しない（サイクルの PR の流れの外で作るため）
      if (!isPatchPhase(phase)) sections.push({ name: "ref", markdown: cycleRefLine(ctx.config.external.target, ctx.cycle.record.external, phase) });
    }
    const filled = sections.filter((section) => section.markdown.trim() !== "");
    const body = filled.map((section) => section.markdown.trim()).join("\n\n");
    emit({ phase, ok: true, sections: filled, body }, () => body);
  },
});

async function factsSection(args: Parameters<typeof scopeFor>[0], phase: string, cycle: string | undefined): Promise<string> {
  const scope = scopeFor(args, phase as Parameters<typeof scopeFor>[1], cycle);
  if (scope.context === undefined) return "";
  const notices: string[] = [];
  let base: { name: string; ref: string | undefined };
  try {
    const prBase = await resolvePrBase(scope, phase as Parameters<typeof resolvePrBase>[1], { fetch: !flagBoolean(args, "no-fetch") });
    base = { name: prBase.base, ref: prBase.ref };
  } catch (error) {
    if (!(error instanceof HikyakuError)) throw error;
    base = { name: "(決められない)", ref: undefined };
    notices.push(`PR のマージ先を決められないので、差分を調べていません: ${error.message}`);
  }
  const buildDirectory = join(scope.context.directory, buildDirName(normalizeBuildId(phase)));
  const facts = await collectDiffFacts({
    config: scope.config,
    phase: buildDirName(normalizeBuildId(phase)),
    buildDirectory,
    cycleDirectory: scope.context.directory,
    base,
    notices,
  });
  const agreementPath = join(buildDirectory, AGREEMENT_FILE);
  return renderFactsPr(facts, existsSync(agreementPath) ? readFileSync(agreementPath, "utf8") : undefined);
}
