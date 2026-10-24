/**
 * 作業単位の進捗ログ（progress.jsonl）。
 *
 * フェーズの中の手順がどこまで進んだかを、イベントの追記で記録する（#50）。
 * 現在地は保存しない。成果物とこのログから毎回導出する（steps/engine.mts）。
 * 追記しかしないので、書き換えの途中で壊れることも、無効になった記録を消すことも無い。
 * 人間が読むことは想定しない（表示は step status が整形する）。
 *
 * ファイルは作業単位のディレクトリ（build-NN/ など）に置き、成果物と一緒にコミットする。
 * 別のセッション・別のマシンから再開したときも、ここから続きを導出できる。
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HikyakuError } from "./errors.mts";

export const PROGRESS_FILE = "progress.jsonl";

export type StepResult = "done" | "skipped" | "approved" | "rejected" | "failed";
export const STEP_RESULTS: StepResult[] = ["done", "skipped", "approved", "rejected", "failed"];

/**
 * 同じ作業単位で、そのスキルの手順を最初から回し直す区切り（step restart）。
 * これより前の記録は現在地の導出に使わない。architect の追加設計や、内部スキルの
 * 2回目以降の呼び出しで使う。古い記録は消さずに残る
 */
export const RESTART = "restart";
export const RESTART_STEP = "*";

export interface ProgressEvent {
  at: string;
  /** 報告したスキル（builder / build-manager など） */
  skill: string;
  step: string;
  result: StepResult | typeof RESTART;
  /** スキップ・失敗の理由 */
  reason?: string;
  /** ゲートでのユーザーの答え */
  input?: string;
  /** 承認に結びつけた成果物のハッシュ（作業単位のディレクトリからの相対パス → sha256 の先頭12桁） */
  hashes?: Record<string, string>;
  /** 報告で添えた BP（plan / plan-review） */
  bp?: number;
  /** 報告した時点のメインセッションのコンテキスト（#68）。計測できなければ記録しない */
  context?: number;
  /** 計測できなかった理由 */
  contextUnavailable?: string;
  /** CLAUDE_CODE_SESSION_ID / CODEX_THREAD_ID */
  session?: string;
  /** 報告した Hikyaku の版 */
  hikyaku?: string;
}

export function progressPath(unitDirectory: string): string {
  return join(unitDirectory, PROGRESS_FILE);
}

/**
 * ログを読む。壊れた行は推測で読み飛ばさずエラーにする。
 * 1行の欠けが「そのステップは未実施」と読まれ、手順が巻き戻るため
 */
export function readProgress(unitDirectory: string): ProgressEvent[] {
  const path = progressPath(unitDirectory);
  if (!existsSync(path)) return [];
  const events: ProgressEvent[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (line.trim() === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new HikyakuError(
          `${path}:${index + 1} を JSON として読めません`,
          "progress.jsonl は hikyaku step report だけが追記します。手で編集した場合は元に戻してください。",
        );
      }
      if (!isEvent(parsed)) {
        throw new HikyakuError(`${path}:${index + 1} は進捗のイベントの形をしていません`);
      }
      events.push(parsed);
    });
  return events;
}

function isEvent(value: unknown): value is ProgressEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["at"] === "string" &&
    typeof record["skill"] === "string" &&
    typeof record["step"] === "string" &&
    (STEP_RESULTS.includes(record["result"] as StepResult) || record["result"] === RESTART)
  );
}

export function appendProgress(unitDirectory: string, event: ProgressEvent): void {
  const path = progressPath(unitDirectory);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

/** 承認に結びつけるハッシュ。改行コードの違いで承認が外れないよう、LF に揃えてから計算する */
export function fileHash(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
