import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { BuildRecord } from "../scripts/lib/tasklist.mts";
import type { CycleRecord } from "../scripts/lib/cycles.mts";

const cliPath = fileURLToPath(new URL("../scripts/hikyaku.mts", import.meta.url));

export function temporaryDirectory(t: TestContext): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "hikyaku-test-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// 呼び出し元の Git 設定・リポジトリ指定を一時リポジトリへ持ち込まない。
export function testEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_") && key !== "GIT_CONFIG_GLOBAL" && key !== "GIT_CONFIG_NOSYSTEM") delete env[key];
  }
  // 開発者のシェルのレビュー設定をテストに持ち込まない
  delete env["HIKYAKU_REVIEW_PROVIDER"];
  delete env["HIKYAKU_CONDUCTOR_CHILD"];
  delete env["CLAUDE_CODE_REMOTE"];
  // 実行中のセッションの記録を tokens session に読ませない
  for (const key of ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CONFIG_DIR"]) {
    delete env[key];
  }
  return env;
}

export function repository(t: TestContext): string {
  const directory = temporaryDirectory(t);
  const result = spawnSync("git", ["init", "--quiet", "--initial-branch=main", directory], {
    encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return directory;
}

export function cli(directory: string, ...args: string[]) {
  return cliWith(directory, {}, ...args);
}

/** 環境変数を足して CLI を実行する（tokens session の記録の場所を一時ディレクトリへ向ける等） */
export function cliWith(directory: string, extraEnv: NodeJS.ProcessEnv, ...args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: directory, encoding: "utf8", env: { ...testEnvironment(), ...extraEnv }, timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

/** 標準入力を渡して CLI を実行する（フックの入力など） */
export function cliInput(directory: string, input: string, extraEnv: NodeJS.ProcessEnv, ...args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: directory, encoding: "utf8", env: { ...testEnvironment(), ...extraEnv }, input, timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

export function succeeds(directory: string, ...args: string[]): string {
  const result = cli(directory, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

export function workspace(t: TestContext, withCycle = false): string {
  const directory = repository(t);
  succeeds(directory, "init", "--root", "docs/hikyaku");
  if (withCycle) succeeds(directory, "cycle", "new", "test", "--profile", "standard");
  return directory;
}

export function write(directory: string, path: string, content = "# テスト成果物\n"): void {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

/**
 * gh が無い環境で CLI を実行する。開発環境には本物の gh があるので、PATH を git だけのディレクトリに差し替える
 * （CLI は process.execPath で起動するので node は PATH に要らない）
 */
export function withoutGh(t: TestContext, directory: string, ...args: string[]) {
  const bin = mkdtempSync(join(tmpdir(), "hikyaku-nogh-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const git = (process.env["PATH"] ?? "").split(":").map((entry) => join(entry, "git")).find((path) => existsSync(path));
  if (git !== undefined) symlinkSync(git, join(bin, "git"));
  return cliWith(directory, { PATH: bin }, ...args);
}

/** 行き詰まりの報告の3つの節（試したこと / 問題を変える選択肢と失うもの / 推奨）がそろった本文 */
export const ESCALATION_BODY = [
  "## 試したこと",
  "",
  "- タイムアウトを 30s に延ばした",
  "",
  "## 問題を変える選択肢",
  "",
  "- スコープから CSV 出力を外す 失うもの: CSV での取り込み",
  "",
  "## 推奨",
  "",
  "CSV 出力を外す",
  "",
].join("\n");

/** 3つの節がそろった return.md（見出しの差し戻し元だけを変える） */
export function returnRecord(heading = "# 差し戻し: build-01"): string {
  return `${heading}\n\n## 何が崩れたか\n\n- 設計と要件が両立しない\n\n${ESCALATION_BODY}`;
}

/** Git 管理情報以外のファイルを比較し、予期しない書き込みも検出する。 */
export function snapshot(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (relative: string): void => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      if (relative === "" && entry.name === ".git") continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[path] = readFileSync(join(directory, path), "utf8");
    }
  };
  visit("");
  return files;
}

export function build(id: string, overrides: Partial<BuildRecord> = {}): BuildRecord {
  return { id, title: `ビルド ${id}`, peak: 350_000, dependsOn: [], pr: "", ...overrides };
}

export function cycle(id = "001", overrides: Partial<CycleRecord> = {}): CycleRecord {
  return {
    id, slug: "test", status: "active", profile: "standard", hikyaku: "2.1.0",
    ticket: "", external: "", dependsOn: [], started: "2026-10-03", finished: "", summary: "", ...overrides,
  };
}
