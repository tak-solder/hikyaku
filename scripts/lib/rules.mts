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
export function parseRule(source: string): { paths: string[] | undefined; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { paths: undefined, body: source };
  const body = source.slice(match[0].length);
  const lines = (match[1] as string).split(/\r?\n/);
  const at = lines.findIndex((line) => /^paths\s*:/.test(line));
  if (at === -1) return { paths: undefined, body };

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
  return { paths: paths.length === 0 ? undefined : paths, body };
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
        found.push({ path: relative(repoRoot, path), paths: parsed.paths, characters: parsed.body.trim().length });
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
