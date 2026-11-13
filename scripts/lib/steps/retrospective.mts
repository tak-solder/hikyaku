/**
 * retrospective（内部スキル）のステップ。
 *
 * 呼び出し元（planner / architect / builder / close-cycle）の call で呼ばれ、
 * `step next <phase> <cycle> --skill retrospective` で進む。記録は呼び出し元と同じ
 * progress.jsonl に入り、呼び出し元が最後に報告したあとの記録だけが今回の呼び出しの分になる。
 * 呼び出し元が報告しないまま呼び直すとき（builder の PR レビュー対応）は、
 * `step restart <phase> <cycle> --skill retrospective` で区切ってから呼ぶ。
 *
 * 並びは SKILL.md の Step 1〜6 と同じ。Step 0（設定の確認）は step が行い、Step 2
 * （フェーズの判定）は出力先を args で渡すので、ステップにしない。Step 4（会話履歴の分析）と
 * Step 5（改善提案の分類）は、分析した内容をそのまま分類するので1つにまとめる。
 */

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { startOf, type SkillSteps, type StepContext } from "./engine.mts";

const SKILL = "retrospective";

/** 呼び出し元のフェーズ → retrospective.md を置くサイクルのサブディレクトリ */
export function retrospectiveDirectory(phase: string): string | undefined {
  if (phase === "plan") return "planning";
  if (phase === "architect") return "design";
  if (phase === "close") return "close";
  if (phase.startsWith("build-")) return phase;
  return undefined;
}

function mode(ctx: StepContext): string {
  return ctx.config.reviews.retrospective;
}

/** prompt で、ユーザーが振り返りを実施しないと答えた（今回の呼び出しの記録だけを見る） */
function declined(ctx: StepContext): boolean {
  const confirms = ctx.events
    .slice(startOf(RETROSPECTIVE_STEPS, ctx.events) + 1)
    .filter((event) => event.skill === SKILL && event.step === "confirm");
  return confirms[confirms.length - 1]?.result === "skipped";
}

/** 振り返りを行うか。skip なら呼び出し元が呼ばないが、呼ばれても何もしない */
function active(ctx: StepContext): boolean {
  return mode(ctx) !== "skip" && !declined(ctx);
}

/** 書き込み先 */
function outputFile(ctx: StepContext): string {
  const directory = retrospectiveDirectory(ctx.unit) ?? ctx.unit;
  const base = ctx.cycle === undefined ? ctx.unitDirectory : ctx.cycle.directory;
  return join(base, directory, "retrospective.md");
}

export const RETROSPECTIVE_STEPS: SkillSteps = {
  skill: SKILL,
  internal: true,
  steps: [
    {
      id: "confirm",
      kind: "run",
      title: "振り返りを実施するかの確認",
      when: (ctx) => mode(ctx) === "prompt",
      // 実施しないと答えたら skipped で報告する。後ろのステップは対象外になり、done が返る
      skippable: true,
    },
    {
      id: "bp-actual",
      kind: "run",
      title: "BP 実績とセッションの実測の収集",
      when: (ctx) => active(ctx) && ctx.unit.startsWith("build-"),
    },
    { id: "analyze", kind: "run", title: "会話履歴の分析と改善提案の分類", when: active },
    {
      // PR レビュー対応の追記モードでは書く前から retrospective.md がある。前の呼び出しで
      // write を記録していれば、記録の欠けとは数えられない（engine の orphans）
      id: "write",
      kind: "run",
      title: "retrospective.md の書き込みと提示",
      when: active,
      evidence: (ctx) => existsSync(outputFile(ctx)),
      args: (ctx) => ({ output: relative(ctx.config.repoRoot, outputFile(ctx)) }),
    },
  ],
};
