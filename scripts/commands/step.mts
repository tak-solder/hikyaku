/**
 * step — フェーズの中の手順を、設定と状態から1手ずつ返す（#50）。
 *
 *   step next    次の1手（directive）を返す。何度呼んでも同じ状態なら同じものを返す
 *   step report  1手の結果を progress.jsonl に追記し、次の1手を返す
 *   step status  手順の一覧と、それぞれの状態を表示する
 *   step lint    ステップの定義と指示ファイルの対応を検査する（CI 用）
 *
 * 判定は scripts/lib/steps/ にある。ここは引数の解釈と出力だけを行う。
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { flagBoolean, flagString, type ParsedArgs } from "../lib/args.mts";
import type { Phase } from "../lib/branch.mts";
import type { ContextBudget } from "../lib/config.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { emit, table } from "../lib/output.mts";
import { pluginRoot, pluginVersion } from "../lib/paths.mts";
import {
  appendProgress,
  readProgress,
  RESTART,
  RESTART_STEP,
  STEP_RESULTS,
  type ProgressEvent,
  type StepResult,
} from "../lib/progress.mts";
import { register } from "../lib/registry.mts";
import { formatTokens, measureCurrent, smallWindowNotice, type CurrentContext } from "../lib/session.mts";
import { requirePhase, scopeFor } from "../lib/stack.mts";
import {
  allowedResults,
  currentHashes,
  evaluate,
  hasEvidence,
  type EvaluatedStep,
  type Evaluation,
  type SkillSteps,
  type StepContext,
} from "../lib/steps/engine.mts";
import { checkpointsOf, CHECKPOINT_LABELS, CHECKPOINT_STEPS, type Overrun } from "../lib/steps/checkpoints.mts";
import { instructionPath, ownerOf, SKILL_STEPS, stepsOf } from "../lib/steps/index.mts";

const CLI = `node "${join(pluginRoot(), "scripts", "hikyaku.mts")}"`;

interface Opened {
  phase: Phase;
  skill: SkillSteps;
  ctx: StepContext;
}

function open(args: ParsedArgs, phaseOperand: string | undefined, cycleOperand: string | undefined): Opened {
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
function cycleArg(ctx: StepContext): string {
  return ctx.cycle === undefined ? "" : ` ${ctx.cycle.name}`;
}

/** 内部スキルなら --skill を添える */
function skillArg(opened: Opened): string {
  return opened.skill.internal === true ? ` --skill ${opened.skill.skill}` : "";
}

/** 作成時の版のメジャーが 2 以下のサイクルは扱わない（v2 のまま終える） */
function legacyCycleMessage(ctx: StepContext): string | undefined {
  if (ctx.cycle === undefined) return undefined;
  const version = ctx.cycle.record.hikyaku;
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isInteger(major) && major >= 3) return undefined;
  const label = version === "" ? "作成時の版が記録されていない版" : `v${version}`;
  return [
    `サイクル ${ctx.cycle.name} は ${label} で作成されています。v3 の手順では扱いません。`,
    "v2 で始めたサイクルは v2 のまま終えてください（docs/migration/v2-to-v3.md）。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// directive

interface ContextCheck {
  checkpoint: keyof ContextBudget;
  label: string;
  budget: number;
  tokens: number | null;
  over: boolean;
  unavailable: string | null;
}

interface Directive {
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

function buildDirective(opened: Opened, evaluation: Evaluation): Directive {
  const { ctx, skill } = opened;
  const base = { skill: skill.skill, cycle: ctx.cycle?.name ?? null, unit: opened.phase, notices: [] as string[], progress: progressOf(evaluation) };

  const legacy = legacyCycleMessage(ctx);
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
  if (definition.checkpoint !== undefined) {
    const measured = measureCurrent(process.env);
    directive.context = checkContext(opened, definition.checkpoint, measured);
    const notice = smallWindowNotice(process.env, measured);
    if (notice !== undefined) directive.notices.push(notice);
  }
  if (definition.id === "review" && overruns.length > 0) directive.overruns = overruns;
  return directive;
}

function renderDirective(directive: Directive): string {
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

function emitDirective(directive: Directive, extra: Record<string, unknown> = {}, prefix = ""): void {
  emit({ ...extra, directive }, () => `${prefix}${renderDirective(directive)}`);
}

// ---------------------------------------------------------------------------
// コマンド

register({
  name: "step next",
  summary: "フェーズの中の次の1手を、設定と進捗から決めて返す",
  usage: "hikyaku step next <phase> [<cycle>] [--skill <内部スキル>] [--json]",
  details: [
    "スキルの転送ループが呼びます。返った1手（directive）を行い、step report で結果を返します。",
    "状態は保存せず、作業単位のディレクトリの progress.jsonl と成果物から毎回導出します。",
    "同じ状態なら何度呼んでも同じものを返すので、迷ったら呼び直してください。",
    "",
    "  run    ステップを行う。指示ファイル（read）を読み、終えたら report のコマンドで返す",
    "  gate   ユーザーに承認を求める。承認は結びつくファイル（binds）のハッシュと一緒に記録され、",
    "         承認後にファイルが変わると無効になる",
    "  call   内部スキル（call）を呼ぶ。終えたら呼び出し元が report で返す",
    "  done   手順をすべて終えた",
    "  stop   止まる。message をユーザーに伝えて終了する",
    "",
    "内部スキル（build-manager / retrospective）は --skill で指定し、呼び出し元のフェーズの",
    "作業単位で進めます。記録は呼び出し元と同じ progress.jsonl に入り、呼び出し元が最後に",
    "報告したあとの記録だけが今回の呼び出しの分として数えられます。",
    "",
    "区切り（G8・実装開始前・レビュー前）では、現在のセッションのコンテキストを測り、",
    "[context] の目安と比べます（context）。超えていても止めません。",
    "",
    `いま step に移っているスキル: ${SKILL_STEPS.map((entry) => entry.skill).join(" / ")}`,
  ].join("\n"),
  run: ({ args, operands }) => {
    const opened = open(args, operands[0], operands[1]);
    emitDirective(buildDirective(opened, evaluate(opened.skill, opened.ctx)));
  },
});

register({
  name: "step report",
  summary: "1手の結果を進捗に記録し、次の1手を返す",
  usage:
    "hikyaku step report <phase> <step> [<cycle>] [--skill <内部スキル>] --result done|skipped|approved|rejected|failed [--reason <理由>] [--input <答え>] [--bp <N>] [--dry-run] [--json]",
  writes: true,
  details: [
    "作業単位のディレクトリの progress.jsonl に1行追記します。報告できるのは現在地のステップと、",
    "完了したステップの done の報告し直し（成果物を作り直したとき）です。報告し直すと、",
    "そこから後ろのステップはやり直しになります（承認も取り直し）。",
    "",
    "  done      ステップを終えた。成果物が要るステップは、成果物が無ければ受け付けない",
    "  skipped   スキップした。--reason が必須。スキップできるステップだけ",
    "  approved  ゲートの承認。結びつくファイルのハッシュを記録する",
    "  rejected  ゲートの差し戻し。--input にユーザーの答えが必須",
    "  failed    失敗した。--reason が必須。現在地は動かない",
    "",
    "--bp は plan / plan-review で、再算出した BP を添えるときに使います（分割の検討の判定に使う）。",
    "記録には、報告した時点のコンテキスト・セッション ID・Hikyaku の版が入ります（#68）。",
    "progress.jsonl は成果物と一緒にコミットしてください。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const opened = open(args, operands[0], operands[2]);
    const stepId = operands[1];
    if (stepId === undefined) throw new HikyakuError("ステップを指定してください");
    const evaluation = evaluate(opened.skill, opened.ctx);
    const evaluated = evaluation.steps.find((step) => step.definition.id === stepId);
    if (evaluated === undefined) {
      throw new HikyakuError(
        `${opened.skill.skill} にステップ ${stepId} はありません`,
        `ステップ: ${opened.skill.steps.map((step) => step.id).join(" / ")}`,
      );
    }
    const event = buildEvent(opened, evaluation, evaluated, args);

    if (flagBoolean(args, "dry-run")) {
      emit({ dryRun: true, event }, () => `（dry-run）次の1行を追記します:\n${JSON.stringify(event)}`);
      return;
    }
    appendProgress(opened.ctx.unitDirectory, event);
    const after: Opened = { ...opened, ctx: { ...opened.ctx, events: [...opened.ctx.events, event] } };
    emitDirective(buildDirective(after, evaluate(after.skill, after.ctx)), { recorded: event }, `記録しました: ${stepId} ${event.result}\n\n`);
  },
});

function buildEvent(opened: Opened, evaluation: Evaluation, evaluated: EvaluatedStep, args: ParsedArgs): ProgressEvent {
  const definition = evaluated.definition;
  const resultRaw = flagString(args, "result");
  if (resultRaw === undefined || !STEP_RESULTS.includes(resultRaw as StepResult)) {
    throw new HikyakuError(`--result は ${STEP_RESULTS.join(" | ")} のどれかで指定してください`);
  }
  const result = resultRaw as StepResult;

  const legacy = legacyCycleMessage(opened.ctx);
  if (legacy !== undefined) throw new HikyakuError(legacy);
  if (evaluated.status === "off") {
    throw new HikyakuError(`${definition.id} は、このサイクルの設定では行わないステップです`);
  }
  // 現在地のほか、完了したステップを done で報告し直せる（成果物を作り直したとき）。
  // そこから後ろはやり直しになる。現在地より後ろへは進めない
  const redo = (evaluated.status === "complete" || evaluated.status === "skipped") && result === "done";
  if (evaluation.current !== evaluated && !redo) {
    const current = evaluation.current?.definition.id;
    throw new HikyakuError(
      current === undefined
        ? "手順はすべて終わっています。作り直したステップを done で報告し直す以外に、報告するものはありません"
        : `報告できるのは現在地のステップ（${current}）か、完了したステップの報告し直しだけです`,
      "step next で現在地を確認してください。",
    );
  }
  if (!allowedResults(definition).includes(result)) {
    throw new HikyakuError(
      `${definition.id} に ${result} は報告できません`,
      `報告できる結果: ${allowedResults(definition).join(" | ")}${definition.kind !== "gate" && result === "skipped" ? "（このステップはスキップできません）" : ""}`,
    );
  }
  const reason = flagString(args, "reason");
  const input = flagString(args, "input");
  if ((result === "skipped" || result === "failed") && (reason === undefined || reason.trim() === "")) {
    throw new HikyakuError(`${result} には --reason で理由を添えてください`);
  }
  if (result === "rejected" && (input === undefined || input.trim() === "")) {
    throw new HikyakuError("rejected には --input でユーザーの答えを添えてください");
  }
  if (result === "done" && !hasEvidence(definition, opened.ctx)) {
    throw new HikyakuError(
      `${definition.id} の成果物がまだありません`,
      definition.produces === undefined ? "完了の条件を満たしてから報告してください。" : `必要な成果物: ${definition.produces.join(", ")}`,
    );
  }

  const event: ProgressEvent = { at: new Date().toISOString(), skill: opened.skill.skill, step: definition.id, result };
  if (reason !== undefined) event.reason = reason;
  if (input !== undefined) event.input = input;
  if (result === "approved") event.hashes = currentHashes(definition, opened.ctx);

  const bpRaw = flagString(args, "bp");
  if (bpRaw !== undefined) {
    if (definition.reportsBp !== true) throw new HikyakuError(`${definition.id} には --bp を添えられません`);
    const bp = Number(bpRaw);
    if (!Number.isInteger(bp) || bp < 0) throw new HikyakuError(`--bp は0以上の整数で指定してください（現在: ${bpRaw}）`);
    event.bp = bp;
  }

  const measured = measureCurrent(process.env);
  if (measured.tokens !== undefined) event.context = measured.tokens;
  else if (measured.reason !== undefined) event.contextUnavailable = measured.reason;
  if (measured.sessionId !== undefined) event.session = measured.sessionId;
  event.hikyaku = pluginVersion();
  return event;
}

register({
  name: "step restart",
  summary: "同じ作業単位で、スキルの手順を最初から回し直す区切りを記録する",
  usage: "hikyaku step restart <phase> [<cycle>] [--skill <内部スキル>] [--round <回の種類>] --reason <理由> [--dry-run] [--json]",
  writes: true,
  details: [
    "progress.jsonl に区切りを1行追記し、次の1手を返します。これより前の記録は現在地の導出に使いません。",
    "古い記録は消さずに残るので、区切りでのコンテキストなどは後から読めます。",
    "",
    "  architect の追加設計   設計を終えた design/ で、もう一度手順を回すとき",
    "  内部スキルの呼び直し   呼び出し元が報告しないまま、build-manager などをもう一度呼ぶとき",
    "",
    "--round は回の種類です（architect の return / add など）。スキルの定義がこの値で手順を変えます。",
    "使える値はスキルが決め、知らない値はエラーになります。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const opened = open(args, operands[0], operands[1]);
    const reason = flagString(args, "reason");
    if (reason === undefined || reason.trim() === "") throw new HikyakuError("--reason で理由を添えてください");
    const event: ProgressEvent = {
      at: new Date().toISOString(), skill: opened.skill.skill, step: RESTART_STEP, result: RESTART, reason, hikyaku: pluginVersion(),
    };
    const round = flagString(args, "round");
    if (round !== undefined) {
      const rounds = opened.skill.rounds ?? [];
      if (!rounds.includes(round)) {
        throw new HikyakuError(
          `--round に ${round} は指定できません`,
          rounds.length === 0 ? `${opened.skill.skill} には回の種類がありません` : `使える値: ${rounds.join(" | ")}`,
        );
      }
      event.round = round;
    }
    const measured = measureCurrent(process.env);
    if (measured.sessionId !== undefined) event.session = measured.sessionId;
    if (flagBoolean(args, "dry-run")) {
      emit({ dryRun: true, event }, () => `（dry-run）次の1行を追記します:\n${JSON.stringify(event)}`);
      return;
    }
    appendProgress(opened.ctx.unitDirectory, event);
    const after: Opened = { ...opened, ctx: { ...opened.ctx, events: [...opened.ctx.events, event] } };
    emitDirective(buildDirective(after, evaluate(after.skill, after.ctx)), { recorded: event }, `記録しました: ${opened.skill.skill} の手順を最初から回し直します（${reason}）\n\n`);
  },
});

const STATUS_LABELS: Record<EvaluatedStep["status"], string> = {
  complete: "完了",
  skipped: "スキップ",
  pending: "未完了",
  off: "対象外",
};

register({
  name: "step status",
  summary: "フェーズの手順の一覧と、それぞれの状態を表示する",
  usage: "hikyaku step status <phase> [<cycle>] [--skill <内部スキル>] [--json]",
  run: ({ args, operands }) => {
    const opened = open(args, operands[0], operands[1]);
    const evaluation = evaluate(opened.skill, opened.ctx);
    const checkpoints = checkpointsOf(opened.ctx.events, opened.ctx.config.context);
    emit(
      {
        skill: opened.skill.skill,
        cycle: opened.ctx.cycle?.name ?? null,
        unit: opened.phase,
        current: evaluation.current?.definition.id ?? null,
        steps: evaluation.steps.map((step) => ({
          id: step.definition.id,
          kind: step.definition.kind,
          title: step.definition.title,
          status: step.status,
          at: step.event?.at ?? null,
          note: step.note ?? null,
        })),
        checkpoints,
      },
      () => {
        const lines = [
          `${opened.skill.skill} ${opened.phase}${opened.ctx.cycle === undefined ? "" : `（${opened.ctx.cycle.name}）`}`,
          "",
          table(
            evaluation.steps.map((step) => [
              step === evaluation.current ? "→" : "",
              step.definition.id,
              STATUS_LABELS[step.status],
              step.definition.title,
              step.event?.reason ?? step.note ?? "",
            ]),
            ["", "ステップ", "状態", "内容", "補足"],
          ),
        ];
        if (checkpoints.length > 0) {
          lines.push(
            "",
            "区切りでのコンテキスト:",
            ...checkpoints.map(
              (entry) => `  ${entry.label}: ${formatTokens(entry.tokens)} / 目安 ${formatTokens(entry.budget)}${entry.over ? "（超過）" : ""}`,
            ),
          );
        }
        return lines.join("\n");
      },
    );
  },
});

register({
  name: "step lint",
  summary: "ステップの定義と、スキルの指示ファイルの対応を検査する",
  usage: "hikyaku step lint [--json]",
  details: [
    "プラグイン本体の開発用です。CI（check-scripts）が実行します。",
    "",
    "scripts/lib/steps/ の各ステップに skills/<skill>/steps/<id>.md があるか、",
    "定義に無い指示ファイルが残っていないかを検査します。",
    `区切りの定義（${Object.keys(CHECKPOINT_STEPS).join(" / ")}）が実在するステップを指しているかも見ます。`,
  ].join("\n"),
  run: () => {
    const problems: string[] = [];
    for (const skill of SKILL_STEPS) {
      const directory = join(pluginRoot(), "skills", skill.skill, "steps");
      const ids = skill.steps.map((step) => step.id);
      const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
      for (const id of new Set(duplicated)) problems.push(`${skill.skill}: ステップ ${id} が重複しています`);
      for (const id of ids) {
        if (!existsSync(instructionPath(skill.skill, id))) problems.push(`skills/${skill.skill}/steps/${id}.md がありません`);
      }
      const files = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".md")) : [];
      for (const file of files) {
        if (!ids.includes(file.replace(/\.md$/, ""))) {
          problems.push(`skills/${skill.skill}/steps/${file} に対応するステップが scripts/lib/steps/${skill.skill}.mts にありません`);
        }
      }
    }
    for (const [checkpoint, { skill, step }] of Object.entries(CHECKPOINT_STEPS)) {
      if (!stepsOf(skill)?.steps.some((definition) => definition.id === step)) {
        problems.push(`区切り ${checkpoint} が指す ${skill} の ${step} がありません`);
      }
    }
    if (problems.length > 0) throw new ValidationError(problems);
    const count = SKILL_STEPS.reduce((sum, skill) => sum + skill.steps.length, 0);
    emit({ ok: true, skills: SKILL_STEPS.map((skill) => skill.skill) }, () => `✓ ${SKILL_STEPS.length} スキル・${count} ステップの指示ファイルが揃っています`);
  },
});

