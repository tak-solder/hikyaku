/**
 * データ整合性 — ビルドのマージで本番データを壊さないための判定。
 *
 * 原則として、各ビルドはマージした時点で本番データを壊さないように分割する。
 * BP の都合などでやむを得ずその原則を外す（安全でない分割）のは、サイクルが
 * allow_unsafe_split で宣言し、かつ base_branch がリリースされるブランチでない
 * ときだけ。リリースされるブランチはルート設定の release_branches と、暗黙に
 * 含まれるデフォルトブランチで決まる。
 *
 * 安全でない分割を使ったビルドは、issue.md の「マージ時点で残る危険」に
 * 残る危険と、それを解消するビルドを書く。
 */

import type { DataIntegrityConfig, ResolvedConfig } from "./config.mts";
import { defaultBranch } from "./git.mts";
import { normalizeBuildId, type BuildRecord } from "./tasklist.mts";

/** issue.md で、安全でない分割を使ったビルドが残る危険を書く節の見出し */
export const ISSUE_UNSAFE_HEADING = "マージ時点で残る危険";

/** 「マージ時点で残る危険」の節で、解消するビルドを書く行の書き出し */
export const RESOLVED_BY_LABEL = "解消するビルド";

/**
 * ブランチ名の glob。GitHub のブランチ保護と同じく、`*` は `/` をまたがず、
 * `**` はまたぐ。`?` は `/` 以外の1文字。それ以外の文字はそのまま比べる
 */
export function branchPatternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesBranchPattern(pattern: string, branch: string): boolean {
  return branchPatternToRegExp(pattern).test(branch);
}

export type UnsafeSplitReason =
  /** allow_unsafe_split が true で、base_branch はリリースされるブランチでない */
  | "allowed"
  /** allow_unsafe_split が false（既定） */
  | "flag-off"
  /** base_branch がリリースされるブランチに一致した */
  | "release-branch"
  /** デフォルトブランチが分からず、リリースされるブランチかを判定できない */
  | "default-unknown";

export interface UnsafeSplitDecision {
  /** 安全でない分割を許すか */
  allowed: boolean;
  reason: UnsafeSplitReason;
  /** 判定に使った base_branch。未設定ならデフォルトブランチ */
  baseBranch: string | null;
  defaultBranch: string | null;
  /** 設定された release_branches（デフォルトブランチは含めない） */
  releaseBranches: string[];
  /** base_branch が一致したパターン。デフォルトブランチそのものなら "(デフォルトブランチ)" */
  matchedPattern: string | null;
  /** allow_unsafe_split = true なのに効いていない（リリースされるブランチに一致した等） */
  overridden: boolean;
  message: string;
}

export const DEFAULT_BRANCH_MARK = "(デフォルトブランチ)";

/**
 * 安全でない分割を許すかを決める。判定できないときは常に許さない側に倒す。
 * 本番データの破壊は取り返しがつかないので、迷ったら原則（分割で安全を保つ）に戻る
 */
export function decideUnsafeSplit(
  settings: DataIntegrityConfig,
  configuredBase: string | undefined,
  detectedDefault: string | undefined,
): UnsafeSplitDecision {
  const base = configuredBase ?? detectedDefault;
  const common = {
    baseBranch: base ?? null,
    defaultBranch: detectedDefault ?? null,
    releaseBranches: settings.releaseBranches,
  };

  let matchedPattern: string | null = null;
  if (base !== undefined) {
    if (detectedDefault !== undefined && base === detectedDefault) matchedPattern = DEFAULT_BRANCH_MARK;
    else matchedPattern = settings.releaseBranches.find((pattern) => matchesBranchPattern(pattern, base)) ?? null;
  }

  if (!settings.allowUnsafeSplit) {
    return {
      ...common,
      allowed: false,
      reason: "flag-off",
      matchedPattern,
      overridden: false,
      message: "allow_unsafe_split が false のため、各ビルドはマージ時点で本番データを壊さないように分割します",
    };
  }

  if (matchedPattern !== null) {
    const where = matchedPattern === DEFAULT_BRANCH_MARK ? "デフォルトブランチ" : `release_branches の ${matchedPattern}`;
    return {
      ...common,
      allowed: false,
      reason: "release-branch",
      matchedPattern,
      overridden: true,
      message: `base_branch ${base} は${where}に一致するリリースされるブランチなので、allow_unsafe_split は効きません`,
    };
  }

  if (detectedDefault === undefined) {
    return {
      ...common,
      allowed: false,
      reason: "default-unknown",
      matchedPattern,
      overridden: true,
      message: [
        "デフォルトブランチ（origin/HEAD）を特定できないため、base_branch がリリースされるブランチか判定できません。",
        "安全側に倒して allow_unsafe_split を効かせません。git remote set-head origin --auto で origin/HEAD を設定できます",
      ].join(""),
    };
  }

  return {
    ...common,
    allowed: true,
    reason: "allowed",
    matchedPattern,
    overridden: false,
    message: `base_branch ${base} はリリースされるブランチでないため、やむを得ない場合に限り安全でない分割を許します`,
  };
}

export function resolveUnsafeSplit(config: ResolvedConfig): UnsafeSplitDecision {
  return decideUnsafeSplit(config.dataIntegrity, config.baseBranch, defaultBranch(config.repoRoot));
}

/** コードブロックの外にある行だけを返す（テンプレートや例示を拾わないため） */
function proseLines(source: string): string[] {
  const lines: string[] = [];
  let fence: number | undefined;
  for (const line of source.split("\n")) {
    const marker = /^\s*(`{3,})/.exec(line);
    if (fence === undefined && marker) {
      fence = marker[1]?.length;
      continue;
    }
    if (fence !== undefined) {
      if (new RegExp(`^\\s*\`{${fence},}\\s*$`).test(line)) fence = undefined;
      continue;
    }
    lines.push(line);
  }
  return lines;
}

export interface UnsafeSection {
  /** 「解消するビルド」の行に書かれた buildID（正規化済み） */
  resolvedBy: string[];
  /** 「解消するビルド」の行があったか */
  hasResolvedByLine: boolean;
}

/**
 * issue.md の「マージ時点で残る危険」節を読む。節が無ければ undefined
 * （安全でない分割を使っていないビルド）
 */
export function readUnsafeSection(issue: string): UnsafeSection | undefined {
  let inSection = false;
  let found = false;
  let hasResolvedByLine = false;
  const resolvedBy: string[] = [];
  for (const line of proseLines(issue)) {
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (heading) {
      inSection = heading[2] === ISSUE_UNSAFE_HEADING;
      if (inSection) found = true;
      continue;
    }
    if (!inSection || !line.includes(RESOLVED_BY_LABEL)) continue;
    hasResolvedByLine = true;
    for (const match of line.matchAll(/build-(\d+)/gi)) resolvedBy.push(normalizeBuildId(match[1] as string));
  }
  return found ? { resolvedBy, hasResolvedByLine } : undefined;
}

export interface UnsafeSplitIssue {
  /** buildID */
  id: string;
  text: string;
}

export interface UnsafeSplitProblem {
  build: string;
  message: string;
}

/**
 * 安全でない分割の記録を検査する。
 *
 * - 許されていないサイクルで「マージ時点で残る危険」を書いていないか
 *   （判定できないとき＝デフォルトブランチ不明は、確かな違反ではないので見ない）
 * - 解消するビルドが書かれ、実在し、このビルドに（推移的に）依存しているか。
 *   依存していなければ、解消するビルドが先にマージされうるので危険が残る順序を保証できない
 */
export function validateUnsafeSplits(
  builds: BuildRecord[],
  issues: UnsafeSplitIssue[],
  decision: UnsafeSplitDecision,
): UnsafeSplitProblem[] {
  const problems: UnsafeSplitProblem[] = [];
  const byId = new Map(builds.map((build) => [build.id, build]));

  const dependsOn = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [...(byId.get(from)?.dependsOn ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (next === target) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(byId.get(next)?.dependsOn ?? []));
    }
    return false;
  };

  for (const issue of issues) {
    const section = readUnsafeSection(issue.text);
    if (section === undefined) continue;

    if (!decision.allowed && decision.reason !== "default-unknown") {
      problems.push({
        build: issue.id,
        message: `「${ISSUE_UNSAFE_HEADING}」がありますが、このサイクルでは安全でない分割が許されていません（${decision.message}）`,
      });
    }

    if (section.resolvedBy.length === 0) {
      problems.push({
        build: issue.id,
        message: `「${ISSUE_UNSAFE_HEADING}」に「${RESOLVED_BY_LABEL}: build-NN」の行がありません`,
      });
      continue;
    }

    for (const id of section.resolvedBy) {
      const label = `build-${id.padStart(2, "0")}`;
      if (id === issue.id) {
        problems.push({ build: issue.id, message: `${RESOLVED_BY_LABEL}に自分自身（${label}）を挙げています` });
      } else if (!byId.has(id)) {
        problems.push({ build: issue.id, message: `${RESOLVED_BY_LABEL}の ${label} は tasklist.md にありません` });
      } else if (!dependsOn(id, issue.id)) {
        problems.push({
          build: issue.id,
          message: `${RESOLVED_BY_LABEL}の ${label} がこのビルドに依存していないため、危険が解消される順序を保証できません`,
        });
      }
    }
  }
  return problems;
}
