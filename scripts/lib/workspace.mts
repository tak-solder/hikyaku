/** サイクルの解決とファイル書き込みの共通処理 */

import { writeFileSync } from "node:fs";
import { cycleDir, cycleDirName, loadCycles, type CycleRecord } from "./cycles.mts";
import { HikyakuError } from "./errors.mts";
import { loadTasklist, renderTasklistFile, tasklistPath, type BuildRecord } from "./tasklist.mts";

export interface CycleContext {
  record: CycleRecord;
  name: string;
  directory: string;
  builds: BuildRecord[];
}

/** ID / slug / ディレクトリ名 のいずれでもサイクルを引ける */
export function resolveCycle(hikyakuRoot: string, key: string | undefined): CycleContext {
  const records = loadCycles(hikyakuRoot);
  if (records.length === 0) {
    throw new HikyakuError(
      "サイクルがまだありません",
      "/hikyaku:create-cycle で作成してください。",
    );
  }

  let record: CycleRecord | undefined;
  if (key === undefined) {
    const active = records.filter((r) => r.status === "active");
    if (active.length === 1) {
      record = active[0];
    } else if (active.length === 0) {
      throw new HikyakuError(
        "進行中のサイクルがありません",
        "サイクルを明示するか、/hikyaku:create-cycle で作成してください。",
      );
    } else {
      throw new HikyakuError(
        "進行中のサイクルが複数あります。対象を指定してください",
        active.map((r) => `  ${cycleDirName(r)}`).join("\n"),
      );
    }
  } else {
    record = records.find(
      (r) => r.id === key || r.slug === key || cycleDirName(r) === key,
    );
  }

  if (!record) {
    throw new HikyakuError(
      `サイクルが見つかりません: ${key}`,
      "hikyaku cycle list で一覧を確認してください。",
    );
  }

  const directory = cycleDir(hikyakuRoot, record);
  return { record, name: cycleDirName(record), directory, builds: loadTasklist(directory) };
}

export function writeTasklist(context: CycleContext, builds: BuildRecord[]): void {
  writeFileSync(tasklistPath(context.directory), renderTasklistFile(context.name, builds), "utf8");
}
