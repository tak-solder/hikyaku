/**
 * 中間レビューの指摘の採用率 — progress.jsonl の done に残した件数（--findings / --adopted）を集める。
 *
 * プロファイルで外せる中間レビュー（user-stories・architecture・tasklist・plan・test-spec）を残すかを、
 * 実績で決めるための材料。どのステップを数えるかは、定義の countsFindings が唯一の正。
 * 件数は報告したモデルの申告で、指摘1件の数え方はレビューごとに揺れる（比べるのは同じステップどうし）。
 *
 * 件数の無い done（この記録を始める前の報告）は捨てずに uncounted として数える。採用率の分母に入れると
 * 0 件の回と区別できなくなるため、件数のある回だけから計算する。残すか外すかはここでは決めない
 */

import { join } from "node:path";
import { cycleDir, cycleDirName, type CycleRecord } from "./cycles.mts";
import { unitDirectories } from "./ledger.mts";
import { readProgress } from "./progress.mts";
import { SKILL_STEPS } from "./steps/index.mts";

export interface FindingRun {
  cycle: string;
  /** サイクルのディレクトリからの相対パス（planning / design / build-NN） */
  directory: string;
  skill: string;
  step: string;
  at: string;
  /** 件数の無い報告（記録を始める前）は undefined */
  findings: number | undefined;
  adopted: number | undefined;
}

export interface FindingSummary {
  skill: string;
  step: string;
  /** done を報告した回 */
  runs: number;
  /** そのうち件数の無い回 */
  uncounted: number;
  /** 件数のある回のうち、指摘が1件以上あった回 */
  withFindings: number;
  findings: number;
  adopted: number;
  /** adopted / findings。指摘が0件なら null */
  rate: number | null;
}

/** 件数を数えるステップ（skill と step の組）。定義の countsFindings から導く */
export function findingSteps(): { skill: string; step: string }[] {
  return SKILL_STEPS.flatMap((skill) =>
    skill.steps.filter((definition) => definition.countsFindings === true).map((definition) => ({ skill: skill.skill, step: definition.id })),
  );
}

export function collectFindingRuns(hikyakuRoot: string, cycles: CycleRecord[]): FindingRun[] {
  const targets = new Set(findingSteps().map((entry) => `${entry.skill}/${entry.step}`));
  const runs: FindingRun[] = [];
  for (const record of cycles) {
    const directory = cycleDir(hikyakuRoot, record);
    for (const relative of unitDirectories(directory)) {
      for (const event of readProgress(join(directory, relative))) {
        if (event.result !== "done" || !targets.has(`${event.skill}/${event.step}`)) continue;
        runs.push({
          cycle: cycleDirName(record),
          directory: relative,
          skill: event.skill,
          step: event.step,
          at: event.at,
          findings: event.findings,
          adopted: event.adopted,
        });
      }
    }
  }
  return runs;
}

/** ステップごとの集計。定義の並びで、回が無いステップも 0 件として返す */
export function summarizeFindings(runs: FindingRun[]): FindingSummary[] {
  return findingSteps().map(({ skill, step }) => {
    const own = runs.filter((run) => run.skill === skill && run.step === step);
    const counted = own.filter((run) => run.findings !== undefined);
    const findings = counted.reduce((sum, run) => sum + (run.findings ?? 0), 0);
    const adopted = counted.reduce((sum, run) => sum + (run.adopted ?? 0), 0);
    return {
      skill,
      step,
      runs: own.length,
      uncounted: own.length - counted.length,
      withFindings: counted.filter((run) => (run.findings ?? 0) > 0).length,
      findings,
      adopted,
      rate: findings === 0 ? null : adopted / findings,
    };
  });
}
