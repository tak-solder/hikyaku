/**
 * architect（ARCHITECT フェーズ）のステップ。
 *
 * 並びは移行前の SKILL.md の Step 1〜6 と同じ。Step 0（設定の解決・入力の読み込み・ブランチ・
 * セッション名）はセッションごとにやり直す準備なので、ここには含めず SKILL.md に置く。
 * 進捗は design/progress.jsonl にあるので、ブランチを決めるまでは現在地を導出できない。
 *
 * 同じ design/ で手順を回し直す回が2種類ある。どちらも step restart で区切り、
 * その理由の接頭辞で回の種類を読み分ける（restart に種類の欄が無いため）。
 *
 *   return: build-NN   差し戻しからの再設計。差し戻し元のビルドのブランチで行い、PR を作らず、
 *                      最後に return.md と古い plan.md / test-spec.md を消す
 *   add: <指摘>        指摘からの追加設計。調査を行わず、設計の変更が要るときだけ設計を見直し、
 *                      指摘に対応するビルドを足す
 *
 * 区切りが無い（または接頭辞が無い）回は通常の設計。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadCycles } from "../cycles.mts";
import { pluginRoot } from "../paths.mts";
import { readReturn, RETURN_FILE } from "../phase.mts";
import { RESTART } from "../progress.mts";
import { buildDirName, loadTasklist } from "../tasklist.mts";
import type { SkillSteps, StepContext } from "./engine.mts";

export type ArchitectRound = "design" | "return" | "add";

/** step restart architect の --reason に付ける接頭辞 */
export const ROUND_PREFIXES: Record<Exclude<ArchitectRound, "design">, string> = {
  return: "return:",
  add: "add:",
};

/** いまの回の種類。最後の step restart の理由の接頭辞で決まる */
export function roundOf(ctx: StepContext): ArchitectRound {
  for (let i = ctx.events.length - 1; i >= 0; i -= 1) {
    const event = ctx.events[i];
    if (event?.skill !== "architect" || event.result !== RESTART) continue;
    const reason = (event.reason ?? "").trim();
    if (reason.startsWith(ROUND_PREFIXES.return)) return "return";
    if (reason.startsWith(ROUND_PREFIXES.add)) return "add";
    return "design";
  }
  return "design";
}

/** いまの回で記録された結果。restart より前の回の記録は見ない */
function skipped(ctx: StepContext, step: string): boolean {
  let result: string | undefined;
  for (const event of ctx.events) {
    if (event.skill !== "architect") continue;
    if (event.result === RESTART) result = undefined;
    else if (event.step === step) result = event.result;
  }
  return result === "skipped";
}

/** 自分のほかに進行中のサイクルがあるか（cycle list --active と同じ判定） */
function otherActiveCycles(ctx: StepContext): boolean {
  const self = ctx.cycle?.record.id;
  return loadCycles(ctx.config.hikyakuRoot).some((record) => record.status === "active" && record.id !== self);
}

/**
 * build-manager が書き込んだ印。追加設計では完了済みのビルドしか無かったところに、
 * 未完了のビルドが足されたこと。それ以外の回では tasklist.md にビルドがあること
 */
function splitRecorded(ctx: StepContext): boolean {
  if (ctx.cycle === undefined) return false;
  const builds = loadTasklist(ctx.cycle.directory);
  if (roundOf(ctx) === "add") return builds.some((build) => build.pr.trim() === "");
  return builds.length > 0;
}

/** 追加設計で、指摘への対応に設計の変更が要ると判断したか */
function designChanges(ctx: StepContext): boolean {
  return roundOf(ctx) !== "add" || !skipped(ctx, "design-change");
}

const mode = (ctx: StepContext) => ({ round: roundOf(ctx) });

export const ARCHITECT_STEPS: SkillSteps = {
  skill: "architect",
  unit: (phase) => (phase === "architect" ? "design" : undefined),
  // 差し戻し中なのに再設計の回を始めていなければ、前回の記録のまま進めない
  stop: (ctx) => {
    if (ctx.cycle === undefined || roundOf(ctx) === "return") return undefined;
    const record = readReturn(ctx.cycle.directory);
    if (record === undefined) return undefined;
    const build = record.buildId === undefined ? "build-NN" : buildDirName(record.buildId);
    const cli = `node "${join(pluginRoot(), "scripts", "hikyaku.mts")}"`;
    return [
      `このブランチは architect に差し戻されています（${RETURN_FILE}）。再設計の回を区切ってから始めてください:`,
      `  ${cli} step restart architect ${ctx.cycle.name} --reason "${ROUND_PREFIXES.return} ${build}"`,
    ].join("\n");
  },
  steps: [
    {
      id: "design-change",
      kind: "run",
      title: "指摘への対応に設計の変更が要るかの判断（追加設計）",
      when: (ctx) => roundOf(ctx) === "add",
      // 設計の変更が要らなければスキップし、ビルドの追加へ進む
      skippable: true,
    },
    {
      id: "cycle-scan",
      kind: "run",
      title: "並行サイクルの確認（cycle-scanner）",
      when: (ctx) => roundOf(ctx) !== "add" && otherActiveCycles(ctx),
    },
    {
      id: "survey",
      kind: "run",
      title: "既存コードベースの差分調査と codebase-survey.md の作成",
      when: (ctx) => roundOf(ctx) !== "add",
      produces: ["codebase-survey.md"],
      // 既存コードが無い（新規開発）なら調査しない
      skippable: true,
      args: mode,
    },
    {
      id: "G2",
      kind: "gate",
      title: "codebase-survey.md の確認",
      when: (ctx) => roundOf(ctx) !== "add" && ctx.config.gates.codebaseSurvey && !skipped(ctx, "survey"),
      binds: ["codebase-survey.md"],
      ask: "G2",
    },
    { id: "questions", kind: "run", title: "設計に関する質問（反復ループ）", when: designChanges, args: mode },
    {
      id: "options",
      kind: "run",
      title: "主要な設計判断の特定と、分岐がある判断の案の生成（code-architect）",
      when: designChanges,
      // 分岐がある判断が無ければ、案の生成・G3・ADR を行わない
      skippable: true,
      args: (ctx) => ({ designChoiceGate: ctx.config.gates.designChoice }),
    },
    {
      id: "G3",
      kind: "gate",
      title: "設計案の選択",
      when: (ctx) => designChanges(ctx) && ctx.config.gates.designChoice && !skipped(ctx, "options"),
      ask: "G3",
    },
    {
      id: "adr",
      kind: "run",
      title: "採用案を ADR に追記",
      when: (ctx) => designChanges(ctx) && !skipped(ctx, "options"),
      args: (ctx) => ({ designChoiceGate: ctx.config.gates.designChoice }),
    },
    {
      id: "design-delta",
      kind: "run",
      title: "design-delta.md の作成",
      when: designChanges,
      produces: ["design-delta.md"],
      args: mode,
    },
    {
      id: "architecture-review",
      kind: "run",
      title: "doc-reviewer による設計のレビュー",
      when: (ctx) => designChanges(ctx) && ctx.config.reviews.architecture,
    },
    {
      id: "G4",
      kind: "gate",
      title: "設計ドキュメントの承認",
      when: (ctx) => designChanges(ctx) && ctx.config.gates.architecture,
      binds: ["design-delta.md"],
      ask: "G4",
    },
    {
      id: "build-split",
      kind: "call",
      title: "ビルド分割（build-manager）",
      call: "build-manager",
      evidence: splitRecorded,
      reason: (ctx) =>
        ({
          design: "設計に基づいてビルドを分割し、tasklist.md と issue.md を作る（G6 は build-manager が取る）",
          return: "差し戻し元のビルドと、影響を受けるビルドを更新する（G6 は build-manager が取る）",
          add: "指摘に対応するビルドを追加する。完了済みのビルドは更新しない（G6 は build-manager が取る）",
        })[roundOf(ctx)],
      args: mode,
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
      id: "resolve-return",
      kind: "run",
      title: "差し戻しの解決（return.md と古い plan.md / test-spec.md の削除）",
      when: (ctx) => roundOf(ctx) === "return",
      evidence: (ctx) => ctx.cycle !== undefined && !existsSync(join(ctx.cycle.directory, RETURN_FILE)),
    },
    {
      id: "pr",
      kind: "run",
      title: "PR の作成とレビュアーのアサイン",
      when: (ctx) => roundOf(ctx) !== "return",
      args: (ctx) => ({ designChoiceGate: ctx.config.gates.designChoice, round: roundOf(ctx) }),
    },
  ],
};
