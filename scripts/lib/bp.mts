/**
 * BP（ビルドポイント）の基準表と算出。
 *
 * 基準表は **ワークスペースの持ち物** で、`{HIKYAKU_ROOT}/bp-guide/` に置く。
 *
 *   rules.toml   正本。スクリプトが読むのはこれだけ
 *   README.md    人間向けの説明。表の部分はマーカーブロックで rules.toml から生成する
 *   cases.toml   期待値テスト。入力 → 期待 BP。規則を変えたときの回帰を止める
 *
 * アプリケーションの特性（1ファイルの粒度、フレームワークの定型量、既存コードの
 * 結合度）で、同じ規模の実装でも1セッションに収まる量が変わる。だから Hikyaku 側で
 * 統一の基準を固定せず、ディレクトリが無ければ既定値（DEFAULT_BP_RULES）で動く。
 *
 * 基準表への当てはめ（値 → BP）はここが決定的に行う。LLM の仕事は **入力値の
 * 見積もり**（新規ファイル数はいくつか、影響ファイル数はいくつか）だけになる。
 * 見積もりが外れたとき、「入力値を読み違えた」のか「基準表がこのリポジトリに
 * 合っていない」のかを切り分けられるようにするための分離。
 *
 * モデル:
 *   ベースBP  = 各指標（metrics）の値を上限表に当てて BP にし、その最大値
 *   加算BP    = 加算要素（additions）の合計。3種類:
 *                 flag    該当すれば +bp
 *                 per     1単位につき +per（free 単位まで無料、cap で上限）
 *                 tiered  値を上限表に当てて +bp[i]
 *               加算要素は input で既存の指標の値を参照できる（同じ値を二度渡させない）
 *   BP        = ベースBP + 加算BP
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HikyakuError } from "./errors.mts";
import { upsertMarkerBlock } from "./markdown.mts";
import { parseToml, TomlError, type TomlTable, type TomlValue } from "./toml.mts";

export const BP_GUIDE_DIR = "bp-guide";
export const BP_RULES_FILE = "rules.toml";
export const BP_README_FILE = "README.md";
export const BP_CASES_FILE = "cases.toml";
/** README.md の生成ブロックを囲むマーカー（docs link の hikyaku:docs と同じ方式） */
export const BP_GUIDE_MARKER = "hikyaku:bp-guide";

/** ベースBPの指標。value が upper[i] 以下なら levels[i]。全部超えたら最後の level */
export interface BpMetric {
  key: string;
  label: string;
  upper: number[];
}

interface AdditionBase {
  key: string;
  label: string;
  /** 値の出どころ。既定は自分のキー。指標のキーならその値を共有する */
  input: string;
  examples: string | undefined;
}

export interface BpFlagAddition extends AdditionBase {
  kind: "flag";
  bp: number;
}

export interface BpPerAddition extends AdditionBase {
  kind: "per";
  per: number;
  /** この単位数までは加算しない */
  free: number;
  /** 加算の上限。無制限なら undefined */
  cap: number | undefined;
}

export interface BpTieredAddition extends AdditionBase {
  kind: "tiered";
  /** value が upper[i] 以下なら bp[i]。全部超えたら bp の最後 */
  upper: number[];
  bp: number[];
}

export type BpAddition = BpFlagAddition | BpPerAddition | BpTieredAddition;

export interface BpRules {
  /** 指標の段階に対応するBP。昇順 */
  levels: number[];
  metrics: BpMetric[];
  additions: BpAddition[];
  /** 読み込んだファイル。既定値を使ったときは undefined */
  source: string | undefined;
}

/** `bp actual` が差分から測る指標のキー。基準表がこのキーを持つときだけ流し込む */
export const MEASURED_METRIC_KEYS = { newFiles: "new_files", lines: "lines" } as const;

/**
 * 既定の基準表。v1 から使ってきた bp-guide.md の表を、境界の重なりを解いて
 * 決定的に当てられる形にしたもの（「1」が BP1 と BP2 の両方に載る等の曖昧さを排除）。
 */
export const DEFAULT_BP_RULES: BpRules = {
  levels: [1, 2, 3, 5, 8, 13],
  metrics: [
    { key: "new_files", label: "新規ファイル数", upper: [2, 5, 15, 20, 30] },
    { key: "lines", label: "実装行数（テスト含む）", upper: [200, 500, 1000, 2000, 3000] },
    { key: "api_operations", label: "API操作数", upper: [0, 1, 2, 4, 7] },
    { key: "screens", label: "画面/ページ数", upper: [0, 1, 2, 3, 5] },
    { key: "db_entities", label: "DBテーブル/エンティティ数", upper: [0, 1, 3, 4, 6] },
  ],
  additions: [
    {
      kind: "tiered",
      key: "impact_files",
      label: "影響ファイル数",
      input: "impact_files",
      upper: [3, 6, 10],
      bp: [0, 1, 3, 4],
      examples: "変更の影響を理解するために読み込むファイル。変更するファイルより広い",
    },
    {
      kind: "flag",
      key: "setup",
      label: "基盤セットアップを含む",
      input: "setup",
      bp: 1,
      examples: "ORM導入、UIライブラリ初期化、CI構築",
    },
    {
      kind: "flag",
      key: "external_api",
      label: "外部API連携を含む",
      input: "external_api",
      bp: 1,
      examples: "認証プロバイダ、決済API、S3等",
    },
    {
      kind: "flag",
      key: "refactor",
      label: "既存コードの大規模リファクタ",
      input: "refactor",
      bp: 1,
      examples: "新規より読み込みコストが大きい",
    },
  ],
  source: undefined,
};

/**
 * CLI のグローバルオプションや bp コマンド自身のオプションと衝突するキー。
 * 基準表のキーはそのまま `--<key>` になるので、ここにあるものは受け付けない。
 */
const RESERVED_KEYS = new Set([
  "json",
  "root",
  "profile",
  "dry_run",
  "help",
  "version",
  "base",
  "no_fetch",
  "markdown",
  "workspace",
  "builtin",
]);

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function bpGuideDir(hikyakuRoot: string): string {
  return join(hikyakuRoot, BP_GUIDE_DIR);
}
export function bpRulesPath(hikyakuRoot: string): string {
  return join(bpGuideDir(hikyakuRoot), BP_RULES_FILE);
}
export function bpReadmePath(hikyakuRoot: string): string {
  return join(bpGuideDir(hikyakuRoot), BP_README_FILE);
}
export function bpCasesPath(hikyakuRoot: string): string {
  return join(bpGuideDir(hikyakuRoot), BP_CASES_FILE);
}

/** 基準表のキーを CLI のフラグ名にする（new_files → new-files） */
export function flagNameOf(key: string): string {
  return key.replace(/_/g, "-");
}

/** 入力の型。flag は真偽値、それ以外は0以上の整数 */
export function inputKindOf(rules: BpRules, key: string): "count" | "flag" | undefined {
  if (rules.metrics.some((m) => m.key === key)) return "count";
  const addition = rules.additions.find((a) => a.input === key);
  if (addition === undefined) return undefined;
  return addition.kind === "flag" ? "flag" : "count";
}

/** 入力として受け付けるキーの一覧（指標 + 指標を参照しない加算要素） */
export function inputKeys(rules: BpRules): { key: string; kind: "count" | "flag"; label: string }[] {
  const keys: { key: string; kind: "count" | "flag"; label: string }[] = rules.metrics.map((m) => ({
    key: m.key,
    kind: "count",
    label: m.label,
  }));
  for (const addition of rules.additions) {
    if (addition.input !== addition.key) continue;
    keys.push({ key: addition.key, kind: addition.kind === "flag" ? "flag" : "count", label: addition.label });
  }
  return keys;
}

/**
 * ワークスペースの基準表を読む。無ければ既定値。
 *
 * 壊れているときはエラーにする。既定値へ黙って落とすと、「調整したのに効かない」
 * という最も気づきにくい壊れ方になる。
 */
export function loadBpRules(hikyakuRoot: string): BpRules {
  const path = bpRulesPath(hikyakuRoot);
  if (!existsSync(path)) return DEFAULT_BP_RULES;
  return parseBpRules(readFileSync(path, "utf8"), path);
}

function parseTomlFile(source: string, path: string): TomlTable {
  try {
    return parseToml(source);
  } catch (error) {
    if (error instanceof TomlError) throw new HikyakuError(`${path} を解析できません: ${error.message}`);
    throw error;
  }
}

export function parseBpRules(source: string, path: string): BpRules {
  const root = parseTomlFile(source, path);
  const fail = (message: string): never => {
    throw new HikyakuError(`${path}: ${message}`);
  };

  for (const key of Object.keys(root)) {
    if (!["levels", "metrics", "additions"].includes(key)) {
      fail(`不明なキーです: ${key}（使えるのは levels / [metrics.*] / [additions.*]）`);
    }
  }

  const levels = readIntegerArray(root["levels"], "levels", fail);
  if (levels.length < 2) fail("levels は2段階以上が必要です");
  for (let i = 1; i < levels.length; i += 1) {
    if ((levels[i] as number) <= (levels[i - 1] as number)) fail("levels は昇順で並べてください");
  }
  if (levels.some((n) => n < 1)) fail("levels は 1 以上の整数にしてください");

  const metrics: BpMetric[] = [];
  const metricsTable = readTable(root["metrics"], "metrics", fail);
  for (const [key, raw] of Object.entries(metricsTable)) {
    const where = `metrics.${key}`;
    validateKey(key, where, fail);
    const entry = readTable(raw, where, fail);
    expectKeys(entry, where, ["label", "upper"], ["label", "upper"], fail);
    const upper = readIntegerArray(entry["upper"], `${where}.upper`, fail);
    if (upper.length !== levels.length - 1) {
      fail(`${where}.upper は levels より1つ少ない ${levels.length - 1} 個の上限が必要です`);
    }
    assertNonDecreasing(upper, `${where}.upper`, fail);
    metrics.push({ key, label: readLabel(entry, where, fail), upper });
  }
  if (metrics.length === 0) fail("[metrics.*] が1つも定義されていません");

  const additions: BpAddition[] = [];
  const additionsTable = readTable(root["additions"] ?? {}, "additions", fail);
  for (const [key, raw] of Object.entries(additionsTable)) {
    const where = `additions.${key}`;
    validateKey(key, where, fail);
    if (metrics.some((m) => m.key === key)) {
      fail(`${where} は指標と同じキーです。指標の値を使うなら input = "${key}" を書き、加算要素には別の名前を付けてください`);
    }
    const entry = readTable(raw, where, fail);
    const label = readLabel(entry, where, fail);
    const examples = readOptionalString(entry, "examples", where, fail);
    const input = readOptionalString(entry, "input", where, fail) ?? key;
    if (input !== key && !metrics.some((m) => m.key === input)) {
      fail(`${where}.input = "${input}" に対応する指標がありません`);
    }

    if (entry["per"] !== undefined) {
      expectKeys(entry, where, ["label", "input", "examples", "per", "free", "cap"], ["per"], fail);
      const per = readInteger(entry["per"], `${where}.per`, fail);
      const free = entry["free"] === undefined ? 0 : readInteger(entry["free"], `${where}.free`, fail);
      const cap = entry["cap"] === undefined ? undefined : readInteger(entry["cap"], `${where}.cap`, fail);
      additions.push({ kind: "per", key, label, input, examples, per, free, cap });
      continue;
    }
    if (entry["upper"] !== undefined) {
      expectKeys(entry, where, ["label", "input", "examples", "upper", "bp"], ["upper", "bp"], fail);
      const upper = readIntegerArray(entry["upper"], `${where}.upper`, fail);
      const bp = readIntegerArray(entry["bp"], `${where}.bp`, fail);
      if (bp.length !== upper.length + 1) {
        fail(`${where}.bp は upper より1つ多い ${upper.length + 1} 個が必要です（全段階を超えた分）`);
      }
      assertNonDecreasing(upper, `${where}.upper`, fail);
      additions.push({ kind: "tiered", key, label, input, examples, upper, bp });
      continue;
    }
    expectKeys(entry, where, ["label", "input", "examples", "bp"], ["bp"], fail);
    if (input !== key) {
      fail(`${where}: input で指標を参照する加算要素は per か upper/bp で書いてください（flag 型は真偽値を取るため）`);
    }
    additions.push({ kind: "flag", key, label, input, examples, bp: readInteger(entry["bp"], `${where}.bp`, fail) });
  }

  return { levels, metrics, additions, source: path };
}

function validateKey(key: string, where: string, fail: (m: string) => never): void {
  if (!KEY_PATTERN.test(key)) {
    fail(`${where}: キーは小文字英数字とアンダースコアで書いてください（--${flagNameOf(key)} として使うため）`);
  }
  if (RESERVED_KEYS.has(key)) fail(`${where}: ${key} は CLI のオプション名と衝突するため使えません`);
}

function readTable(value: TomlValue | undefined, where: string, fail: (m: string) => never): TomlTable {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(`${where} はテーブル（[${where}]）にしてください`);
  }
  return value;
}

function readLabel(entry: TomlTable, where: string, fail: (m: string) => never): string {
  const label = entry["label"];
  if (typeof label !== "string" || label.trim() === "") return fail(`${where}.label は空でない文字列にしてください`);
  return label;
}

function readOptionalString(
  entry: TomlTable,
  key: string,
  where: string,
  fail: (m: string) => never,
): string | undefined {
  const value = entry[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") return fail(`${where}.${key} は文字列にしてください`);
  return value;
}

function expectKeys(
  entry: TomlTable,
  where: string,
  allowed: string[],
  required: string[],
  fail: (m: string) => never,
): void {
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) fail(`${where}.${key} は不明なキーです（使えるのは ${allowed.join(" / ")}）`);
  }
  for (const key of required) {
    if (entry[key] === undefined) fail(`${where}.${key} がありません`);
  }
}

function readInteger(value: TomlValue | undefined, where: string, fail: (m: string) => never): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return fail(`${where} は0以上の整数にしてください`);
  }
  return value;
}

function readIntegerArray(value: TomlValue | undefined, where: string, fail: (m: string) => never): number[] {
  if (!Array.isArray(value) || value.length === 0) return fail(`${where} は整数の配列にしてください`);
  return value.map((item) => readInteger(item, where, fail));
}

function assertNonDecreasing(values: number[], where: string, fail: (m: string) => never): void {
  for (let i = 1; i < values.length; i += 1) {
    if ((values[i] as number) < (values[i - 1] as number)) fail(`${where} は昇順で並べてください`);
  }
}

/** 値を上限表に当てて段階の添字を返す。全部超えたら upper.length */
function tierIndex(upper: number[], value: number): number {
  const index = upper.findIndex((limit) => value <= limit);
  return index === -1 ? upper.length : index;
}

export function metricBp(rules: BpRules, metric: BpMetric, value: number): number {
  return rules.levels[tierIndex(metric.upper, value)] as number;
}

export function additionBp(addition: BpAddition, value: number | boolean): number {
  if (addition.kind === "flag") return value === true ? addition.bp : 0;
  const count = typeof value === "boolean" ? (value ? 1 : 0) : value;
  if (addition.kind === "tiered") return addition.bp[tierIndex(addition.upper, count)] as number;
  const raw = addition.per * Math.max(0, count - addition.free);
  return addition.cap === undefined ? raw : Math.min(addition.cap, raw);
}

/** 入力値。キーは指標か、指標を参照しない加算要素 */
export type BpInput = Record<string, number | boolean>;

/**
 * 入力値の型を基準表と突き合わせる。基準表に無いキーはエラー。
 * `impactfiles` のようなタイプミスを黙って捨てると、加算要素の取りこぼしという
 * まさに防ぎたい過小見積もりになる。
 */
export function validateInput(rules: BpRules, input: BpInput, where: string): void {
  for (const [key, value] of Object.entries(input)) {
    const kind = inputKindOf(rules, key);
    if (kind === undefined) {
      throw new HikyakuError(
        `${where}: ${key} は基準表にありません`,
        `使える入力: ${inputKeys(rules)
          .map((k) => (k.kind === "flag" ? k.key : `${k.key}=<n>`))
          .join("  ")}`,
      );
    }
    if (kind === "flag" && typeof value !== "boolean") {
      throw new HikyakuError(`${where}: ${key} は真偽値で指定してください`);
    }
    if (kind === "count" && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
      throw new HikyakuError(`${where}: ${key} は0以上の整数で指定してください`);
    }
  }
}

export interface MetricLine {
  key: string;
  label: string;
  value: number | undefined;
  bp: number | undefined;
  /** ベースBPになった指標か（同点なら最初の1つ） */
  isBase: boolean;
}

export interface AdditionLine {
  key: string;
  label: string;
  kind: BpAddition["kind"];
  /** 値の出どころのキー。指標を参照していれば指標のキー */
  input: string;
  value: number | boolean | undefined;
  bp: number;
}

export interface BpBreakdown {
  metrics: MetricLine[];
  baseBp: number;
  additions: AdditionLine[];
  additionBp: number;
  total: number;
}

/** 基準表に当てて BP を算出する。判断は入らない */
export function estimateBp(rules: BpRules, input: BpInput): BpBreakdown {
  const metrics: MetricLine[] = rules.metrics.map((metric) => {
    const raw = input[metric.key];
    const value = typeof raw === "number" ? raw : undefined;
    return {
      key: metric.key,
      label: metric.label,
      value,
      bp: value === undefined ? undefined : metricBp(rules, metric, value),
      isBase: false,
    };
  });

  // 指標が1つも無ければ最小のBP。ゼロにはしない（BP 0 のビルドは存在しない）
  let baseBp = rules.levels[0] as number;
  let baseIndex = -1;
  metrics.forEach((line, i) => {
    if (line.bp !== undefined && (baseIndex === -1 || line.bp > baseBp)) {
      baseBp = line.bp;
      baseIndex = i;
    }
  });
  if (baseIndex !== -1) (metrics[baseIndex] as MetricLine).isBase = true;

  const additions: AdditionLine[] = rules.additions.map((addition) => {
    const value = input[addition.input];
    return {
      key: addition.key,
      label: addition.label,
      kind: addition.kind,
      input: addition.input,
      value,
      bp: value === undefined ? 0 : additionBp(addition, value),
    };
  });
  const additionTotal = additions.reduce((sum, line) => sum + line.bp, 0);

  return { metrics, baseBp, additions, additionBp: additionTotal, total: baseBp + additionTotal };
}

export type BpVerdict = "fits" | "split-recommended" | "split-required";

/**
 * bp_max に対する判定。build-manager の閾値と同じ:
 *   bp_max + 1 以上         分割必須
 *   bp_max − 2 〜 bp_max    分割推奨（分割コストが大きい場合のみ許容）
 *   それ未満                1セッションで完結見込み
 */
export function bpVerdict(total: number, bpMax: number): BpVerdict {
  if (total > bpMax) return "split-required";
  if (total >= bpMax - 2) return "split-recommended";
  return "fits";
}

export function describeVerdict(verdict: BpVerdict, bpMax: number): string {
  if (verdict === "split-required") return `分割必須（bp_max ${bpMax} を超えています）`;
  if (verdict === "split-recommended") return `分割推奨（${bpMax - 2}〜${bpMax}。分割コストが大きい場合のみ許容）`;
  return `1セッションで完結見込み（${bpMax - 3} 以下）`;
}

function formatValue(value: number | boolean | undefined): string {
  if (value === undefined) return "未指定";
  if (typeof value === "boolean") return value ? "あり" : "なし";
  return String(value);
}

/**
 * plan.md / issue.md / retrospective.md に貼る Markdown 表。
 *
 * 未指定の指標も「未指定」として出す。省くと、考慮しなかったことがレビューで
 * 見えなくなる（過小見積もりの多くは加算要素の取りこぼしから来る）。
 * 見出しは bp history が読むので変えない。
 */
export const BREAKDOWN_HEADERS = ["項目", "値", "BP"];

export function renderBreakdownMarkdown(breakdown: BpBreakdown): string {
  const lines = [`| ${BREAKDOWN_HEADERS.join(" | ")} |`, "|------|----|----|"];
  for (const line of breakdown.metrics) {
    const bp = line.bp === undefined ? "—" : String(line.bp);
    lines.push(`| ${line.label} | ${formatValue(line.value)} | ${bp}${line.isBase ? "（ベース）" : ""} |`);
  }
  lines.push(`| ベースBP（指標の最大値） | — | ${breakdown.baseBp} |`);
  for (const line of breakdown.additions) {
    lines.push(`| ${line.label} | ${formatValue(line.value)} | +${line.bp} |`);
  }
  lines.push(`| **合計** | — | **${breakdown.total}BP** |`);
  return lines.join("\n");
}

/** 人間可読の内訳（CLI の既定出力） */
export function renderBreakdownRows(breakdown: BpBreakdown): string[][] {
  const rows: string[][] = [];
  for (const line of breakdown.metrics) {
    rows.push([line.label, formatValue(line.value), line.bp === undefined ? "—" : `${line.bp}${line.isBase ? " ← ベース" : ""}`]);
  }
  rows.push(["ベースBP", "", String(breakdown.baseBp)]);
  for (const line of breakdown.additions) {
    rows.push([line.label, formatValue(line.value), `+${line.bp}`]);
  }
  rows.push(["合計", "", String(breakdown.total)]);
  return rows;
}

/** 段階の範囲を表示用にする（0–2 / 3–5 / 31+） */
export function rangeLabels(upper: number[]): string[] {
  const labels: string[] = [];
  let lower = 0;
  for (const limit of upper) {
    labels.push(limit === lower ? String(limit) : `${lower}–${limit}`);
    lower = limit + 1;
  }
  labels.push(`${lower}+`);
  return labels;
}

export function describeAddition(addition: BpAddition): string {
  if (addition.kind === "flag") return `+${addition.bp}`;
  if (addition.kind === "tiered") {
    return rangeLabels(addition.upper)
      .map((range, i) => `${range}: +${addition.bp[i]}`)
      .join(" / ");
  }
  const parts = [`1つにつき +${addition.per}`];
  if (addition.free > 0) parts.push(`${addition.free} まで無料`);
  if (addition.cap !== undefined) parts.push(`上限 +${addition.cap}`);
  return parts.join("、");
}

/** 加算要素の入力の書き方 */
export function describeAdditionInput(addition: BpAddition): string {
  if (addition.input !== addition.key) return `\`--${flagNameOf(addition.input)}\` の値を使う`;
  return addition.kind === "flag" ? `\`--${flagNameOf(addition.key)}\`` : `\`--${flagNameOf(addition.key)} <n>\``;
}

/** 基準表そのものを Markdown にする。README.md のマーカーブロックと bp guide --markdown が使う */
export function renderRulesMarkdown(rules: BpRules): string {
  const lines: string[] = [];
  lines.push("### ベースBP", "", "各指標の値を当てはめた BP のうち、最大値をベースBPとします。", "");
  lines.push(`| 指標 | 入力 | ${rules.levels.map((l) => `BP${l}`).join(" | ")} |`);
  lines.push(`|------|------|${rules.levels.map(() => "----").join("|")}|`);
  for (const metric of rules.metrics) {
    lines.push(`| ${metric.label} | \`--${flagNameOf(metric.key)} <n>\` | ${rangeLabels(metric.upper).join(" | ")} |`);
  }
  lines.push("", "### 加算BP", "", "該当する要素をベースBPに足します。", "");
  lines.push("| 要素 | 入力 | 加算 | 例 |", "|------|------|------|---|");
  for (const addition of rules.additions) {
    lines.push(
      `| ${addition.label} | ${describeAdditionInput(addition)} | ${describeAddition(addition)} | ${addition.examples ?? ""} |`,
    );
  }
  return lines.join("\n");
}

/** README.md のマーカーブロックの中身 */
export function renderReadmeBlock(rules: BpRules): string {
  return [
    renderRulesMarkdown(rules),
    "",
    `この表は Hikyaku が ${BP_RULES_FILE} から生成しています（\`hikyaku bp render\`）。`,
    `編集は ${BP_RULES_FILE} 側で行ってください。`,
  ].join("\n");
}

/** README.md に生成ブロックを埋め込む（既存の文章は保持する） */
export function upsertReadmeBlock(source: string, rules: BpRules): { content: string; created: boolean } {
  return upsertMarkerBlock(source, BP_GUIDE_MARKER, renderReadmeBlock(rules));
}

function tomlString(text: string): string {
  return JSON.stringify(text);
}

/**
 * ワークスペースへ置く rules.toml の雛形。既定値から生成するので、
 * 既定の基準表はこのファイルと DEFAULT_BP_RULES の二重管理にならない。
 */
export function renderRulesScaffold(version: string, rules: BpRules = DEFAULT_BP_RULES): string {
  const lines = [
    "# ビルドポイント（BP）の基準表 — このワークスペースの持ち物です",
    `# Hikyaku ${version} の既定値から生成。以後はこのファイルが正で、プラグインを更新しても変わりません。`,
    "#",
    "# 人間向けの説明は README.md にあります。このファイルを変えたら",
    "#   hikyaku bp render   README.md の表を再生成する",
    "#   hikyaku bp test     cases.toml の期待値を確かめる",
    "# を実行してください。validate が食い違いを検出します。",
    "",
    "# 指標の段階に対応する BP。昇順。metrics.*.upper はこれより1つ少ない個数",
    `levels = [${rules.levels.join(", ")}]`,
    "",
    "# ベースBP: 各指標の値を upper に当てて BP にし、最大値を採る。",
    "# 値 <= upper[i] なら levels[i]、すべて超えたら levels の最後。",
    `# ${MEASURED_METRIC_KEYS.newFiles} と ${MEASURED_METRIC_KEYS.lines} は bp actual が差分から測ります（キーを変えないこと）。`,
    "# 指標は足せます（例: [metrics.migrations]）。キーがそのまま --<キー> になります。",
  ];
  for (const metric of rules.metrics) {
    lines.push("", `[metrics.${metric.key}]`, `label = ${tomlString(metric.label)}`, `upper = [${metric.upper.join(", ")}]`);
  }
  lines.push(
    "",
    "# 加算BP: 該当する要素を足す。書き方は3種類。",
    "#   flag    bp = 1                      --<キー> が付いていれば +1",
    "#   per     per = 1, free = 0, cap = 4  1単位につき +1（free まで無料、cap で上限）",
    "#   tiered  upper = [3, 6], bp = [0, 1, 3]  値 <= upper[i] なら +bp[i]、超えたら最後",
    "# input = \"<指標のキー>\" を書くと、その指標の値をそのまま使います（同じ値を二度渡させない）。",
    "#",
    "# 例: テーブル1つにつき Entity 設計で +1（DBテーブル数の入力を共有）",
    "#   [additions.entity_design]",
    "#   label = \"Entity 設計\"",
    "#   input = \"db_entities\"",
    "#   per = 1",
    "#   cap = 4",
    "#",
    "# 例: 決済 API を叩くなら +2",
    "#   [additions.payment_api]",
    "#   label = \"決済APIを叩く\"",
    "#   bp = 2",
  );
  for (const addition of rules.additions) {
    lines.push("", `[additions.${addition.key}]`, `label = ${tomlString(addition.label)}`);
    if (addition.input !== addition.key) lines.push(`input = ${tomlString(addition.input)}`);
    if (addition.kind === "tiered") {
      lines.push(`upper = [${addition.upper.join(", ")}]`, `bp = [${addition.bp.join(", ")}]`);
    } else if (addition.kind === "per") {
      lines.push(`per = ${addition.per}`);
      if (addition.free > 0) lines.push(`free = ${addition.free}`);
      if (addition.cap !== undefined) lines.push(`cap = ${addition.cap}`);
    } else {
      lines.push(`bp = ${addition.bp}`);
    }
    if (addition.examples !== undefined) lines.push(`examples = ${tomlString(addition.examples)}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * README.md の雛形。マーカーの外側は自由に書き換えてよい文章。
 * 入力値の数え方（LLM が読む部分）をここに置くのは、基準表と同じ場所に
 * あれば「何を数えるか」と「どう点にするか」が一緒に読めるため。
 */
export function renderReadmeScaffold(rules: BpRules = DEFAULT_BP_RULES): string {
  const prose = [
    "# BP 見積もりガイド",
    "",
    "BP（ビルドポイント）は、AI エージェントの1セッション（20万トークン）で実装が完了するかを",
    "判断する定量指標です。ビルドの分割単位を決めるために使います。",
    "",
    "基準表はこのワークスペースの持ち物です。同じ規模の実装でも、フレームワークの定型量や",
    "既存コードの結合度によって1セッションに収まる量は変わります。振り返りで見積もりと実績の",
    "乖離が続いたら、このリポジトリに合うよう `rules.toml` を調整してください。",
    "",
    "## 見積もりの手順",
    "",
    "1. ビルドが触るワークスペース（パッケージ）を特定する",
    "2. ワークスペースごとに指標と加算要素の値を見積もり、`hikyaku bp estimate` に渡す",
    "3. 複数ワークスペースにまたがるなら、それぞれの BP を合計する",
    "",
    "表への当てはめはコマンドが行います。あなたが決めるのは入力値だけです。",
    "",
    "## 入力値の数え方",
    "",
    "過小見積もりの多くは、表の読み違えではなく入力値の数え漏れから来ます。",
    "",
    "- **新規ファイル数**: 作成するファイルを名前で列挙してから数える。テスト・型定義・",
    "  マイグレーション・設定も含める",
    "- **実装行数**: 列挙したファイルごとに概算し、合計する。テストを含める",
    "- **影響ファイル数**: 変更するファイルではなく、変更の影響を理解するために読むファイル。",
    "  codebase-survey.md と設計ドキュメントから、参照元・呼び出し元・共有する型まで辿る",
    "- **加算要素**: 該当するものをすべて付ける。迷ったら付けて、レビューで外す",
    "",
    "（このリポジトリ固有の数え方があれば、ここに追記してください。例:",
    "「マイグレーション1本は新規ファイル2つとして数える」）",
    "",
    "## 基準表",
    "",
  ].join("\n");
  return upsertMarkerBlock(prose, BP_GUIDE_MARKER, renderReadmeBlock(rules)).content;
}

// ---------------------------------------------------------------------------
// 期待値テスト（cases.toml）
// ---------------------------------------------------------------------------

export interface BpCase {
  name: string;
  description: string | undefined;
  input: BpInput;
  expect: number;
}

/** 既定ルール自体の回帰テスト。ワークスペースの cases.toml の雛形にもなる */
export const DEFAULT_BP_CASES: BpCase[] = [
  {
    name: "minimal",
    description: "1ファイルの小さな修正。最小の BP",
    input: { new_files: 1, lines: 80 },
    expect: 1,
  },
  {
    name: "base_is_max_of_metrics",
    description: "行数は BP2 だがファイル数が BP3。ベースは最大値を採る",
    input: { new_files: 8, lines: 400 },
    expect: 3,
  },
  {
    name: "additions_stack",
    description: "影響ファイル 7（+3）と基盤セットアップ（+1）が積み上がる",
    input: { new_files: 5, lines: 800, impact_files: 7, setup: true },
    expect: 7,
  },
  {
    name: "split_required",
    description: "新規 25 ファイルで BP8、リファクタ +1 で bp_max 8 を超える",
    input: { new_files: 25, lines: 2500, refactor: true },
    expect: 9,
  },
  {
    name: "boundary_resolved",
    description: "旧ガイドで BP1 と BP2 の両方に載っていた「テーブル1」は BP2 に寄せる",
    input: { db_entities: 1 },
    expect: 2,
  },
];

export function loadBpCases(hikyakuRoot: string): { cases: BpCase[]; source: string | undefined } {
  const path = bpCasesPath(hikyakuRoot);
  if (!existsSync(path)) return { cases: DEFAULT_BP_CASES, source: undefined };
  return { cases: parseBpCases(readFileSync(path, "utf8"), path), source: path };
}

export function parseBpCases(source: string, path: string): BpCase[] {
  const root = parseTomlFile(source, path);
  const fail = (message: string): never => {
    throw new HikyakuError(`${path}: ${message}`);
  };
  for (const key of Object.keys(root)) {
    if (key !== "cases") fail(`不明なキーです: ${key}（ケースは [cases.<名前>] に書きます）`);
  }
  const table = readTable(root["cases"] ?? {}, "cases", fail);
  const cases: BpCase[] = [];
  for (const [name, raw] of Object.entries(table)) {
    const where = `cases.${name}`;
    const entry = readTable(raw, where, fail);
    expectKeys(entry, where, ["description", "input", "expect"], ["input", "expect"], fail);
    const inputTable = readTable(entry["input"], `${where}.input`, fail);
    const input: BpInput = {};
    for (const [key, value] of Object.entries(inputTable)) {
      if (typeof value !== "boolean" && typeof value !== "number") {
        fail(`${where}.input.${key} は整数か真偽値にしてください`);
      }
      input[key] = value as number | boolean;
    }
    cases.push({
      name,
      description: readOptionalString(entry, "description", where, fail),
      input,
      expect: readInteger(entry["expect"], `${where}.expect`, fail),
    });
  }
  if (cases.length === 0) fail("ケースが1つもありません");
  return cases;
}

export interface BpCaseResult {
  name: string;
  description: string | undefined;
  expect: number;
  actual: number;
  ok: boolean;
  breakdown: BpBreakdown;
}

/** 全ケースを走らせる。入力が基準表に合わない場合はそのケースがエラーになる */
export function runBpCases(rules: BpRules, cases: BpCase[], where: string): BpCaseResult[] {
  return cases.map((c) => {
    validateInput(rules, c.input, `${where} [cases.${c.name}]`);
    const breakdown = estimateBp(rules, c.input);
    return {
      name: c.name,
      description: c.description,
      expect: c.expect,
      actual: breakdown.total,
      ok: breakdown.total === c.expect,
      breakdown,
    };
  });
}

function tomlInputValue(value: number | boolean): string {
  return typeof value === "boolean" ? String(value) : String(value);
}

export function renderCasesScaffold(cases: BpCase[] = DEFAULT_BP_CASES): string {
  const lines = [
    "# BP 基準表の期待値テスト — hikyaku bp test が全件を照合します",
    "#",
    "# rules.toml を変えたら、その変更を確かめるケースをここに足してください。",
    "# ケース名は [cases.<名前>] で、失敗時にそのまま表示されます。",
    "# input のキーは rules.toml の指標・加算要素のキーです（フラグ型は true / false）。",
    "#",
    "# 例:",
    "#   [cases.payment_flow]",
    "#   description = \"決済 API 1本、新規3ファイル\"",
    "#   expect = 4",
    "#   [cases.payment_flow.input]",
    "#   new_files = 3",
    "#   lines = 400",
    "#   payment_api = true",
  ];
  for (const c of cases) {
    lines.push("", `[cases.${c.name}]`);
    if (c.description !== undefined) lines.push(`description = ${tomlString(c.description)}`);
    lines.push(`expect = ${c.expect}`, `[cases.${c.name}.input]`);
    for (const [key, value] of Object.entries(c.input)) lines.push(`${key} = ${tomlInputValue(value)}`);
  }
  lines.push("");
  return lines.join("\n");
}
