/**
 * スキルごとのステップ定義の一覧と、フェーズからの引き当て。
 *
 * 定義はスキルごとのファイルに分ける（並行して移すときに同じファイルを触らないため）。
 * 移したスキルはここに足す。
 */

import { join } from "node:path";
import type { Phase } from "../branch.mts";
import { pluginRoot } from "../paths.mts";
import { buildDirName, normalizeBuildId } from "../tasklist.mts";
import { BUILDER_STEPS } from "./builder.mts";
import type { SkillSteps } from "./engine.mts";

export const SKILL_STEPS: SkillSteps[] = [BUILDER_STEPS];

export function stepsOf(skill: string): SkillSteps | undefined {
  return SKILL_STEPS.find((entry) => entry.skill === skill);
}

export interface UnitTarget {
  /** そのフェーズを担うスキル */
  skill: string;
  /** progress.jsonl を置く、サイクルのディレクトリからの相対パス */
  directory: string;
}

/** フェーズから、手順を担うスキルと作業単位のディレクトリを引く。未移行のフェーズは undefined */
export function unitOf(phase: Phase): UnitTarget | undefined {
  if (phase.startsWith("build-")) return { skill: "builder", directory: buildDirName(normalizeBuildId(phase)) };
  return undefined;
}

/** ステップの指示ファイル */
export function instructionPath(skill: string, step: string): string {
  return join(pluginRoot(), "skills", skill, "steps", `${step}.md`);
}
