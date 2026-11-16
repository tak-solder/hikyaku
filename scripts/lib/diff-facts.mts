/**
 * 差分の事実（hikyaku diff facts）。
 *
 * ビルドの差分から、AI が問題を黙って変えたかもしれない変更を**事実として**並べる（US-2・原則3）。
 * 並べるのは、変更ファイルと種類、テストファイルの削除、削除されたテストの宣言、追加された
 * スキップの印、アサーションの行の変更、設定の宣言の変更、合意の文書（issue.md・G8 の承認後の
 * plan.md と test-spec.md）の書き換え。
 *
 * **判定はしない。** スコープの内か外か、アサーションの変更が緩和かどうかは、作った本人ではない
 * レビュー（doc-reviewer の agreement の context）が合意と突き合わせて決める。印はヒューリスティクス
 * なので見逃しも誤検出もある（ADR agreement-review の「受け入れたこと」）。
 *
 * 比べるのは、PR のマージ先（resolvePrBase）と HEAD の merge-base から**作業ツリー**まで。
 * agreement-review は review のコミットより前に走るので、未コミットの変更と未追跡のファイルも含める。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ResolvedConfig } from "./config.mts";
import { classifyPath, findMarker, type DiffPatterns, type FileKind } from "./diff-stats.mts";
import {
  commitsTouchingSince,
  hasUncommittedChange,
  mergeBaseOf,
  nameStatus,
  readFileAtRef,
  unifiedDiff,
  untrackedFiles,
  type CommitSummary,
} from "./git.mts";
import { readProgress } from "./progress.mts";
import { parseToml, type TomlTable, type TomlValue } from "./toml.mts";

const CONFIG_FILE = ".hikyaku.config";
export const AGREEMENT_FILE = "agreement.md";

/** builder がこのビルドのディレクトリに正当に書く成果物。変更ファイルの一覧からは除く */
const BUILD_ARTIFACTS = [
  "progress.jsonl",
  "decisions.jsonl",
  "handoff.md",
  AGREEMENT_FILE,
  "retrospective.md",
  "questions.md",
  "plan.md",
  "test-spec.md",
];

/** 設定のうち、事実として並べる宣言のテーブル */
const DECLARATION_TABLES = ["app", "boundaries", "consent"];

// ---------------------------------------------------------------------------
// unified diff（-U0）の解析

export interface HunkLine {
  side: "-" | "+";
  /** - は変更前の、+ は変更後の行番号 */
  line: number;
  text: string;
}

export interface FileHunks {
  path: string;
  from?: string;
  lines: HunkLine[];
}

/** `--- a/x` / `+++ b/x` のパス。/dev/null は undefined。git が付ける末尾のタブと引用符を外す */
function headerPath(raw: string, prefix: string): string | undefined {
  let value = raw.replace(/\t$/, "");
  if (value === "/dev/null") return undefined;
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * `git diff -U0` の出力をファイルごとの増減の行に分ける。
 * hunk の中は見出しの行数で数えて読む（`--- ` で始まる削除行を見出しと取り違えないため）。
 * バイナリと、中身の変わらないリネームは行を持たない
 */
export function parseUnifiedDiff(diff: string): FileHunks[] {
  const files: FileHunks[] = [];
  let current: FileHunks | undefined;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let renameFrom: string | undefined;
  let renameTo: string | undefined;
  let minus: string | undefined;

  const start = () => {
    current = { path: "", lines: [] };
    files.push(current);
    renameFrom = undefined;
    renameTo = undefined;
    minus = undefined;
  };

  for (const raw of diff.split("\n")) {
    if (current !== undefined && (oldLeft > 0 || newLeft > 0)) {
      if (raw.startsWith("-") && oldLeft > 0) {
        current.lines.push({ side: "-", line: oldLine, text: raw.slice(1) });
        oldLine += 1;
        oldLeft -= 1;
        continue;
      }
      if (raw.startsWith("+") && newLeft > 0) {
        current.lines.push({ side: "+", line: newLine, text: raw.slice(1) });
        newLine += 1;
        newLeft -= 1;
        continue;
      }
      if (raw.startsWith("\\")) continue;
      // 行数と合わない出力は、残りを捨てて見出しとして読み直す
      oldLeft = 0;
      newLeft = 0;
    }
    if (raw.startsWith("diff --git ")) {
      start();
      continue;
    }
    if (current === undefined) continue;
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("rename from ")) renameFrom = raw.slice("rename from ".length);
    else if (raw.startsWith("rename to ")) renameTo = raw.slice("rename to ".length);
    else if (raw.startsWith("--- ")) minus = headerPath(raw.slice(4), "a/");
    else if (raw.startsWith("+++ ")) {
      const plus = headerPath(raw.slice(4), "b/");
      current.path = plus ?? minus ?? "";
      if (minus !== undefined && plus !== undefined && minus !== plus) current.from = minus;
    } else {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (hunk !== null) {
        oldLine = Number.parseInt(hunk[1] as string, 10);
        oldLeft = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
        newLine = Number.parseInt(hunk[3] as string, 10);
        newLeft = hunk[4] === undefined ? 1 : Number.parseInt(hunk[4], 10);
        // 0 行の側は、行番号が「直前の行」を指す
        if (oldLeft === 0) oldLine += 1;
        if (newLeft === 0) newLine += 1;
      }
    }
    if (current.path === "" && renameTo !== undefined) {
      current.path = renameTo;
      if (renameFrom !== undefined) current.from = renameFrom;
    }
  }
  return files.filter((file) => file.path !== "");
}

// ---------------------------------------------------------------------------
// 印の事実

export interface MarkerFact {
  path: string;
  line: number;
  text: string;
  marker: string;
}

export interface AssertionFact extends MarkerFact {
  side: "-" | "+";
}

export interface MarkerFacts {
  deletedTests: MarkerFact[];
  addedSkips: MarkerFact[];
  assertionChanges: AssertionFact[];
}

/**
 * テストファイルの増減の行から、印の事実を集める。
 * 同じファイルの反対側に同じ文（前後の空白を除く）がある行は、移動・字下げの変更とみなして並べない
 */
export function collectMarkerFacts(hunks: FileHunks[], patterns: DiffPatterns, skipPaths: Set<string> = new Set()): MarkerFacts {
  const facts: MarkerFacts = { deletedTests: [], addedSkips: [], assertionChanges: [] };
  for (const file of hunks) {
    if (skipPaths.has(file.path) || classifyPath(patterns, file.path) !== "test") continue;
    const removed = new Set(file.lines.filter((line) => line.side === "-").map((line) => line.text.trim()));
    const added = new Set(file.lines.filter((line) => line.side === "+").map((line) => line.text.trim()));
    for (const line of file.lines) {
      const text = line.text.trim();
      if (text === "") continue;
      const opposite = line.side === "-" ? added : removed;
      if (opposite.has(text)) continue;
      const base = { path: file.path, line: line.line, text };
      if (line.side === "-") {
        const marker = findMarker(patterns.testDeclarations, line.text);
        if (marker !== undefined) facts.deletedTests.push({ ...base, marker });
      } else {
        const marker = findMarker(patterns.skipMarkers, line.text);
        if (marker !== undefined) facts.addedSkips.push({ ...base, marker });
      }
      const assertion = findMarker(patterns.assertionMarkers, line.text);
      if (assertion !== undefined) facts.assertionChanges.push({ ...base, marker: assertion, side: line.side });
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// 設定の宣言の変更

export interface ConfigChange {
  /** リポジトリルートからの相対パス */
  file: string;
  /** app.<key> / area:<name> / boundaries.<key> / consent.<key>。読めなければ表の名前 */
  ref: string;
  change: "added" | "removed" | "changed" | "unreadable";
  detail: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function show(value: TomlValue | undefined): string {
  if (value === undefined) return "（なし）";
  if (Array.isArray(value) && value.every((item) => typeof item !== "object")) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  return typeof value === "object" ? canonical(value) : JSON.stringify(value);
}

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 値の変更の説明。文字列の配列は外したものと足したものに分ける（paths を狭めたことが読めるように） */
function valueChange(before: TomlValue | undefined, after: TomlValue | undefined): string {
  const list = (value: TomlValue | undefined) =>
    Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : undefined;
  const old = list(before);
  const next = list(after);
  if (old !== undefined && next !== undefined) {
    const removed = old.filter((item) => !next.includes(item));
    const added = next.filter((item) => !old.includes(item));
    const parts = [];
    if (removed.length > 0) parts.push(`外した: ${removed.map((item) => JSON.stringify(item)).join(", ")}`);
    if (added.length > 0) parts.push(`足した: ${added.map((item) => JSON.stringify(item)).join(", ")}`);
    if (parts.length > 0) return parts.join(" / ");
  }
  return `${show(before)} → ${show(after)}`;
}

function compareKeys(file: string, prefix: string, before: TomlTable, after: TomlTable, skip: string[] = []): ConfigChange[] {
  const changes: ConfigChange[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (skip.includes(key)) continue;
    const old = before[key];
    const next = after[key];
    if (canonical(old) === canonical(next)) continue;
    const change = old === undefined ? "added" : next === undefined ? "removed" : "changed";
    changes.push({ file, ref: `${prefix}${key}`, change, detail: valueChange(old, next) });
  }
  return changes;
}

function areasOf(app: TomlTable): Map<string, TomlTable> {
  const areas = new Map<string, TomlTable>();
  const list = app["areas"];
  if (!Array.isArray(list)) return areas;
  list.forEach((area, index) => {
    if (!isTable(area)) return;
    const name = typeof area["name"] === "string" ? area["name"] : `#${index + 1}`;
    areas.set(name, area);
  });
  return areas;
}

function compareAreas(file: string, before: TomlTable, after: TomlTable): ConfigChange[] {
  const old = areasOf(before);
  const next = areasOf(after);
  const changes: ConfigChange[] = [];
  for (const name of [...new Set([...old.keys(), ...next.keys()])].sort()) {
    const a = old.get(name);
    const b = next.get(name);
    const ref = `area:${name}`;
    if (a === undefined) changes.push({ file, ref, change: "added", detail: `項目を足した: ${canonical(b)}` });
    else if (b === undefined) changes.push({ file, ref, change: "removed", detail: `項目を消した: ${canonical(a)}` });
    else {
      for (const item of compareKeys(file, "", a, b)) {
        changes.push({ file, ref, change: "changed", detail: `${item.ref}: ${item.detail}` });
      }
    }
  }
  return changes;
}

type Parsed = { ok: true; table: TomlTable } | { ok: false; reason: string };

function parseConfig(source: string | undefined): Parsed {
  if (source === undefined) return { ok: true, table: {} };
  try {
    return { ok: true, table: parseToml(source) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 設定ファイルの前後の中身から、宣言（[app]・[[app.areas]]・[boundaries]・[consent]）の変更を並べる。
 * ファイルが無い側は undefined（宣言なし）。読めない側があれば、読めないことを事実にする
 */
export function declarationConfigChanges(file: string, before: string | undefined, after: string | undefined): ConfigChange[] {
  const old = parseConfig(before);
  const next = parseConfig(after);
  const unreadable: ConfigChange[] = [];
  if (!old.ok) unreadable.push({ file, ref: CONFIG_FILE, change: "unreadable", detail: `基準の側を読めません: ${old.reason}` });
  if (!next.ok) unreadable.push({ file, ref: CONFIG_FILE, change: "unreadable", detail: `作業ツリーの側を読めません: ${next.reason}` });
  if (!old.ok || !next.ok) return unreadable;

  const changes: ConfigChange[] = [];
  for (const name of DECLARATION_TABLES) {
    const a = old.table[name];
    const b = next.table[name];
    if (a !== undefined && !isTable(a)) changes.push({ file, ref: name, change: "unreadable", detail: `基準の [${name}] がテーブルではありません` });
    if (b !== undefined && !isTable(b)) changes.push({ file, ref: name, change: "unreadable", detail: `作業ツリーの [${name}] がテーブルではありません` });
    const before = isTable(a) ? a : {};
    const after = isTable(b) ? b : {};
    if (name === "app") {
      changes.push(...compareKeys(file, "app.", before, after, ["areas"]), ...compareAreas(file, before, after));
    } else {
      changes.push(...compareKeys(file, `${name}.`, before, after));
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// 事実の収集

export interface FactFile {
  status: string;
  path: string;
  from?: string;
  kind: FileKind;
  untracked?: true;
}

export interface DeletedTestFile {
  path: string;
  /** リネームでテストから外れたときの移動先 */
  to?: string;
}

export interface AfterApproval {
  path: string;
  commits: CommitSummary[];
  uncommitted: boolean;
}

export interface DiffFacts extends MarkerFacts {
  phase: string;
  base: { name: string; ref: string | undefined; mergeBase: string | undefined };
  files: FactFile[];
  deletedTestFiles: DeletedTestFile[];
  configChanges: ConfigChange[];
  /** このビルドの issue.md が基準から変わっている */
  issueChanged: boolean;
  /** G8 の承認より後の plan.md・test-spec.md の書き換え。承認の記録が無ければ approvedAt は undefined */
  afterG8: { approvedAt: string | undefined; files: AfterApproval[] };
  notices: string[];
}

export interface DiffFactsInput {
  config: ResolvedConfig;
  phase: string;
  /** このビルドのディレクトリ（cycles/{cycle}/build-NN） */
  buildDirectory: string;
  /** サイクルのディレクトリ（サイクルの .hikyaku.config の場所） */
  cycleDirectory: string;
  base: { name: string; ref: string | undefined };
}

function emptyFacts(input: DiffFactsInput, mergeBase: string | undefined, notices: string[]): DiffFacts {
  return {
    phase: input.phase,
    base: { ...input.base, mergeBase },
    files: [],
    deletedTests: [],
    addedSkips: [],
    assertionChanges: [],
    deletedTestFiles: [],
    configChanges: [],
    issueChanged: false,
    afterG8: { approvedAt: undefined, files: [] },
    notices,
  };
}

function readWorking(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** 未追跡のファイルを、全行が + の hunk として読む。バイナリ（NUL を含む）と大きなファイルは行を持たない */
function untrackedHunks(repoRoot: string, path: string): FileHunks {
  const absolute = join(repoRoot, path);
  try {
    if (statSync(absolute).size > 2 * 1024 * 1024) return { path, lines: [] };
    const content = readFileSync(absolute, "utf8");
    if (content.includes("\0")) return { path, lines: [] };
    const lines = content.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return { path, lines: lines.map((text, index) => ({ side: "+" as const, line: index + 1, text })) };
  } catch {
    return { path, lines: [] };
  }
}

function lastG8Approval(buildDirectory: string, notices: string[]): string | undefined {
  try {
    return readProgress(buildDirectory).findLast((event) => event.skill === "builder" && event.step === "G8" && event.result === "approved")?.at;
  } catch (error) {
    notices.push(`progress.jsonl を読めないので、G8 の承認後の書き換えを並べられません: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export async function collectDiffFacts(input: DiffFactsInput): Promise<DiffFacts> {
  const { config } = input;
  const repoRoot = config.repoRoot;
  const notices: string[] = [];
  if (input.base.ref === undefined) {
    notices.push(`差分の基準（${input.base.name}）をローカルで解決できません。fetch してから実行し直してください`);
    return emptyFacts(input, undefined, notices);
  }
  const mergeBase = await mergeBaseOf(repoRoot, input.base.ref);
  if (mergeBase === undefined) {
    notices.push(`HEAD と ${input.base.ref} の merge-base を求められません（浅い clone なら履歴を取得してください）`);
    return emptyFacts(input, undefined, notices);
  }

  const buildRelative = relative(repoRoot, input.buildDirectory);
  const excluded = BUILD_ARTIFACTS.map((name) => `${buildRelative}/${name}`);
  const patterns = config.diff;

  const entries = await nameStatus(repoRoot, mergeBase, excluded);
  const diff = await unifiedDiff(repoRoot, mergeBase, excluded);
  if (entries === undefined || diff === undefined) {
    notices.push("git diff を実行できませんでした");
    return emptyFacts(input, mergeBase, notices);
  }
  const untracked = await untrackedFiles(repoRoot, excluded);

  const files: FactFile[] = entries.map((entry) => ({
    status: entry.status,
    path: entry.path,
    ...(entry.from === undefined ? {} : { from: entry.from }),
    kind: classifyPath(patterns, entry.path),
  }));
  for (const path of untracked) files.push({ status: "A", path, kind: classifyPath(patterns, path), untracked: true });

  const deletedTestFiles: DeletedTestFile[] = [];
  for (const entry of entries) {
    if (entry.status === "D" && classifyPath(patterns, entry.path) === "test") deletedTestFiles.push({ path: entry.path });
    if (entry.status === "R" && entry.from !== undefined && classifyPath(patterns, entry.from) === "test" && classifyPath(patterns, entry.path) !== "test") {
      deletedTestFiles.push({ path: entry.from, to: entry.path });
    }
  }

  const hunks = [...parseUnifiedDiff(diff), ...untracked.map((path) => untrackedHunks(repoRoot, path))];
  // 削除したファイルは、ファイルの削除そのものを事実にする（宣言を1行ずつ並べ直さない）
  const markerFacts = collectMarkerFacts(hunks, patterns, new Set(deletedTestFiles.filter((file) => file.to === undefined).map((file) => file.path)));

  const configChanges: ConfigChange[] = [];
  for (const absolute of [join(repoRoot, CONFIG_FILE), join(input.cycleDirectory, CONFIG_FILE)]) {
    const path = relative(repoRoot, absolute);
    const before = await readFileAtRef(repoRoot, mergeBase, path);
    if (before.state === "unreadable") {
      notices.push(`基準の ${path} を読めません: ${before.unavailable ?? "理由不明"}`);
      continue;
    }
    configChanges.push(...declarationConfigChanges(path, before.content, readWorking(absolute)));
  }

  const issuePath = `${buildRelative}/issue.md`;
  const issueChanged = files.some((file) => file.path === issuePath || file.from === issuePath);

  const approvedAt = lastG8Approval(input.buildDirectory, notices);
  const afterFiles: AfterApproval[] = [];
  if (approvedAt !== undefined) {
    for (const name of ["test-spec.md", "plan.md"]) {
      const path = `${buildRelative}/${name}`;
      const commits = await commitsTouchingSince(repoRoot, path, approvedAt);
      if (commits === undefined) notices.push(`${path} の履歴を読めません`);
      const uncommitted = await hasUncommittedChange(repoRoot, path);
      if ((commits?.length ?? 0) > 0 || uncommitted) afterFiles.push({ path, commits: commits ?? [], uncommitted });
    }
  }

  return {
    phase: input.phase,
    base: { ...input.base, mergeBase },
    files,
    ...markerFacts,
    deletedTestFiles,
    configChanges,
    issueChanged,
    afterG8: { approvedAt, files: afterFiles },
    notices,
  };
}

// ---------------------------------------------------------------------------
// agreement.md

/** agreement.md の「## 返した理由」の箇条書き（指摘を直さずに理由を返したもの） */
export function agreementReasons(markdown: string): string[] {
  const reasons: string[] = [];
  let inside = false;
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    if (/^##\s/.test(line)) {
      inside = /^##\s+返した理由\s*$/.test(line);
      continue;
    }
    if (!inside) continue;
    const bullet = /^[-*]\s+(.*\S)\s*$/.exec(line);
    if (bullet !== null) {
      const text = bullet[1] as string;
      if (!/^(なし|無し|該当なし)[。]?$/.test(text)) reasons.push(text);
    } else if (/^\s{2,}\S/.test(line) && reasons.length > 0) {
      reasons[reasons.length - 1] += ` ${line.trim()}`;
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// 描画

const STATUS_LABEL: Record<string, string> = { A: "追加", M: "変更", D: "削除", R: "リネーム", C: "コピー", T: "種類の変更" };
const KIND_LABEL: Record<FileKind, string> = { implementation: "実装", test: "テスト", generated: "生成物" };
const CHANGE_LABEL: Record<ConfigChange["change"], string> = { added: "追加", removed: "削除", changed: "変更", unreadable: "読めない" };

/** PR 本文の1節に並べる行の上限。超えた分は件数だけを示し、全件は CLI で見る */
const PR_LIMIT = 20;

function code(text: string): string {
  const clipped = text.length > 120 ? `${text.slice(0, 117)}...` : text;
  return clipped.includes("`") ? `\`\` ${clipped} \`\`` : `\`${clipped}\``;
}

function limited(lines: string[], limit: number | undefined, phase: string): string[] {
  if (limit === undefined || lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `- ほか ${lines.length - limit} 件（全件は \`hikyaku diff facts ${phase}\`）`];
}

interface Section {
  title: string;
  lines: string[];
}

function factSections(facts: DiffFacts): Section[] {
  const sections: Section[] = [
    {
      title: "テストファイルの削除",
      lines: facts.deletedTestFiles.map((file) =>
        file.to === undefined ? `- ${code(file.path)}（削除）` : `- ${code(file.path)}（リネームでテストから外れた: → ${code(file.to)}）`,
      ),
    },
    { title: "削除されたテストの宣言", lines: facts.deletedTests.map((fact) => `- ${code(`${fact.path}:${fact.line}`)} ${code(fact.text)}`) },
    { title: "追加されたスキップの印", lines: facts.addedSkips.map((fact) => `- ${code(`${fact.path}:${fact.line}`)} ${code(fact.text)}`) },
    {
      title: "アサーションの行の変更（緩和かどうかは判定していない）",
      lines: facts.assertionChanges.map((fact) => `- ${code(`${fact.path}:${fact.line}`)}（${fact.side === "-" ? "削除" : "追加"}） ${code(fact.text)}`),
    },
    {
      title: "設定の宣言の変更",
      lines: facts.configChanges.map((change) => `- ${code(change.file)} ${code(change.ref)}: ${CHANGE_LABEL[change.change]}（${change.detail}）`),
    },
  ];
  const agreement: string[] = [];
  if (facts.issueChanged) agreement.push("- このビルドの issue.md が基準から変わっています");
  for (const file of facts.afterG8.files) {
    const parts = file.commits.map((commit) => `${commit.sha}「${commit.subject}」`);
    if (file.uncommitted) parts.push("未コミットの変更");
    agreement.push(`- G8 の承認（${facts.afterG8.approvedAt}）より後の ${code(file.path)} の書き換え: ${parts.join("、")}`);
  }
  sections.push({ title: "合意の文書の書き換え", lines: agreement });
  return sections;
}

/** レビュアーとユーザーが読む形（既定の出力） */
export function renderFactsText(facts: DiffFacts): string {
  const out = [
    `差分の事実: ${facts.phase}`,
    `基準: ${facts.base.ref ?? facts.base.name}${facts.base.mergeBase === undefined ? "" : `（merge-base ${facts.base.mergeBase.slice(0, 7)}）`} から作業ツリーまで`,
    "スコープの内外や、アサーションの変更が緩和かどうかは判定していません。",
    "",
    "## 変更ファイル",
    "",
  ];
  if (facts.files.length === 0) out.push("なし");
  for (const file of facts.files) {
    const status = STATUS_LABEL[file.status] ?? file.status;
    const from = file.from === undefined ? "" : `（← ${file.from}）`;
    out.push(`- ${status}・${KIND_LABEL[file.kind]}${file.untracked === true ? "・未追跡" : ""}: ${file.path}${from}`);
  }
  for (const section of factSections(facts)) {
    out.push("", `## ${section.title}`, "", ...(section.lines.length === 0 ? ["なし"] : section.lines));
  }
  if (facts.afterG8.approvedAt === undefined) out.push("", "G8 の承認の記録が無いので、承認後の書き換えは並べていません。");
  if (facts.notices.length > 0) out.push("", "## 注意", "", ...facts.notices.map((notice) => `- ${notice}`));
  return out.join("\n");
}

/**
 * PR 本文の節。変更ファイルの一覧は PR の diff で読めるので写さない（原則7）。
 * 問題を変えうる事実と、agreement.md に返した理由だけを並べる。
 * agreement は agreement.md の中身（無ければ undefined）
 */
export function renderFactsPr(facts: DiffFacts, agreement: string | undefined): string {
  const out = ["## 差分の事実と合意の突き合わせ", ""];
  out.push(`スクリプトが差分から並べた事実です。緩和やスコープの内外は判定していません（全件は \`hikyaku diff facts ${facts.phase}\`）。`);
  const sections = factSections(facts).filter((section) => section.lines.length > 0);
  if (sections.length === 0) {
    out.push("", "該当なし（テストの削除・スキップ・アサーションの変更・設定の宣言の変更・合意の文書の書き換えはありません）。");
  }
  for (const section of sections) {
    out.push("", `### ${section.title}`, "", ...limited(section.lines, PR_LIMIT, facts.phase));
  }
  if (facts.notices.length > 0) out.push("", "### 注意", "", ...facts.notices.map((notice) => `- ${notice}`));
  out.push("", "### 合意に無いと指摘された変更と、返した理由", "");
  if (agreement === undefined) {
    out.push(`${AGREEMENT_FILE} がありません（agreement-review を終えていません）。`);
  } else {
    const reasons = agreementReasons(agreement);
    out.push(...(reasons.length === 0 ? ["なし"] : reasons.map((reason) => `- ${reason}`)));
  }
  return out.join("\n");
}
