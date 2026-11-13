/**
 * 作業単位の探索 — progress.jsonl のある作業単位を見つけ、そのフェーズとスキルを逆に引く（#50）。
 *
 * step の各コマンドはフェーズとサイクルを引数で受け取るが、Stop フック・step where・
 * conductor parse は「どの作業単位の手順が途中か」「このセッションはどこを進めていたか」を
 * 知りたい側で、フェーズを知らない。記録は作業単位のディレクトリに置かれ、各イベントには
 * 報告したスキルとセッション ID が入っているので、そこから逆に引く。
 *
 * 見る範囲は呼び出し側が決める（Scope）。
 *
 *   explicit  渡したサイクルだけを見る（step where <cycle>・conductor parse）。終えたサイクルも見る。
 *             close-cycle は cycle close で status を closed にしてから pr を行うため。
 *             HIKYAKU_ROOT 直下（init / bp-guide）は見ない
 *   all       HIKYAKU_ROOT 直下と、進行中のサイクルのディレクトリとその直下のディレクトリ
 *             （planning/・design/・build-NN/）を見る（Stop フック）。終えたサイクルは、CLOSE の
 *             手順が残っているときだけサイクルのディレクトリ直下を見る
 *
 * サイクルのディレクトリ直下に記録する内部スキル（retrospective）は close-cycle が呼んだもの。
 * create-cycle は内部スキルを呼ばず、close-cycle は最初に振り返りを呼ぶので、その間は
 * close-cycle 自身の記録がまだ無い。
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../args.mts";
import { FIXED_PHASES, isCyclelessPhase, isPhase, type Phase } from "../branch.mts";
import { cycleDir, cycleDirName, type CycleRecord } from "../cycles.mts";
import { PROGRESS_FILE, readProgress, RESTART, type ProgressEvent } from "../progress.mts";
import { buildDirective, open, type Directive, type Opened } from "./directive.mts";
import { evaluate, type SkillSteps } from "./engine.mts";
import { stepsOf } from "./index.mts";

/** 記録のある作業単位と、その手順を担うスキル */
export interface FoundUnit {
  phase: Phase;
  /** サイクルのディレクトリ名。サイクルの無いフェーズでは undefined */
  cycle: string | undefined;
  skill: SkillSteps;
  directory: string;
  /** サイクルのディレクトリ直下の作業単位か（create-cycle / close-cycle） */
  cycleRoot: boolean;
  events: ProgressEvent[];
}

interface ProgressFile {
  cycle: CycleRecord | undefined;
  /** サイクルのディレクトリ（サイクルの無いフェーズでは HIKYAKU_ROOT）からの相対パス */
  relative: string;
  directory: string;
  events: ProgressEvent[];
}

/** 探す範囲。explicit なら渡したサイクルだけ（終えたものも）、all なら Stop フックの範囲 */
export interface Scope {
  records: CycleRecord[];
  explicit: boolean;
}

/** サイクルのディレクトリ直下の記録で、CLOSE の手順（振り返りを含む）が PR まで終わっていないか */
function closeUnfinished(events: ProgressEvent[]): boolean {
  const started = events.some((event) => event.skill === "close-cycle" || stepsOf(event.skill)?.internal === true);
  if (!started) return false;
  const last = [...events].reverse().find((event) => event.skill === "close-cycle" && event.result !== RESTART);
  return !(last?.step === "pr" && last.result === "done" && last.pr !== undefined);
}

function progressFiles(hikyakuRoot: string, scope: Scope): ProgressFile[] {
  const files: ProgressFile[] = [];
  const read = (base: string, relative: string, cycle: CycleRecord | undefined): ProgressFile | undefined => {
    const directory = join(base, relative);
    if (!existsSync(join(directory, PROGRESS_FILE))) return undefined;
    return { cycle, relative, directory, events: readProgress(directory) };
  };
  const visit = (base: string, cycle: CycleRecord | undefined): void => {
    const relatives = [""];
    if (existsSync(base)) {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) relatives.push(entry.name);
      }
    }
    for (const relative of relatives) {
      const file = read(base, relative, cycle);
      if (file !== undefined) files.push(file);
    }
  };
  if (scope.explicit) {
    for (const record of scope.records) visit(cycleDir(hikyakuRoot, record), record);
    return files;
  }
  visit(hikyakuRoot, undefined);
  for (const record of scope.records) {
    if (record.status === "active") {
      visit(cycleDir(hikyakuRoot, record), record);
      continue;
    }
    // 終えたサイクルは、CLOSE の手順（cycle close のあとの pr）が残っているときだけ見る
    const root = read(cycleDir(hikyakuRoot, record), "", record);
    if (root !== undefined && closeUnfinished(root.events)) files.push(root);
  }
  return files;
}

/** index の記録を書いた内部スキルを呼んだスキル。サイクルのディレクトリ直下なら close-cycle */
function callerOf(events: ProgressEvent[], index: number, cycleRoot: boolean): string | undefined {
  if (cycleRoot) return "close-cycle";
  return events
    .slice(0, index)
    .reverse()
    .find((entry) => entry.result !== RESTART && stepsOf(entry.skill)?.internal !== true)?.skill;
}

function isCycleRoot(file: ProgressFile): boolean {
  return file.cycle !== undefined && file.relative === "";
}

/** そのスキルが、そのディレクトリを作業単位にするフェーズ。サイクルの有無も合わせる */
function phaseOf(skill: SkillSteps, file: ProgressFile): Phase | undefined {
  const candidates = [...FIXED_PHASES, file.relative].filter((value): value is Phase => isPhase(value));
  return candidates.find(
    (phase) => isCyclelessPhase(phase) === (file.cycle === undefined) && skill.unit?.(phase) === file.relative,
  );
}

function unitOf(file: ProgressFile, skillName: string): FoundUnit | undefined {
  const skill = stepsOf(skillName);
  if (skill === undefined || skill.internal === true) return undefined;
  const phase = phaseOf(skill, file);
  if (phase === undefined) return undefined;
  return {
    phase,
    cycle: file.cycle === undefined ? undefined : cycleDirName(file.cycle),
    skill,
    directory: file.directory,
    cycleRoot: isCycleRoot(file),
    events: file.events,
  };
}

/**
 * 記録のある作業単位を一覧する。1つのファイルに複数のスキルの記録があれば
 * （サイクルのディレクトリ直下の create-cycle と close-cycle）、スキルごとに分ける。
 * 内部スキルの記録は、呼び出し元の作業単位に含まれる（呼び出し元の記録がまだ無くても、
 * 呼び出し元の作業単位として並べる。close-cycle の最初の振り返りの途中など）
 */
export function findUnits(hikyakuRoot: string, scope: Scope): FoundUnit[] {
  const units: FoundUnit[] = [];
  for (const file of progressFiles(hikyakuRoot, scope)) {
    const skills = [
      ...new Set(
        file.events.flatMap((event, index) =>
          stepsOf(event.skill)?.internal === true ? (callerOf(file.events, index, isCycleRoot(file)) ?? []) : event.skill,
        ),
      ),
    ];
    for (const skill of skills) {
      const unit = unitOf(file, skill);
      if (unit !== undefined) units.push(unit);
    }
  }
  return units;
}

export interface SessionPosition {
  unit: FoundUnit;
  /** セッションが最後に報告したのが内部スキルなら、そのスキル */
  internal: SkillSteps | undefined;
  /** セッションの最後の記録 */
  event: ProgressEvent;
}

/**
 * セッションが最後に記録した作業単位。内部スキルの記録なら、その前にある呼び出し元の
 * 記録から作業単位を決める。記録が無ければ undefined（そのセッションは手順を進めていない）
 */
export function locateSession(
  hikyakuRoot: string,
  scope: Scope,
  sessionId: string,
): SessionPosition | undefined {
  let found: { file: ProgressFile; index: number; event: ProgressEvent } | undefined;
  for (const file of progressFiles(hikyakuRoot, scope)) {
    file.events.forEach((event, index) => {
      if (event.session !== sessionId) return;
      if (found === undefined || event.at >= found.event.at) found = { file, index, event };
    });
  }
  if (found === undefined) return undefined;

  const { file, index, event } = found;
  const skill = stepsOf(event.skill);
  if (skill === undefined) return undefined;
  if (skill.internal !== true) {
    const unit = unitOf(file, event.skill);
    return unit === undefined ? undefined : { unit, internal: undefined, event };
  }
  const caller = callerOf(file.events, index, isCycleRoot(file));
  const unit = caller === undefined ? undefined : unitOf(file, caller);
  return unit === undefined ? undefined : { unit, internal: skill, event };
}

/** 見つけた作業単位を、step の各コマンドと同じ形で開く */
export function openUnit(unit: FoundUnit, options: { root?: string; skill?: SkillSteps } = {}): Opened {
  const argv: string[] = [];
  if (options.skill !== undefined) argv.push("--skill", options.skill.skill);
  if (options.root !== undefined) argv.push("--root", options.root);
  return open(parseArgs(argv), unit.phase, unit.cycle);
}

/**
 * 呼び出し元が最後に報告したあとに記録のある内部スキル（呼び直しの区切りを含む）。複数あれば最後のもの。
 * call ではなく run のステップの中から呼んだ内部スキル（implement からの build-manager、
 * validate での呼び直し、PR レビュー対応の振り返りなど）を見つけるため
 */
function runningInternal(unit: FoundUnit, events: ProgressEvent[]): SkillSteps | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const skill = stepsOf((events[i] as ProgressEvent).skill);
    if (skill === undefined) continue;
    if (skill.internal !== true) return undefined;
    // 同じファイルに別のスキルの作業単位がある（サイクルのディレクトリ直下の create-cycle）なら、その呼び出しではない
    return callerOf(events, i, unit.cycleRoot) === unit.skill.skill ? skill : undefined;
  }
  return undefined;
}

/**
 * 作業単位の次の1手（区切りでのコンテキストは測らない）。内部スキルを呼んでいる最中なら、
 * 呼ばれたスキルの1手を返す。build-manager の G6 のように、手順は呼ばれた側のゲートで止まっているため。
 * 呼んでいる最中とは、呼び出し元の1手が call のとき、または呼び出し元が最後に報告したあとに
 * 内部スキルの記録があるとき（run のステップの中から呼んだとき）。
 * 呼ばれた側が終わっていれば、呼び出し元が報告する番なので、呼び出し元の1手のまま
 */
export function directiveOf(unit: FoundUnit, options: { root?: string } = {}): { opened: Opened; directive: Directive } {
  const opened = openUnit(unit, options);
  const directive = buildDirective(opened, evaluate(opened.skill, opened.ctx), { measure: false });
  if (directive.kind === "stop") return { opened, directive };
  const called = directive.kind === "call" && directive.call !== undefined ? stepsOf(directive.call) : undefined;
  const callee = called?.internal === true ? called : runningInternal(unit, opened.ctx.events);
  if (callee === undefined) return { opened, directive };

  const inner = openUnit(unit, { ...options, skill: callee });
  const innerDirective = buildDirective(inner, evaluate(inner.skill, inner.ctx), { measure: false });
  return innerDirective.kind === "done" ? { opened, directive } : { opened: inner, directive: innerDirective };
}
