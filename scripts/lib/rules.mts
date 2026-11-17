/**
 * パス指定の rule（.claude/rules/）の広さと大きさを測る。
 *
 * rule は「一致するファイルを読み書きしたとき」に読み込まれる。glob が広いと、関係のない作業でも
 * 毎回読み込まれて、常時読み込みと変わらなくなる。問題になるのは広さと大きさの両方が大きい rule
 * なので、掛け合わせた値（読み込み量）で見る。広いが短い rule と、長いが狭い rule は問題にしない。
 *
 * glob がどのファイルにも一致しなくなった rule は、もう読み込まれない。パスの移動で静かに
 * 効かなくなるので、機械で検出する。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { matchesPathPattern } from "./diff-stats.mts";
import { lastTouched } from "./git.mts";
import type { RuleHit } from "./review-records.mts";

export const RULES_DIR = ".claude/rules";

/** 読み込み量（一致率 × 文字数）がこれを超えた rule を知らせる */
export const RULE_LOAD_WARNING = 2000;

export interface RuleFile {
  /** リポジトリルートからの相対パス */
  path: string;
  /** frontmatter の paths。無ければ undefined（起動時に常に読み込まれる） */
  paths: string[] | undefined;
  /** frontmatter を除いた本文の文字数 */
  characters: number;
  /** frontmatter の prevents / basis / importance（基準の理由。persistence.md の「rule の書き方」） */
  reasons?: RuleReasons;
  /** frontmatter の読めなかった値 */
  problems?: string[];
}

export interface RuleReasons {
  /** 何を防ぐための rule か（実際に起きた失敗） */
  prevents?: string;
  /** 何に立っているか（モデルの振る舞い・いまのコードの形・外の前提） */
  basis?: string;
  /** 害が成果物に残るなら高、セッションのコストなら中 */
  importance?: "高" | "中";
}

export interface RuleMeasure extends RuleFile {
  matched: number;
  /** 一致率（0〜1）。paths が無ければ 1 */
  share: number;
  /** 一致率 × 文字数 */
  load: number;
  /** paths があるのに、どのファイルにも一致しない */
  stale: boolean;
  heavy: boolean;
}

/** `{a,b}` を展開する（入れ子も扱う） */
export function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i += 1) {
    if (pattern[i] === "{") depth += 1;
    else if (pattern[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [pattern];

  const parts: string[] = [];
  let current = "";
  depth = 0;
  for (const ch of pattern.slice(open + 1, close)) {
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    current += ch;
  }
  parts.push(current);
  // カンマの無い `{x}` は展開しない（文字どおりに扱う）
  if (parts.length === 1) return expandBraces(pattern.slice(close + 1)).map((rest) => pattern.slice(0, close + 1) + rest);

  const head = pattern.slice(0, open);
  return parts.flatMap((part) => expandBraces(head + part + pattern.slice(close + 1)));
}

/**
 * rule の glob を正規表現にする。リポジトリルートからの相対パスに当てる。
 * `/` を含まないパターン（`*.md`）はどの階層のファイル名にも当たり、先頭が `/` ならルート直下だけに当たる。
 */
export function ruleGlobToRegExp(glob: string): RegExp {
  const anchored = glob.startsWith("/");
  const body = anchored ? glob.slice(1) : glob;
  let source = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (ch === "*") {
      if (body[i + 1] === "*") {
        if (body[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (ch === "?") {
      source += "[^/]";
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const prefix = !anchored && !body.includes("/") ? "(?:.*/)?" : "";
  return new RegExp(`^${prefix}${source}$`);
}

export function matchesRule(globs: string[], path: string): boolean {
  return globs.flatMap(expandBraces).some((glob) => ruleGlobToRegExp(glob).test(path));
}

/**
 * YAML のコメントを除く。引用符の外で、行頭か空白の直後にある `#` から後ろがコメント
 * （`src/#x` のように空白を挟まない `#` は値の一部）
 */
export function stripYamlComment(value: string): string {
  let quote: string | undefined;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i] as string;
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(value[i - 1] as string))) return value.slice(0, i).trimEnd();
  }
  return value;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/** カンマで分ける。`{a,b}` の中のカンマでは分けない */
function splitList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map(unquote).filter((part) => part !== "");
}

/**
 * frontmatter の paths を読む。YAML のリスト（ブロック・インライン）と、カンマ区切りの文字列を受ける。
 * frontmatter が無い・paths が無い・読めないときは undefined（Claude Code も paths なしとして扱う）。
 */
export function parseRule(source: string): { paths: string[] | undefined; body: string; reasons: RuleReasons; problems: string[] } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { paths: undefined, body: source, reasons: {}, problems: [] };
  const body = source.slice(match[0].length);
  const lines = (match[1] as string).split(/\r?\n/);
  const { reasons, problems } = parseReasons(lines);
  const at = lines.findIndex((line) => /^paths\s*:/.test(line));
  if (at === -1) return { paths: undefined, body, reasons, problems };

  const inline = stripYamlComment((lines[at] as string).replace(/^paths\s*:/, "")).trim();
  let paths: string[];
  if (inline !== "") {
    paths = splitList(inline.replace(/^\[/, "").replace(/\]$/, ""));
  } else {
    paths = [];
    for (const line of lines.slice(at + 1)) {
      // 空行とコメントだけの行は、リストの途中にあっても読み飛ばす
      if (stripYamlComment(line).trim() === "") continue;
      const item = /^\s*-\s+(.*)$/.exec(line);
      if (!item) break;
      const value = unquote(stripYamlComment(item[1] as string));
      if (value !== "") paths.push(value);
    }
  }
  return { paths: paths.length === 0 ? undefined : paths, body, reasons, problems };
}

/** frontmatter の行から prevents / basis / importance を読む（1行の文字列だけ） */
function parseReasons(lines: string[]): { reasons: RuleReasons; problems: string[] } {
  const reasons: RuleReasons = {};
  const problems: string[] = [];
  const value = (key: string): string | undefined => {
    const line = lines.find((l) => new RegExp(`^${key}\\s*:`).test(l));
    if (line === undefined) return undefined;
    const raw = unquote(stripYamlComment(line.replace(new RegExp(`^${key}\\s*:`), "")));
    return raw === "" ? undefined : raw;
  };
  const prevents = value("prevents");
  const basis = value("basis");
  const importance = value("importance");
  if (prevents !== undefined) reasons.prevents = prevents;
  if (basis !== undefined) reasons.basis = basis;
  if (importance === "高" || importance === "中") reasons.importance = importance;
  else if (importance !== undefined) problems.push(`importance が不正です: ${importance}（高 か 中）`);
  return { reasons, problems };
}

/** .claude/rules/ 配下の .md を再帰的に集める */
export function listRuleFiles(repoRoot: string): RuleFile[] {
  const root = join(repoRoot, RULES_DIR);
  if (!existsSync(root)) return [];
  const found: RuleFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".md")) {
        const parsed = parseRule(readFileSync(path, "utf8"));
        found.push({
          path: relative(repoRoot, path),
          paths: parsed.paths,
          characters: parsed.body.trim().length,
          reasons: parsed.reasons,
          problems: parsed.problems,
        });
      }
    }
  };
  visit(root);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** 追跡ファイルの一覧。git が使えなければ undefined */
export function trackedFiles(repoRoot: string): string[] | undefined {
  try {
    const stdout = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });
    return stdout.split("\0").filter((path) => path !== "");
  } catch {
    return undefined;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** date から now までの日数（切り捨て）。日時が分からなければ undefined */
export function daysSince(date: Date | null | undefined, now: Date): number | undefined {
  if (date === null || date === undefined) return undefined;
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

/**
 * rule の最終変更を測るファイル。paths に当たる追跡ファイル（rule が守る領域の開発頻度）。
 * paths が無い rule・どのファイルにも一致しない rule は、rule ファイル自身
 */
export function ruleTouchFiles(rule: RuleFile, files: string[]): string[] {
  if (rule.paths === undefined) return [rule.path];
  const matched = files.filter((path) => path !== rule.path && matchesRule(rule.paths as string[], path));
  return matched.length === 0 ? [rule.path] : matched;
}

/** rule ごとの最終変更日時（git.mts の lastTouched）。失敗した rule は undefined */
export async function rulesLastTouched(repoRoot: string, rules: RuleFile[], files: string[]): Promise<Map<string, Date | null | undefined>> {
  const touched = new Map<string, Date | null | undefined>();
  for (const rule of rules) touched.set(rule.path, await lastTouched(repoRoot, ruleTouchFiles(rule, files)));
  return touched;
}

export interface RuleCandidate {
  path: string;
  /**
   * move: レビューの記録で閾値以上引かれた（機械の検査やリファクタへ移す候補）。
   * stale: どのファイルにも一致しない。missing: 記録に挙がったが .claude/rules/ に無い
   */
  kind: "move" | "stale" | "missing";
  hits?: number;
  heavy?: number;
  sources?: string[];
  /** 最終変更からの日数（領域の開発頻度の材料）。分からなければ undefined */
  lastTouchedDays: number | undefined;
  reasons: RuleReasons;
}

/** 記録の rule のパスを .claude/rules/ のパスと同じ形にそろえる */
function normalizeRulePath(path: string): string {
  return path.replace(/^\.\//, "");
}

/**
 * 移す候補・一致しない rule・記録に挙がったが無い rule を並べる。移すか消すかは決めない（US-4.4）
 */
export function ruleCandidates(input: {
  measures: RuleMeasure[];
  hits: Map<string, RuleHit>;
  threshold: number;
  lastTouched: Map<string, Date | null | undefined>;
  now: Date;
}): RuleCandidate[] {
  const candidates: RuleCandidate[] = [];
  const hits = new Map<string, RuleHit>();
  for (const [path, hit] of input.hits) {
    const key = normalizeRulePath(path);
    const merged = hits.get(key) ?? { count: 0, heavy: 0, sources: [] };
    hits.set(key, { count: merged.count + hit.count, heavy: merged.heavy + hit.heavy, sources: [...merged.sources, ...hit.sources] });
  }
  for (const rule of input.measures) {
    const hit = hits.get(rule.path);
    const days = daysSince(input.lastTouched.get(rule.path), input.now);
    const reasons = rule.reasons ?? {};
    if (hit !== undefined && hit.count >= input.threshold) {
      candidates.push({ path: rule.path, kind: "move", hits: hit.count, heavy: hit.heavy, sources: hit.sources, lastTouchedDays: days, reasons });
    }
    if (rule.stale) {
      const extra = hit === undefined ? {} : { hits: hit.count, heavy: hit.heavy, sources: hit.sources };
      candidates.push({ path: rule.path, kind: "stale", ...extra, lastTouchedDays: days, reasons });
    }
  }
  const known = new Set(input.measures.map((rule) => rule.path));
  for (const [path, hit] of hits) {
    if (known.has(path)) continue;
    candidates.push({ path, kind: "missing", hits: hit.count, heavy: hit.heavy, sources: hit.sources, lastTouchedDays: undefined, reasons: {} });
  }
  return candidates;
}

/**
 * rule ごとに、一致するファイル数・一致率・読み込み量を出す。
 * exclude（[diff] exclude の glob）に当たる生成物は、触って読むファイルではないので分母から除く。
 */
export function measureRules(rules: RuleFile[], files: string[], exclude: string[]): { measures: RuleMeasure[]; total: number } {
  const counted = files.filter((path) => !exclude.some((pattern) => matchesPathPattern(pattern, path)));
  const total = counted.length;
  const measures = rules.map((rule) => {
    const matched = rule.paths === undefined ? total : counted.filter((path) => matchesRule(rule.paths as string[], path)).length;
    const share = total === 0 ? 0 : matched / total;
    const load = Math.round(share * rule.characters);
    return { ...rule, matched, share, load, stale: rule.paths !== undefined && matched === 0, heavy: load > RULE_LOAD_WARNING };
  });
  return { measures, total };
}
