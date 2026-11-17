/**
 * handoff.md の「レビューの記録」を、サイクルをまたいで集める（ADR review-records-and-criterion-reasons）。
 *
 * 行の書式は `- [重|軽] \`rule:<パス>\`: 指摘の要約`。rule に当たらない指摘は宛先を `` `-` `` にする。
 * ここから、rule が引かれた回数（機械の検査やリファクタへ移すきっかけ）と、重い指摘の数（品質の指標）を数える。
 * どの rule を引いたかは LLM の申告なので、書き漏らすと回数は少なく出る（移す候補を見逃す側に倒れる）。
 *
 * 移すか消すかはここでは決めない。並べるのは rules.mts の ruleCandidates と `hikyaku rules candidates`。
 * 読めない行は捨てずに unparsed として返す（promotions.mts と同じ）。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cycleDir, cycleDirName, type CycleRecord } from "./cycles.mts";
import { REVIEW_RECORD_HEADING, sectionItems, type Unparsed } from "./promotions.mts";

export type ReviewWeight = "重" | "軽";

export interface ReviewRecordLine {
  weight: ReviewWeight;
  /** 引いた rule のパス。rule に当たらない指摘は undefined */
  rule: string | undefined;
  text: string;
}

export interface ReviewRecord extends ReviewRecordLine {
  cycle: string;
  build: string;
  /** サイクルのディレクトリからの相対パス */
  source: string;
}

export interface RuleHit {
  count: number;
  heavy: number;
  /** 出どころ（`{cycle}/{build}/handoff.md`）。1件の記録につき1つ */
  sources: string[];
}

const LINE = /^\[(重|軽)\]\s*`([^`]+)`\s*[:：]\s*(.+)$/;

/** `[重] \`rule:<パス>\`: 要約` の1行を読む。読めなければ理由を返す */
export function parseReviewRecord(item: string): ReviewRecordLine | string {
  const match = LINE.exec(item.trim());
  if (!match) return "「[重|軽] `rule:<パス>`: 指摘の要約」の形になっていません（rule に当たらなければ宛先は `-`）";
  const target = (match[2] as string).trim();
  let rule: string | undefined;
  if (target === "-") {
    rule = undefined;
  } else if (target.startsWith("rule:")) {
    rule = target.slice("rule:".length).trim();
    if (rule === "") return "rule のパスが空です";
  } else {
    return `宛先が不明です: ${target}（使えるのは rule:<パス> か -）`;
  }
  const text = (match[3] as string).trim();
  // テンプレートの例（`rule:.claude/rules/{名前}.md`: （指摘の要約））を残したままの行を、記録として数えない
  if (/^（[^（）]*）$/.test(text) || rule?.includes("{名前}") === true) return "テンプレートの例のままです。指摘を書くか、行を消してください";
  return { weight: match[1] as ReviewWeight, rule, text };
}

function isNone(item: string): boolean {
  return /^(なし|無し|該当なし)[。.]?$/.test(item);
}

/**
 * 全サイクル（closed を含む）の build-NN/handoff.md の「レビューの記録」を集める。
 * patch の handoff.md は読まない（patch の手順はまだこの記録を書かない）
 */
export function collectReviewRecords(hikyakuRoot: string, cycles: CycleRecord[]): { records: ReviewRecord[]; unparsed: Unparsed[] } {
  const records: ReviewRecord[] = [];
  const unparsed: Unparsed[] = [];
  for (const record of cycles) {
    const directory = cycleDir(hikyakuRoot, record);
    if (!existsSync(directory)) continue;
    const cycle = cycleDirName(record);
    const builds = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^build-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const build of builds) {
      const path = join(directory, build, "handoff.md");
      if (!existsSync(path)) continue;
      const source = `${build}/handoff.md`;
      for (const item of sectionItems(readFileSync(path, "utf8"), REVIEW_RECORD_HEADING)) {
        if (isNone(item)) continue;
        const parsed = parseReviewRecord(item);
        if (typeof parsed === "string") {
          unparsed.push({ heading: REVIEW_RECORD_HEADING, line: item, source: `${cycle}/${source}`, problem: parsed });
        } else {
          records.push({ ...parsed, cycle, build, source });
        }
      }
    }
  }
  return { records, unparsed };
}

/** rule のパスごとに、引かれた回数・重い指摘の数・出どころ。rule に当たらない記録は数えない */
export function ruleHits(records: ReviewRecord[]): Map<string, RuleHit> {
  const hits = new Map<string, RuleHit>();
  for (const record of records) {
    if (record.rule === undefined) continue;
    const hit = hits.get(record.rule) ?? { count: 0, heavy: 0, sources: [] };
    hit.count += 1;
    if (record.weight === "重") hit.heavy += 1;
    hit.sources.push(`${record.cycle}/${record.source}`);
    hits.set(record.rule, hit);
  }
  return hits;
}

/** サイクルごとの重い指摘の数（rule に当たらない指摘も含む）。記録のあるサイクルだけを返す */
export function heavyCountByCycle(records: ReviewRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.cycle, (counts.get(record.cycle) ?? 0) + (record.weight === "重" ? 1 : 0));
  }
  return counts;
}
