/**
 * 基準を試しに消した PR の、マージ前後の品質の指標の比較（ADR review-records-and-criterion-reasons、US-9.4）。
 *
 * 消した基準とマージの時点は保存せずに導く（原則8）:
 *   - 消す PR は close-cycle の followups が `{close のブランチ}-criteria` で作り、followups の done の `pr` に残る
 *   - マージの時点は、ベースブランチの first-parent の履歴で、件名にその PR 番号を含むコミットの日時
 *   - 消した基準は、そのコミットと第1親の差分で消えた rule のファイルと、登録された文書から消えた箇条書きの行
 *
 * 比べる指標は、サイクルごとの差し戻し・rejected の決定・重要度が高の落とし穴・重い指摘の数。
 * マージ前後それぞれ `[metrics] window` サイクルが揃わなければ「比較できない」とする。
 * 戻すかどうかは決めない（ユーザーが決める）。悪くなった指標を材料として返すだけ
 */

import { join } from "node:path";
import type { ResolvedConfig } from "./config.mts";
import { cycleDir, cycleDirName, loadCycles, type CycleRecord } from "./cycles.mts";
import { loadGuide } from "./docs.mts";
import { defaultBranch, gitSync } from "./git.mts";
import { readLedger } from "./ledger.mts";
import { readProgress, RESTART } from "./progress.mts";
import { collectPromotions } from "./promotions.mts";
import { collectReviewRecords, heavyCountByCycle } from "./review-records.mts";
import { RULES_DIR } from "./rules.mts";

export const METRIC_KEYS = ["returns", "rejected", "highPitfalls", "heavyFindings"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type MetricTotals = Record<MetricKey, number>;

export const METRIC_LABELS: Record<MetricKey, string> = {
  returns: "差し戻し",
  rejected: "rejected の決定",
  highPitfalls: "重要度が高の落とし穴",
  heavyFindings: "重い指摘",
};

export interface CycleMetrics extends MetricTotals {
  cycle: string;
}

/** サイクルの指標。記録のファイルが無ければ 0 と数える。記録が壊れていれば理由を返す */
export function cycleMetrics(hikyakuRoot: string, record: CycleRecord): CycleMetrics | string {
  const directory = cycleDir(hikyakuRoot, record);
  const cycle = cycleDirName(record);
  try {
    const returns = readProgress(join(directory, "design")).filter(
      (event) => event.skill === "architect" && event.result === RESTART && event.round === "return",
    ).length;
    const ledger = readLedger(directory);
    const rejected =
      ledger.items.reduce((sum, item) => sum + item.decisions.filter((d) => d.decision === "rejected").length, 0) +
      ledger.orphans.filter((d) => d.decision === "rejected").length;
    const highPitfalls = collectPromotions(directory).candidates.filter((c) => c.importance === "高").length;
    const heavyFindings = heavyCountByCycle(collectReviewRecords(hikyakuRoot, [record]).records).get(cycle) ?? 0;
    return { cycle, returns, rejected, highPitfalls, heavyFindings };
  } catch (error) {
    return `${cycle} の記録を読めません: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** PR の URL か番号から番号を取る */
export function prNumber(reference: string): number | undefined {
  const match = /(?:\/pull\/|^#?)(\d+)\/?$/.exec(reference.trim());
  return match === null ? undefined : Number(match[1]);
}

/** 件名に PR 番号が現れるか。前後が数字の `#12`（`#123` の一部）は当たらない */
export function subjectMentionsPr(subject: string, pr: number): boolean {
  return new RegExp(`(?<![0-9A-Za-z])#${pr}(?!\\d)`).test(subject);
}

/** 基準を消した PR の記録（closed のサイクルの followups の done の pr） */
export interface RemovalRecord {
  cycle: string;
  pr: string;
}

export function removalRecords(hikyakuRoot: string, cycles: CycleRecord[]): RemovalRecord[] {
  const found: RemovalRecord[] = [];
  for (const record of cycles) {
    if (record.status !== "closed") continue;
    let events;
    try {
      events = readProgress(cycleDir(hikyakuRoot, record));
    } catch {
      continue;
    }
    for (const event of events) {
      if (event.skill === "close-cycle" && event.step === "followups" && event.result === "done" && event.pr !== undefined) {
        found.push({ cycle: cycleDirName(record), pr: event.pr });
      }
    }
  }
  return found;
}

interface BaseCommit {
  hash: string;
  date: string;
  subject: string;
}

/** ベースブランチの first-parent の履歴。読めなければ理由 */
function baseHistory(config: ResolvedConfig): BaseCommit[] | string {
  const base = config.baseBranch ?? defaultBranch(config.repoRoot);
  if (base === undefined) return "ベースブランチを決められません（base_branch を設定してください）";
  // リモートを先に見る。PR は GitHub でマージされ、手元のベースブランチは進めていないことが多い
  const ref = [`origin/${base}`, base].find((candidate) => gitSync(config.repoRoot, ["rev-parse", "--verify", "-q", candidate]) !== undefined);
  if (ref === undefined) return `ベースブランチ ${base} を読めません`;
  const log = gitSync(config.repoRoot, ["log", "--first-parent", "--format=%H%x1f%cI%x1f%s", ref]);
  if (log === undefined) return `ベースブランチ ${base} の履歴を読めません`;
  return log
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [hash, date, subject] = line.split("\x1f");
      return { hash: hash ?? "", date: date ?? "", subject: subject ?? "" };
    });
}

/** マージのコミットと第1親の差分から、消えた rule のファイルと、登録された文書から消えた箇条書きの行 */
export function removedCriteria(config: ResolvedConfig, hash: string): string[] {
  const root = config.repoRoot;
  const removed: string[] = [];
  const status = gitSync(root, ["diff", "--name-status", "--no-renames", "-z", `${hash}^1`, hash, "--", RULES_DIR]) ?? "";
  const fields = status.split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if ((fields[i] as string).trim() === "D") removed.push(fields[i + 1] as string);
  }
  let docs: string[] = [];
  try {
    docs = loadGuide(config.hikyakuRoot)
      .map((entry) => entry.path)
      .filter((path): path is string => path !== undefined);
  } catch {
    docs = [];
  }
  if (docs.length === 0) return removed;
  const patch = gitSync(root, ["diff", "--no-renames", "-U0", `${hash}^1`, hash, "--", ...docs]) ?? "";
  let file: string | undefined;
  for (const line of patch.split("\n")) {
    const header = /^--- (?:a\/(.*)|\/dev\/null)$/.exec(line);
    if (header) {
      file = header[1];
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---") && file !== undefined) {
      const body = line.slice(1);
      if (/^\s*[-*]\s+\S/.test(body)) removed.push(`${file}: ${body.trim()}`);
    }
  }
  return removed;
}

export interface MetricsSide {
  cycles: string[];
  totals: MetricTotals;
}

export interface MetricsComparison {
  /** 消す PR を作ったサイクル */
  cycle: string;
  pr: string;
  /** マージの日時（ベースブランチのコミットの日時）。未マージなら無い */
  mergedAt?: string;
  removed: string[];
  comparable: boolean;
  /** 比較できない理由 */
  reason?: string;
  before?: MetricsSide;
  after?: MetricsSide;
  /** 後のほうが多い指標 */
  worse?: MetricKey[];
}

function totalsOf(metrics: CycleMetrics[]): MetricTotals {
  const totals: MetricTotals = { returns: 0, rejected: 0, highPitfalls: 0, heavyFindings: 0 };
  for (const m of metrics) for (const key of METRIC_KEYS) totals[key] += m[key];
  return totals;
}

/**
 * マージの日で前後に分けて比べる。前: 完了日がマージの日より前の closed のサイクルの直近 window 件。
 * 後: 開始日がマージの日以後の closed のサイクルの先頭 window 件。開始 ≤ 完了なので重ならない
 */
export function compareAround(input: {
  mergedDay: string;
  cycles: CycleRecord[];
  window: number;
  metricsOf: (record: CycleRecord) => CycleMetrics | string;
}): Pick<MetricsComparison, "comparable" | "reason" | "before" | "after" | "worse"> {
  const closed = input.cycles.filter((c) => c.status === "closed");
  const before = closed
    .filter((c) => c.finished !== "" && c.finished < input.mergedDay)
    .sort((a, b) => (a.finished < b.finished ? 1 : a.finished > b.finished ? -1 : 0))
    .slice(0, input.window);
  const after = closed
    .filter((c) => c.started !== "" && c.started >= input.mergedDay)
    .sort((a, b) => (a.started < b.started ? -1 : a.started > b.started ? 1 : 0))
    .slice(0, input.window);
  if (before.length < input.window || after.length < input.window) {
    return {
      comparable: false,
      reason: `マージ前後に closed のサイクルがそれぞれ ${input.window} 件要ります（前 ${before.length} 件・後 ${after.length} 件）`,
    };
  }
  const measure = (records: CycleRecord[]): CycleMetrics[] | string => {
    const found: CycleMetrics[] = [];
    for (const record of records) {
      const m = input.metricsOf(record);
      if (typeof m === "string") return m;
      found.push(m);
    }
    return found;
  };
  const b = measure([...before].reverse());
  const a = measure(after);
  if (typeof b === "string") return { comparable: false, reason: b };
  if (typeof a === "string") return { comparable: false, reason: a };
  const beforeTotals = totalsOf(b);
  const afterTotals = totalsOf(a);
  return {
    comparable: true,
    before: { cycles: b.map((m) => m.cycle), totals: beforeTotals },
    after: { cycles: a.map((m) => m.cycle), totals: afterTotals },
    worse: METRIC_KEYS.filter((key) => afterTotals[key] > beforeTotals[key]),
  };
}

/**
 * 日時をこの環境のローカルの日付（YYYY-MM-DD）にする。cycles.md の開始日・完了日はローカルの日付で書かれるので、
 * コミットした人のタイムゾーンの日付（ISO の先頭10文字）ではそろわない
 */
export function localDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 過去に基準を消した PR ごとの、マージ前後の指標の比較（close-cycle の followups が示す） */
export function metricsComparison(config: ResolvedConfig): MetricsComparison[] {
  let cycles: CycleRecord[];
  try {
    cycles = loadCycles(config.hikyakuRoot);
  } catch {
    return [];
  }
  const records = removalRecords(config.hikyakuRoot, cycles);
  if (records.length === 0) return [];
  const history = baseHistory(config);
  return records.map((record) => {
    const pr = prNumber(record.pr);
    if (typeof history === "string") return { ...record, removed: [], comparable: false, reason: history };
    if (pr === undefined) return { ...record, removed: [], comparable: false, reason: `PR 番号を読めません: ${record.pr}` };
    // 履歴は新しい順。PR を参照する後のコミット（revert など）ではなく、最も古いものをマージとみなす
    const merge = history.findLast((commit) => subjectMentionsPr(commit.subject, pr) && !/^Revert\b/.test(commit.subject));
    if (merge === undefined) return { ...record, removed: [], comparable: false, reason: "未マージ（ベースブランチに PR のコミットがありません）" };
    const compared = compareAround({
      mergedDay: localDay(merge.date),
      cycles,
      window: config.metrics.window,
      metricsOf: (c) => cycleMetrics(config.hikyakuRoot, c),
    });
    return { ...record, mergedAt: merge.date, removed: removedCriteria(config, merge.hash), ...compared };
  });
}
