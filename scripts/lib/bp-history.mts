/**
 * BP 見積もりの実績を、各ビルドの retrospective.md から集める。
 *
 * retrospective の「BP見積もりの振り返り」節はテンプレートで形が固定されている
 * （段階表 / セッション行 / 内訳表）ので、見出し名で読める。LLM が書いた文章の
 * 部分（乖離の要因）はここでは読まず、呼び出し元のスキルが直接読む。
 *
 * 読めない項目は undefined にして返す。推測で埋めると「実測した」記録に見えるので、
 * 欠けは欠けのまま表示する。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BREAKDOWN_HEADERS } from "./bp.mts";
import { cycleDir, cycleDirName, type CycleRecord } from "./cycles.mts";
import { parseTables, type MarkdownTable } from "./markdown.mts";

/** retrospective.md 内の節の見出し */
export const BP_SECTION_HEADING = "BP見積もりの振り返り";
export const BP_STAGE_HEADERS = ["段階", "BP"];

export interface BpRecord {
  cycle: string;
  build: string;
  path: string;
  architect: number | undefined;
  builder: number | undefined;
  actual: number | undefined;
  /** **セッション**: の右側。1セッションで完結したか */
  session: string | undefined;
  /** 見積もり（builder 段階）の内訳。項目ラベル → 値 */
  estimated: Record<string, string>;
  /** 実績の内訳。項目ラベル → 値 */
  measured: Record<string, string>;
}

/** セルから整数を取り出す（`**5BP**` → 5）。無ければ undefined */
function integerIn(cell: string): number | undefined {
  const match = /-?\d+/.exec(cell.replace(/\*/g, ""));
  return match === null ? undefined : Number.parseInt(match[0], 10);
}

/** 「## BP見積もりの振り返り」から次の同レベル見出しまで */
function bpSection(source: string): string | undefined {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^##\s/.test(line) && line.includes(BP_SECTION_HEADING));
  if (start === -1) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i] as string)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function isStageTable(table: MarkdownTable): boolean {
  return BP_STAGE_HEADERS.every((h, i) => table.headers[i] === h);
}

function isBreakdownTable(table: MarkdownTable): boolean {
  return BREAKDOWN_HEADERS.every((h, i) => table.headers[i] === h);
}

function breakdownValues(table: MarkdownTable): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of table.rows) {
    const label = (row[0] ?? "").replace(/\*/g, "").trim();
    if (label === "") continue;
    values[label] = (row[1] ?? "").trim();
  }
  return values;
}

export function parseBpRecord(source: string, meta: Pick<BpRecord, "cycle" | "build" | "path">): BpRecord | undefined {
  const section = bpSection(source);
  if (section === undefined) return undefined;

  const record: BpRecord = {
    ...meta,
    architect: undefined,
    builder: undefined,
    actual: undefined,
    session: undefined,
    estimated: {},
    measured: {},
  };

  const tables = parseTables(section);
  const stage = tables.find(isStageTable);
  if (stage !== undefined) {
    for (const row of stage.rows) {
      const label = (row[0] ?? "").replace(/\*/g, "");
      const bp = integerIn(row[1] ?? "");
      if (/architect/i.test(label)) record.architect = bp;
      else if (/builder/i.test(label)) record.builder = bp;
      else if (label.includes("実績")) record.actual = bp;
    }
  }

  const breakdowns = tables.filter(isBreakdownTable);
  if (breakdowns[0] !== undefined) record.estimated = breakdownValues(breakdowns[0]);
  if (breakdowns[1] !== undefined) record.measured = breakdownValues(breakdowns[1]);

  const session = /\*\*セッション\*\*\s*[:：]\s*(.+)/.exec(section);
  if (session?.[1] !== undefined) record.session = session[1].trim();

  return record;
}

/** 全サイクル（または指定サイクル）の build-NN/retrospective.md を集める */
export function collectBpRecords(hikyakuRoot: string, records: CycleRecord[]): BpRecord[] {
  const found: BpRecord[] = [];
  for (const cycle of records) {
    const directory = cycleDir(hikyakuRoot, cycle);
    if (!existsSync(directory)) continue;
    const builds = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^build-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const build of builds) {
      const path = join(directory, build, "retrospective.md");
      if (!existsSync(path)) continue;
      const parsed = parseBpRecord(readFileSync(path, "utf8"), { cycle: cycleDirName(cycle), build, path });
      if (parsed !== undefined) found.push(parsed);
    }
  }
  return found;
}

/** 「5」「未指定」「あり」のうち数値だけを返す */
export function numericValue(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  if (!/^\s*\d+\s*$/.test(cell)) return undefined;
  return Number.parseInt(cell, 10);
}
