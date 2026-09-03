/**
 * パス解決。
 *
 * - プラグインルート: このスクリプト自身の位置から導出する
 * - リポジトリルート: .git を上方向に探索する（git バイナリに依存しない）
 * - HIKYAKU_ROOT:  --root → config の hikyaku_root → 上方向探索 の順
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HikyakuError } from "./errors.mts";

/** プラグインのルート（scripts/lib/ から2階層上） */
export function pluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** plugin.json に記載されたバージョン */
export function pluginVersion(): string {
  const manifest = join(pluginRoot(), ".claude-plugin", "plugin.json");
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** 指定ディレクトリから上方向に、述語を満たす最初のディレクトリを探す */
function searchUpward(from: string, matches: (dir: string) => boolean): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (matches(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** .git を上方向に探索する。見つからなければ cwd を返す */
export function repoRoot(from: string = process.cwd()): string {
  return searchUpward(from, (dir) => existsSync(join(dir, ".git"))) ?? resolve(from);
}

/** HIKYAKU_ROOT らしさの判定に使うマーカー */
const ROOT_MARKERS = ["document-guide.md", "cycles.md", ".hikyaku.config"];

/**
 * HIKYAKU_ROOT を上方向探索で見つける。
 * document-guide.md か cycles.md を持つディレクトリを優先し、
 * どちらも無い場合に限って .hikyaku.config だけを持つディレクトリを採用する
 * （リポジトリルートの設定ファイルと取り違えないため）。
 */
export function findHikyakuRoot(from: string = process.cwd()): string | undefined {
  const strong = searchUpward(
    from,
    (dir) => existsSync(join(dir, "document-guide.md")) || existsSync(join(dir, "cycles.md")),
  );
  if (strong !== undefined) return strong;

  const root = repoRoot(from);
  return searchUpward(from, (dir) => dir !== root && existsSync(join(dir, ".hikyaku.config")));
}

/** HIKYAKU_ROOT が実在し、マーカーを持つか検証する */
export function assertHikyakuRoot(root: string): void {
  if (!existsSync(root)) {
    throw new HikyakuError(
      `HIKYAKU_ROOT が存在しません: ${root}`,
      "パスを確認するか、/hikyaku:init で初期化してください。",
    );
  }
  const hasMarker = ROOT_MARKERS.some((marker) => existsSync(join(root, marker)));
  if (!hasMarker) {
    throw new HikyakuError(
      `${root} は Hikyaku ワークスペースとして初期化されていません`,
      "/hikyaku:init を実行してください。",
    );
  }
}
