/**
 * 宣言の変更と、それを拠り所にした受け入れ（US-13.5・US-6.6）。読み取り専用。
 *
 * 宣言（ルートの .hikyaku.config の [app]・[[app.areas]]）が変わったら、その宣言を拠り所にして受け入れた
 * リスクを、宣言を変える PR の時点で見直しの対象として示す。受け入れは2か所にある:
 *
 *   - 作業ツリーにある全サイクルの decisions.jsonl（risk と、受け入れた objection）
 *   - decisions（ADR）・constraints の「受け入れたこと」の行（`（拠り所: \`<参照>\`）` で終わる行）
 *
 * 基準は risk.mts の基準（ユーザーがマージした宣言）と同じ読み方をする。基準を読めないときは、
 * 宣言されている参照をすべて変わったものとして扱う（見直しの対象を落とさない向き）。
 *
 * ID の範囲（`AD-1〜AD-5`）の検出もここに置く（validate の警告。原則7: ポインタに範囲を添えない）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ResolvedConfig } from "./config.mts";
import { cycleDir, cycleDirName, loadCycles } from "./cycles.mts";
import { loadGuide } from "./docs.mts";
import { HikyakuError } from "./errors.mts";
import { gitSync } from "./git.mts";
import { APP_KEYS, parsePremise, readLedger, type Decision } from "./ledger.mts";
import { effectiveDeclaration } from "./risk.mts";
import type { StepContext } from "./steps/engine.mts";
import { parseToml, type TomlTable } from "./toml.mts";

const CONFIG_FILE = ".hikyaku.config";
const SECTION = "受け入れたこと";

// ---------------------------------------------------------------------------
// 「受け入れたこと」の節

export interface AcceptedLine {
  /** リポジトリルートからの相対パス */
  source: string;
  /** 項目の1行目（1始まり） */
  line: number;
  /** 拠り所を除いた本文 */
  text: string;
  /** 拠り所の参照。無ければ空（照合の対象にしない） */
  premises: string[];
}

export interface AcceptedProblem {
  source: string;
  line: number;
  message: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BOLD_ITEM = new RegExp(`^(\\s*)[-*+]\\s+\\*\\*${SECTION}\\*\\*\\s*[:：]\\s*(.*)$`);
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const PREMISE_PREFIX = /^（拠り所\s*[:：]\s*/;
const FENCE = /^\s*(`{3,}|~{3,})/;

function indentOf(line: string): number {
  return (/^\s*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;
}

/**
 * Markdown の「受け入れたこと」の節を読む。見出しの形（`## 受け入れたこと`）と、太字の箇条書きの形
 * （`- **受け入れたこと**:` の下に字下げした箇条書き）の両方。項目より深く字下げした行は前の項目の続き。
 * 箇条書きでない行・書式に合わない拠り所は、読み飛ばさずに problems に出す
 */
export function parseAcceptedSection(markdown: string, source: string): { lines: AcceptedLine[]; problems: AcceptedProblem[] } {
  const lines: AcceptedLine[] = [];
  const problems: AcceptedProblem[] = [];
  const all = markdown.split(/\r?\n/);

  // 節の状態。parent は太字の項目の字下げ（見出しの形なら -1）
  let section: { parent: number } | undefined;
  let itemIndent: number | undefined;
  let current: { line: number; parts: string[] } | undefined;
  let fence: string | undefined;

  const flush = () => {
    if (current !== undefined) finishItem(current, source, lines, problems);
    current = undefined;
  };
  const close = () => {
    flush();
    section = undefined;
    itemIndent = undefined;
  };

  all.forEach((raw, index) => {
    const number = index + 1;
    const fenceMatch = FENCE.exec(raw);
    if (fence !== undefined) {
      if (fenceMatch && fenceMatch[1]?.[0] === fence[0] && (fenceMatch[1]?.length ?? 0) >= fence.length) fence = undefined;
      return;
    }
    if (fenceMatch) {
      // コードブロックの中は文書の本文ではない（テンプレートの例など）
      close();
      fence = fenceMatch[1];
      return;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      close();
      if (heading[2]?.replace(/\*\*/g, "").trim() === SECTION) section = { parent: -1 };
      return;
    }
    const bold = BOLD_ITEM.exec(raw);
    if (bold) {
      close();
      section = { parent: indentOf(raw) };
      // 「なし」は受け入れたことが無いと書いたもの（ADR の他の欄と同じ書き方）
      const rest = (bold[2] ?? "").trim();
      if (rest !== "" && !rest.startsWith("なし")) {
        problems.push({ source, line: number, message: `「${SECTION}」の本文が項目と同じ行にあります。1件1行の箇条書きにしてください` });
      }
      return;
    }
    if (section === undefined) return;
    if (raw.trim() === "") return;

    const indent = indentOf(raw);
    if (indent <= section.parent) {
      // 太字の項目と同じか浅い字下げ: 節の終わり
      close();
      return;
    }
    const bullet = BULLET.exec(raw);
    if (bullet && (itemIndent === undefined || indent === itemIndent)) {
      flush();
      itemIndent = indent;
      current = { line: number, parts: [(bullet[2] ?? "").trim()] };
      return;
    }
    if (current !== undefined && itemIndent !== undefined && indent > itemIndent) {
      current.parts.push(raw.trim());
      return;
    }
    if (bullet && itemIndent !== undefined && indent < itemIndent) {
      // 字下げが浅くなった箇条書き: 新しい並びとして読み直す
      flush();
      itemIndent = indent;
      current = { line: number, parts: [(bullet[2] ?? "").trim()] };
      return;
    }
    flush();
    if (raw.trim() === "なし") return;
    problems.push({ source, line: number, message: `「${SECTION}」の節に箇条書きでない行があります: ${raw.trim()}` });
  });
  close();
  return { lines, problems };
}

function finishItem(
  item: { line: number; parts: string[] },
  source: string,
  lines: AcceptedLine[],
  problems: AcceptedProblem[],
): void {
  const text = item.parts.join(" ").trim();
  // 最後の「（拠り所」から行末の「）」までが拠り所。参照の中の全角括弧（`assumption:決済は外部（Stripe）経由`）も読める
  const start = text.lastIndexOf("（拠り所");
  const prefix = start === -1 ? null : PREMISE_PREFIX.exec(text.slice(start));
  if (start === -1 || prefix === null || !text.endsWith("）")) {
    if (/拠り所\s*[:：]/.test(text)) {
      problems.push({ source, line: item.line, message: "（拠り所: …）が行末にありません。拠り所は行末に1つだけ書きます" });
    }
    lines.push({ source, line: item.line, text, premises: [] });
    return;
  }
  const inner = text.slice(start + prefix[0].length, -1);
  const premises: string[] = [];
  const bad: string[] = [];
  // 参照はバッククォートで囲んだものだけ。囲みの外は区切り（, と 、）だけを許す
  // （囲みの中の 、 で切らない: assumption の文は 、 を含みうる）
  for (const match of inner.matchAll(/`([^`]+)`/g)) {
    const value = (match[1] ?? "").trim();
    try {
      parsePremise(value);
      premises.push(value);
    } catch {
      bad.push(`\`${value}\``);
    }
  }
  const rest = inner.replace(/`[^`]+`/g, "").replace(/[\s,、]/g, "");
  if (rest !== "") bad.push(rest);
  if (premises.length === 0 && bad.length === 0) bad.push("（空）");
  if (bad.length > 0) {
    problems.push({
      source,
      line: item.line,
      message: `拠り所の参照の書式に合いません: ${bad.join(", ")}（\`app.exposure\` / \`area:<name>\` / \`constraints#<anchor>\` / \`adr:<file>\` / \`assumption:<短い文>\` をバッククォートで囲んで書きます）`,
    });
  }
  lines.push({ source, line: item.line, text: text.slice(0, start).trim(), premises });
}

// ---------------------------------------------------------------------------
// 永続ドキュメント

/** ディレクトリの下の .md（再帰。repo 管理で ADR をサブディレクトリに分けた形も読む） */
function markdownUnder(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...markdownUnder(path));
    else if (stat.isFile() && name.endsWith(".md")) files.push(path);
  }
  return files;
}

/** document-guide.md の論理名が指す Markdown ファイル。ディレクトリならその下の .md すべて */
export function documentFiles(config: ResolvedConfig, names: string[]): string[] {
  const files: string[] = [];
  for (const entry of loadGuide(config.hikyakuRoot)) {
    if (!names.includes(entry.name) || entry.path === undefined) continue;
    // entry.path はアンカーを除いたパス（docs.mts の parseGuide が分ける）
    const absolute = join(config.repoRoot, entry.path);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).isDirectory()) files.push(...markdownUnder(absolute));
    else if (absolute.endsWith(".md")) files.push(absolute);
  }
  return files;
}

/** frontmatter の status が superseded か */
export function isSuperseded(markdown: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  return frontmatter !== null && /^status:\s*["']?superseded["']?\s*$/m.test(frontmatter[1] ?? "");
}

/** decisions（ADR）・constraints の「受け入れたこと」の行。覆された ADR は読まない */
export function persistentAcceptances(config: ResolvedConfig): { lines: AcceptedLine[]; problems: AcceptedProblem[] } {
  const lines: AcceptedLine[] = [];
  const problems: AcceptedProblem[] = [];
  for (const file of documentFiles(config, ["decisions", "constraints"])) {
    const source = readFileSync(file, "utf8");
    // 覆された ADR（status: superseded）の受け入れは、もう効いていない
    if (isSuperseded(source)) continue;
    const parsed = parseAcceptedSection(source, relative(config.repoRoot, file));
    lines.push(...parsed.lines);
    problems.push(...parsed.problems);
  }
  return { lines, problems };
}

// ---------------------------------------------------------------------------
// 記録の受け入れ

export interface LedgerAcceptance {
  cycle: string;
  id: string;
  unit: string;
  type: "risk" | "objection";
  summary: string;
  premises: string[];
  /** 最新の決定。未決の risk は null */
  decision: Decision | null;
}

/**
 * 作業ツリーにある全サイクルの decisions.jsonl の受け入れ。risk は退け・解決されていないもの
 * （未決も含む: 事後同意を待つ受け入れも見直しの対象）、objection はユーザーが受け入れたもの（consented）。
 * どちらも拠り所（premises）を持つものだけ。読めないサイクルの記録は problems に出して続ける
 */
export function ledgerAcceptances(config: ResolvedConfig): { items: LedgerAcceptance[]; problems: string[] } {
  const items: LedgerAcceptance[] = [];
  const problems: string[] = [];
  for (const record of loadCycles(config.hikyakuRoot)) {
    const directory = cycleDir(config.hikyakuRoot, record);
    if (!existsSync(directory)) continue;
    const name = cycleDirName(record);
    let ledger;
    try {
      ledger = readLedger(directory);
    } catch (error) {
      if (!(error instanceof HikyakuError)) throw error;
      problems.push(`${name}: 未決事項の記録を読めません: ${error.message}`);
      continue;
    }
    for (const item of ledger.items) {
      const { open, latest } = item;
      const premises = open.premises ?? [];
      if (premises.length === 0) continue;
      const decision = latest?.decision ?? null;
      const accepted =
        (open.type === "risk" && decision !== "rejected" && decision !== "resolved") ||
        (open.type === "objection" && decision === "consented");
      if (!accepted) continue;
      items.push({ cycle: name, id: open.id, unit: open.unit, type: open.type as "risk" | "objection", summary: open.summary, premises, decision });
    }
  }
  return { items, problems };
}

// ---------------------------------------------------------------------------
// 宣言の差分

export interface DeclarationChanges {
  /** 比べた基準 */
  bases: { ref: string; commit: string }[];
  /** 変わった参照（app.<key> / area:<name>） */
  changed: string[];
  /** 基準を1つも読めなかった、またはどこかの宣言を読めなかった（宣言されている参照をすべて変わったものとした） */
  uncertain: boolean;
  notices: string[];
}

/** キーの順に依らない比較用の文字列（`[[app.areas]]` の中のキーを並べ替えただけでは変わったことにしない） */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** [app] の表から、参照ごとの値（比較用の文字列） */
function declarationRefs(app: TomlTable | undefined): Map<string, string> {
  const refs = new Map<string, string>();
  if (app === undefined) return refs;
  for (const key of APP_KEYS) {
    if (app[key] !== undefined) refs.set(`app.${key}`, canonical(app[key]));
  }
  const areas = app["areas"];
  if (Array.isArray(areas)) {
    for (const area of areas) {
      if (typeof area !== "object" || area === null || Array.isArray(area)) continue;
      const name = (area as TomlTable)["name"];
      if (typeof name === "string") refs.set(`area:${name}`, canonical(area));
    }
  }
  return refs;
}

type Read = { ok: true; refs: Map<string, string> } | { ok: false; reason: string };

/** コミットのルートの .hikyaku.config の [app]。ファイルが無ければ宣言なしとして読めた扱い */
function readDeclarationAt(repoRoot: string, commit: string, label: string): Read {
  const listed = gitSync(repoRoot, ["ls-tree", "--name-only", commit, "--", CONFIG_FILE]);
  if (listed === undefined) return { ok: false, reason: `${label} の ${CONFIG_FILE} の有無を確かめられません` };
  if (listed.trim() === "") return { ok: true, refs: new Map() };
  const source = gitSync(repoRoot, ["show", `${commit}:${CONFIG_FILE}`]);
  if (source === undefined) return { ok: false, reason: `${label} の ${CONFIG_FILE} を読めません` };
  try {
    const app = parseToml(source)["app"];
    if (app !== undefined && (typeof app !== "object" || Array.isArray(app))) throw new Error("[app] がテーブルではありません");
    return { ok: true, refs: declarationRefs(app as TomlTable | undefined) };
  } catch (error) {
    return { ok: false, reason: `${label} の ${CONFIG_FILE} の宣言を読めません: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** `--changed-from` の ref。`-` で始まる値は git のオプションとして読まれるので受け付けない */
export function assertRef(ref: string): void {
  if (ref.trim() === "" || ref.startsWith("-")) {
    throw new HikyakuError(`基準の ref が不正です: ${ref}`, "ブランチ名かコミットを指定してください（- で始まる値は受け付けません）。");
  }
}

/** 明示した ref の基準。origin/<ref> と <ref> のうち解決できるものすべての merge-base */
function explicitBases(config: ResolvedConfig, from: string, notices: string[]): { ref: string; commit: string }[] {
  assertRef(from);
  const bases: { ref: string; commit: string }[] = [];
  for (const ref of [`origin/${from}`, from]) {
    if (gitSync(config.repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === undefined) continue;
    const commit = gitSync(config.repoRoot, ["merge-base", "HEAD", ref])?.trim();
    if (commit === undefined || commit === "") {
      notices.push(`HEAD と ${ref} に共通の祖先がありません（浅い clone なら履歴を取得してください）`);
      continue;
    }
    if (!bases.some((base) => base.commit === commit)) bases.push({ ref, commit });
  }
  if (bases.length === 0 && notices.length === 0) notices.push(`${from} も origin/${from} も解決できません`);
  return bases;
}

/**
 * 基準のコミットと HEAD の宣言を比べ、変わった参照の和を返す。from を省くと risk.mts の基準
 * （デフォルトブランチと base_branch、それぞれ origin/ とローカル。Hikyaku のブランチは除く）を使う
 */
export function declarationChanges(config: ResolvedConfig, from?: string): DeclarationChanges {
  const notices: string[] = [];
  let uncertain = false;
  let bases: { ref: string; commit: string }[];
  if (from !== undefined) {
    bases = explicitBases(config, from, notices);
  } else {
    const effective = effectiveDeclaration(config);
    notices.push(...effective.notices);
    if (effective.baselines.some((baseline) => baseline.unreadableDeclaration === true)) uncertain = true;
    bases = [];
    for (const baseline of effective.baselines) {
      if (baseline.unavailable !== undefined || baseline.commit === undefined || baseline.ref === undefined) continue;
      if (!bases.some((base) => base.commit === baseline.commit)) bases.push({ ref: baseline.ref, commit: baseline.commit });
    }
  }

  const head = readDeclarationAt(config.repoRoot, "HEAD", "HEAD");
  const sides: Map<string, string>[] = [];
  if (head.ok) sides.push(head.refs);
  else {
    uncertain = true;
    notices.push(head.reason);
  }

  const changed = new Set<string>();
  for (const base of bases) {
    const read = readDeclarationAt(config.repoRoot, base.commit, `基準 ${base.ref}`);
    if (!read.ok) {
      uncertain = true;
      notices.push(read.reason);
      continue;
    }
    sides.push(read.refs);
    if (!head.ok) continue;
    for (const ref of new Set([...head.refs.keys(), ...read.refs.keys()])) {
      if (head.refs.get(ref) !== read.refs.get(ref)) changed.add(ref);
    }
  }
  if (bases.length === 0) uncertain = true;
  if (uncertain) {
    // 厳しさ・変化の分からない基準がある: 宣言されている参照をすべて見直しの対象にする
    for (const refs of sides) for (const ref of refs.keys()) changed.add(ref);
    if (bases.length === 0 && changed.size > 0) notices.push("比べる基準を読めないので、宣言されている参照をすべて変わったものとして扱います");
  }
  return { bases, changed: [...changed].sort(), uncertain, notices };
}

// ---------------------------------------------------------------------------
// 見直しの対象

export interface PremisesReview {
  changes: DeclarationChanges;
  /** 変わった参照を拠り所にした記録の受け入れ */
  ledger: LedgerAcceptance[];
  /** 変わった参照を拠り所にした ADR・constraints の行 */
  documents: AcceptedLine[];
  /** 読めない行・読めない記録 */
  warnings: string[];
}

function touches(premises: string[], changed: string[]): boolean {
  return premises.some((premise) => changed.includes(premise.trim()));
}

export function problemLine(problem: AcceptedProblem): string {
  return `${problem.source}:${problem.line}: ${problem.message}`;
}

export function premisesReview(config: ResolvedConfig, from?: string): PremisesReview {
  const changes = declarationChanges(config, from);
  const records = ledgerAcceptances(config);
  const documents = persistentAcceptances(config);
  return {
    changes,
    ledger: records.items.filter((item) => touches(item.premises, changes.changed)),
    documents: documents.lines.filter((line) => touches(line.premises, changes.changed)),
    warnings: [...documents.problems.map(problemLine), ...records.problems],
  };
}

function decisionLabel(decision: Decision | null): string {
  if (decision === null) return "未決";
  return { decided: "決定", consented: "同意", rejected: "退け", resolved: "解決" }[decision];
}

function premiseList(premises: string[]): string {
  return premises.map((premise) => `\`${premise}\``).join(", ");
}

/** 見直しの対象の行（PR 本文とテキスト出力で同じ形） */
export function reviewLines(review: PremisesReview): string[] {
  return [
    ...review.ledger.map((item) => `- ${item.cycle} の ${item.id}（${item.type}・${decisionLabel(item.decision)}）: ${item.summary}（拠り所: ${premiseList(item.premises)}）`),
    ...review.documents.map((line) => `- \`${line.source}:${line.line}\`: ${line.text}（拠り所: ${premiseList(line.premises)}）`),
  ];
}

/** PR 本文に貼る「宣言の変更」の節 */
export function premisesPrSection(review: PremisesReview): string {
  const { changes } = review;
  // 宣言が変わっていなければ節を作らない（読めない行の警告は validate が示す）
  if (changes.changed.length === 0) return "";
  const out = ["## 宣言の変更", ""];
  out.push(`変わった宣言: ${premiseList(changes.changed)}（基準: ${changes.bases.map((base) => base.ref).join(", ") || "読めず"}）`);
  if (changes.uncertain) {
    out.push("", "基準の宣言を読めなかったので、宣言されている参照をすべて変わったものとして扱っています。");
    out.push(...changes.notices.map((notice) => `- ${notice}`));
  }
  out.push("");
  const lines = reviewLines(review);
  if (lines.length === 0) out.push("この宣言を拠り所にした受け入れはありません。");
  else out.push("この宣言を拠り所にした受け入れ（見直しの対象）:", "", ...lines);
  if (review.warnings.length > 0) {
    out.push("", "読めない「受け入れたこと」の行・記録:", "", ...review.warnings.map((warning) => `- ${warning}`));
  }
  return out.join("\n");
}

/** pr の args。宣言が変わっていれば、変わった参照をカンマ区切りで（無ければ false） */
export function declarationArgs(ctx: StepContext): Record<string, unknown> {
  // Stop フック・step where は位置だけを読むので、git を呼ばない
  if (ctx.positionOnly === true) return {};
  const { changed } = declarationChanges(ctx.config);
  return { declarationChanged: changed.length > 0 ? changed.join(",") : false };
}

// ---------------------------------------------------------------------------
// ID の範囲

// 接頭辞は大文字の ID（AD・US）と、小文字の作業単位（build）。build-01〜05 も範囲として拾う
const ID_RANGE = /(?<![A-Za-z0-9-])([A-Z][A-Z0-9]*|build)-(\d+(?:\.\d+)?)\s*[〜～~]\s*(?:\1-)?\d+(?:\.\d+)?/g;

/** ID の範囲（`AD-1〜AD-5`・`US-15.1〜15.3`）。コードブロックとインラインコードの中は除く */
export function idRanges(markdown: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  let fence: string | undefined;
  markdown.split(/\r?\n/).forEach((raw, index) => {
    const marker = FENCE.exec(raw);
    if (fence !== undefined) {
      if (marker && marker[1]?.[0] === fence[0] && (marker[1]?.length ?? 0) >= fence.length) fence = undefined;
      return;
    }
    if (marker) {
      fence = marker[1];
      return;
    }
    const prose = raw.replace(/`[^`]*`/g, "");
    for (const match of prose.matchAll(ID_RANGE)) found.push({ line: index + 1, text: match[0] });
  });
  return found;
}
