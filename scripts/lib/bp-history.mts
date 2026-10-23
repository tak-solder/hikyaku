/**
 * BP 見積もりの実績を、各ビルドの retrospective.md から集める。
 *
 * retrospective の「BP見積もりの振り返り」節はテンプレートで形が固定されている
 * （段階表 / セッション行 / 内訳表 / セッションの実測表）ので、見出し名で読める。
 * セッションの実測表は後から足した項目なので、無い retrospective.md は欠けとして読む。LLM が書いた文章の
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
import { DEFAULT_CONTEXT_BUDGET, type ContextBudget } from "./config.mts";
import { readProgress } from "./progress.mts";
import { SESSION_LABELS, SESSION_TABLE_HEADERS } from "./session.mts";
import { checkpointsOf } from "./steps/checkpoints.mts";

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
  /** セッションの実測（bp session の表）。無ければ各項目 undefined */
  context: SessionContext;
  /** 区切りでのコンテキスト（progress.jsonl から）。記録の無い区切りは含めない */
  checkpoints: Partial<Record<keyof ContextBudget, number>>;
}

export interface SessionContext {
  peak: number | undefined;
  first: number | undefined;
  calls: number | undefined;
  outputTokens: number | undefined;
  compactions: number | undefined;
  window: number | undefined;
  model: string | undefined;
  host: string | undefined;
  hikyaku: string | undefined;
}

export function emptyContext(): SessionContext {
  return {
    peak: undefined,
    first: undefined,
    calls: undefined,
    outputTokens: undefined,
    compactions: undefined,
    window: undefined,
    model: undefined,
    host: undefined,
    hikyaku: undefined,
  };
}

/** 「312,400」「312400」をトークン数として読む。「計測不可（…）」「—」は undefined */
export function tokenValue(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  const plain = cell.replace(/\*/g, "").trim();
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(plain)) return undefined;
  return Number.parseInt(plain.replace(/,/g, ""), 10);
}

function textValue(cell: string | undefined): string | undefined {
  const plain = cell?.replace(/\*/g, "").trim();
  return plain === undefined || plain === "" || plain === "—" || plain === "-" ? undefined : plain;
}

function isSessionTable(table: MarkdownTable): boolean {
  return SESSION_TABLE_HEADERS.every((h, i) => table.headers[i] === h);
}

function sessionContext(table: MarkdownTable | undefined): SessionContext {
  const context = emptyContext();
  if (table === undefined) return context;
  const values = breakdownValues(table);
  context.peak = tokenValue(values[SESSION_LABELS.peak]);
  context.first = tokenValue(values[SESSION_LABELS.first]);
  context.calls = tokenValue(values[SESSION_LABELS.calls]);
  context.outputTokens = tokenValue(values[SESSION_LABELS.output]);
  context.compactions = tokenValue(values[SESSION_LABELS.compactions]);
  context.window = tokenValue(values[SESSION_LABELS.window]);
  context.model = textValue(values[SESSION_LABELS.model]);
  context.host = textValue(values[SESSION_LABELS.host]);
  context.hikyaku = textValue(values[SESSION_LABELS.hikyaku]);
  return context;
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
    context: emptyContext(),
    checkpoints: {},
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

  record.context = sessionContext(tables.find(isSessionTable));

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
      if (parsed === undefined) continue;
      parsed.checkpoints = checkpointValues(join(directory, build));
      found.push(parsed);
    }
  }
  return found;
}

/** ビルドの progress.jsonl から区切りの値を読む。読めなければ欠けとして扱う */
function checkpointValues(buildDirectory: string): Partial<Record<keyof ContextBudget, number>> {
  try {
    const values: Partial<Record<keyof ContextBudget, number>> = {};
    for (const entry of checkpointsOf(readProgress(buildDirectory), DEFAULT_CONTEXT_BUDGET)) {
      values[entry.checkpoint] = entry.tokens;
    }
    return values;
  } catch {
    return {};
  }
}

/** 「5」「未指定」「あり」のうち数値だけを返す */
export function numericValue(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  if (!/^\s*\d+\s*$/.test(cell)) return undefined;
  return Number.parseInt(cell, 10);
}

export type GroupKey = "model" | "hikyaku" | "host";

export const GROUP_KEYS: GroupKey[] = ["model", "hikyaku", "host"];

/**
 * 分ける軸の値。ホストは版を落として「Claude Code」「Codex」で分ける
 * （版ごとに分けると件数が散って比べられない）
 */
export function groupValue(record: BpRecord, key: GroupKey): string {
  const value = record.context[key];
  if (value === undefined) return "—";
  return key === "host" ? value.replace(/\s+v?\d+(\.\d+)+\S*$/, "") : value;
}

export interface GroupSummary {
  key: string;
  count: number;
  /** 実績 BP とピークの両方があるビルドの数 */
  paired: number;
  meanActual: number | undefined;
  meanPeak: number | undefined;
  minPeak: number | undefined;
  maxPeak: number | undefined;
  /** 実績 1BP あたりのピーク（ピーク ÷ 実績 BP の平均） */
  peakPerBp: number | undefined;
}

function mean(values: number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function summarizeGroup(key: string, records: BpRecord[]): GroupSummary {
  const actuals = records.map((r) => r.actual).filter((v): v is number => v !== undefined);
  const peaks = records.map((r) => r.context.peak).filter((v): v is number => v !== undefined);
  const paired = records.filter((r) => r.actual !== undefined && r.actual > 0 && r.context.peak !== undefined);
  return {
    key,
    count: records.length,
    paired: paired.length,
    meanActual: mean(actuals),
    meanPeak: mean(peaks),
    minPeak: peaks.length === 0 ? undefined : Math.min(...peaks),
    maxPeak: peaks.length === 0 ? undefined : Math.max(...peaks),
    peakPerBp: mean(paired.map((r) => (r.context.peak as number) / (r.actual as number))),
  };
}

/** 軸の値ごとに束ねる。並びは最初に現れた順 */
export function groupRecords(records: BpRecord[], key: GroupKey): { key: string; records: BpRecord[] }[] {
  const groups = new Map<string, BpRecord[]>();
  for (const record of records) {
    const value = groupValue(record, key);
    groups.set(value, [...(groups.get(value) ?? []), record]);
  }
  return [...groups].map(([value, members]) => ({ key: value, records: members }));
}
