/**
 * git への問い合わせ。
 *
 * **着手可能・待機の判定には使わない。** 判定の入力は作業ツリーの tasklist.md で、
 * git に問い合わせるのは「マージ済みかどうかのラベル付け」「着手中の検出」
 * 「スタック元の導出」だけ。リモートに到達できなくてもワークフローは止まらず、
 * 到達できないことで判定が変わることもない。
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

type RunResult = { ok: true; stdout: string } | { ok: false; message: string };

/**
 * git を実行し、成否を値で返す。
 *
 * **終了コードだけで判断する。** fatal メッセージは locale 依存なので、
 * 文字列の一致で場合分けしてはいけない（LANG が日本語の環境で壊れる）。
 */
async function tryGit(cwd: string, argv: string[], timeout = 15_000): Promise<RunResult> {
  try {
    const { stdout } = await run("git", argv, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message.split("\n")[0] ?? message };
  }
}

/**
 * 現在のブランチ名。.git を直接読むので git バイナリに依存しない。
 * detached HEAD や .git が見つからない場合は undefined。
 */
export function currentBranch(repoRootPath: string): string | undefined {
  const gitDir = resolveGitDir(repoRootPath);
  if (gitDir === undefined) return undefined;

  const headPath = join(gitDir, "HEAD");
  if (!existsSync(headPath)) return undefined;

  const ref = /^ref:\s*refs\/heads\/(.+)$/m.exec(readFileSync(headPath, "utf8").trim());
  return ref?.[1];
}

/**
 * デフォルトブランチ。origin/HEAD が指す先から導出する。
 *
 * 設定の base_branch が正だが、未設定のときの自動検出をスクリプト側で持つ。
 * origin/HEAD が無いクローンもあるので、分からなければ undefined を返す。
 * 「分からない」を "main" と推測すると、main 以外を使うリポジトリで
 * 「デフォルトブランチ上ではない」と誤判定する。
 */
export function defaultBranch(repoRootPath: string): string | undefined {
  const gitDir = resolveGitDir(repoRootPath);
  if (gitDir === undefined) return undefined;

  const head = join(commonGitDir(gitDir), "refs", "remotes", "origin", "HEAD");
  if (!existsSync(head)) return undefined;

  return /^ref:\s*refs\/remotes\/origin\/(.+)$/m.exec(readFileSync(head, "utf8").trim())?.[1];
}

/** worktree では refs は共有される（HEAD だけが worktree 固有） */
function commonGitDir(gitDir: string): string {
  const pointer = join(gitDir, "commondir");
  if (!existsSync(pointer)) return gitDir;
  const target = readFileSync(pointer, "utf8").trim();
  return isAbsolute(target) ? target : resolve(gitDir, target);
}

/** worktree では .git がファイルで、gitdir: の行が実体を指す */
function resolveGitDir(repoRootPath: string): string | undefined {
  const dotGit = join(repoRootPath, ".git");
  if (!existsSync(dotGit)) return undefined;
  if (statSync(dotGit).isDirectory()) return dotGit;

  const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
  if (pointer === undefined) return undefined;
  return isAbsolute(pointer) ? pointer : resolve(repoRootPath, pointer);
}

/** パスが git の管理下にあるか（.hikyaku.local の取り違え検出に使う） */
export async function isTracked(cwd: string, path: string): Promise<boolean> {
  const result = await tryGit(cwd, ["ls-files", "--error-unmatch", "--", path], 10_000);
  return result.ok && result.stdout.trim() !== "";
}

/** ローカルに保存されている ref のコミット SHA。リモートへは問い合わせない */
export async function localSha(cwd: string, ref: string): Promise<string | undefined> {
  const result = await tryGit(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (!result.ok) return undefined;
  const sha = result.stdout.trim();
  return sha === "" ? undefined : sha;
}

export interface RemoteBranches {
  /** リモートに存在するブランチ名 */
  names: string[];
  /** ブランチ名 → 先端 SHA。ローカルの追跡参照が古いかの判定に使う */
  tips: Map<string, string>;
  /** 取得できなかった場合の理由（着手中の表示だけが落ちる） */
  unavailable: string | undefined;
}

export async function listRemoteBranches(cwd: string): Promise<RemoteBranches> {
  const result = await tryGit(cwd, ["ls-remote", "--heads", "origin"]);
  if (!result.ok) return { names: [], tips: new Map(), unavailable: result.message };

  const tips = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    const [sha = "", ref = ""] = line.split("\t");
    if (!ref.startsWith("refs/heads/")) continue;
    tips.set(ref.slice("refs/heads/".length), sha);
  }
  return { names: [...tips.keys()], tips, unavailable: undefined };
}

/**
 * ローカルの追跡参照がリモートの先端より古いか。
 *
 * `git show origin/{base}:...` はネットワークへ行かず、最後に fetch した時点の
 * ローカルコピーを読む。コンテナがスナップショットを再利用した環境では、
 * この写しだけが数日前を指したまま残ることがある。**判定には使わないが**、
 * マージ済みラベルが古く見える理由として提示する。
 */
export interface BaseFreshness {
  /** リモートの先端（ls-remote に到達できなければ undefined） */
  remote: string | undefined;
  /** ローカルの origin/{base} */
  local: string | undefined;
  /** 一致しないと分かった場合だけ true。判断できなければ undefined */
  stale: boolean | undefined;
}

export async function baseFreshness(
  cwd: string,
  base: string,
  remoteTip: string | undefined,
): Promise<BaseFreshness> {
  const local = await localSha(cwd, `origin/${base}`);
  if (remoteTip === undefined || local === undefined) {
    return { remote: remoteTip, local, stale: undefined };
  }
  return { remote: remoteTip, local, stale: remoteTip !== local };
}

/** ref の tree にファイルが在ったかどうかの3状態 */
export type FileAtRefState = "found" | "absent" | "unreadable";

export interface FileAtRef {
  /**
   * found      … 読めた
   * absent     … **ref は在るがファイルが無い**。「完了しているビルドは0件」と確定できる
   * unreadable … ref 自体が無い / 読めない。本当に不明
   */
  state: FileAtRefState;
  /** found のときの内容 */
  content: string | undefined;
  /** 実際に見た ref（origin/main か main か） */
  ref: string | undefined;
  /** その ref の短縮 SHA */
  sha: string | undefined;
  /** その ref のコミット日時（ISO 8601） */
  committedAt: string | undefined;
  /** unreadable のときの理由 */
  unavailable: string | undefined;
}

/**
 * デフォルトブランチの tree からファイルを読む。
 *
 * **「ファイルが無い」と「ref が読めない」を分ける。** 前者は確定情報で、
 * 「このサイクルはまだデフォルトブランチに出ていない = 完了0件」を意味する。
 * 後者だけが本当の不明で、呼び出し元の縮退が要る。両方を同じ失敗に潰すと、
 * architect の PR が未マージなだけの状態で作業ツリーへ縮退し、
 * ビルドブランチ上の自分の PR 列を「マージ済み」として拾ってしまう。
 *
 * origin/{base} を先に見る。ローカルの {base} は fetch していなければ古い。
 * ただし origin/{base} も「最後に fetch した時点のローカルコピー」であって
 * リモートそのものではないので、鮮度は baseFreshness で別に見る。
 */
export async function readFileAtDefaultBranch(
  cwd: string,
  base: string,
  repoRelativePath: string,
): Promise<FileAtRef> {
  const errors: string[] = [];

  for (const ref of [`origin/${base}`, base]) {
    if ((await localSha(cwd, ref)) === undefined) {
      errors.push(`${ref}: ref がありません`);
      continue;
    }

    const meta = await commitMeta(cwd, ref);
    const exists = await tryGit(cwd, ["cat-file", "-e", `${ref}:${repoRelativePath}`]);
    if (!exists.ok) {
      return {
        state: "absent",
        content: undefined,
        ref,
        sha: meta?.sha,
        committedAt: meta?.committedAt,
        unavailable: undefined,
      };
    }

    const shown = await tryGit(cwd, ["show", `${ref}:${repoRelativePath}`]);
    if (!shown.ok) {
      errors.push(`${ref}: ${shown.message}`);
      continue;
    }

    return {
      state: "found",
      content: shown.stdout,
      ref,
      sha: meta?.sha,
      committedAt: meta?.committedAt,
      unavailable: undefined,
    };
  }

  return {
    state: "unreadable",
    content: undefined,
    ref: undefined,
    sha: undefined,
    committedAt: undefined,
    unavailable: errors.join(" / "),
  };
}

interface CommitMeta {
  sha: string;
  committedAt: string;
}

async function commitMeta(cwd: string, ref: string): Promise<CommitMeta | undefined> {
  const result = await tryGit(cwd, ["show", "-s", "--format=%h%x09%cI", ref]);
  if (!result.ok) return undefined;
  const [sha = "", committedAt = ""] = result.stdout.trim().split("\t");
  return sha === "" ? undefined : { sha, committedAt };
}

export interface KnownBranch {
  /** 解決に使う ref（リモート追跡参照があればそちら） */
  ref: string;
  /** ブランチ名（origin/ を剥がしたもの） */
  name: string;
}

/**
 * ローカルのブランチとリモート追跡参照を列挙する。ネットワークへは行かない。
 *
 * 同名がローカルとリモートの両方にあればリモート追跡参照を採る。
 * PR の base に使うのはリモート側のブランチだから。
 */
export async function listKnownBranches(cwd: string): Promise<KnownBranch[]> {
  const result = await tryGit(cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes/origin",
  ]);
  if (!result.ok) return [];

  const found = new Map<string, string>();
  for (const raw of result.stdout.split("\n")) {
    const short = raw.trim();
    if (short === "" || short === "origin/HEAD") continue;
    if (short.startsWith("origin/")) {
      found.set(short.slice("origin/".length), short);
    } else if (!found.has(short)) {
      found.set(short, short);
    }
  }
  return [...found].map(([name, ref]) => ({ name, ref }));
}

/** ancestor が descendant の履歴に含まれているか */
export async function isAncestor(
  cwd: string,
  ancestorRef: string,
  descendantRef: string,
): Promise<boolean> {
  const result = await tryGit(cwd, ["merge-base", "--is-ancestor", ancestorRef, descendantRef]);
  return result.ok;
}

/**
 * 候補のうち、HEAD の履歴に含まれていて**最も近い**ものを返す。
 *
 * スタック（デフォルトブランチへマージせず、先行ビルドのブランチから積む）の
 * 検出に使う。状態を保存せず、ブランチの祖先関係から導出する。
 *
 * **既に base に取り込まれている候補は除く。** マージ済みのブランチも HEAD の
 * 祖先になるため、除かないと「main から切っただけ」をスタックと誤判定する。
 * base 側は origin/{base} とローカル {base} の両方を見る。片方が古くても
 * もう片方が取り込みを知っていれば誤判定を避けられる。
 *
 * 近さは HEAD までのコミット数で測る。build-01 → build-02 → build-03 と
 * 積んだとき、build-03 から見れば build-01 も祖先だが、PR の base にすべきは
 * 直前の build-02 だけ。
 */
export async function nearestAncestorBranch(
  cwd: string,
  candidates: KnownBranch[],
  baseRefs: string[],
  head = "HEAD",
): Promise<KnownBranch | undefined> {
  let nearest: { branch: KnownBranch; distance: number } | undefined;

  for (const candidate of candidates) {
    if (!(await isAncestor(cwd, candidate.ref, head))) continue;

    let merged = false;
    for (const baseRef of baseRefs) {
      if (await isAncestor(cwd, candidate.ref, baseRef)) {
        merged = true;
        break;
      }
    }
    if (merged) continue;

    const counted = await tryGit(cwd, ["rev-list", "--count", `${candidate.ref}..${head}`]);
    if (!counted.ok) continue;
    const distance = Number.parseInt(counted.stdout.trim(), 10);
    if (!Number.isInteger(distance)) continue;

    if (nearest === undefined || distance < nearest.distance) {
      nearest = { branch: candidate, distance };
    }
  }

  return nearest?.branch;
}
