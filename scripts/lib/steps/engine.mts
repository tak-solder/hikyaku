/**
 * ステップエンジン — フェーズの中の手順を、設定と状態から決める（#50）。
 *
 * 手順の並び・実行条件・完了を確かめる成果物は、スキルごとの定義（steps/<skill>.mts）が
 * 唯一の正。SKILL.md は「step next を呼び、返った1手を行い、step report で返す」転送ループと、
 * 全体に関わる原則だけを持つ。各ステップで何をするかは skills/<skill>/steps/<id>.md にあり、
 * モデルは実行するステップの指示だけを読む。
 *
 * 現在地は保存しない。progress.jsonl のイベントと成果物から、毎回頭から導出する。
 *
 *   - ステップを順に見て、最初に完了していないものが現在地
 *   - 完了の印は、そのステップの完了イベントが「前のステップの完了より後」にあること。
 *     前のステップをやり直したら、後ろのステップもやり直しになる（差し戻しで plan.md が
 *     作り直されたあと、古い test-spec のレビューを完了と読まないため）
 *   - 成果物が要るステップは、成果物が無ければ完了イベントがあっても未完了
 *   - 完了したステップを報告し直すと（成果物を作り直したとき）、そこから後ろはやり直しになる
 *   - ゲートの承認は、承認した時点の成果物のハッシュと一致するときだけ有効。ただし
 *     承認のあとに後ろのステップが完了していれば、そのまま有効とする
 *
 * 判定はすべてここで行い、LLM には結果（directive）だけを渡す。条件の分岐を SKILL.md の
 * 文章で書くと、省略や取り違えが起きるため。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Phase } from "../branch.mts";
import type { ContextBudget, ResolvedConfig } from "../config.mts";
import { fileHash, type ProgressEvent, type StepResult } from "../progress.mts";
import type { CycleContext } from "../workspace.mts";

export type StepKind = "run" | "gate" | "call";

/** 定義の条件・成果物を評価するときに渡すもの */
export interface StepContext {
  config: ResolvedConfig;
  /** 対象サイクル。サイクルの無いフェーズ（init / bp-guide）では undefined */
  cycle: CycleContext | undefined;
  /** 作業単位のフェーズ（build-03 など） */
  unit: string;
  unitDirectory: string;
  events: ProgressEvent[];
}

export interface StepDefinition {
  id: string;
  kind: StepKind;
  /** step status に出す短い説明 */
  title: string;
  /** 実行するか。false なら手順に含めない（設定で無効なステップ） */
  when?: (ctx: StepContext) => boolean;
  /** 完了に要る成果物（作業単位のディレクトリからの相対パス） */
  produces?: string[];
  /** 成果物で判定できない完了の条件（tasklist の PR 列など）。成果物と同じ扱い */
  evidence?: (ctx: StepContext) => boolean;
  /** ゲートが結びつくファイル（作業単位からの相対パス）。存在するものだけ結びつける */
  binds?: string[];
  /** ゲートの問いの ID（conductor の ASKS） */
  ask?: string;
  /** call で呼ぶ内部スキル */
  call?: string;
  /** call を呼ぶ理由 */
  reason?: (ctx: StepContext) => string;
  /** 理由を添えればスキップできるか。省略を記録に残すため、既定ではできない */
  skippable?: boolean;
  /** このステップに入るときに、コンテキストを目安と比べる区切り（#68） */
  checkpoint?: keyof ContextBudget;
  /** 報告で BP を添えられるか */
  reportsBp?: boolean;
  /** 設定から解決して指示に添える値 */
  args?: (ctx: StepContext) => Record<string, unknown>;
}

export interface SkillSteps {
  skill: string;
  /**
   * そのフェーズを担うときの、作業単位のディレクトリ（progress.jsonl を置く場所）。
   * サイクルのあるフェーズはサイクルのディレクトリから、サイクルの無いフェーズ（init / bp-guide）は
   * HIKYAKU_ROOT からの相対パス。担わないフェーズなら undefined。内部スキルは持たない
   */
  unit?: (phase: Phase) => string | undefined;
  /**
   * 呼び出し元のフェーズの作業単位で動く内部スキル（build-manager / retrospective）。
   * step の --skill で指定し、記録は呼び出し元と同じ progress.jsonl に書く
   */
  internal?: boolean;
  steps: StepDefinition[];
}

export type StepStatus = "complete" | "skipped" | "pending" | "off";

export interface EvaluatedStep {
  definition: StepDefinition;
  status: StepStatus;
  /** 完了とみなしたイベント */
  event: ProgressEvent | undefined;
  /** 未完了の理由の補足（差し戻し・承認後の変更・失敗など） */
  note: string | undefined;
  /** 差し戻されたゲートの、ユーザーの答え */
  revise: string | undefined;
}

export interface Evaluation {
  steps: EvaluatedStep[];
  current: EvaluatedStep | undefined;
  /**
   * 現在地より後ろなのに成果物があるステップ。ログが欠けている（手で進めた）ので、
   * 推測で補わずに止まる
   */
  orphans: EvaluatedStep[];
}

const COMPLETING: Record<StepKind, StepResult[]> = {
  run: ["done", "skipped"],
  call: ["done", "skipped"],
  gate: ["approved"],
};

/** ステップに報告できる結果 */
export function allowedResults(definition: StepDefinition): StepResult[] {
  if (definition.kind === "gate") return ["approved", "rejected"];
  return definition.skippable === true ? ["done", "skipped", "failed"] : ["done", "failed"];
}

export function hasEvidence(definition: StepDefinition, ctx: StepContext): boolean {
  if (definition.produces !== undefined) {
    if (!definition.produces.every((path) => existsSync(join(ctx.unitDirectory, path)))) return false;
  }
  if (definition.evidence !== undefined && !definition.evidence(ctx)) return false;
  return true;
}

function hasAnyArtifact(definition: StepDefinition, ctx: StepContext): boolean {
  const produced = (definition.produces ?? []).some((path) => existsSync(join(ctx.unitDirectory, path)));
  return produced || (definition.evidence !== undefined && definition.evidence(ctx));
}

/** ゲートが結びつくファイルの現在のハッシュ。存在するファイルだけ */
export function currentHashes(definition: StepDefinition, ctx: StepContext): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const path of definition.binds ?? []) {
    const hash = fileHash(join(ctx.unitDirectory, path));
    if (hash !== undefined) hashes[path] = hash;
  }
  return hashes;
}

function sameHashes(a: Record<string, string> | undefined, b: Record<string, string>): boolean {
  const left = a ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(b)]);
  return [...keys].every((key) => left[key] === b[key]);
}

/**
 * 承認のあとに、後ろのステップが完了しているか。完了していれば、承認した成果物の上で
 * 作業が進んでいるので、成果物が変わっても承認を取り直させない（PR のレビュー対応で
 * plan.md を直したときに、手順が G8 まで巻き戻らないため）
 */
function proceededAfter(
  skill: SkillSteps,
  gate: StepDefinition,
  indexed: { event: ProgressEvent; index: number }[],
  approvedAt: number,
): boolean {
  const later = skill.steps.slice(skill.steps.indexOf(gate) + 1);
  return indexed.some(
    ({ event, index }) =>
      index > approvedAt &&
      event.skill === skill.skill &&
      later.some((step) => step.id === event.step && COMPLETING[step.kind].includes(event.result)),
  );
}

export function evaluate(skill: SkillSteps, ctx: StepContext): Evaluation {
  const steps: EvaluatedStep[] = [];
  // 前のステップを完了とみなしたイベントの位置。これより後のイベントだけが有効。
  // 内部スキルは何度も呼ばれるので、呼び出し元が最後に報告したあとの記録だけを今回の分とする
  // （呼び出し元は、内部スキルが戻ってから call のステップを報告する）
  let floor = skill.internal === true ? lastIndexOf(ctx.events, (event) => event.skill !== skill.skill) : -1;
  let current: EvaluatedStep | undefined;

  const indexed = ctx.events.map((event, index) => ({ event, index }));

  for (const definition of skill.steps) {
    if (definition.when !== undefined && !definition.when(ctx)) {
      steps.push({ definition, status: "off", event: undefined, note: undefined, revise: undefined });
      continue;
    }
    if (current !== undefined) {
      steps.push({ definition, status: "pending", event: undefined, note: undefined, revise: undefined });
      continue;
    }

    const own = indexed.filter(
      ({ event, index }) => index > floor && event.skill === skill.skill && event.step === definition.id,
    );
    const latest = own[own.length - 1];
    let evaluated: EvaluatedStep;

    if (latest === undefined) {
      evaluated = { definition, status: "pending", event: undefined, note: undefined, revise: undefined };
    } else if (definition.kind === "gate") {
      if (latest.event.result === "rejected") {
        evaluated = {
          definition, status: "pending", event: latest.event,
          note: "差し戻されています。答えに沿って直してから、提示し直してください", revise: latest.event.input ?? "",
        };
      } else if (
        latest.event.result === "approved" &&
        !sameHashes(latest.event.hashes, currentHashes(definition, ctx)) &&
        !proceededAfter(skill, definition, indexed, latest.index)
      ) {
        evaluated = {
          definition, status: "pending", event: latest.event,
          note: "承認したあとに成果物が変わっています。提示し直して承認を取り直してください", revise: undefined,
        };
      } else if (latest.event.result === "approved") {
        evaluated = { definition, status: "complete", event: latest.event, note: undefined, revise: undefined };
        floor = latest.index;
      } else {
        evaluated = { definition, status: "pending", event: latest.event, note: undefined, revise: undefined };
      }
    } else if (COMPLETING[definition.kind].includes(latest.event.result)) {
      if (latest.event.result === "skipped") {
        evaluated = { definition, status: "skipped", event: latest.event, note: undefined, revise: undefined };
        floor = latest.index;
      } else if (!hasEvidence(definition, ctx)) {
        evaluated = {
          definition, status: "pending", event: latest.event,
          note: "完了の記録はありますが、成果物がありません。作り直してください", revise: undefined,
        };
      } else {
        evaluated = { definition, status: "complete", event: latest.event, note: undefined, revise: undefined };
        floor = latest.index;
      }
    } else {
      evaluated = {
        definition, status: "pending", event: latest.event,
        note: latest.event.result === "failed" ? `前回は失敗しました: ${latest.event.reason ?? "理由なし"}` : undefined,
        revise: undefined,
      };
    }

    steps.push(evaluated);
    if (evaluated.status === "pending") current = evaluated;
  }

  const currentIndex = current === undefined ? steps.length : steps.indexOf(current);
  const orphans = steps
    .slice(currentIndex + 1)
    .filter((step) => step.status !== "off" && hasAnyArtifact(step.definition, ctx));

  return { steps, current, orphans };
}

function lastIndexOf(events: ProgressEvent[], matches: (event: ProgressEvent) => boolean): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (matches(events[i] as ProgressEvent)) return i;
  }
  return -1;
}

/** 報告で添えた BP のうち、最後のもの */
export function latestBp(events: ProgressEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const bp = events[i]?.bp;
    if (bp !== undefined) return bp;
  }
  return undefined;
}
