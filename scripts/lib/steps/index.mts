/**
 * スキルごとのステップ定義の一覧。
 *
 * 定義はスキルごとのファイル（steps/<skill>.mts）に分ける。並行して移すときに
 * 同じファイルを触らないため。移したスキルは SKILL_STEPS に1行足す。
 */

import { join } from "node:path";
import type { Phase } from "../branch.mts";
import { pluginRoot } from "../paths.mts";
import { ARCHITECT_STEPS } from "./architect.mts";
import { BP_GUIDE_STEPS } from "./bp-guide.mts";
import { BUILD_MANAGER_STEPS } from "./build-manager.mts";
import { BUILDER_STEPS } from "./builder.mts";
import { CREATE_CYCLE_STEPS } from "./create-cycle.mts";
import type { SkillSteps } from "./engine.mts";
import { INIT_STEPS } from "./init.mts";

export const SKILL_STEPS: SkillSteps[] = [
  INIT_STEPS,
  CREATE_CYCLE_STEPS,
  ARCHITECT_STEPS,
  BUILD_MANAGER_STEPS,
  BUILDER_STEPS,
  BP_GUIDE_STEPS,
];

export function stepsOf(skill: string): SkillSteps | undefined {
  return SKILL_STEPS.find((entry) => entry.skill === skill);
}

/** そのフェーズを担うスキル。未移行のフェーズは undefined */
export function ownerOf(phase: Phase): { skill: SkillSteps; directory: string } | undefined {
  for (const skill of SKILL_STEPS) {
    const directory = skill.unit?.(phase);
    if (directory !== undefined) return { skill, directory };
  }
  return undefined;
}

/** ステップの指示ファイル */
export function instructionPath(skill: string, step: string): string {
  return join(pluginRoot(), "skills", skill, "steps", `${step}.md`);
}
