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

import { join } from "node:path";
import { appendJsonl, readJsonl } from "./jsonl.mts";

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
  /**
   * ゲートの承認の種類（その回の consent が now なら consent）。承認したあとに同意が要る変更が出たとき、
   * 確認として受けた承認では足りないと分かるように残す（G10）。無い記録は種類が分からない
   */
  approval?: "consent" | "confirm";
  /** step restart で始めた回の種類（architect の return / add など）。スキルが定義で読む */
  round?: string;
  /** 報告で添えた予測ピーク（トークン。plan / plan-review） */
  peak?: number;
  /** 報告で添えた PR（URL か番号。pr ステップ） */
  pr?: string;
  /** 報告した時点のメインセッションのコンテキスト（#68）。計測できなければ記録しない */
  context?: number;
  /** 計測できなかった理由 */
  contextUnavailable?: string;
  /** CLAUDE_CODE_SESSION_ID */
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
  return readJsonl(progressPath(unitDirectory), isEvent, {
    writer: "progress.jsonl は hikyaku step report だけが追記します。",
    shape: "進捗のイベント",
  });
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
  appendJsonl(progressPath(unitDirectory), event);
}
