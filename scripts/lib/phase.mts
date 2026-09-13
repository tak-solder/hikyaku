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
  /** このツリーでは完了しているが、まだデフォルトブランチに入っていないビルド */
  mergePending: string[];
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
  mergedIds?: Set<string> | undefined,
): CycleState {
  const mergePending =
    mergedIds === undefined
      ? []
      : builds.filter((build) => isComplete(build) && !mergedIds.has(build.id)).map((b) => b.id);

  if (record.status === "closed" || record.status === "abandoned") {
    return { phase: record.status, artifacts: [], resumeAt: undefined, builds, mergePending };
  }

  const planArtifacts = resolve(cycleDirectory, PLAN_ARTIFACTS);
  if (firstMissing(planArtifacts) !== undefined) {
    return {
      phase: "planning",
      artifacts: planArtifacts,
      resumeAt: firstMissing(planArtifacts),
      builds,
      mergePending,
    };
  }

  const architectArtifacts = resolve(cycleDirectory, ARCHITECT_ARTIFACTS);
  if (firstMissing(architectArtifacts) !== undefined || builds.length === 0) {
    return {
      phase: "architecting",
      artifacts: architectArtifacts,
      resumeAt: firstMissing(architectArtifacts) ?? "tasklist.md（ビルドが1件も登録されていません）",
      builds,
      mergePending,
    };
  }

  // 「サイクルが完了したか」はリポジトリ全体の問いなので、デフォルトブランチで
  // マージ済みかを見る。builds（HEAD 基準）の PR 列で代用すると、最後のビルドで
  // tasklist done した直後に completed と出て close-cycle を勧めてしまう。
  // mergedIds が undefined（base を読めない）なら completed とは言わない。
  // close-cycle は永続ドキュメントへの昇格なので、誤って勧めるほうが害が大きい。
  if (
    mergedIds !== undefined &&
    builds.length > 0 &&
    builds.every((build) => mergedIds.has(build.id))
  ) {
    // 実装は終わっているが、永続ドキュメントへの昇格がまだ。
    // この期間に他サイクルが古い overview を「実装済みの現実」として読む危険がある
    return { phase: "completed", artifacts: [], resumeAt: undefined, builds, mergePending };
  }

  // 中断点の特定は「いま手元で何をしているか」というツリーローカルの問いなので、
  // HEAD 基準の builds を使う。ここで base 基準を使うと、マージ待ちで完了済みの
  // 先行ビルドが「未完了」に混ざり、スタック中に中断点が古いビルドへ戻る。
  const incomplete = builds.filter((build) => !isComplete(build));

  // 着手済みの（＝成果物が1つでもある）ビルドがあれば、その中断点を返す
  for (const build of incomplete) {
    const artifacts = resolve(cycleDirectory, buildArtifacts(build.id));
    if (artifacts.some((artifact) => artifact.present)) {
      return { phase: "building", artifacts, resumeAt: firstMissing(artifacts), builds, mergePending };
    }
  }

  // 未完了が1件も無ければ、このツリーでは全部できていてマージ待ち
  return { phase: "building", artifacts: [], resumeAt: undefined, builds, mergePending };
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
