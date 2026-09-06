/**
 * フェーズと中断点の導出。
 *
 * 状態ファイルは持たない。フェーズはファイルの存在から、着手中はブランチの
 * 存在から、完了は tasklist.md の PR 列から導出する。重複した状態は必ず腐り、
 * しかも腐っていることに気づけないため。
 *
 * 中断の検出も同じ原理で、ブランチ上の成果物の有無から「どこまで進んだか」を
 * 割り出す。これは成果物が1つできるごとにコミット & push されていることを
 * 前提にしている（コミットされていなければ他セッションから見えない）。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildDirName, isComplete, type BuildRecord } from "./tasklist.mts";
import type { CycleRecord } from "./cycles.mts";

export type DerivedPhase =
  | "planning"
  | "architecting"
  | "building"
  | "completed"
  | "closed"
  | "abandoned";

export interface Artifact {
  path: string;
  /** 必須成果物か。条件付きは「無くても未完了とは限らない」 */
  required: boolean;
  present: boolean;
}

export interface CycleState {
  phase: DerivedPhase;
  /** そのフェーズで作られるべき成果物（順序どおり） */
  artifacts: Artifact[];
  /** 次に作るべき必須成果物。undefined ならフェーズの成果物は揃っている */
  resumeAt: string | undefined;
  builds: BuildRecord[];
}

interface ArtifactSpec {
  path: string;
  required: boolean;
}

const PLAN_ARTIFACTS: ArtifactSpec[] = [
  { path: "planning/questions.md", required: false },
  { path: "planning/user-stories.md", required: true },
];

const ARCHITECT_ARTIFACTS: ArtifactSpec[] = [
  { path: "design/codebase-survey.md", required: false },
  { path: "design/design-questions.md", required: false },
  { path: "design/design-delta.md", required: true },
  { path: "tasklist.md", required: true },
];

function buildArtifacts(id: string): ArtifactSpec[] {
  const dir = buildDirName(id);
  return [
    { path: `${dir}/issue.md`, required: true },
    { path: `${dir}/plan.md`, required: true },
    { path: `${dir}/test-spec.md`, required: false },
    { path: `${dir}/questions.md`, required: false },
    { path: `${dir}/handoff.md`, required: true },
  ];
}

function resolve(cycleDirectory: string, specs: ArtifactSpec[]): Artifact[] {
  return specs.map((spec) => ({
    path: spec.path,
    required: spec.required,
    present: existsSync(join(cycleDirectory, spec.path)),
  }));
}

function firstMissing(artifacts: Artifact[]): string | undefined {
  return artifacts.find((artifact) => artifact.required && !artifact.present)?.path;
}

/**
 * サイクルの状態を導出する。
 * closed / abandoned は保存された status をそのまま返す（導出できないため）。
 */
export function deriveState(
  cycleDirectory: string,
  record: CycleRecord,
  builds: BuildRecord[],
): CycleState {
  if (record.status === "closed" || record.status === "abandoned") {
    return { phase: record.status, artifacts: [], resumeAt: undefined, builds };
  }

  const planArtifacts = resolve(cycleDirectory, PLAN_ARTIFACTS);
  if (firstMissing(planArtifacts) !== undefined) {
    return {
      phase: "planning",
      artifacts: planArtifacts,
      resumeAt: firstMissing(planArtifacts),
      builds,
    };
  }

  const architectArtifacts = resolve(cycleDirectory, ARCHITECT_ARTIFACTS);
  if (firstMissing(architectArtifacts) !== undefined || builds.length === 0) {
    return {
      phase: "architecting",
      artifacts: architectArtifacts,
      resumeAt: firstMissing(architectArtifacts) ?? "tasklist.md（ビルドが1件も登録されていません）",
      builds,
    };
  }

  const incomplete = builds.filter((build) => !isComplete(build));
  if (incomplete.length === 0) {
    // 実装は終わっているが、永続ドキュメントへの昇格がまだ。
    // この期間に他サイクルが古い overview を「実装済みの現実」として読む危険がある
    return { phase: "completed", artifacts: [], resumeAt: undefined, builds };
  }

  // 着手済みの（＝成果物が1つでもある）ビルドがあれば、その中断点を返す
  for (const build of incomplete) {
    const artifacts = resolve(cycleDirectory, buildArtifacts(build.id));
    if (artifacts.some((artifact) => artifact.present)) {
      return { phase: "building", artifacts, resumeAt: firstMissing(artifacts), builds };
    }
  }

  return { phase: "building", artifacts: [], resumeAt: undefined, builds };
}

/**
 * フェーズに対応する次の実行コマンドの案内。
 * スキルは HIKYAKU_ROOT を引数に取らない（設定から解決する）ので、渡すのはサイクルだけ。
 */
export function suggestCommand(phase: DerivedPhase, cycle: string): string {
  const target = cycle;
  switch (phase) {
    case "planning":
      return `/hikyaku:planner ${target}`;
    case "architecting":
      return `/hikyaku:architect ${target}`;
    case "building":
      return `/hikyaku:builder ${target}`;
    case "completed":
      return `/hikyaku:close-cycle ${target}`;
    default:
      return "（このサイクルは終了しています）";
  }
}
