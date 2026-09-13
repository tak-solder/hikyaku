/**
 * ローカルの作業状態（{HIKYAKU_ROOT}/.hikyaku.local）。
 *
 * これはワークフローの状態ではなく、このチェックアウト固有の「栞」。
 * git 管理対象外で、他人には見えず、他人の判断にも影響しない。
 * 消えても支障が無いように扱う（消えたら尋ね直せばよいだけ）。
 *
 * チーム開発では「最後にコミットされたサイクル」は他メンバーのものかもしれない。
 * 「自分が最後に触ったサイクル」はリポジトリからは導出できないので、ここだけは
 * 記録する。ただし用途を厳しく絞る:
 *
 *   読むのは「対象サイクルの決定」だけ。
 *   next / validate / cycle status など判断に使う処理からは参照しない。
 *   指す先が無効（closed / abandoned / 不在）なら黙って捨てて尋ね直す。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HikyakuError } from "./errors.mts";
import { parseToml, TomlError } from "./toml.mts";

export const LOCAL_FILE = ".hikyaku.local";

/** 設定ではないので、置けるキーはこれだけ */
const ALLOWED_KEYS = ["cycle", "updated"];

export interface LocalState {
  /** 最後に対象としたサイクルのディレクトリ名（{NNN}-{slug}） */
  cycle: string | undefined;
  updated: string | undefined;
}

export function localPath(hikyakuRoot: string): string {
  return join(hikyakuRoot, LOCAL_FILE);
}

export function readLocalState(hikyakuRoot: string): LocalState {
  const path = localPath(hikyakuRoot);
  if (!existsSync(path)) return { cycle: undefined, updated: undefined };

  let table;
  try {
    table = parseToml(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof TomlError) {
      throw new HikyakuError(
        `${path} の解析に失敗しました: ${error.message}`,
        "作業の栞にすぎないので、削除すれば復旧します。",
      );
    }
    throw error;
  }

  const unknown = Object.keys(table).filter((key) => !ALLOWED_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new HikyakuError(
      `${path}: 設定は書けません（${unknown.join(", ")}）`,
      [
        "このファイルは作業の栞で、設定の階層ではありません。",
        "設定はリポジトリルートかサイクルディレクトリの .hikyaku.config に書いてください。",
      ].join("\n"),
    );
  }

  const cycle = table["cycle"];
  const updated = table["updated"];
  return {
    cycle: typeof cycle === "string" && cycle !== "" ? cycle : undefined,
    updated: typeof updated === "string" ? updated : undefined,
  };
}

export function renderLocalState(cycle: string, now: Date = new Date()): string {
  return [
    "# Hikyaku のローカル状態（このチェックアウト専用・git 管理対象外）",
    "#",
    "# 最後に作業したサイクルを記録しているだけです。設定は書けません。",
    "# 消しても支障はありません（次回どのサイクルで作業するかを尋ねられます）。",
    "",
    `cycle = "${cycle}"`,
    `updated = "${now.toISOString()}"`,
    "",
  ].join("\n");
}

export function writeLocalState(hikyakuRoot: string, cycle: string): void {
  writeFileSync(localPath(hikyakuRoot), renderLocalState(cycle), "utf8");
}
