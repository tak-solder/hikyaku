/**
 * tasklist.md の3つの断面。
 *
 * 同じファイルを3つの断面で読み、buildID で突き合わせる。どれを読むかは
 * 「ファイルの中身が何についての主張か」で決まる。
 *
 *   一覧・依存グラフ   作業ツリー   これから作るものなので、新しいほど良い
 *   PR 列（着手判定）  HEAD         「実装が自分の履歴に在る」という主張。
 *                                  PR 列の更新は実装と同じコミットに同梱されるため、
 *                                  HEAD に在ることがそのまま実装が在ることを意味する
 *   PR 列（マージ済み） origin/base 「リポジトリ全体に取り込まれた」という主張
 *
 * 着手判定と中断点は HEAD までで閉じるので、ネットワークにもリモート追跡参照にも
 * 依存しない。**先行ビルドのブランチから積んでいても（スタックしていても）、
 * その成果は HEAD の履歴に在るので着手できる。** base を見るのは
 * 「マージされたか」を問う用途だけ。
 */

import { relative } from "node:path";
import type { ResolvedConfig } from "./config.mts";
import {
  baseFreshness,
  defaultBranch,
  fetchBaseRef,
  readFileAtDefaultBranch,
  readFileAtRef,
  type BaseFreshness,
  type FileAtRef,
} from "./git.mts";
import { parseTasklist, tasklistPath, type BuildRecord } from "./tasklist.mts";
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
  /** 一覧は作業ツリー、PR 列は HEAD。着手判定と中断点はこれを使う */
  builds: BuildRecord[];
  head: Section;
  base: Section;
  /** base で PR 列が非空のビルド。**base が不明なら undefined**（空集合ではない） */
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
  const relativePath = relative(config.repoRoot, tasklistPath(ctx.directory));
  const base = config.baseBranch ?? defaultBranch(config.repoRoot);

  const head = toSection(await readFileAtRef(config.repoRoot, "HEAD", relativePath));
  const builds =
    head.prs === undefined
      ? ctx.builds
      : ctx.builds.map((build) => ({ ...build, pr: head.prs?.get(build.id) ?? "" }));

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

  const merged = toSection(await readFileAtDefaultBranch(config.repoRoot, base, relativePath));
  const mergedIds =
    merged.prs === undefined
      ? undefined
      : new Set([...merged.prs].filter(([, pr]) => pr !== "").map(([id]) => id));

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

/**
 * 読み取り結果を「PR 列の対応表」と「出所」に分ける。
 *
 * prs が undefined なのは**本当に不明なときだけ**。ファイルが無い（absent）は
 * 「1件も無い」という確定情報なので空の対応表を返す。ここを undefined にすると
 * 呼び出し元が作業ツリーへ縮退し、ビルドブランチ上の自分の PR 列を拾ってしまう。
 */
function toSection(file: FileAtRef): { prs: Map<string, string> | undefined; section: Section } {
  const at = { ref: file.ref, sha: file.sha, committedAt: file.committedAt };

  if (file.state === "absent") {
    return { prs: new Map(), section: { source: "absent", ...at, unavailable: undefined } };
  }

  if (file.state === "found") {
    try {
      const prs = new Map(parseTasklist(file.content ?? "").map((build) => [build.id, build.pr]));
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
