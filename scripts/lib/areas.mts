/**
 * 領域の開発頻度（US-5）。変更するパスがどれだけ最近まで触られていたかをリポジトリの履歴から判定し、
 * 長く触られていなかった（休眠した）領域に結び付いた基準（rule・ADR・constraints の項目）を示す。
 *
 * 長く触られていなかったこと自体が、外の前提が変わったかもしれないという信号なので、設計の前に見直しの対象として示す。
 * 見直すかどうかは判断しない。
 *
 * glob の意味は rule と同じ（rules.mts の matchesRule）。休眠の判定も、基準との重なりも、追跡ファイルを
 * この matcher で絞ってから決める（git の pathspec に glob を渡すと `*.md` や `{a,b}` の意味が変わる）。
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { ResolvedConfig } from "./config.mts";
import { matchesPathPattern } from "./diff-stats.mts";
import { lastTouched } from "./git.mts";
import { documentFiles, isSuperseded } from "./premises.mts";
import { daysSince, listRuleFiles, matchesRule, trackedFiles } from "./rules.mts";

export interface LinkedCriterion {
  kind: "rule" | "adr" | "constraints";
  /** リポジトリルートからの相対パス。constraints は項目のアンカー付き（`path#見出し`） */
  source: string;
  /** rule と ADR はファイルのパス（rule）か見出し（ADR）、constraints は項目の見出し */
  title: string;
  globs: string[];
}

export interface AreaStatus {
  glob: string;
  /** 当たる追跡ファイルの最終コミット日時（ISO 8601）。当たるファイルが無い・履歴が無い・git が使えなければ null */
  lastTouched: string | null;
  days: number | null;
  dormant: boolean;
  /** 休眠した領域に重なる基準。休眠していなければ空 */
  linked: LinkedCriterion[];
}

export interface DormantResult {
  dormantDays: number;
  areas: AreaStatus[];
  notices: string[];
}

const AREA_LINE = /^\s*[-*+]\s+\*\*領域\*\*\s*[:：]\s*(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** build-05 の書式 `- **領域**: \`<glob>\`, \`<glob>\`` を読む。「領域」行でなければ undefined */
export function parseAreaLine(line: string): string[] | undefined {
  const match = AREA_LINE.exec(line);
  if (!match) return undefined;
  return [...(match[1] as string).matchAll(/`([^`]+)`/g)].map((m) => (m[1] as string).trim()).filter((g) => g !== "");
}

/**
 * Markdown の「領域」行を、属する項目の見出しと一緒に返す（コードブロックの中は読まない）。
 * constraints の項目は `##` の見出しなので、`###` 以下の小見出しは項目に数えない
 */
export function areaLines(markdown: string): { heading: string | undefined; level: number; globs: string[] }[] {
  const found: { heading: string | undefined; level: number; globs: string[] }[] = [];
  let heading: string | undefined;
  let level = 0;
  let fence: string | undefined;
  for (const raw of markdown.split(/\r?\n/)) {
    const fenceMatch = FENCE.exec(raw);
    if (fence !== undefined) {
      if (fenceMatch && fenceMatch[1]?.[0] === fence[0] && (fenceMatch[1]?.length ?? 0) >= fence.length) fence = undefined;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const head = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (head) {
      if ((head[1] as string).length <= 2) {
        heading = (head[2] as string).trim();
        level = (head[1] as string).length;
      }
      continue;
    }
    // glob を読めない「領域」行も返す（globs が空）。呼び出し側が黙って落とさず知らせる
    const globs = parseAreaLine(raw);
    if (globs !== undefined) found.push({ heading, level, globs });
  }
  return found;
}

/** 領域と結び付いた基準: rule の paths、ADR の「領域」行（1ファイル1行）、constraints の項目（`##`）ごとの「領域」行 */
export function linkedCriteria(config: ResolvedConfig): { criteria: LinkedCriterion[]; problems: string[] } {
  const criteria: LinkedCriterion[] = [];
  const problems: string[] = [];
  const unreadable = (where: string): string =>
    `${where}: 「領域」の行に glob がありません（\`<glob>\` をバッククォートで囲んで書きます）。この基準は領域と結び付きません`;
  for (const rule of listRuleFiles(config.repoRoot)) {
    if (rule.paths !== undefined) criteria.push({ kind: "rule", source: rule.path, title: rule.path, globs: rule.paths });
  }
  for (const file of documentFiles(config, ["decisions"])) {
    const markdown = readFileSync(file, "utf8");
    if (isSuperseded(markdown)) continue;
    const source = relative(config.repoRoot, file);
    const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? source;
    const lines = areaLines(markdown);
    if (lines.some((line) => line.globs.length === 0)) problems.push(unreadable(source));
    const globs = lines.flatMap((line) => line.globs);
    if (globs.length > 0) criteria.push({ kind: "adr", source, title, globs });
  }
  for (const file of documentFiles(config, ["constraints"])) {
    const source = relative(config.repoRoot, file);
    for (const line of areaLines(readFileSync(file, "utf8"))) {
      // source は見出しの文字列を添えた所在（GitHub のアンカーの形ではない）
      const title = line.heading ?? source;
      if (line.globs.length === 0) problems.push(unreadable(`${source}「${title}」`));
      else criteria.push({ kind: "constraints", source: `${source}#${title}`, title, globs: line.globs });
    }
  }
  return { criteria, problems };
}

/**
 * 渡された glob ごとに、当たる追跡ファイルの最終変更から休眠を判定し、休眠した領域に重なる基準を返す。
 * 当たるファイルが無い（新しいパス）・履歴が無いものは休眠とみなさない（古びる元のコードが無い）。
 * 期間ちょうどの日数は休眠ではない（超えたら休眠）
 */
export async function dormantAreas(config: ResolvedConfig, globs: string[], now = new Date()): Promise<DormantResult> {
  const notices: string[] = [];
  const files = trackedFiles(config.repoRoot);
  if (files === undefined) notices.push("git を使えないので、最終変更を判定できません（Git リポジトリの中で実行してください）");
  const linked = files === undefined ? { criteria: [], problems: [] } : linkedCriteria(config);
  const criteria = linked.criteria;
  notices.push(...linked.problems);
  const areas: AreaStatus[] = [];
  for (const glob of globs) {
    // 生成物（[diff] exclude）は機械が頻繁に書き換えるので、領域の開発頻度に数えない
    const matched = (files ?? []).filter(
      (path) => matchesRule([glob], path) && !config.diff.exclude.some((pattern) => matchesPathPattern(pattern, path)),
    );
    const date = matched.length === 0 ? null : await lastTouched(config.repoRoot, matched);
    if (date === undefined) notices.push(`${glob}: 最終変更を git から読めませんでした`);
    const days = daysSince(date, now) ?? null;
    const dormant = days !== null && days > config.areas.dormantDays;
    const linked = dormant
      ? criteria.filter((criterion) => matched.some((path) => matchesRule(criterion.globs, path)))
      : [];
    areas.push({ glob, lastTouched: date instanceof Date ? date.toISOString() : null, days, dormant, linked });
  }
  return { dormantDays: config.areas.dormantDays, areas, notices };
}
