/**
 * 作業単位の探索 — progress.jsonl のある作業単位を見つけ、そのフェーズとスキルを逆に引く（#50）。
 *
 * step の各コマンドはフェーズとサイクルを引数で受け取るが、Stop フック・step where・
 * conductor parse は「どの作業単位の手順が途中か」「このセッションはどこを進めていたか」を
 * 知りたい側で、フェーズを知らない。記録は作業単位のディレクトリに置かれ、各イベントには
 * 報告したスキルとセッション ID が入っているので、そこから逆に引く。
 *
 * 見るのは HIKYAKU_ROOT 直下（init / bp-guide）と、進行中のサイクルのディレクトリと
 * その直下のディレクトリ（planning/・design/・build-NN/）だけ。終えたサイクルは見ない。
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
  events: ProgressEvent[];
}

interface ProgressFile {
  cycle: CycleRecord | undefined;
  /** サイクルのディレクトリ（サイクルの無いフェーズでは HIKYAKU_ROOT）からの相対パス */
  relative: string;
  directory: string;
  events: ProgressEvent[];
}

function progressFiles(hikyakuRoot: string, records: CycleRecord[]): ProgressFile[] {
  const files: ProgressFile[] = [];
  const visit = (base: string, cycle: CycleRecord | undefined): void => {
    const relatives = [""];
    if (existsSync(base)) {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) relatives.push(entry.name);
      }
    }
    for (const relative of relatives) {
      const directory = join(base, relative);
      if (!existsSync(join(directory, PROGRESS_FILE))) continue;
      files.push({ cycle, relative, directory, events: readProgress(directory) });
    }
  };
  visit(hikyakuRoot, undefined);
  for (const record of records.filter((entry) => entry.status === "active")) {
    visit(cycleDir(hikyakuRoot, record), record);
  }
  return files;
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
    events: file.events,
  };
}

/**
 * 記録のある作業単位を一覧する。1つのファイルに複数のスキルの記録があれば
 * （サイクルのディレクトリ直下の create-cycle と close-cycle）、スキルごとに分ける。
 * 内部スキルの記録は、呼び出し元の作業単位に含まれる
 */
export function findUnits(hikyakuRoot: string, records: CycleRecord[]): FoundUnit[] {
  const units: FoundUnit[] = [];
  for (const file of progressFiles(hikyakuRoot, records)) {
    const skills = [...new Set(file.events.map((event) => event.skill))];
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
  records: CycleRecord[],
  sessionId: string,
): SessionPosition | undefined {
  let found: { file: ProgressFile; index: number; event: ProgressEvent } | undefined;
  for (const file of progressFiles(hikyakuRoot, records)) {
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
  const caller = file.events
    .slice(0, index)
    .reverse()
    .find((entry) => entry.result !== RESTART && stepsOf(entry.skill)?.internal !== true);
  const unit = caller === undefined ? undefined : unitOf(file, caller.skill);
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
 * 作業単位の次の1手（区切りでのコンテキストは測らない）。内部スキルを呼んでいる最中（call）なら、
 * 呼ばれたスキルの1手を返す。build-manager の G6 のように、手順は呼ばれた側のゲートで止まっているため。
 * 呼ばれた側が終わっていれば、呼び出し元が call を報告する番なので、呼び出し元の1手のまま
 */
export function directiveOf(unit: FoundUnit, options: { root?: string } = {}): { opened: Opened; directive: Directive } {
  const opened = openUnit(unit, options);
  const directive = buildDirective(opened, evaluate(opened.skill, opened.ctx), { measure: false });
  const callee = directive.kind === "call" && directive.call !== undefined ? stepsOf(directive.call) : undefined;
  if (callee?.internal !== true) return { opened, directive };

  const inner = openUnit(unit, { ...options, skill: callee });
  const innerDirective = buildDirective(inner, evaluate(inner.skill, inner.ctx), { measure: false });
  return innerDirective.kind === "done" ? { opened, directive } : { opened: inner, directive: innerDirective };
}
