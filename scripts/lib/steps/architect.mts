/**
 * architect（ARCHITECT フェーズ）のステップ。
 *
 * 並びは移行前の SKILL.md の Step 1〜6 と同じ。Step 0（設定の解決・入力の読み込み・ブランチ・
 * セッション名）はセッションごとにやり直す準備なので、ここには含めず SKILL.md に置く。
 * 進捗は architect のブランチ上の design/progress.jsonl にあるので、ブランチを決めるまでは
 * 現在地を導出できない。
 *
 * 差し戻しからの再設計（$ARGUMENTS[1] が build-NN）と指摘からの追加設計（add）は、ここに載せない。
 * 前者は差し戻し中（return.md）に step next が stop を返し、後者は通常の設計を終えた
 * design/ の記録が残っていて最初からやり直せないため。どちらも SKILL.md から references/ の
 * 手順に従い、steps/ の指示ファイルを順に読んで進める。
 */

import { loadCycles } from "../cycles.mts";
import { loadTasklist } from "../tasklist.mts";
import type { SkillSteps, StepContext } from "./engine.mts";

function skipped(ctx: StepContext, step: string): boolean {
  const events = ctx.events.filter((event) => event.skill === "architect" && event.step === step);
  return events[events.length - 1]?.result === "skipped";
}

/** 自分のほかに進行中のサイクルがあるか（cycle list --active と同じ判定） */
function otherActiveCycles(ctx: StepContext): boolean {
  const self = ctx.cycle?.record.id;
  return loadCycles(ctx.config.hikyakuRoot).some((record) => record.status === "active" && record.id !== self);
}

/** tasklist.md（作業ツリー）にビルドがあるか。build-manager が書き込んだ印 */
function hasBuilds(ctx: StepContext): boolean {
  if (ctx.cycle === undefined) return false;
  return loadTasklist(ctx.cycle.directory).length > 0;
}

export const ARCHITECT_STEPS: SkillSteps = {
  skill: "architect",
  unit: (phase) => (phase === "architect" ? "design" : undefined),
  steps: [
    {
      id: "cycle-scan",
      kind: "run",
      title: "並行サイクルの確認（cycle-scanner）",
      when: otherActiveCycles,
    },
    {
      id: "survey",
      kind: "run",
      title: "既存コードベースの差分調査と codebase-survey.md の作成",
      produces: ["codebase-survey.md"],
      // 既存コードが無い（新規開発）なら調査しない
      skippable: true,
    },
    {
      id: "G2",
      kind: "gate",
      title: "codebase-survey.md の確認",
      when: (ctx) => ctx.config.gates.codebaseSurvey && !skipped(ctx, "survey"),
      binds: ["codebase-survey.md"],
      ask: "G2",
    },
    { id: "questions", kind: "run", title: "設計に関する質問（反復ループ）" },
    {
      id: "options",
      kind: "run",
      title: "主要な設計判断の特定と、分岐がある判断の案の生成（code-architect）",
      // 分岐がある判断が無ければ、案の生成・G3・ADR を行わない
      skippable: true,
      args: (ctx) => ({ designChoiceGate: ctx.config.gates.designChoice }),
    },
    {
      id: "G3",
      kind: "gate",
      title: "設計案の選択",
      when: (ctx) => ctx.config.gates.designChoice && !skipped(ctx, "options"),
      ask: "G3",
    },
    {
      id: "adr",
      kind: "run",
      title: "採用案を ADR に追記",
      when: (ctx) => !skipped(ctx, "options"),
      args: (ctx) => ({ designChoiceGate: ctx.config.gates.designChoice }),
    },
    { id: "design-delta", kind: "run", title: "design-delta.md の作成", produces: ["design-delta.md"] },
    {
      id: "architecture-review",
      kind: "run",
      title: "doc-reviewer による設計のレビュー",
      when: (ctx) => ctx.config.reviews.architecture,
    },
    {
      id: "G4",
      kind: "gate",
      title: "設計ドキュメントの承認",
      when: (ctx) => ctx.config.gates.architecture,
      binds: ["design-delta.md"],
      ask: "G4",
    },
    {
      id: "build-split",
      kind: "call",
      title: "ビルド分割（build-manager）",
      call: "build-manager",
      evidence: hasBuilds,
      reason: () => "設計に基づいてビルドを分割し、tasklist.md と issue.md を作る（G6 は build-manager が取る）",
    },
    { id: "validate", kind: "run", title: "受け入れ基準の割り当てと記録の検証" },
    {
      id: "retrospective",
      kind: "call",
      title: "振り返り",
      call: "retrospective",
      when: (ctx) => ctx.config.reviews.retrospective !== "skip",
      reason: () => "設計フェーズの最後の振り返り",
    },
    {
      id: "pr",
      kind: "run",
      title: "PR の作成とレビュアーのアサイン",
      args: (ctx) => ({ designChoiceGate: ctx.config.gates.designChoice }),
    },
  ],
};
