/**
 * build-manager（内部スキル）のステップ。
 *
 * 並びは移行前の SKILL.md の Step 0〜4 と、書き込み後の外部投影。architect（design/）と
 * builder（build-NN/）から呼ばれ、step の --skill build-manager で呼び出し元の作業単位を
 * 進める。記録は呼び出し元と同じ progress.jsonl に入り、呼び出し元が最後に報告したあとの
 * 記録だけが今回の呼び出しの分になる（engine.mts）。
 */

import type { SkillSteps } from "./engine.mts";

export const BUILD_MANAGER_STEPS: SkillSteps = {
  skill: "build-manager",
  internal: true,
  steps: [
    {
      id: "load",
      kind: "run",
      title: "テンプレート・BP 基準表・tasklist の読み込み",
      args: (ctx) => ({ caller: ctx.unit, bpMax: ctx.config.bpMax }),
    },
    { id: "scope", kind: "run", title: "変更内容（追加・更新・分割）の整理" },
    {
      id: "estimate",
      kind: "run",
      title: "BP 見積もりと分割の判断",
      args: (ctx) => ({ bpMax: ctx.config.bpMax }),
    },
    { id: "dry-run", kind: "run", title: "tasklist の差分の取得（--dry-run）" },
    {
      id: "tasklist-review",
      kind: "run",
      title: "doc-reviewer による tasklist のレビュー",
      when: (ctx) => ctx.config.reviews.tasklist,
      args: (ctx) => ({ caller: ctx.unit }),
    },
    { id: "G6", kind: "gate", title: "tasklist と issue.md の変更の承認", ask: "G6" },
    { id: "write", kind: "run", title: "tasklist と issue.md の書き込み" },
    {
      id: "external-sync",
      kind: "run",
      title: "外部システムへの投影",
      when: (ctx) => ctx.config.external.target !== "none",
      args: (ctx) => ({ target: ctx.config.external.target }),
    },
  ],
};
