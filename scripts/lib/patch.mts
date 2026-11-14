/**
 * patch（/hikyaku:patch）の作業単位の場所と、関連するサイクルの導出。
 *
 * patch はサイクルを要しない小さな変更で、記録（progress.jsonl）は patches/{YYYYMM}/{slug}/ に置く。
 *
 *   サイクルに属さない        {HIKYAKU_ROOT}/patches/{YYYYMM}/{slug}/
 *   進行中のサイクルに属す    {HIKYAKU_ROOT}/cycles/{NNN}-{slug}/patches/{YYYYMM}/{slug}/
 *
 * どちらに属すかは保存しない。サイクルを明示されなければ、進行中のサイクルのうち
 * そのディレクトリを持つものを探して決める（最初の報告より前は、明示されたときだけサイクルに属す）。
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parsePatchPhase, type Phase } from "./branch.mts";
import { cycleDir, cycleDirName, cyclesPath, loadCycles, type CycleRecord } from "./cycles.mts";
import { HikyakuError } from "./errors.mts";

export const PATCHES_DIR = "patches";

/** 作業単位のディレクトリ（サイクルのディレクトリか HIKYAKU_ROOT からの相対パス） */
export function patchUnitDirectory(phase: string): string | undefined {
  const id = parsePatchPhase(phase);
  return id === undefined ? undefined : join(PATCHES_DIR, id.month, id.slug);
}

/** patches/{YYYYMM}/{slug} の相対パスから、patch のフェーズを逆に引く */
export function patchPhaseOf(relative: string): Phase | undefined {
  const parts = relative.split(/[\\/]/);
  if (parts.length !== 3 || parts[0] !== PATCHES_DIR) return undefined;
  const phase = `patch-${parts[1]}-${parts[2]}`;
  return parsePatchPhase(phase) === undefined ? undefined : phase as Phase;
}

/** その base（サイクルのディレクトリか HIKYAKU_ROOT）の下にある patch の作業単位（相対パス） */
export function listPatchUnits(base: string): string[] {
  const root = join(base, PATCHES_DIR);
  if (!existsSync(root)) return [];
  const units: string[] = [];
  for (const month of readdirSync(root, { withFileTypes: true })) {
    if (!month.isDirectory() || !/^\d{6}$/.test(month.name)) continue;
    for (const entry of readdirSync(join(root, month.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = join(PATCHES_DIR, month.name, entry.name);
      if (patchPhaseOf(relative) !== undefined) units.push(relative);
    }
  }
  return units.sort();
}

/**
 * サイクルを明示されなかった patch が属す、進行中のサイクル。
 * どのサイクルにもそのディレクトリが無ければ undefined（サイクルに属さない patch）
 */
export function patchCycleOf(hikyakuRoot: string, phase: string): CycleRecord | undefined {
  const relative = patchUnitDirectory(phase);
  if (relative === undefined || !existsSync(cyclesPath(hikyakuRoot))) return undefined;
  const matched = loadCycles(hikyakuRoot).filter(
    (record) => record.status === "active" && existsSync(join(cycleDir(hikyakuRoot, record), relative)),
  );
  if (matched.length <= 1) return matched[0];
  throw new HikyakuError(
    `${phase} の記録が複数のサイクルにあります`,
    ["サイクルを引数で明示してください:", ...matched.map((record) => `  ${cycleDirName(record)}`)].join("\n"),
  );
}

/** 今日の年月（YYYYMM）。新しい patch の名前に使う */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}
