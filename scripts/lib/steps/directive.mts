/**
 * directive の組み立て — step next が返す1手を、作業単位の評価から作る（#50）。
 *
 * step の各コマンドのほか、Stop フック（step hook stop）・step where・conductor parse も
 * 同じ1手を読む。どこから読んでも同じ判定になるよう、組み立てはここに1つだけ置く。
 */

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { flagString, type ParsedArgs } from "../args.mts";
import type { Phase } from "../branch.mts";
import type { ContextBudget } from "../config.mts";
import { HikyakuError } from "../errors.mts";
import { pluginRoot } from "../paths.mts";
import { readProgress, type StepResult } from "../progress.mts";
import { formatTokens, measureCurrent, smallWindowNotice, type CurrentContext } from "../session.mts";
import { requirePhase, scopeFor } from "../stack.mts";
import type { CycleContext } from "../workspace.mts";
import { checkpointsOf, CHECKPOINT_LABELS, type Overrun } from "./checkpoints.mts";
import { allowedResults, currentHashes, type Evaluation, type SkillSteps, type StepContext } from "./engine.mts";
import { instructionPath, ownerOf, SKILL_STEPS, stepsOf } from "./index.mts";

export const CLI = `node "${join(pluginRoot(), "scripts", "hikyaku.mts")}"`;

export interface Opened {
  phase: Phase;
  skill: SkillSteps;
  ctx: StepContext;
}

export function open(args: ParsedArgs, phaseOperand: string | undefined, cycleOperand: string | undefined): Opened {
  const phase = requirePhase(phaseOperand);
  const owner = ownerOf(phase);
  if (owner === undefined) {
    throw new HikyakuError(
      `${phase} の手順はまだ step に移っていません`,
      `step に移ったスキル: ${SKILL_STEPS.map((entry) => entry.skill).join(" / ")}`,
    );
  }
  // 内部スキル（build-manager / retrospective）は、呼び出し元のフェーズの作業単位で動く
  const skillName = flagString(args, "skill");
  const skill = skillName === undefined ? owner.skill : stepsOf(skillName);
  if (skill === undefined || (skillName !== undefined && skill.internal !== true)) {
    const internal = SKILL_STEPS.filter((entry) => entry.internal === true).map((entry) => entry.skill);
    throw new HikyakuError(
      `--skill に ${skillName} は指定できません`,
      `指定できるのは step に移った内部スキルだけです: ${internal.length === 0 ? "（まだありません）" : internal.join(" / ")}`,
    );
  }
  const scope = scopeFor(args, phase, cycleOperand);
  const base = scope.context?.directory ?? scope.config.hikyakuRoot;
  const unitDirectory = join(base, owner.directory);
  // 作業単位のディレクトリは無くてよい（Git は空のディレクトリを残さないので、別のチェックアウトでは
  // planning/ などがまだ無いことがある）。記録は最初の報告で作られ、成果物が無いうちは完了にならない
  if (!existsSync(base)) {
    throw new HikyakuError(
      `${scope.context === undefined ? "HIKYAKU_ROOT" : "サイクルのディレクトリ"}がありません: ${relative(scope.config.repoRoot, base)}`,
      "そのフェーズのブランチに居るかを確認してください。",
    );
  }
  return {
    phase,
    skill,
    ctx: {
      config: scope.config,
      cycle: scope.context,
      unit: phase,
      unitDirectory,
      events: readProgress(unitDirectory),
    },
  };
}

/** コマンドに添えるサイクルの引数。サイクルの無いフェーズでは空 */
export function cycleArg(ctx: StepContext): string {
  return ctx.cycle === undefined ? "" : ` ${ctx.cycle.name}`;
}

/** 内部スキルなら --skill を添える */
export function skillArg(opened: Opened): string {
  return opened.skill.internal === true ? ` --skill ${opened.skill.skill}` : "";
}

/** 作成時の版のメジャーが 2 以下のサイクルは扱わない（v2 のまま終える） */
/** その作業単位の次の1手を返すコマンド */
export function nextCommand(opened: Opened): string {
  return `${CLI} step next ${opened.phase}${cycleArg(opened.ctx)}${skillArg(opened)}`;
}

export function legacyCycleMessage(cycle: CycleContext | undefined): string | undefined {
  if (cycle === undefined) return undefined;
  const version = cycle.record.hikyaku;
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isInteger(major) && major >= 3) return undefined;
  const label = version === "" ? "作成時の版が記録されていない版" : `v${version}`;
  return [
    `サイクル ${cycle.name} は ${label} で作成されています。v3 の手順では扱いません。`,
    "v2 で始めたサイクルは v2 のまま終えてください（docs/migration/v2-to-v3.md）。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// directive

export interface ContextCheck {
  checkpoint: keyof ContextBudget;
  label: string;
  budget: number;
  tokens: number | null;
  over: boolean;
  unavailable: string | null;
}

export interface Directive {
  kind: "run" | "gate" | "call" | "done" | "stop";
  skill: string;
  cycle: string | null;
  unit: string;
  step?: string;
  title?: string;
  /** 読む指示ファイル */
  read?: string;
  args?: Record<string, unknown>;
  /** 結果ごとの報告コマンド */
  report?: Partial<Record<StepResult, string>>;
  note?: string;
  /** 差し戻されたゲートの、ユーザーの答え */
  revise?: string;
  ask?: string;
  binds?: string[];
  call?: string;
  reason?: string;
  /** 呼ぶ内部スキルが step に移っていれば、そのスキルが最初に呼ぶコマンド */
  callNext?: string;
  context?: ContextCheck;
  /** 目安を超えたまま継続した区切り。ゲートの報告・完了の案内で伝える */
  overruns?: Overrun[];
  notices: string[];
  message?: string;
  progress: { complete: number; total: number };
}

function reportCommand(opened: Opened, step: string, result: StepResult): string {
  const extra =
    result === "skipped" || result === "failed"
      ? ' --reason "<理由>"'
      : result === "rejected"
        ? ' --input "<ユーザーの答え>"'
        : result === "approved"
          ? ' --input "<ユーザーの答え>"'
          : "";
  const bp = result === "done" && opened.skill.steps.find((definition) => definition.id === step)?.reportsBp === true ? " [--bp <再算出した BP>]" : "";
  return `${CLI} step report ${opened.phase} ${step}${cycleArg(opened.ctx)}${skillArg(opened)} --result ${result}${extra}${bp}`;
}

function progressOf(evaluation: Evaluation): { complete: number; total: number } {
  const counted = evaluation.steps.filter((step) => step.status !== "off");
  return {
    complete: counted.filter((step) => step.status === "complete" || step.status === "skipped").length,
    total: counted.length,
  };
}

function checkContext(opened: Opened, checkpoint: keyof ContextBudget, measured: CurrentContext): ContextCheck {
  const budget = opened.ctx.config.context[checkpoint];
  return {
    checkpoint,
    label: CHECKPOINT_LABELS[checkpoint],
    budget,
    tokens: measured.tokens ?? null,
    over: measured.tokens !== undefined && measured.tokens > budget,
    unavailable: measured.tokens === undefined ? (measured.reason ?? "理由不明") : null,
  };
}

export interface BuildOptions {
  /**
   * 区切りでコンテキストを測るか。測るのは step next / report だけで、手順の位置だけを
   * 読む側（Stop フック・step where・conductor parse）は測らない。測るとホストの記録を
   * 読みに行くので遅く、読む側のセッションを測ってしまうため
   */
  measure?: boolean;
}

export function buildDirective(opened: Opened, evaluation: Evaluation, options: BuildOptions = {}): Directive {
  const { ctx, skill } = opened;
  const base = { skill: skill.skill, cycle: ctx.cycle?.name ?? null, unit: opened.phase, notices: [] as string[], progress: progressOf(evaluation) };

  const legacy = legacyCycleMessage(ctx.cycle);
  if (legacy !== undefined) return { ...base, kind: "stop", message: legacy };

  const stopped = skill.stop?.(ctx);
  if (stopped !== undefined) return { ...base, kind: "stop", message: stopped };

  if (evaluation.orphans.length > 0) {
    const current = evaluation.current?.definition.id ?? "（なし）";
    return {
      ...base,
      kind: "stop",
      message: [
        `進捗の記録が欠けています。現在地は ${current} ですが、その後のステップの成果物があります: ${evaluation.orphans.map((step) => step.definition.id).join(", ")}`,
        "推測で補わずに止まります。ユーザーに経緯を確認し、実施済みなら次のように記録してください:",
        `  ${CLI} step report ${opened.phase} <ステップ>${cycleArg(ctx)}${skillArg(opened)} --result done --reason "手で実施"`,
        "記録は現在地のステップから順に行います。",
      ].join("\n"),
    };
  }

  const overruns = checkpointsOf(ctx.events, ctx.config.context).filter((entry) => entry.over);
  const current = evaluation.current;
  if (current === undefined) {
    return { ...base, kind: "done", overruns };
  }

  const definition = current.definition;
  const directive: Directive = {
    ...base,
    kind: definition.kind,
    step: definition.id,
    title: definition.title,
    read: instructionPath(skill.skill, definition.id),
    report: Object.fromEntries(allowedResults(definition).map((result) => [result, reportCommand(opened, definition.id, result)])),
  };
  if (definition.args !== undefined) directive.args = definition.args(ctx);
  if (current.note !== undefined) directive.note = current.note;
  if (current.revise !== undefined) directive.revise = current.revise;
  if (definition.kind === "gate") {
    directive.ask = definition.ask ?? definition.id;
    directive.binds = Object.keys(currentHashes(definition, ctx));
  }
  if (definition.kind === "call") {
    directive.call = definition.call ?? "";
    directive.reason = definition.reason?.(ctx) ?? "";
    if (stepsOf(directive.call)?.internal === true) {
      directive.callNext = `${CLI} step next ${opened.phase}${cycleArg(ctx)} --skill ${directive.call}`;
    }
  }
  if (definition.checkpoint !== undefined && options.measure !== false) {
    const measured = measureCurrent(process.env);
    directive.context = checkContext(opened, definition.checkpoint, measured);
    const notice = smallWindowNotice(process.env, measured);
    if (notice !== undefined) directive.notices.push(notice);
  }
  if (definition.id === "review" && overruns.length > 0) directive.overruns = overruns;
  return directive;
}

export function renderDirective(directive: Directive): string {
  const head = `[${directive.progress.complete}/${directive.progress.total}] ${directive.skill} ${directive.unit}`;
  if (directive.kind === "stop") return `${head}\n\nstop: ${directive.message ?? ""}`;
  const lines: string[] = [];
  if (directive.kind === "done") {
    lines.push(head, "", "done: 手順をすべて終えました。");
    appendOverruns(lines, directive.overruns, "まだ伝えていない超過があれば、完了の案内で伝えてください");
    return lines.join("\n");
  }

  lines.push(head, "", `${directive.kind}: ${directive.step}（${directive.title}）`, `指示: ${directive.read} を読んで行う`);
  if (directive.kind === "gate") {
    lines.push(`問いの ID: ${directive.ask}`);
    if ((directive.binds ?? []).length > 0) lines.push(`承認に結びつくファイル: ${(directive.binds ?? []).join(", ")}`);
  }
  if (directive.kind === "call") {
    lines.push(`呼ぶスキル: /hikyaku:${directive.call}`, `理由: ${directive.reason}`);
    if (directive.callNext !== undefined) lines.push(`呼ばれたスキルの手順: ${directive.callNext}`);
  }
  if (directive.args !== undefined) {
    lines.push(`値: ${Object.entries(directive.args).map(([key, value]) => `${key}=${String(value)}`).join(" ")}`);
  }
  if (directive.note !== undefined) lines.push(`注意: ${directive.note}`);
  if (directive.revise !== undefined) lines.push(`差し戻しの答え: ${directive.revise === "" ? "（記録なし）" : directive.revise}`);
  if (directive.context !== undefined) {
    const c = directive.context;
    lines.push(
      c.tokens === null
        ? `コンテキスト（${c.label}）: 計測不可（${c.unavailable}）。見積もりだけで進めてください`
        : `コンテキスト（${c.label}）: ${formatTokens(c.tokens)} / 目安 ${formatTokens(c.budget)}${c.over ? " — 目安を超えています" : ""}`,
    );
  }
  appendOverruns(lines, directive.overruns, "レビュー結果の提示で伝えてください。指摘が0件なら完了の案内で伝えます");
  for (const notice of directive.notices) lines.push(`注意: ${notice}`);
  lines.push("", "報告:");
  for (const [result, command] of Object.entries(directive.report ?? {})) lines.push(`  ${result.padEnd(8)}${command}`);
  return lines.join("\n");
}

function appendOverruns(lines: string[], overruns: Overrun[] | undefined, how: string): void {
  if (overruns === undefined || overruns.length === 0) return;
  lines.push(`目安を超えたまま継続した区切り（${how}）:`);
  for (const entry of overruns) {
    lines.push(`  ${entry.label}: ${formatTokens(entry.tokens)} / 目安 ${formatTokens(entry.budget)}`);
  }
}
