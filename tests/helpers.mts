import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { BuildRecord } from "../scripts/lib/tasklist.mts";
import type { CycleRecord } from "../scripts/lib/cycles.mts";

const cliPath = fileURLToPath(new URL("../scripts/hikyaku.mts", import.meta.url));
const scriptsDirectory = fileURLToPath(new URL("../scripts/", import.meta.url));
const loaderUrl = new URL("./cli-loader.mjs", import.meta.url).href;

/** テストの実行が終わったら消す一時ディレクトリ（テストをまたいで使い回すもの） */
function processDirectory(prefix: string): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

let stripped: string | undefined;

/**
 * scripts/ の .mts を型剥がしした結果を、中身のハッシュを名前にして一時ディレクトリへ書く。
 * CLI の子プロセスは cli-loader.mjs がこれを読み、起動のたびの型剥がしを省く（テストを速くするためだけのもの）
 */
function strippedScripts(): string {
  if (stripped !== undefined) return stripped;
  const directory = processDirectory("hikyaku-stripped-");
  // stripTypeScriptTypes は試験的な機能の警告を出す。テストの出力を汚さないよう、この間だけ黙らせる
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {};
  try {
    for (const entry of readdirSync(scriptsDirectory, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".mts")) continue;
      const source = readFileSync(join(entry.parentPath, entry.name), "utf8");
      const hash = createHash("sha1").update(source).digest("hex");
      writeFileSync(join(directory, `${hash}.mjs`), stripTypeScriptTypes(source), "utf8");
    }
  } finally {
    process.emitWarning = emitWarning;
  }
  stripped = directory;
  return directory;
}

function spawnCli(directory: string, extraEnv: NodeJS.ProcessEnv, args: string[], input?: string) {
  const result = spawnSync(process.execPath, ["--import", loaderUrl, cliPath, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: { ...testEnvironment(), HIKYAKU_TEST_STRIPPED: strippedScripts(), ...extraEnv },
    timeout: 10_000,
    ...(input === undefined ? {} : { input }),
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

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
  return initRepository(temporaryDirectory(t));
}

function initRepository(directory: string): string {
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
  return spawnCli(directory, extraEnv, args);
}

/** 標準入力を渡して CLI を実行する（フックの入力など） */
export function cliInput(directory: string, input: string, extraEnv: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnCli(directory, extraEnv, args, input);
}

export function succeeds(directory: string, ...args: string[]): string {
  const result = cli(directory, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const workspaceTemplates = new Map<boolean, string>();

/** init 済みの一時リポジトリ。init と cycle new は1回だけ実行し、以降はその結果を写す */
export function workspace(t: TestContext, withCycle = false): string {
  let template = workspaceTemplates.get(withCycle);
  if (template === undefined) {
    template = initRepository(processDirectory("hikyaku-template-"));
    succeeds(template, "init", "--root", "docs/hikyaku");
    if (withCycle) succeeds(template, "cycle", "new", "test", "--profile", "standard");
    workspaceTemplates.set(withCycle, template);
  }
  const directory = temporaryDirectory(t);
  cpSync(template, directory, { recursive: true });
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

/** 中間レビュー（countsFindings）の done に添える件数。planner の review は呼び出し側で添える（builder の review と同じ ID のため） */
export function findingCounts(step: string | undefined): string[] {
  return step !== undefined && ["architecture-review", "tasklist-review", "plan-review", "test-spec-review"].includes(step)
    ? ["--findings", "0", "--adopted", "0"]
    : [];
}
