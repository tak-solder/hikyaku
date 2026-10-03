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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDirName, isComplete, normalizeBuildId, type BuildRecord } from "./tasklist.mts";
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
  /** 作業ツリーに差し戻しの記録があれば、その内容。無ければ undefined */
  returned?: ReturnRecord | undefined;
}

/**
 * 差し戻しの記録（{cycle}/return.md）。
 *
 * builder が設計の前提が崩れたと判断したときに書き、差し戻し元のビルドの
 * ブランチにだけコミットする（デフォルトブランチにはマージしない）。
 * architect が再設計の最後に削除するので、「ファイルがある」こと自体が
 * 差し戻し中を意味する。他のブランチは読まない。差し戻しに気づくのは、
 * 差し戻しを受けた人と、そのブランチで動くスキルだけでよいため。
 */
export const RETURN_FILE = "return.md";

export interface ReturnRecord {
  /** 差し戻し元のビルド ID。見出しから読めなければ undefined */
  buildId: string | undefined;
}

/** 差し戻し元は見出し（`# 差し戻し: build-NN`）から読む。中身の他の部分は解釈しない */
const RETURN_HEADING = /^#\s*差し戻し\s*[:：]\s*(build-\d+)/m;

export function readReturn(cycleDirectory: string): ReturnRecord | undefined {
  const path = join(cycleDirectory, RETURN_FILE);
  if (!existsSync(path)) return undefined;
  const match = RETURN_HEADING.exec(readFileSync(path, "utf8"));
  return { buildId: match?.[1] === undefined ? undefined : normalizeBuildId(match[1]) };
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

  // 差し戻し中は、設計がそろっていてもビルドを進められない。フェーズは building の
  // まま（サイクルとしてはビルドの途中）にし、差し戻しの記録を添えて返す。
  // completed より先に見るのは、差し戻し元のブランチでは完了判定より再設計が先だから
  const returned = readReturn(cycleDirectory);
  if (returned !== undefined) {
    const target = builds.find((build) => build.id === returned.buildId);
    const artifacts = target === undefined ? [] : resolve(cycleDirectory, buildArtifacts(target.id));
    return { phase: "building", artifacts, resumeAt: undefined, builds, mergePending, returned };
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

/**
 * 状態に対応する次の実行コマンドの案内。差し戻し中なら、差し戻し元を指定した architect。
 * 差し戻し元を読めなければビルドを付けない（architect が記録を読んで確かめる）
 */
export function suggestFor(state: CycleState, cycle: string): string {
  if (state.returned === undefined) return suggestCommand(state.phase, cycle);
  const build = state.returned.buildId;
  return build === undefined
    ? `/hikyaku:architect ${cycle}`
    : `/hikyaku:architect ${cycle} ${buildDirName(build)}`;
}

/** 表示用のフェーズ。差し戻し中はフェーズの値を変えずに注記する */
export function phaseLabel(state: CycleState): string {
  if (state.returned === undefined) return state.phase;
  const build = state.returned.buildId;
  return `${state.phase}（差し戻し中${build === undefined ? "" : `: ${buildDirName(build)}`}）`;
}
