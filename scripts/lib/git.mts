/**
 * git への問い合わせ。
 *
 * 着手中の検出にだけリモートを使う。着手可能・待機の判定は
 * main 上の tasklist.md の PR 列だけで行うため、リモートに到達できなくても
 * ワークフローは止まらない。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

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
