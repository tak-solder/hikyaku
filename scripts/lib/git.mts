/**
 * git への問い合わせ。
 *
 * 着手中の検出にだけリモートを使う。着手可能・待機の判定は
 * main 上の tasklist.md の PR 列だけで行うため、リモートに到達できなくても
 * ワークフローは止まらない。
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

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
  try {
    const { stdout } = await run("git", ["ls-files", "--error-unmatch", "--", path], {
      cwd,
      timeout: 10_000,
    });
    return stdout.trim() !== "";
  } catch {
    return false;
  }
}

export interface RemoteBranches {
  /** リモートに存在するブランチ名 */
  names: string[];
  /** 取得できなかった場合の理由（着手中の表示だけが落ちる） */
  unavailable: string | undefined;
}

export async function listRemoteBranches(cwd: string): Promise<RemoteBranches> {
  try {
    const { stdout } = await run("git", ["ls-remote", "--heads", "origin"], {
      cwd,
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const names = stdout
      .split("\n")
      .map((line) => line.split("\t")[1] ?? "")
      .filter((ref) => ref.startsWith("refs/heads/"))
      .map((ref) => ref.slice("refs/heads/".length));
    return { names, unavailable: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { names: [], unavailable: message };
  }
}
