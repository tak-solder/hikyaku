/**
 * 予測ピーク — ビルドのメインセッションのコンテキストのピークを、着手前に予測する（#68）。
 *
 * 予測は LLM がガイド（token-guide）に沿って成分ごとに出し、スクリプトは合計・帯との比較・
 * 記録の形式だけを担う。係数や段階表は持たない。同じ入力に対する予測の揺れは受け入れ、
 * 揺れの大きさは実測（tokens session）との突き合わせで確かめる。
 *
 * ガイドは2つある。
 *
 *   - 標準のガイド  プラグインに同梱する（skills/build-manager/references/token-guide.md）
 *   - プロジェクトのガイド  {HIKYAKU_ROOT}/token-guide/guide.md。あれば標準を置き換える
 *
 * どちらも先頭に版（version）と本文のハッシュ（hash）を持つ。予測にはどの版で見積もったかを
 * 残し、ガイドを補正する前と後の予測を混ぜて比べないようにする。本文を変えたら
 * tokens stamp で版を上げる。ハッシュが本文と合わないガイドは validate が止める。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HikyakuError } from "./errors.mts";
import { pluginRoot } from "./paths.mts";

export const TOKEN_GUIDE_DIR = "token-guide";
export const TOKEN_GUIDE_FILE = "guide.md";
/** 標準のガイドの、プラグインのルートからの相対パス */
export const STANDARD_GUIDE = "skills/build-manager/references/token-guide.md";

// ---------------------------------------------------------------------------
// トークン数の表記

/**
 * トークン数を読む。0 を許す（成分が無いと判断したことを渡せるようにするため）。
 * 整数（120000・120,000）か、k / m の単位を付けた値（120k・1.2m）
 */
export function parseTokenAmount(raw: string): number | undefined {
  const match = /^\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM]?)\s*$/.exec(raw);
  if (match === null) return undefined;
  const unit = (match[2] ?? "").toLowerCase();
  const scale = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1;
  const tokens = Math.round(Number((match[1] as string).replace(/,/g, "")) * scale);
  return Number.isFinite(tokens) && tokens >= 0 ? tokens : undefined;
}

/** 380000 → 380k。予測は粗い値なので k 単位で書く（1000 未満はそのまま） */
export function formatK(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value < 1_000) return String(value);
  return `${Math.round(value / 1_000)}k`;
}

// ---------------------------------------------------------------------------
// 成分

export type ComponentKey = "fixed" | "reading" | "implementation" | "tests" | "unknown";

export interface Component {
  key: ComponentKey;
  label: string;
  description: string;
}

/** 予測ピークの成分。トークンは足し算で増えるので、最大値ではなく和で予測する */
export const COMPONENTS: Component[] = [
  { key: "fixed", label: "固定費", description: "開始時の固定分（システムプロンプト・スキル本文・ルールの注入）と、手順の進行に伴う定常分" },
  { key: "reading", label: "読み込み", description: "読むドキュメントとコード。触れたファイルに応じて読み込まれるルールファイルも含む" },
  { key: "implementation", label: "実装", description: "テストを除くコードの生成と編集" },
  { key: "tests", label: "テスト", description: "テストコードの生成と、テストの実行結果の読み込み" },
  { key: "unknown", label: "未知の領域", description: "見通せない作業。環境構築・デバッグ・外部ライブラリの内部調査・検証と修正のループ" },
];

export const COMPONENT_KEYS: ComponentKey[] = COMPONENTS.map((c) => c.key);

export interface ComponentEstimate {
  key: ComponentKey;
  label: string;
  tokens: number;
  /** 根拠。渡されなければ空 */
  basis: string;
}

export interface PeakEstimate {
  components: ComponentEstimate[];
  total: number;
}

export function sumComponents(values: Record<ComponentKey, { tokens: number; basis?: string }>): PeakEstimate {
  const components = COMPONENTS.map((c) => ({
    key: c.key,
    label: c.label,
    tokens: values[c.key].tokens,
    basis: values[c.key].basis?.trim() ?? "",
  }));
  return { components, total: components.reduce((sum, c) => sum + c.tokens, 0) };
}

// ---------------------------------------------------------------------------
// 判定

/** 予測ピークの判定の帯（[context] merge_below / split_above） */
export interface PeakBands {
  mergeBelow: number;
  splitAbove: number;
}

export const DEFAULT_PEAK_BANDS: PeakBands = { mergeBelow: 300_000, splitAbove: 450_000 };

/**
 * merge  … 小さい。統合を検討する（推奨のみ。分けたままでもよい）
 * target … 狙いの帯
 * split  … 大きい。原則として分割する
 */
export type PeakVerdict = "merge" | "target" | "split";

export function peakVerdict(total: number, bands: PeakBands): PeakVerdict {
  if (total > bands.splitAbove) return "split";
  if (total < bands.mergeBelow) return "merge";
  return "target";
}

export function describePeakVerdict(verdict: PeakVerdict, bands: PeakBands): string {
  switch (verdict) {
    case "merge":
      return `統合を検討（${formatK(bands.mergeBelow)} 未満。推奨のみ）`;
    case "target":
      return `狙いの帯（${formatK(bands.mergeBelow)}〜${formatK(bands.splitAbove)}）`;
    case "split":
      return `分割を検討（${formatK(bands.splitAbove)} 超。原則として分割する）`;
  }
}

// ---------------------------------------------------------------------------
// ガイド

export type GuideKind = "project" | "standard";

export interface GuideHeader {
  version: number | undefined;
  basedOn: string | undefined;
  hash: string | undefined;
}

export interface TokenGuide extends GuideHeader {
  kind: GuideKind;
  path: string;
  /** 本文（先頭の版の宣言を除く） */
  body: string;
  /** 本文から計算したハッシュ */
  actualHash: string;
}

export function projectGuidePath(hikyakuRoot: string): string {
  return join(hikyakuRoot, TOKEN_GUIDE_DIR, TOKEN_GUIDE_FILE);
}

export function standardGuidePath(): string {
  return join(pluginRoot(), STANDARD_GUIDE);
}

/** 本文のハッシュ。行末の空白と、先頭・末尾の空行の違いでは変わらないよう正規化する */
export function bodyHash(body: string): string {
  const normalized = body.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/^\s+/, "").replace(/\s+$/, "");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 8);
}

/** 先頭の `---` で囲んだ宣言と本文に分ける。宣言が無ければ全体が本文 */
export function splitGuide(source: string): { header: GuideHeader; body: string; hasHeader: boolean } {
  const header: GuideHeader = { version: undefined, basedOn: undefined, hash: undefined };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (match === null) return { header, body: source, hasHeader: false };
  for (const line of (match[1] as string).split(/\r?\n/)) {
    const pair = /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (pair === null) continue;
    const value = (pair[2] as string).replace(/^["']|["']$/g, "");
    if (pair[1] === "version") header.version = /^\d+$/.test(value) ? Number.parseInt(value, 10) : undefined;
    else if (pair[1] === "based_on") header.basedOn = value === "" ? undefined : value;
    else if (pair[1] === "hash") header.hash = value === "" ? undefined : value;
  }
  return { header, body: source.slice(match[0].length), hasHeader: true };
}

export function renderGuide(header: { version: number; basedOn?: string }, body: string): string {
  const lines = ["---", `version: ${header.version}`];
  if (header.basedOn !== undefined) lines.push(`based_on: ${header.basedOn}`);
  lines.push(`hash: ${bodyHash(body)}`, "---", "", "");
  return `${lines.join("\n")}${body.replace(/^\s+/, "")}`;
}

function readGuide(path: string, kind: GuideKind): TokenGuide {
  const { header, body } = splitGuide(readFileSync(path, "utf8"));
  return { ...header, kind, path, body, actualHash: bodyHash(body) };
}

/** プロジェクトのガイドがあればそれを、無ければ標準のガイドを返す */
export function loadTokenGuide(hikyakuRoot: string): TokenGuide {
  const project = projectGuidePath(hikyakuRoot);
  if (existsSync(project)) return readGuide(project, "project");
  const standard = standardGuidePath();
  if (!existsSync(standard)) {
    throw new HikyakuError(`標準のガイドが見つかりません: ${standard}`, "プラグインのインストールが壊れている可能性があります。");
  }
  return readGuide(standard, "standard");
}

export function loadStandardGuide(): TokenGuide {
  return readGuide(standardGuidePath(), "standard");
}

/** 「プロジェクト v3」「標準 v1」。予測の記録と tokens history の群に使う */
export function guideLabel(guide: Pick<TokenGuide, "kind" | "version">): string {
  return `${guide.kind === "project" ? "プロジェクト" : "標準"} v${guide.version ?? "?"}`;
}

/** ガイドの版の宣言の不備。無ければ空 */
export function guideHeaderProblems(guide: TokenGuide): string[] {
  const problems: string[] = [];
  if (guide.version === undefined || guide.version < 1) {
    problems.push("先頭の version（1以上の整数）がありません。hikyaku tokens stamp で付けてください");
  }
  if (guide.hash === undefined) {
    problems.push("先頭の hash がありません。hikyaku tokens stamp で付けてください");
  } else if (guide.hash !== guide.actualHash) {
    problems.push("本文が hash と合いません。本文を変えたあとは hikyaku tokens stamp で版を上げてください");
  }
  return problems;
}

export interface TokenGuideProblem {
  /** HIKYAKU_ROOT からの相対パス */
  scope: string;
  message: string;
}

/**
 * プロジェクトのガイドの整合性。無いのは問題ではない（標準で動く）が、あって版の宣言が
 * 壊れているのは「補正したのに記録に残らない」壊れ方なので拾う。validate と step が使う
 */
export function tokenGuideProblems(hikyakuRoot: string): TokenGuideProblem[] {
  const path = projectGuidePath(hikyakuRoot);
  if (!existsSync(path)) return [];
  const scope = `${TOKEN_GUIDE_DIR}/${TOKEN_GUIDE_FILE}`;
  return guideHeaderProblems(readGuide(path, "project")).map((message) => ({ scope, message }));
}

export interface StampPlan {
  /** 書き込む内容。変更が無ければ undefined */
  content: string | undefined;
  created: boolean;
  version: number;
  basedOn: string | undefined;
  hash: string;
  /** 前の版（作成時は undefined） */
  previous: number | undefined;
}

/**
 * tokens stamp の計画。プロジェクトのガイドが無ければ標準から作り（version 1）、
 * あれば本文の変化を見て版を上げる。宣言が欠けているだけなら、版を変えずに補う
 */
export function planStamp(hikyakuRoot: string): StampPlan {
  const path = projectGuidePath(hikyakuRoot);
  if (!existsSync(path)) {
    const standard = loadStandardGuide();
    const basedOn = guideLabel(standard);
    const content = renderGuide({ version: 1, basedOn }, standard.body);
    return { content, created: true, version: 1, basedOn, hash: standard.actualHash, previous: undefined };
  }
  const current = readGuide(path, "project");
  const source = readFileSync(path, "utf8");
  const changed = current.hash !== current.actualHash;
  const version = current.version === undefined ? 1 : changed && current.hash !== undefined ? current.version + 1 : current.version;
  const content = renderGuide({ version, basedOn: current.basedOn }, current.body);
  return {
    content: content === source ? undefined : content,
    created: false,
    version,
    basedOn: current.basedOn,
    hash: current.actualHash,
    previous: current.version,
  };
}

// ---------------------------------------------------------------------------
// 記録の形式（issue.md・plan.md・retrospective.md に貼る表）

export const ESTIMATE_HEADERS = ["成分", "予測", "根拠"];
export const PEAK_ROW_LABEL = "予測ピーク";
export const GUIDE_ROW_LABEL = "ガイド";

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderEstimateMarkdown(
  estimate: PeakEstimate,
  verdict: PeakVerdict,
  bands: PeakBands,
  guide: Pick<TokenGuide, "kind" | "version" | "actualHash">,
): string {
  const rows = [
    `| ${ESTIMATE_HEADERS.join(" | ")} |`,
    `|${ESTIMATE_HEADERS.map(() => "------").join("|")}|`,
    ...estimate.components.map((c) => `| ${c.label} | ${formatK(c.tokens)} | ${cell(c.basis === "" ? "—" : c.basis)} |`),
    `| **${PEAK_ROW_LABEL}** | **${formatK(estimate.total)}** | ${describePeakVerdict(verdict, bands)} |`,
    `| ${GUIDE_ROW_LABEL} | ${guideLabel(guide)} | ${guide.actualHash} |`,
  ];
  return rows.join("\n");
}
