/** サイクルの解決とファイル書き込みの共通処理 */

import { existsSync, writeFileSync } from "node:fs";
import { flagString, type ParsedArgs } from "./args.mts";
import { parseBranch, type BranchNaming } from "./branch.mts";
import { loadConfig, type ResolvedConfig } from "./config.mts";
import {
  cycleDir,
  cycleDirName,
  cyclesPath,
  findCycleByKey,
  loadCycles,
  type CycleRecord,
} from "./cycles.mts";
import { HikyakuError } from "./errors.mts";
import { currentBranch } from "./git.mts";
import { readLocalState } from "./local.mts";
import { loadTasklist, renderTasklistFile, tasklistPath, type BuildRecord } from "./tasklist.mts";

/** 対象サイクルをどう決めたか。スキルが根拠を表示できるようにする */
export type CycleSource = "explicit" | "branch" | "local" | "single-active";

export interface CycleContext {
  record: CycleRecord;
  name: string;
  directory: string;
  builds: BuildRecord[];
  source: CycleSource;
}

export interface ResolveOptions {
  /** ブランチ名の解析に使う命名規則 */
  branch?: BranchNaming | undefined;
  /** 現在のブランチ名 */
  currentBranch?: string | undefined;
  /** .hikyaku.local に記録されたサイクル */
  local?: string | undefined;
}

/**
 * 対象サイクルを決める。優先順位:
 *
 *   1. 明示指定             引数で渡された ID / slug / ディレクトリ名
 *   2. 現在のブランチ       そのブランチに居る以上に強い根拠は無い
 *   3. .hikyaku.local       このチェックアウトで最後に作業したサイクル（active のみ）
 *   4. active が1つだけ     迷いようがない
 *
 * どれでも決まらなければ候補を挙げてエラーにする。ここは人間に尋ねる場面であって、
 * スクリプトが推測してよい場面ではない（誤ると別サイクルへコミットする）。
 */
export function resolveCycle(
  hikyakuRoot: string,
  key: string | undefined,
  options: ResolveOptions = {},
): CycleContext {
  const records = loadCycles(hikyakuRoot);
  if (records.length === 0) {
    throw new HikyakuError(
      "サイクルがまだありません",
      "/hikyaku:create-cycle で作成してください。",
    );
  }

  if (key !== undefined) {
    const record = findCycleByKey(records, key);
    if (!record) {
      throw new HikyakuError(
        `サイクルが見つかりません: ${key}`,
        "hikyaku cycle list で一覧を確認してください。",
      );
    }
    return context(hikyakuRoot, record, "explicit");
  }

  // 2. 現在のブランチ。close フェーズもあるので status は問わない
  if (options.branch && options.currentBranch !== undefined) {
    const parsed = parseBranch(options.branch, options.currentBranch);
    const record = parsed?.cycle === undefined ? undefined : findCycleByKey(records, parsed.cycle);
    if (record) return context(hikyakuRoot, record, "branch");
  }

  // 3. ローカルの栞。指す先が active でなければ黙って捨てる。
  // ここは active に限って引く（栞の曖昧さでエラーにはしない。無効なら捨てて次へ）
  if (options.local !== undefined) {
    const key = options.local;
    const record = records.find(
      (r) => r.status === "active" && (r.id === key || r.slug === key || cycleDirName(r) === key),
    );
    if (record) return context(hikyakuRoot, record, "local");
  }

  const active = records.filter((r) => r.status === "active");
  if (active.length === 1) return context(hikyakuRoot, active[0] as CycleRecord, "single-active");

  if (active.length === 0) {
    throw new HikyakuError(
      "進行中のサイクルがありません",
      "サイクルを明示するか、/hikyaku:create-cycle で作成してください。",
    );
  }

  throw new HikyakuError(
    "対象サイクルを決められません",
    [
      "進行中のサイクル:",
      ...active.map((r) => `  ${cycleDirName(r)}  ${r.summary || "（要約なし）"}`),
      "",
      "どのサイクルで作業するかをユーザーに尋ね、引数で指定し直してください。",
      "選んだサイクルは hikyaku cycle use で記録すると、次回から尋ねずに済みます。",
    ].join("\n"),
  );
}

function context(hikyakuRoot: string, record: CycleRecord, source: CycleSource): CycleContext {
  const directory = cycleDir(hikyakuRoot, record);
  return {
    record,
    name: cycleDirName(record),
    directory,
    builds: loadTasklist(directory),
    source,
  };
}

/** source を人間可読な根拠にする */
export function describeSource(source: CycleSource): string {
  if (source === "explicit") return "引数で指定";
  if (source === "branch") return "現在のブランチから決定";
  if (source === "local") return "前回の作業サイクル（.hikyaku.local）";
  return "唯一の進行中サイクル";
}

export interface OpenedCycle {
  /** サイクル固有設定を重ねた設定 */
  config: ResolvedConfig;
  context: CycleContext;
}

/**
 * 設定を読み、対象サイクルを解決し、そのサイクルの設定を重ねて返す。
 *
 * 設定を2度読むことになるが、サイクルが決まるまでサイクル設定は読めず、
 * サイクルの解決にはブランチ命名規則（＝設定）が要る。TOML は小さいので
 * 素直に2度読む。
 */
export function openCycle(args: ParsedArgs, key: string | undefined): OpenedCycle {
  const root = flagString(args, "root");
  const base = loadConfig({ root });
  const ctx = resolveCycle(base.hikyakuRoot, key, {
    branch: base.branch,
    currentBranch: currentBranch(base.repoRoot),
    local: readLocalState(base.hikyakuRoot).cycle,
  });
  const config = loadConfig({
    root,
    cycleDir: ctx.directory,
    profileOverride: flagString(args, "profile") ?? (ctx.record.profile || undefined),
  });
  return { config, context: ctx };
}

/** サイクルがまだ1つも無い場合だけ undefined を返す（init / create-cycle 用） */
export function openCycleIfAny(args: ParsedArgs, key: string | undefined): OpenedCycle | undefined {
  const base = loadConfig({ root: flagString(args, "root") });
  const path = cyclesPath(base.hikyakuRoot);
  if (!existsSync(path) || loadCycles(base.hikyakuRoot).length === 0) return undefined;
  return openCycle(args, key);
}

export function writeTasklist(context: CycleContext, builds: BuildRecord[]): void {
  writeFileSync(tasklistPath(context.directory), renderTasklistFile(context.name, builds), "utf8");
}
