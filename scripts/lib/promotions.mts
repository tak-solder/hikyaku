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
import { join } from "node:path";
import { DOC_DEFINITIONS } from "./docs.mts";
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

/** 理由の欄の中身（行末の閉じ括弧まで）。中の入れ子の括弧（`移行（up/down）`）はそのまま含む */
function reasonsTail(text: string): { start: number; inner: string } | undefined {
  const opens = [...text.matchAll(REASONS_OPEN)];
  const last = opens[opens.length - 1];
  if (last === undefined || !/[）)]$/.test(text)) return undefined;
  const start = last.index ?? 0;
  return { start, inner: text.slice(start + last[0].length, -1) };
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

/** 宛先ごとに候補を並べる（宛先の並びは、最初に現れた順） */
export function groupCandidates(items: Candidate[]): Map<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>();
  for (const item of items) {
    groups.set(item.target, [...(groups.get(item.target) ?? []), item]);
  }
  return groups;
}
