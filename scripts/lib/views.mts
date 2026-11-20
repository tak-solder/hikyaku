/**
 * tasklist.md と完了の記録の3つの断面。
 *
 * 同じファイルを3つの断面で読み、buildID で突き合わせる。どれを読むかは
 * 「ファイルの中身が何についての主張か」で決まる。完了は、PR 列と各ビルドの
 * 完了の記録（build-NN/progress.jsonl の builder の pr の done）のどちらかで読む（tasklist.mts）。
 *
 *   一覧・依存グラフ         作業ツリー   これから作るものなので、新しいほど良い
 *   完了の記録（着手判定）   HEAD         「実装が自分の履歴に在る」という主張。
 *                                        記録は実装と同じブランチにコミットされるため、
 *                                        HEAD に在ることがそのまま実装が在ることを意味する
 *   完了の記録（マージ済み） origin/base  「リポジトリ全体に取り込まれた」という主張
 *
 * 着手判定と中断点は HEAD までで閉じるので、ネットワークにもリモート追跡参照にも
 * 依存しない。**先行ビルドのブランチから積んでいても（スタックしていても）、
 * その成果は HEAD の履歴に在るので着手できる。** base を見るのは
 * 「マージされたか」を問う用途だけ。
 */

import type { ResolvedConfig } from "./config.mts";
import { posix } from "node:path";
import {
  baseFreshness,
  defaultBranch,
  fetchBaseRef,
  readFileAtDefaultBranch,
  readFileAtRef,
  readFilesAtRef,
  type BaseFreshness,
  type FileAtRef,
} from "./git.mts";
import { repoRelative } from "./paths.mts";
import { parseProgress } from "./progress.mts";
import { completionRecordPath, parseTasklist, tasklistPath, withRecordedPrs, type BuildRecord } from "./tasklist.mts";
import type { CycleContext } from "./workspace.mts";

/** ある断面をどう読めたか */
export interface Section {
  /**
   * ref      … その ref の tasklist を読めた
   * absent   … ref は在るが tasklist が無い（＝その断面には1件も無いと確定）
   * worktree … 読めず、作業ツリーへ縮退した
   */
  source: "ref" | "absent" | "worktree";
  ref: string | undefined;
  sha: string | undefined;
  committedAt: string | undefined;
  unavailable: string | undefined;
}

export interface TasklistViews {
  /** 一覧は作業ツリー、完了は HEAD。着手判定と中断点はこれを使う */
  builds: BuildRecord[];
  head: Section;
  base: Section;
  /** base で完了しているビルド。**base が不明なら undefined**（空集合ではない） */
  mergedIds: Set<string> | undefined;
  baseBranch: string | undefined;
  freshness: BaseFreshness;
  /** 追跡参照を更新したか */
  fetched: boolean;
  /** 判定に使った tasklist のリポジトリ相対パス */
  relativePath: string;
}

export interface ViewOptions {
  /** ls-remote で得たリモートの先端。鮮度判定と fetch の要否に使う */
  remoteTips?: Map<string, string> | undefined;
  /** 古いと分かったときに追跡参照を更新するか（既定 true） */
  fetch?: boolean | undefined;
}

/** 1プロセス内で同じ base を何度も fetch しない（cycle list は全サイクルを回る） */
const fetchedBases = new Set<string>();

export async function resolveViews(
  config: ResolvedConfig,
  ctx: CycleContext,
  options: ViewOptions = {},
): Promise<TasklistViews> {
  const relativePath = repoRelative(config.repoRoot, tasklistPath(ctx.directory));
  const base = config.baseBranch ?? defaultBranch(config.repoRoot);

  const head = await toSection(config.repoRoot, await readFileAtRef(config.repoRoot, "HEAD", relativePath), relativePath);
  const builds =
    head.prs === undefined
      ? ctx.builds
      : ctx.builds.map((build) => withPr(build, head.prs?.get(build.id)));

  if (base === undefined) {
    return {
      builds,
      head: head.section,
      base: {
        source: "worktree",
        ref: undefined,
        sha: undefined,
        committedAt: undefined,
        unavailable: "デフォルトブランチを特定できません",
      },
      mergedIds: undefined,
      baseBranch: undefined,
      freshness: { remote: undefined, local: undefined, stale: undefined },
      fetched: false,
      relativePath,
    };
  }

  let freshness = await baseFreshness(config.repoRoot, base, options.remoteTips?.get(base));
  let fetched = false;
  const key = `${config.repoRoot}::${base}`;
  if (options.fetch !== false && freshness.stale === true && !fetchedBases.has(key)) {
    fetchedBases.add(key);
    if ((await fetchBaseRef(config.repoRoot, base)).ok) {
      fetched = true;
      freshness = await baseFreshness(config.repoRoot, base, options.remoteTips?.get(base));
    }
  }

  const merged = await toSection(config.repoRoot, await readFileAtDefaultBranch(config.repoRoot, base, relativePath), relativePath);
  const mergedIds =
    merged.prs === undefined
      ? undefined
      : new Set([...merged.prs].filter(([, read]) => read.pr !== "").map(([id]) => id));

  return {
    builds,
    head: head.section,
    base: merged.section,
    mergedIds,
    baseBranch: base,
    freshness,
    fetched,
    relativePath,
  };
}

/** 作業ツリーの一覧に、ある断面で読んだ完了を重ねる */
function withPr(build: BuildRecord, read: { pr: string; prSource: "record" | undefined } | undefined): BuildRecord {
  const { prSource: _worktree, ...rest } = build;
  if (read === undefined || read.pr === "") return { ...rest, pr: "" };
  return read.prSource === undefined ? { ...rest, pr: read.pr } : { ...rest, pr: read.pr, prSource: read.prSource };
}

/**
 * ref の tasklist.md（読んだ結果）に、同じ ref の各ビルドの完了の記録を重ねる。
 * 記録を読めない（git を実行できない・壊れた行がある）ときは投げる
 */
export async function buildsAtRef(repoRoot: string, file: FileAtRef & { state: "found" }, tasklistRelativePath: string): Promise<BuildRecord[]> {
  const builds = parseTasklist(file.content ?? "");
  const cycleRelative = posix.dirname(tasklistRelativePath);
  const pending = builds.filter((build) => build.pr === "");
  const paths = pending.map((build) => posix.join(cycleRelative, completionRecordPath(build.id)));
  const files = await readFilesAtRef(repoRoot, file.ref ?? "HEAD", paths);
  if (files === undefined) throw new Error(`${file.ref ?? "HEAD"} の完了の記録を読めません`);
  return withRecordedPrs(builds, (id) => {
    const path = posix.join(cycleRelative, completionRecordPath(id));
    const text = files.get(path);
    return text === undefined ? [] : parseProgress(text, `${file.ref ?? "HEAD"}:${path}`);
  });
}

/**
 * 読み取り結果を「完了の対応表」と「出所」に分ける。
 *
 * prs が undefined なのは**本当に不明なときだけ**。ファイルが無い（absent）は
 * 「1件も無い」という確定情報なので空の対応表を返す。ここを undefined にすると
 * 呼び出し元が作業ツリーへ縮退し、ビルドブランチ上の自分の完了の記録を拾ってしまう。
 */
async function toSection(
  repoRoot: string,
  file: FileAtRef,
  relativePath: string,
): Promise<{ prs: Map<string, { pr: string; prSource: "record" | undefined }> | undefined; section: Section }> {
  const at = { ref: file.ref, sha: file.sha, committedAt: file.committedAt };

  if (file.state === "absent") {
    return { prs: new Map(), section: { source: "absent", ...at, unavailable: undefined } };
  }

  if (file.state === "found") {
    try {
      const builds = await buildsAtRef(repoRoot, { ...file, state: "found" }, relativePath);
      const prs = new Map(builds.map((build) => [build.id, { pr: build.pr, prSource: build.prSource }]));
      return { prs, section: { source: "ref", ...at, unavailable: undefined } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { prs: undefined, section: degraded(message.split("\n")[0] ?? message) };
    }
  }

  return { prs: undefined, section: degraded(file.unavailable) };
}

function degraded(unavailable: string | undefined): Section {
  return { source: "worktree", ref: undefined, sha: undefined, committedAt: undefined, unavailable };
}

/** 「この断面をいつ時点の何から読んだか」の1行 */
export function sectionNote(label: string, section: Section, suffix = ""): string {
  if (section.source === "worktree") {
    return `${label}: 不明（${section.unavailable ?? "読めません"}）。作業ツリーに縮退しています`;
  }
  const stamp = section.committedAt === undefined ? "" : `, ${section.committedAt.slice(0, 10)}`;
  const at = `${section.ref}（${section.sha ?? "?"}${stamp}）`;
  return section.source === "absent"
    ? `${label}: ${at} に tasklist.md がまだありません（0件として扱いました）`
    : `${label}: ${at}${suffix}`;
}
