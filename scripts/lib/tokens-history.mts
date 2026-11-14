/**
 * 予測ピークの実績を、各ビルドの retrospective.md から集める（tokens history）。
 *
 * retrospective の「予測ピークの振り返り」節はテンプレートで形が固定されている
 * （段階表 / セッション行 / 内訳表 / セッションの実測表 / 差分の集計表）ので、見出し名で読める。
 * LLM が書いた文章の部分（乖離の要因）はここでは読まず、呼び出し元のスキルが直接読む。
 *
 * 読めない項目は undefined にして返す。推測で埋めると「実測した」記録に見えるので、
 * 欠けは欠けのまま表示する。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONTEXT_BUDGET, type ContextBudget } from "./config.mts";
import { cycleDir, cycleDirName, type CycleRecord } from "./cycles.mts";
import { DIFF_LABELS, DIFF_TABLE_HEADERS, parseSplitCount } from "./diff-stats.mts";
import { parseTables, type MarkdownTable } from "./markdown.mts";
import { readProgress } from "./progress.mts";
import { SESSION_LABELS, SESSION_TABLE_HEADERS } from "./session.mts";
import { checkpointsOf } from "./steps/checkpoints.mts";
import { COMPONENTS, type ComponentKey, ESTIMATE_HEADERS, GUIDE_ROW_LABEL, parseTokenAmount } from "./tokens.mts";

/** retrospective.md 内の節の見出し */
export const PEAK_SECTION_HEADING = "予測ピークの振り返り";
export const PEAK_STAGE_HEADERS = ["段階", "予測ピーク"];

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

export interface DiffSummary {
  newFiles: number | undefined;
  addedLines: number | undefined;
  implementationLines: number | undefined;
  testLines: number | undefined;
}

export interface PeakRecord {
  cycle: string;
  build: string;
  path: string;
  /** architect 段階の予測ピーク（issue.md） */
  architect: number | undefined;
  /** builder 段階の予測ピーク（plan.md） */
  builder: number | undefined;
  /** **セッション**: の右側。1セッションで完結したか */
  session: string | undefined;
  /** builder 段階の成分ごとの予測 */
  components: Partial<Record<ComponentKey, number>>;
  /** builder 段階の予測に使ったガイド（「プロジェクト v3」）とそのハッシュ */
  guide: string | undefined;
  guideHash: string | undefined;
  /** セッションの実測（tokens session の表）。無ければ各項目 undefined */
  context: SessionContext;
  /** 差分の集計（tokens history build-NN の表）。無ければ各項目 undefined */
  diff: DiffSummary;
  /** 区切りでのコンテキスト（progress.jsonl から）。記録の無い区切りは含めない */
  checkpoints: Partial<Record<keyof ContextBudget, number>>;
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

function emptyDiff(): DiffSummary {
  return { newFiles: undefined, addedLines: undefined, implementationLines: undefined, testLines: undefined };
}

/** 「312,400」「312400」「380k」をトークン数として読む。「計測不可（…）」「—」は undefined */
export function tokenValue(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  return parseTokenAmount(cell.replace(/\*/g, "").trim());
}

function textValue(cell: string | undefined): string | undefined {
  const plain = cell?.replace(/\*/g, "").trim();
  return plain === undefined || plain === "" || plain === "—" || plain === "-" ? undefined : plain;
}

function hasHeaders(table: MarkdownTable, headers: string[]): boolean {
  return headers.every((h, i) => table.headers[i] === h);
}

function labelOf(row: string[]): string {
  return (row[0] ?? "").replace(/\*/g, "").trim();
}

/** 1列目をラベル、2列目を値として読む */
function valuesOf(table: MarkdownTable): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of table.rows) {
    const label = labelOf(row);
    if (label !== "") values[label] = (row[1] ?? "").trim();
  }
  return values;
}

function sessionContext(table: MarkdownTable | undefined): SessionContext {
  const context = emptyContext();
  if (table === undefined) return context;
  const values = valuesOf(table);
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

function diffSummary(table: MarkdownTable | undefined): DiffSummary {
  const diff = emptyDiff();
  if (table === undefined) return diff;
  const values = valuesOf(table);
  diff.newFiles = parseSplitCount(values[DIFF_LABELS.newFiles])?.total;
  const lines = parseSplitCount(values[DIFF_LABELS.addedLines]);
  diff.addedLines = lines?.total;
  diff.implementationLines = lines?.implementation;
  diff.testLines = lines?.tests;
  return diff;
}

/** 「## 予測ピークの振り返り」から次の同レベル見出しまで */
function peakSection(source: string): string | undefined {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^##\s/.test(line) && line.includes(PEAK_SECTION_HEADING));
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

export function parsePeakRecord(source: string, meta: Pick<PeakRecord, "cycle" | "build" | "path">): PeakRecord | undefined {
  const section = peakSection(source);
  if (section === undefined) return undefined;

  const record: PeakRecord = {
    ...meta,
    architect: undefined,
    builder: undefined,
    session: undefined,
    components: {},
    guide: undefined,
    guideHash: undefined,
    context: emptyContext(),
    diff: emptyDiff(),
    checkpoints: {},
  };

  const tables = parseTables(section);
  const stage = tables.find((t) => hasHeaders(t, PEAK_STAGE_HEADERS));
  if (stage !== undefined) {
    for (const row of stage.rows) {
      const label = labelOf(row);
      const value = tokenValue(row[1]);
      if (/architect/i.test(label)) record.architect = value;
      else if (/builder/i.test(label)) record.builder = value;
    }
  }

  const breakdown = tables.find((t) => hasHeaders(t, ESTIMATE_HEADERS));
  if (breakdown !== undefined) {
    for (const row of breakdown.rows) {
      const label = labelOf(row);
      const component = COMPONENTS.find((c) => c.label === label);
      if (component !== undefined) {
        const value = tokenValue(row[1]);
        if (value !== undefined) record.components[component.key] = value;
      } else if (label === GUIDE_ROW_LABEL) {
        record.guide = textValue(row[1]);
        record.guideHash = textValue(row[2]);
      }
    }
  }

  record.context = sessionContext(tables.find((t) => hasHeaders(t, SESSION_TABLE_HEADERS)));
  record.diff = diffSummary(tables.find((t) => hasHeaders(t, DIFF_TABLE_HEADERS)));

  const session = /\*\*セッション\*\*\s*[:：]\s*(.+)/.exec(section);
  if (session?.[1] !== undefined) record.session = session[1].trim();

  return record;
}

/** 全サイクル（または指定サイクル）の build-NN/retrospective.md を集める */
export function collectPeakRecords(hikyakuRoot: string, records: CycleRecord[]): PeakRecord[] {
  const found: PeakRecord[] = [];
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
      const parsed = parsePeakRecord(readFileSync(path, "utf8"), { cycle: cycleDirName(cycle), build, path });
      if (parsed === undefined) continue;
      parsed.checkpoints = checkpointValues(join(directory, build));
      found.push(parsed);
    }
  }
  return found;
}

/** ビルドの progress.jsonl から区切りの値を読む。読めなければ欠けとして扱う */
export function checkpointValues(buildDirectory: string): Partial<Record<keyof ContextBudget, number>> {
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

/** 実測 − builder 段階の予測。どちらかが無ければ undefined */
export function deviationOf(record: PeakRecord): number | undefined {
  return record.context.peak !== undefined && record.builder !== undefined ? record.context.peak - record.builder : undefined;
}

/** 実測 ÷ builder 段階の予測 */
export function ratioOf(record: PeakRecord): number | undefined {
  return record.context.peak !== undefined && record.builder !== undefined && record.builder > 0
    ? record.context.peak / record.builder
    : undefined;
}

/** 予測がこの割合を超えて外れたビルドを「外れた」と数える（実測 ÷ 予測 が 1 ± この値の外） */
export const GUIDE_REVIEW_TOLERANCE = 0.2;
/** 同じ向きに外れたビルドがこの数あれば、見積もりのガイドの見直しを勧める */
export const GUIDE_REVIEW_MIN_BUILDS = 2;

export interface GuideReview {
  /** 見直しを勧めるか */
  needed: boolean;
  /** 予測と実測の両方があるビルドの数 */
  paired: number;
  /** 過小見積もり（実測が予測を大きく上回った）のビルド */
  under: string[];
  /** 過大見積もりのビルド */
  over: string[];
  /** 見積もりに使ったガイドの版が記録に無く、判定から外したビルド */
  unknownGuide: string[];
  reason: string;
}

/**
 * サイクルの実績から、見積もりのガイドの見直しを勧めるかを決める。
 *
 * 1件だけのぶれでは勧めない。同じ向きに外れたビルドが複数あるときだけ勧める。ガイドの版が
 * 途中で変わっていたら版ごとに数える（直す前と後を混ぜると、直した効果が見えなくなる）。
 * 実測の無いビルドは数えない。ガイドの版が記録に無いビルドも数えない（版が分からないものを
 * 同じ版とみなすと、別の版で見積もったビルドの外れを足し合わせてしまう）。
 */
export function guideReview(records: PeakRecord[]): GuideReview {
  const measured = records.filter((r) => ratioOf(r) !== undefined);
  const unknownGuide = measured.filter((r) => r.guide === undefined).map((r) => r.build);
  const paired = measured.filter((r) => r.guide !== undefined);
  const under: string[] = [];
  const over: string[] = [];
  let needed = false;
  for (const group of groupRecords(paired, "guide")) {
    const groupUnder = group.records.filter((r) => (ratioOf(r) as number) > 1 + GUIDE_REVIEW_TOLERANCE);
    const groupOver = group.records.filter((r) => (ratioOf(r) as number) < 1 - GUIDE_REVIEW_TOLERANCE);
    under.push(...groupUnder.map((r) => r.build));
    over.push(...groupOver.map((r) => r.build));
    if (groupUnder.length >= GUIDE_REVIEW_MIN_BUILDS || groupOver.length >= GUIDE_REVIEW_MIN_BUILDS) needed = true;
  }
  const percent = Math.round(GUIDE_REVIEW_TOLERANCE * 100);
  const excluded = unknownGuide.length === 0 ? "" : `。ガイドの版が記録に無い ${unknownGuide.length} 件は判定から外しました`;
  const base =
    paired.length === 0
      ? measured.length === 0
        ? "予測と実測の両方があるビルドがありません"
        : "ガイドの版が分かるビルドがありません"
      : needed
        ? `同じガイドの版で、同じ向きに ${percent}% を超えて外れたビルドが ${GUIDE_REVIEW_MIN_BUILDS} 件以上あります（過小 ${under.length} 件 / 過大 ${over.length} 件）`
        : `同じ向きに ${percent}% を超えて外れたビルドは ${GUIDE_REVIEW_MIN_BUILDS} 件未満です（過小 ${under.length} 件 / 過大 ${over.length} 件）`;
  return { needed, paired: paired.length, under, over, unknownGuide, reason: `${base}${excluded}` };
}

export type GroupKey = "model" | "hikyaku" | "host" | "guide";

export const GROUP_KEYS: GroupKey[] = ["model", "hikyaku", "host", "guide"];

/**
 * 分ける軸の値。ホストは版を落として「Claude Code」などで分ける（v3 のベータ版の記録には「Codex」もある）
 * （版ごとに分けると件数が散って比べられない）
 */
export function groupValue(record: PeakRecord, key: GroupKey): string {
  const value = key === "guide" ? record.guide : record.context[key];
  if (value === undefined) return "—";
  return key === "host" ? value.replace(/\s+v?\d+(\.\d+)+\S*$/, "") : value;
}

export interface GroupSummary {
  key: string;
  count: number;
  /** 予測（builder 段階）と実測の両方があるビルドの数 */
  paired: number;
  meanPredicted: number | undefined;
  meanMeasured: number | undefined;
  minMeasured: number | undefined;
  maxMeasured: number | undefined;
  /** 実測 − 予測の平均 */
  meanDeviation: number | undefined;
  /** 実測 ÷ 予測の平均 */
  meanRatio: number | undefined;
}

function mean(values: number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function defined<T>(values: (T | undefined)[]): T[] {
  return values.filter((v): v is T => v !== undefined);
}

export function summarizeGroup(key: string, records: PeakRecord[]): GroupSummary {
  const measured = defined(records.map((r) => r.context.peak));
  return {
    key,
    count: records.length,
    paired: defined(records.map(deviationOf)).length,
    meanPredicted: mean(defined(records.map((r) => r.builder))),
    meanMeasured: mean(measured),
    minMeasured: measured.length === 0 ? undefined : Math.min(...measured),
    maxMeasured: measured.length === 0 ? undefined : Math.max(...measured),
    meanDeviation: mean(defined(records.map(deviationOf))),
    meanRatio: mean(defined(records.map(ratioOf))),
  };
}

/** 軸の値ごとに束ねる。並びは最初に現れた順 */
export function groupRecords(records: PeakRecord[], key: GroupKey): { key: string; records: PeakRecord[] }[] {
  const groups = new Map<string, PeakRecord[]>();
  for (const record of records) {
    const value = groupValue(record, key);
    groups.set(value, [...(groups.get(value) ?? []), record]);
  }
  return [...groups].map(([value, members]) => ({ key: value, records: members }));
}
