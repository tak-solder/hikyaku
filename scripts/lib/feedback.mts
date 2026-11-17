/**
 * Hikyaku へのフィードバックの書き出し（feedback export）。
 *
 * ユーザーのリポジトリの中身を外に出さない（AGENTS.md の原則 15）。そのため:
 *   - progress.jsonl から読むのは、中身を含まない欄（at / skill / step / result / round / hikyaku）だけ。
 *     input（ユーザーの答え）・reason（理由）・pr・session は読まない
 *   - 集計の単位はスキルとステップの ID だけ。サイクル名・ビルド番号・patch の slug・作業単位の
 *     パスは出力に含めない。件数の合計や最大値のように、作業の規模や時期の手がかりになる値も出さない
 *   - 外部に送る処理は持たない。送るかどうかの判断と起票はユーザーが行う
 *
 * upstream の本文だけは自由文で、中身を含みうる。ここでは要約も一般化もせず（AI やスクリプトが
 * 判断すると、何が消えたかをユーザーが確かめられない）、送る前に全文を読むよう書き出しの中で示す。
 *
 * 起票の下書きは固定の枠を埋めるだけで、文面は作らない（文面の作成はスクリプトの仕事ではない）。
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "./config.mts";
import { cycleDir, loadCycles } from "./cycles.mts";
import { gitSync } from "./git.mts";
import { readProgress, PROGRESS_FILE, RESTART, type ProgressEvent } from "./progress.mts";
import { collectPromotions } from "./promotions.mts";

export const FEEDBACK_DIR = "feedback";

/** 書き出しが読む欄。ここに無い欄（input / reason / pr / session など）は集計に渡さない */
export type FeedbackEvent = Pick<ProgressEvent, "at" | "skill" | "step" | "result" | "round" | "hikyaku">;

export interface StepCount {
  skill: string;
  step: string;
  count: number;
}

export interface GateWait {
  skill: string;
  step: string;
  count: number;
  medianMinutes: number;
}

export interface FeedbackSummary {
  failed: StepCount[];
  gates: GateWait[];
  /** 記録に現れた Hikyaku の版 */
  versions: string[];
  upstream: string[];
}

/** 中身を含まない欄だけを写す */
export function pickFeedbackFields(event: ProgressEvent): FeedbackEvent {
  const picked: FeedbackEvent = { at: event.at, skill: event.skill, step: event.step, result: event.result };
  if (event.round !== undefined) picked.round = event.round;
  if (event.hikyaku !== undefined) picked.hikyaku = event.hikyaku;
  return picked;
}

/** HIKYAKU_ROOT の下の progress.jsonl（feedback/ は除く）。ユーザーが手で呼ぶコマンドなので全件を走査する */
export function progressFiles(hikyakuRoot: string): string[] {
  const found: string[] = [];
  const visit = (directory: string, top: boolean): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (top && entry.name === FEEDBACK_DIR) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, false);
      else if (entry.isFile() && entry.name === PROGRESS_FILE) found.push(path);
    }
  };
  if (existsSync(hikyakuRoot)) visit(hikyakuRoot, true);
  return found.sort();
}

function key(skill: string, step: string): string {
  return `${skill}\u0000${step}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return Math.round(value * 10) / 10;
}

function byStep<T extends { skill: string; step: string }>(a: T, b: T): number {
  return a.skill.localeCompare(b.skill) || a.step.localeCompare(b.step);
}

/**
 * ファイルごとの記録の列から集計する。
 *
 * ゲートの記録（approved / rejected）は、同じファイルの直前の記録の at との差をかかった時間とする（直前が別のスキルなら数えない）。
 * restart の直後のゲート、日時が読めない・差が負の組は数えない（別の回の記録と差を取らないため）。
 * round は集計の単位に含めない（回の種類で分けると、サイクルを特定しうる組み合わせが増える）
 */
export function summarizeProgress(files: FeedbackEvent[][]): Omit<FeedbackSummary, "upstream"> {
  const failed = new Map<string, StepCount>();
  const waits = new Map<string, { skill: string; step: string; minutes: number[] }>();
  const versions = new Set<string>();

  for (const events of files) {
    // 直前の記録が別のスキルなら数えない。作業単位の progress.jsonl には内部スキル（build-manager・
    // retrospective）の記録も混ざり、その作業の時間をゲートの待ちに数えてしまうため
    let previous: FeedbackEvent | undefined;
    for (const event of events) {
      if (event.hikyaku !== undefined) versions.add(event.hikyaku);
      if (event.result === "failed") {
        const entry = failed.get(key(event.skill, event.step)) ?? { skill: event.skill, step: event.step, count: 0 };
        entry.count += 1;
        failed.set(key(event.skill, event.step), entry);
      }
      if ((event.result === "approved" || event.result === "rejected") && previous !== undefined && previous.result !== RESTART && previous.skill === event.skill) {
        const minutes = (Date.parse(event.at) - Date.parse(previous.at)) / 60_000;
        if (Number.isFinite(minutes) && minutes >= 0) {
          const entry = waits.get(key(event.skill, event.step)) ?? { skill: event.skill, step: event.step, minutes: [] };
          entry.minutes.push(minutes);
          waits.set(key(event.skill, event.step), entry);
        }
      }
      previous = event;
    }
  }

  return {
    failed: [...failed.values()].sort(byStep),
    gates: [...waits.values()]
      .map((entry) => ({ skill: entry.skill, step: entry.step, count: entry.minutes.length, medianMinutes: median(entry.minutes) }))
      .sort(byStep),
    versions: [...versions].sort(),
  };
}

/** すべてのサイクルの「永続化すること」から、宛先が upstream の本文だけ（どのファイルから来たかは捨てる） */
export function upstreamItems(hikyakuRoot: string): string[] {
  const items: string[] = [];
  for (const record of loadCycles(hikyakuRoot)) {
    const directory = cycleDir(hikyakuRoot, record);
    if (!existsSync(directory)) continue;
    for (const candidate of collectPromotions(directory).candidates) {
      if (candidate.kind === "upstream") items.push(candidate.text);
    }
  }
  return items;
}

export function collectFeedback(config: Pick<ResolvedConfig, "hikyakuRoot">): FeedbackSummary {
  const files = progressFiles(config.hikyakuRoot).map((path) => readProgress(join(path, "..")).map(pickFeedbackFields));
  return { ...summarizeProgress(files), upstream: upstreamItems(config.hikyakuRoot) };
}

/** YYYYMMDD（ローカル時刻） */
export function feedbackDate(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

export function feedbackPath(hikyakuRoot: string, date: string): string {
  return join(hikyakuRoot, FEEDBACK_DIR, `${date}.md`);
}

/**
 * まだ無い書き出し先。同じ日に既にあれば `{date}-2.md` `{date}-3.md` … にする。
 * ユーザーが送る前に削った書き出しを、同じ日の再実行で黙って上書きして元に戻さないため
 */
export function freshFeedbackPath(hikyakuRoot: string, date: string): string {
  let path = feedbackPath(hikyakuRoot, date);
  for (let n = 2; existsSync(path); n += 1) path = join(hikyakuRoot, FEEDBACK_DIR, `${date}-${n}.md`);
  return path;
}

/**
 * git が追跡しないパスか（git check-ignore が一致したときだけ true）。
 * 書き出すファイルのパスを渡す。feedback/ はディレクトリにだけ当たるパターンなので、
 * まだ無いディレクトリそのものを渡すと一致しない。git が無い・失敗したときは false（止める側に倒す）
 */
export function isIgnored(repoRoot: string, path: string): boolean {
  return gitSync(repoRoot, ["check-ignore", "-q", "--", path]) !== undefined;
}

export function renderFeedback(summary: FeedbackSummary, date: string): string {
  const lines = [
    `# Hikyaku へのフィードバック（${date}）`,
    "",
    "## 使い方",
    "",
    "このファイルは `hikyaku feedback export` が、作業の記録のうち中身を含まない欄（日時・スキル・ステップ・結果・版）から作りました。",
    "サイクル名・ビルド番号・ユーザーの答え・理由・PR は含めていません。外部には何も送っていません。",
    "",
    "**送る前に全文を読んでください。** とくに「upstream」の節は記録に書かれた文をそのまま載せているので、リポジトリの中身が含まれていないかを確かめてください。送るかどうか、どこを削るかはユーザーが決め、起票もユーザーが行います。",
    "",
    "## 止まった手順",
    "",
  ];
  if (summary.failed.length === 0) lines.push("なし");
  else {
    lines.push("| スキル | ステップ | 失敗の件数 |", "|---|---|---|");
    for (const entry of summary.failed) lines.push(`| ${entry.skill} | ${entry.step} | ${entry.count} |`);
  }

  lines.push("", "## ゲートにかかった時間", "", "ゲートの記録と、その直前の記録の日時の差です（ユーザーが読んで答えるまでの時間の目安）。", "");
  if (summary.gates.length === 0) lines.push("なし");
  else {
    lines.push("| スキル | ステップ | 件数 | 中央値（分） |", "|---|---|---|---|");
    for (const entry of summary.gates) lines.push(`| ${entry.skill} | ${entry.step} | ${entry.count} | ${entry.medianMinutes} |`);
  }

  lines.push("", "## upstream", "", "「永続化すること」に宛先 `upstream` で書かれた本文です。自由文なので、送る前に全文を読んでください。", "");
  if (summary.upstream.length === 0) lines.push("なし");
  else for (const item of summary.upstream) lines.push(`- ${item}`);

  lines.push(
    "",
    "## 起票の下書き",
    "",
    "issue のタイトルと本文の枠です。文面は必要に応じて書き直してください。起票はユーザーが行います。",
    "",
    "タイトル: [feedback] （気づいたことを一行で）",
    "",
    "```markdown",
    "## 概要",
    "",
    "（気づいたこと・困ったことを書く）",
    "",
    "## 記録から",
    "",
    "- 止まった手順・ゲートにかかった時間・upstream: このファイルの各節から、送ってよいものだけを貼る",
    `- Hikyaku の版: ${summary.versions.length === 0 ? "（記録なし）" : summary.versions.join(", ")}`,
    "```",
    "",
  );
  return lines.join("\n");
}
