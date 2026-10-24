/**
 * planner（PLAN フェーズ）のステップ。
 *
 * 並びは SKILL.md の Step 2〜6 と同じ。Step 0〜1（設定の解決・init / create-cycle の代行・
 * ブランチ・セッション名）はセッションごとにやり直す準備なので、ここには含めず SKILL.md に置く。
 * サイクルが無い時点（create-cycle を代行する前）は、作業単位のディレクトリも無いため。
 *
 * 作業単位はサイクルの planning/。成果物（user-stories.md）と同じ場所に progress.jsonl を置く。
 */

import type { SkillSteps } from "./engine.mts";

export const PLANNER_STEPS: SkillSteps = {
  skill: "planner",
  unit: (phase) => (phase === "plan" ? "planning" : undefined),
  steps: [
    { id: "inputs", kind: "run", title: "インプットの読み込み" },
    { id: "scope", kind: "run", title: "目的とスコープのすり合わせ" },
    {
      id: "user-stories",
      kind: "run",
      title: "質問ループと user-stories.md の作成",
      produces: ["user-stories.md"],
    },
    {
      id: "review",
      kind: "run",
      title: "doc-reviewer による user-stories.md のレビュー",
      when: (ctx) => ctx.config.reviews.userStories,
    },
    {
      id: "G1",
      kind: "gate",
      title: "user-stories.md の承認",
      when: (ctx) => ctx.config.gates.userStories,
      binds: ["user-stories.md"],
      ask: "G1",
    },
    {
      id: "retrospective",
      kind: "call",
      title: "振り返り",
      call: "retrospective",
      when: (ctx) => ctx.config.reviews.retrospective !== "skip",
      reason: () => "企画フェーズの最後の振り返り",
    },
    { id: "pr", kind: "run", title: "親 issue と PR の作成" },
  ],
};
