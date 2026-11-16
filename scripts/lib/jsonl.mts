/**
 * 追記型の JSONL（progress.jsonl・decisions.jsonl）の厳密な読み書き。
 *
 * 壊れた行は推測で読み飛ばさずエラーにする。1行の欠けが「そのステップは未実施」
 * 「その決定は無い」と読まれ、手順や判断が黙って巻き戻るため。
 *
 * 解析は文字列から行う（parseJsonl）。ファイルだけでなく、git show で読んだ別のブランチの
 * 記録も同じ検査で読めるようにするため。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { HikyakuError } from "./errors.mts";

export interface JsonlLabels {
  /** 書き手の案内（壊れた行のヒント）。例: "progress.jsonl は hikyaku step report だけが追記します。" */
  writer: string;
  /** 形の名前。例: "進捗のイベント" */
  shape: string;
}

export function parseJsonl<T>(
  text: string,
  source: string,
  isRecord: (value: unknown) => value is T,
  labels: JsonlLabels,
): T[] {
  const records: T[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new HikyakuError(
        `${source}:${index + 1} を JSON として読めません`,
        `${labels.writer}手で編集した場合は元に戻してください。`,
      );
    }
    if (!isRecord(parsed)) {
      throw new HikyakuError(`${source}:${index + 1} は${labels.shape}の形をしていません`);
    }
    records.push(parsed);
  });
  return records;
}

/** ファイルを読んで parseJsonl。ファイルが無ければ空 */
export function readJsonl<T>(path: string, isRecord: (value: unknown) => value is T, labels: JsonlLabels): T[] {
  if (!existsSync(path)) return [];
  return parseJsonl(readFileSync(path, "utf8"), path, isRecord, labels);
}

/** 1行追記する。ディレクトリが無ければ作る */
export function appendJsonl(path: string, record: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}
