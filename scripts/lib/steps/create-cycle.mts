/**
 * create-cycle（サイクルの作成）のステップ。
 *
 * step に乗せるのは、cycle new でサイクルを作ったあとの手順だけ。それより前の
 * 前提の確認・サイクルの定義・profile の選択・cycle new は SKILL.md に置く。
 * step はサイクルのディレクトリに progress.jsonl を置くので、サイクルができるまでは
 * 記録の置き場が無い。
 *
 * 作業単位はサイクルのディレクトリ自身。PLAN へ続けるか単独で PR にするかは
 * to-plan の結果で分かれる。続けるなら done、単独で終えるなら skipped（理由付き）で報告し、
 * skipped のときだけ pr が手順に入る。
 */

import type { SkillSteps, StepContext } from "./engine.mts";

function toPlanSkipped(ctx: StepContext): boolean {
  const events = ctx.events.filter((event) => event.skill === "create-cycle" && event.step === "to-plan");
  return events[events.length - 1]?.result === "skipped";
}

export const CREATE_CYCLE_STEPS: SkillSteps = {
  skill: "create-cycle",
  unit: (phase) => (phase === "create" ? "" : undefined),
  steps: [
    {
      id: "to-plan",
      kind: "run",
      title: "このまま PLAN へ進むかの確認（進むなら plan のブランチへ）",
      skippable: true,
    },
    {
      id: "pr",
      kind: "run",
      title: "単独で終える場合のブランチ・コミット・PR",
      when: toPlanSkipped,
    },
  ],
};
