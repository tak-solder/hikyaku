/**
 * retrospective（内部スキル）のステップ。
 *
 * 呼び出し元（planner / architect / builder / close-cycle）の call で呼ばれ、
 * `step next <phase> <cycle> --skill retrospective` で進む。記録は呼び出し元と同じ
 * progress.jsonl に入り、呼び出し元が最後に報告したあとの記録だけが今回の呼び出しの分になる。
 *
 * 並びは SKILL.md の Step 1〜6 と同じ。Step 0（設定の確認）は step が行い、Step 2
 * （フェーズの判定）は出力先を args で渡すので、ステップにしない。Step 4（会話履歴の分析）と
 * Step 5（改善提案の分類）は、分析した内容をそのまま分類するので1つにまとめる。
 */

import { join, relative } from "node:path";
import type { ProgressEvent } from "../progress.mts";
import type { SkillSteps, StepContext } from "./engine.mts";

const SKILL = "retrospective";

/** 呼び出し元のフェーズ → retrospective.md を置くサイクルのサブディレクトリ */
export function retrospectiveDirectory(phase: string): string | undefined {
  if (phase === "plan") return "planning";
  if (phase === "architect") return "design";
  if (phase === "close") return "close";
  if (phase.startsWith("build-")) return phase;
  return undefined;
}

/** 今回の呼び出しの記録（呼び出し元が最後に報告したあとのもの）。engine の数え方に合わせる */
function currentCall(events: ProgressEvent[]): ProgressEvent[] {
  let floor = -1;
  events.forEach((event, index) => {
    if (event.skill !== SKILL) floor = index;
  });
  return events.slice(floor + 1);
}

function mode(ctx: StepContext): string {
  return ctx.config.reviews.retrospective;
}

/** prompt で、ユーザーが振り返りを実施しないと答えた */
function declined(ctx: StepContext): boolean {
  const confirms = currentCall(ctx.events).filter((event) => event.skill === SKILL && event.step === "confirm");
  return confirms[confirms.length - 1]?.result === "skipped";
}

/** 振り返りを行うか。skip なら呼び出し元が呼ばないが、呼ばれても何もしない */
function active(ctx: StepContext): boolean {
  return mode(ctx) !== "skip" && !declined(ctx);
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
      // 成果物（retrospective.md）を完了の条件にしない。PR レビュー対応では既存の
      // retrospective.md に追記するので、書く前から成果物があり、記録の欠けと誤って止まるため
      id: "write",
      kind: "run",
      title: "retrospective.md の書き込みと提示",
      when: active,
      args: (ctx) => ({ output: outputPath(ctx) }),
    },
  ],
};

/** 書き込み先（リポジトリルートからの相対パス） */
function outputPath(ctx: StepContext): string {
  const directory = retrospectiveDirectory(ctx.unit) ?? ctx.unit;
  const base = ctx.cycle === undefined ? ctx.unitDirectory : ctx.cycle.directory;
  return relative(ctx.config.repoRoot, join(base, directory, "retrospective.md"));
}
