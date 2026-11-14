/**
 * architect（ARCHITECT フェーズ）のステップ。
 *
 * 並びは移行前の SKILL.md の Step 1〜6 と同じ。Step 0（設定の解決・入力の読み込み・ブランチ・
 * セッション名）はセッションごとにやり直す準備なので、ここには含めず SKILL.md に置く。
 * 進捗は design/progress.jsonl にあるので、ブランチを決めるまでは現在地を導出できない。
 *
 * 同じ design/ で手順を回し直す回が2種類ある。どちらも step restart --round で区切り、
 * 回の種類は currentRound で読む。
 *
 *   return   差し戻しからの再設計。差し戻し元のビルドのブランチで行い、PR を作らず、
 *            最後に return.md と古い plan.md / test-spec.md を消す
 *   add      指摘からの追加設計。調査を行わず、設計の変更が要るときだけ設計を見直し、
 *            指摘に対応するビルドを足す
 *
 * --round を付けずに区切った回と、区切りが無い回は通常の設計（design）。
 *
 * 再設計の回で差し戻しを解決した（resolve-return を終えた）あとに、同じブランチで新しく差し戻されたら、
 * 前の回のまま進めずに止まる。改めて step restart --round return で区切らないと、新しい return.md を
 * 消すだけで差し戻しを解決できてしまうため。
 */

import { publicationStep } from "./publication.mts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadCycles } from "../cycles.mts";
import { pluginRoot } from "../paths.mts";
import { readReturn, RETURN_FILE } from "../phase.mts";
import { buildDirName, loadTasklist } from "../tasklist.mts";
import { currentEvents, currentRound, type SkillSteps, type StepContext } from "./engine.mts";

export type ArchitectRound = "design" | "return" | "add";

/** step restart architect --round で指定できる回の種類 */
const ROUNDS: Exclude<ArchitectRound, "design">[] = ["return", "add"];

/** いまの回の種類。--round で始めた回ならその値、それ以外は通常の設計 */
export function roundOf(ctx: StepContext): ArchitectRound {
  const round = currentRound(ARCHITECT_STEPS, ctx.events);
  return ROUNDS.find((entry) => entry === round) ?? "design";
}

/** いまの回で、そのステップが最後にスキップと記録されたか */
function skipped(ctx: StepContext, step: string): boolean {
  const events = currentEvents(ARCHITECT_STEPS, ctx.events).filter((event) => event.skill === "architect" && event.step === step);
  return events[events.length - 1]?.result === "skipped";
}

/** 自分のほかに進行中のサイクルがあるか（cycle list --active と同じ判定） */
function otherActiveCycles(ctx: StepContext): boolean {
  const self = ctx.cycle?.record.id;
  return loadCycles(ctx.config.hikyakuRoot).some((record) => record.status === "active" && record.id !== self);
}

/** いまの回で、そのスキルのそのステップが done と記録されたか */
function doneThisRound(ctx: StepContext, skill: string, step: string): boolean {
  return currentEvents(ARCHITECT_STEPS, ctx.events).some((event) => event.skill === skill && event.step === step && event.result === "done");
}

/**
 * build-manager が書き込んだ印。tasklist.md にビルドがあること。追加設計の回では、それに加えて
 * この回で build-manager が書き込み（write）を終えていること。未完了のビルドがあるかは完了の印にしない。
 * 足したビルドがすべて PR まで進むと条件が崩れ、完了した build-split に巻き戻るため（報告のときだけ
 * addedBuild で確かめる）
 */
function splitRecorded(ctx: StepContext): boolean {
  if (ctx.cycle === undefined) return false;
  if (loadTasklist(ctx.cycle.directory).length === 0) return false;
  return roundOf(ctx) !== "add" || doneThisRound(ctx, "build-manager", "write");
}

/** 追加設計の回で、報告の時点で未完了のビルドが足されているか */
function addedBuild(ctx: StepContext): string | undefined {
  if (ctx.cycle === undefined || roundOf(ctx) !== "add") return undefined;
  if (loadTasklist(ctx.cycle.directory).some((build) => build.pr.trim() === "")) return undefined;
  return "追加設計なのに、未完了のビルドが tasklist.md にありません。build-manager で指摘に対応するビルドを足してください";
}

/** 追加設計で、指摘への対応に設計の変更が要ると判断したか */
function designChanges(ctx: StepContext): boolean {
  return roundOf(ctx) !== "add" || !skipped(ctx, "design-change");
}

const mode = (ctx: StepContext) => ({ round: roundOf(ctx) });

export const ARCHITECT_STEPS: SkillSteps = {
  skill: "architect",
  unit: (phase) => (phase === "architect" ? "design" : undefined),
  rounds: ROUNDS,
  // 差し戻し中なのに再設計の回を始めていなければ、前回の記録のまま進めない
  stop: (ctx) => {
    if (ctx.cycle === undefined) return undefined;
    const record = readReturn(ctx.cycle.directory);
    if (record === undefined) return undefined;
    // 再設計の回の途中なら進める。その回で差し戻しを解決したあとの return.md は、新しい差し戻し
    const resolved = roundOf(ctx) === "return" && doneThisRound(ctx, "architect", "resolve-return");
    if (roundOf(ctx) === "return" && !resolved) return undefined;
    const build = record.buildId === undefined ? "build-NN" : buildDirName(record.buildId);
    const cli = `node "${join(pluginRoot(), "scripts", "hikyaku.mts")}"`;
    return [
      resolved
        ? `前の再設計で差し戻しを解決したあと、もう一度 architect に差し戻されています（${RETURN_FILE}）。新しい再設計の回を区切ってから始めてください:`
        : `このブランチは architect に差し戻されています（${RETURN_FILE}）。再設計の回を区切ってから始めてください:`,
      `  ${cli} step restart architect ${ctx.cycle.name} --round return --reason "${build} からの差し戻し"`,
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
      ask: "G4",
    },
    {
      id: "build-split",
      kind: "call",
      title: "ビルド分割（build-manager）",
      call: "build-manager",
      evidence: splitRecorded,
      accepts: addedBuild,
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
      recordsPr: true,
      args: (ctx) => ({ designChoiceGate: ctx.config.gates.designChoice, round: roundOf(ctx) }),
    },
    publicationStep("architect", (ctx) => roundOf(ctx) !== "return"),
  ],
};
