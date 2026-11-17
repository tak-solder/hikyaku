/**
 * サイクルの記録から、永続化の候補と「役に立たなかった記述」を集める（promotions）。
 *
 * handoff.md と retrospective.md は、同じ見出しと行の形で候補を書く
 * （skills/close-cycle/references/persistence.md の「記録の書式」）。形が決まっているので、
 * 集めて束ねるところまではスクリプトでできる。重複の判定・コードとの照合・取捨選択は
 * close-cycle（LLM）の仕事で、ここでは行わない。
 *
 * 読めない行は捨てずに unparsed として返す。黙って落とすと、書式を少し崩しただけの候補が
 * 昇格の機会を失う。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { ResolvedConfig } from "./config.mts";
import { DOC_DEFINITIONS, loadGuide } from "./docs.mts";
import { gitSync } from "./git.mts";
import { listPatchUnits } from "./patch.mts";

export const PROMOTE_HEADING = "永続化すること";
/** handoff.md の、コードレビューの指摘がどの rule を引いたかの記録（読むのは review-records.mts） */
export const REVIEW_RECORD_HEADING = "レビューの記録";
export const UNHELPFUL_HEADING = "役に立たなかった記述";
/** design-delta.md の予定。close-cycle は実装の結果と照らして昇格させる */
export const PLANNED_HEADING = "永続ドキュメントの更新予定";

export type Importance = "高" | "中";
export const UNHELPFUL_REASONS = ["古い", "自明", "無関係"] as const;
export type UnhelpfulReason = (typeof UNHELPFUL_REASONS)[number];

/**
 * 論理名以外の宛先。`skill:` `rule:` は後ろに名前・パスが続く。
 * `refactor` は「なくす」: リファクタで知見そのものを不要にできるもの（置き場の順の先頭。persistence.md）
 */
const PLAIN_TARGETS = ["refactor", "workflow", "hook", "upstream"];
const PREFIXED_TARGETS = ["skill", "rule"];

export interface Candidate {
  /** 宛先（`constraints` / `rule:.claude/rules/x.md` など） */
  target: string;
  /** 宛先の種類。論理名は doc */
  kind: "doc" | "refactor" | "workflow" | "skill" | "rule" | "hook" | "upstream";
  importance: Importance | undefined;
  /** 行末の `（防ぐ: … / 立つ: … / 重要度: …）`。書かれていなければ持たない */
  reasons?: CriterionReasons;
  /** そのビルドの PR で既に書いたもの */
  written: boolean;
  text: string;
  /** サイクルのディレクトリからの相対パス */
  source: string;
}

export interface Unhelpful {
  /** 論理名・ファイルのパス・`rule:<パス>` */
  location: string;
  /** 鉤括弧の中（見出しか冒頭の数語） */
  quote: string;
  reason: UnhelpfulReason;
  note: string;
  source: string;
}

export interface Unparsed {
  heading: string;
  line: string;
  source: string;
  problem: string;
}

export interface Planned {
  text: string;
  source: string;
}

export interface Collected {
  candidates: Candidate[];
  unhelpful: Unhelpful[];
  planned: Planned[];
  unparsed: Unparsed[];
  /** 読んだファイル（サイクルのディレクトリからの相対パス） */
  sources: string[];
}

/**
 * 見出し（レベルは問わない）の直下の箇条書きを、項目ごとに返す。
 *
 * 振り返りの追記（PR レビュー対応）は同じ見出しを下位のレベルで繰り返すので、同名の節をすべて拾う。
 * 字下げした続きの行は、直前の項目につなげる。コードブロックの中は読まない（テンプレートの例を
 * 候補として拾わないため）。
 */
export function sectionItems(source: string, heading: string): string[] {
  const items: string[] = [];
  let inside = false;
  let fenced = false;

  for (const raw of source.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const head = /^#{1,6}\s+(.*)$/.exec(line);
    if (head) {
      inside = (head[1] as string).trim() === heading;
      continue;
    }
    if (!inside) continue;

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      items.push((bullet[1] as string).trim());
      continue;
    }
    if (/^\s+\S/.test(line) && items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    }
  }
  return items;
}

function targetKind(target: string): Candidate["kind"] | undefined {
  if (DOC_DEFINITIONS.some((d) => d.name === target)) return "doc";
  if (PLAIN_TARGETS.includes(target)) return target as Candidate["kind"];
  const [prefix, rest] = splitPrefix(target);
  if (PREFIXED_TARGETS.includes(prefix) && rest !== "") return prefix as Candidate["kind"];
  return undefined;
}

function splitPrefix(target: string): [string, string] {
  const at = target.indexOf(":");
  return at === -1 ? [target, ""] : [target.slice(0, at), target.slice(at + 1).trim()];
}

/** 基準の理由。何を防ぐためのものか・何に立っているか・害が成果物に残るか */
export interface CriterionReasons {
  prevents: string;
  basis: string;
  importance: Importance | undefined;
}

/** 理由の欄の始まり。最後に現れたものを使う（本文や根拠の括弧に「防ぐ:」が出ても、理由は行末にある） */
const REASONS_OPEN = /[（(]\s*防ぐ\s*[:：]/g;
/** 欄の区切り。次の欄の名前が続く `/` だけで切る（防ぐ・立つの文に `src/billing` のようなパスが入りうる） */
const FIELD_SEPARATOR = /\s*\/\s*(?=(?:防ぐ|立つ|重要度)\s*[:：])/;

/**
 * 理由の欄の中身。最後の `（防ぐ:` から、対応する閉じ括弧まで。中の入れ子の括弧（`移行（up/down）`）はそのまま含む。
 * 欄が無ければ undefined、欄が閉じていない・欄の後ろに文字が続くなら理由を返す（黙って理由なしとして読まない）
 */
function reasonsTail(text: string): { start: number; inner: string } | undefined | string {
  const opens = [...text.matchAll(REASONS_OPEN)];
  const last = opens[opens.length - 1];
  if (last === undefined) return undefined;
  const start = last.index ?? 0;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === "（" || ch === "(") depth += 1;
    else if (ch === "）" || ch === ")") {
      depth -= 1;
      if (depth === 0) {
        if (i !== text.length - 1) return "理由の欄 `（防ぐ: … / 立つ: …）` は行末に置きます（後ろに文字が続いています）";
        return { start, inner: text.slice(start + last[0].length, i) };
      }
    }
  }
  return "理由の欄 `（防ぐ: …` の括弧が閉じていません";
}

/**
 * 基準の行末の理由 `（防ぐ: … / 立つ: … / 重要度: 高|中）` を読む。「永続化すること」の行と、
 * 文書に書かれた基準の行（conventions など）が同じ書式を使う。重要度は省ける（「永続化すること」の行は [高|中] を持つ）。
 * 理由の欄が無ければ reasons は undefined（エラーにしない）。「（防ぐ:」で始まる括弧が崩れていれば理由を返す
 */
export function parseCriterionReasons(text: string): { text: string; reasons: CriterionReasons | undefined } | string {
  const trimmed = text.trim();
  const tail = reasonsTail(trimmed);
  if (tail === undefined) return { text: trimmed, reasons: undefined };
  if (typeof tail === "string") return tail;
  const fields = new Map<string, string>();
  for (const part of `防ぐ:${tail.inner}`.split(FIELD_SEPARATOR).map((p) => p.trim())) {
    const field = /^(防ぐ|立つ|重要度)\s*[:：]\s*(.*)$/.exec(part);
    if (!field) return `理由の欄を読めません: 「${part}」（「防ぐ: … / 立つ: … / 重要度: 高|中」の形で書きます）`;
    fields.set(field[1] as string, (field[2] as string).trim());
  }
  const prevents = fields.get("防ぐ") ?? "";
  const basis = fields.get("立つ") ?? "";
  if (prevents === "") return "理由の欄の「防ぐ」が空です（何を防ぐ基準かを書きます）";
  if (basis === "") return "理由の欄に「立つ」がありません（何に立っている基準かを書きます）";
  const importance = fields.get("重要度");
  if (importance !== undefined && importance !== "高" && importance !== "中") {
    return `理由の欄の重要度が不正です: ${importance}（高 か 中）`;
  }
  return { text: trimmed.slice(0, tail.start).trim(), reasons: { prevents, basis, importance: importance as Importance | undefined } };
}

/** `- \`宛先\` [高] 済: 本文` の1行を読む。読めなければ理由を返す */
export function parseCandidate(item: string): Omit<Candidate, "source"> | string {
  const match = /^`([^`]+)`\s*(?:\[(高|中|低)\])?\s*(済)?\s*[:：]\s*(.+)$/.exec(item);
  if (!match) return "「`宛先` [重要度]: 本文」の形になっていません";
  const target = (match[1] as string).trim();
  const kind = targetKind(target);
  if (kind === undefined) {
    return `宛先が不明です: ${target}（使えるのは ${[...DOC_DEFINITIONS.map((d) => d.name), ...PLAIN_TARGETS, "skill:<名前>", "rule:<パス>"].join(" / ")}）`;
  }
  if (match[2] === "低") return "重要度が低の知見は書きません（persistence.md）";
  const importance = match[2] as Importance | undefined;
  if (importance === undefined && kind !== "upstream") return "重要度（[高] か [中]）がありません";
  const body = parseCriterionReasons(match[4] as string);
  if (typeof body === "string") return body;
  const candidate: Omit<Candidate, "source"> = { target, kind, importance, written: match[3] !== undefined, text: body.text };
  if (body.reasons !== undefined) {
    if (body.reasons.importance !== undefined && body.reasons.importance !== importance) {
      return `行の重要度（[${importance ?? "なし"}]）と理由の欄の重要度（${body.reasons.importance}）が食い違っています`;
    }
    candidate.reasons = body.reasons;
  }
  return candidate;
}

/** `- \`場所\`「引用」: 理由（補足）` の1行を読む */
export function parseUnhelpful(item: string): Omit<Unhelpful, "source"> | string {
  const match = /^`([^`]+)`\s*「([^」]*)」\s*[:：]\s*(\S+?)(?:[（(](.*)[）)])?\s*$/.exec(item);
  if (!match) return "「`場所`「見出しや冒頭」: 理由（補足）」の形になっていません";
  const reason = match[3] as string;
  if (!(UNHELPFUL_REASONS as readonly string[]).includes(reason)) {
    return `理由が不明です: ${reason}（使えるのは ${UNHELPFUL_REASONS.join(" / ")}）`;
  }
  return {
    location: (match[1] as string).trim(),
    quote: (match[2] as string).trim(),
    reason: reason as UnhelpfulReason,
    note: (match[4] ?? "").trim(),
  };
}

/** 「なし」だけの項目（節に該当が無い） */
function isNone(item: string): boolean {
  return /^(なし|無し|該当なし)[。.]?$/.test(item);
}

/** サイクルのディレクトリの中で、候補を書きうるファイル（相対パス、並びは固定） */
export function promotionSources(cycleDirectory: string): string[] {
  const found: string[] = [];
  const push = (rel: string): void => {
    if (existsSync(join(cycleDirectory, rel))) found.push(rel);
  };
  push("planning/retrospective.md");
  push("design/design-delta.md");
  push("design/retrospective.md");
  const builds = existsSync(cycleDirectory)
    ? readdirSync(cycleDirectory, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^build-\d+$/.test(e.name))
        .map((e) => e.name)
        .sort()
    : [];
  for (const build of builds) {
    push(`${build}/handoff.md`);
    push(`${build}/retrospective.md`);
  }
  // サイクルに属す patch（統合ブランチ宛て・CLOSE 前）は、永続化するものを handoff.md に残す
  for (const unit of listPatchUnits(cycleDirectory)) push(`${unit}/handoff.md`);
  return found;
}

export function collectPromotions(cycleDirectory: string): Collected {
  const collected: Collected = { candidates: [], unhelpful: [], planned: [], unparsed: [], sources: [] };

  for (const source of promotionSources(cycleDirectory)) {
    const text = readFileSync(join(cycleDirectory, source), "utf8");
    collected.sources.push(source);

    for (const item of sectionItems(text, PLANNED_HEADING)) {
      if (!isNone(item)) collected.planned.push({ text: item, source });
    }
    for (const item of sectionItems(text, PROMOTE_HEADING)) {
      if (isNone(item)) continue;
      const parsed = parseCandidate(item);
      if (typeof parsed === "string") {
        collected.unparsed.push({ heading: PROMOTE_HEADING, line: item, source, problem: parsed });
      } else {
        collected.candidates.push({ ...parsed, source });
      }
    }
    for (const item of sectionItems(text, UNHELPFUL_HEADING)) {
      if (isNone(item)) continue;
      const parsed = parseUnhelpful(item);
      if (typeof parsed === "string") {
        collected.unparsed.push({ heading: UNHELPFUL_HEADING, line: item, source, problem: parsed });
      } else {
        collected.unhelpful.push({ ...parsed, source });
      }
    }
  }
  return collected;
}

export interface UnhelpfulGroup {
  location: string;
  quote: string;
  /** 理由ごとの件数 */
  reasons: Partial<Record<UnhelpfulReason, number>>;
  notes: string[];
  sources: string[];
}

/**
 * 同じ記述への指摘を束ねる。場所と引用が一致したものだけを同じとみなす
 * （言い回しの違いを同一とみなすかは close-cycle が判断する）。
 */
export function groupUnhelpful(items: Unhelpful[]): UnhelpfulGroup[] {
  const groups = new Map<string, UnhelpfulGroup>();
  for (const item of items) {
    const key = `${item.location}\u0000${item.quote}`;
    const group = groups.get(key) ?? { location: item.location, quote: item.quote, reasons: {}, notes: [], sources: [] };
    group.reasons[item.reason] = (group.reasons[item.reason] ?? 0) + 1;
    if (item.note !== "") group.notes.push(`${item.reason}: ${item.note}`);
    group.sources.push(item.source);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.sources.length - a.sources.length);
}

// ---------------------------------------------------------------------------
// G10 の同意が要る変更（ADR approval-kind-in-step-definitions）
//
// 判定はこの節の consentChanges だけに置く。G10 の consent と write の accepts が同じ関数を使い、
// 提示（promotions --json の approval）も同じ宛先の表を使う。

/** 変更に同意が要る論理名。外の前提と受け入れたリスクを持つ文書（原則11） */
export const CONSENT_TARGETS = ["decisions", "constraints"] as const;
export type ConsentTarget = (typeof CONSENT_TARGETS)[number];

/** 候補の承認の種類。decisions・constraints 宛ては同意、それ以外は確認 */
export function candidateApproval(candidate: Pick<Candidate, "target" | "kind">): "consent" | "confirm" {
  return candidate.kind === "doc" && (CONSENT_TARGETS as readonly string[]).includes(candidate.target) ? "consent" : "confirm";
}

const STATUS_LINE = /^status\s*:\s*(\S+)\s*$/;

/** frontmatter（先頭の --- から次の --- まで）の範囲。無ければ undefined */
function frontmatterEnd(lines: string[]): number | undefined {
  if (lines[0]?.trim() !== "---") return undefined;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return end === -1 ? undefined : end;
}

/**
 * frontmatter の `status: accepted` を `status: implemented` に変えただけか（ほかの行はすべて同じ）。
 * 実装状態の記録で、判断の中身を変えない書き換え（設計の質問 Q11）
 */
export function isStatusOnlyChange(before: string, after: string): boolean {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  if (a.length !== b.length) return false;
  const end = frontmatterEnd(a);
  if (end === undefined || frontmatterEnd(b) !== end) return false;
  let changed = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (i >= end) return false;
    const from = STATUS_LINE.exec(a[i] as string)?.[1];
    const to = STATUS_LINE.exec(b[i] as string)?.[1];
    if (from !== "accepted" || to !== "implemented") return false;
    changed += 1;
  }
  return changed === 1;
}

/** ADR のファイル名から拡張子を除いた名前（`20261116-xxx`） */
export function adrName(path: string): string {
  return basename(path).replace(/\.md$/, "");
}

/**
 * このサイクルの ADR。サイクルのディレクトリの .md（design/・tasklist.md・build-NN/issue.md など）に
 * 名前が現れる ADR だけを返す。現れない ADR は、このサイクルのものと確かめられないので含めない（同意の側に倒れる）
 */
export function cycleAdrNames(cycleDirectory: string, names: string[]): Set<string> {
  const found = new Set<string>();
  if (names.length === 0 || !existsSync(cycleDirectory)) return found;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".md")) {
        const text = readFileSync(path, "utf8");
        for (const name of names) if (text.includes(name)) found.add(name);
      }
    }
  };
  visit(cycleDirectory);
  return found;
}

export interface DocChange {
  /** リポジトリルートからの相対パス */
  path: string;
  doc: ConsentTarget;
  status: "A" | "M" | "D";
  before?: string;
  after?: string;
}

export interface ConsentChange {
  source: "candidate" | "diff";
  doc: ConsentTarget;
  text: string;
}

const STATUS_LABELS: Record<DocChange["status"], string> = { A: "追加", M: "変更", D: "削除" };

/**
 * 同意が要る変更（唯一の判定）。宛先が decisions・constraints の候補はすべて（候補の時点では書き換えの
 * 中身が分からない）。差分は、このサイクルの ADR の accepted → implemented だけの書き換えを除いたすべて
 */
export function consentChanges(input: { candidates: Candidate[]; changes: DocChange[]; cycleAdrs: Set<string> }): ConsentChange[] {
  const found: ConsentChange[] = [];
  for (const candidate of input.candidates) {
    if (candidateApproval(candidate) !== "consent") continue;
    found.push({ source: "candidate", doc: candidate.target as ConsentTarget, text: `${candidate.text}（${candidate.source}）` });
  }
  for (const change of input.changes) {
    const statusOnly =
      change.doc === "decisions" &&
      change.status === "M" &&
      input.cycleAdrs.has(adrName(change.path)) &&
      change.before !== undefined &&
      change.after !== undefined &&
      isStatusOnlyChange(change.before, change.after);
    if (statusOnly) continue;
    found.push({ source: "diff", doc: change.doc, text: `${change.path}（${STATUS_LABELS[change.status]}）` });
  }
  return found;
}

/** 空のツリー（親の無いコミットの手前と比べるとき） */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * close-cycle が書く前の状態のコミット。close-cycle の記録がサイクル直下の progress.jsonl に初めて入った
 * コミットの親。まだコミットされていなければ HEAD。サイクル直下には create-cycle の記録も入るので、
 * ファイルを足したコミットではなく、close-cycle の行が初めて現れたコミットを探す
 */
function closeBaseline(repoRoot: string, progressRel: string): string | undefined {
  const found = gitSync(repoRoot, ["log", "--reverse", "--format=%H", "-S", '"skill":"close-cycle"', "--", progressRel]);
  if (found === undefined) return undefined;
  const first = found.split("\n").find((line) => line.trim() !== "")?.trim();
  if (first === undefined) {
    return gitSync(repoRoot, ["rev-parse", "--verify", "-q", "HEAD"]) === undefined ? undefined : "HEAD";
  }
  return gitSync(repoRoot, ["rev-parse", "--verify", "-q", `${first}^`]) === undefined ? EMPTY_TREE : `${first}^`;
}

/**
 * 作業ツリーにある decisions・constraints の変更（close-cycle が書く前との差分。追跡外のファイルも追加として数える）。
 * 所在は作業ツリーの document-guide.md から引く（未作成・対象外は見ない）。確かめられなければ理由を返す
 */
export function docChanges(config: ResolvedConfig, cycleDirectory: string): DocChange[] | string {
  const paths = new Map<string, ConsentTarget>();
  let guide;
  try {
    guide = loadGuide(config.hikyakuRoot);
  } catch (error) {
    return `document-guide.md を読めません: ${error instanceof Error ? error.message : String(error)}`;
  }
  for (const entry of guide) {
    if ((CONSENT_TARGETS as readonly string[]).includes(entry.name) && entry.path !== undefined) {
      paths.set(entry.path.replace(/^\.\//, ""), entry.name as ConsentTarget);
    }
  }
  if (paths.size === 0) return [];
  const docOf = (path: string): ConsentTarget | undefined => {
    for (const [prefix, doc] of paths) {
      const dir = prefix.endsWith("/") ? prefix : `${prefix}/`;
      if (path === prefix || path.startsWith(dir)) return doc;
    }
    return undefined;
  };

  const root = config.repoRoot;
  const progressRel = relative(root, join(cycleDirectory, "progress.jsonl"));
  const base = closeBaseline(root, progressRel);
  if (base === undefined) return "git の履歴を読めず、close-cycle が書く前の状態と比べられません";
  const pathspec = [...paths.keys()];
  const diff = gitSync(root, ["diff", "--name-status", "--no-renames", "-z", base, "--", ...pathspec]);
  const untracked = gitSync(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspec]);
  if (diff === undefined || untracked === undefined) return "git の差分を読めず、decisions・constraints の変更を確かめられません";

  const changes: DocChange[] = [];
  const fields = diff.split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const code = (fields[i] as string).trim()[0];
    const path = fields[i + 1] as string;
    const doc = docOf(path);
    if (doc === undefined || (code !== "A" && code !== "M" && code !== "D")) continue;
    const change: DocChange = { path, doc, status: code };
    if (code !== "A") change.before = gitSync(root, ["show", `${base}:${path}`]);
    if (code !== "D" && existsSync(join(root, path))) change.after = readFileSync(join(root, path), "utf8");
    changes.push(change);
  }
  for (const path of untracked.split("\0").filter((p) => p !== "")) {
    const doc = docOf(path);
    if (doc === undefined) continue;
    changes.push({ path, doc, status: "A", after: readFileSync(join(root, path), "utf8") });
  }
  return changes;
}

/** G10 の判定の材料。同意が要る変更と、差分を確かめられなかった理由 */
export interface PromotionConsent {
  changes: ConsentChange[];
  /** 差分を確かめられなかった理由（同意の側に倒す） */
  problem?: string;
}

/**
 * G10・write が使う判定。サイクルが閉じたあとは差分を見ない（後続のサイクルの decisions の変更で、
 * 閉じたサイクルの G10 が戻らないように）
 */
export function promotionConsent(config: ResolvedConfig, cycleDirectory: string, closed: boolean): PromotionConsent {
  const candidates = collectPromotions(cycleDirectory).candidates;
  if (closed) return { changes: consentChanges({ candidates, changes: [], cycleAdrs: new Set() }) };
  const changes = docChanges(config, cycleDirectory);
  if (typeof changes === "string") {
    return { changes: consentChanges({ candidates, changes: [], cycleAdrs: new Set() }), problem: changes };
  }
  const names = changes.filter((change) => change.doc === "decisions").map((change) => adrName(change.path));
  return { changes: consentChanges({ candidates, changes, cycleAdrs: cycleAdrNames(cycleDirectory, names) }) };
}

/** 宛先ごとに候補を並べる（宛先の並びは、最初に現れた順） */
export function groupCandidates(items: Candidate[]): Map<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>();
  for (const item of items) {
    groups.set(item.target, [...(groups.get(item.target) ?? []), item]);
  }
  return groups;
}
