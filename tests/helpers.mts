import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
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
  return { id, title: `ビルド ${id}`, bp: 2, dependsOn: [], issue: "", pr: "", ...overrides };
}

export function cycle(id = "001", overrides: Partial<CycleRecord> = {}): CycleRecord {
  return {
    id, slug: "test", status: "active", profile: "standard", hikyaku: "2.1.0",
    ticket: "", external: "", dependsOn: [], started: "2026-10-03", finished: "", summary: "", ...overrides,
  };
}
