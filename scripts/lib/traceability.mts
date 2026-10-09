/**
 * 受け入れ基準の追跡 — user-stories.md の受け入れ基準（US-N.M）と、
 * 各ビルドの issue.md が実現する受け入れ基準を突き合わせる。
 *
 * 番号を振るかどうかはサイクルごとに決まる。user-stories.md に番号付きの
 * 受け入れ基準が1つも無ければ追跡しない（番号を導入する前に作ったサイクルを
 * 壊さないため）。
 */

/** issue.md で、そのビルドが実現する受け入れ基準を列挙する節の見出し */
export const ISSUE_CRITERIA_HEADING = "対応する受け入れ基準";

const CRITERION = /US-\d+\.\d+/g;
/** 受け入れ基準の定義行: `- [ ] US-1.1: ...`（チェック済みも含む） */
const DEFINITION = /^\s*[-*]\s+\[[ xX]\]\s+(US-\d+\.\d+)\b/;

/** コードブロックの外にある行だけを返す（テンプレートや例示の番号を拾わないため） */
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

/** user-stories.md で定義された受け入れ基準の番号。出現順で、重複もそのまま返す */
export function definedCriteria(userStories: string): string[] {
  const ids: string[] = [];
  for (const line of proseLines(userStories)) {
    const match = DEFINITION.exec(line);
    if (match?.[1]) ids.push(match[1]);
  }
  return ids;
}

/**
 * issue.md の「対応する受け入れ基準」節に書かれた番号。
 * 節が無ければ undefined（節があって番号が無いのとは区別する）。
 */
export function referencedCriteria(issue: string): string[] | undefined {
  let inSection = false;
  let found = false;
  const ids: string[] = [];
  for (const line of proseLines(issue)) {
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (heading) {
      inSection = heading[2] === ISSUE_CRITERIA_HEADING;
      if (inSection) found = true;
      continue;
    }
    if (inSection) ids.push(...(line.match(CRITERION) ?? []));
  }
  return found ? ids : undefined;
}

export interface TraceabilityIssue {
  /** buildID */
  id: string;
  /** issue.md の本文。読めなかったビルドは渡さない */
  text: string;
}

export interface TraceabilityProblem {
  /** 問題のあるビルド。サイクル全体の問題なら undefined */
  build?: string;
  message: string;
}

/**
 * 番号の重複、存在しない番号への参照、どのビルドにも割り当てられていない
 * 受け入れ基準を返す。番号が定義されていなければ何も検査しない。
 */
export function validateTraceability(
  defined: string[],
  issues: TraceabilityIssue[],
): TraceabilityProblem[] {
  if (defined.length === 0) return [];
  const problems: TraceabilityProblem[] = [];

  const seen = new Set<string>();
  for (const id of defined) {
    if (seen.has(id)) problems.push({ message: `受け入れ基準の番号が重複しています: ${id}` });
    seen.add(id);
  }

  // ビルド分割の前（tasklist が空）は割り当てが無くて当然なので、網羅は見ない
  if (issues.length === 0) return problems;

  const covered = new Set<string>();
  for (const issue of issues) {
    const ids = referencedCriteria(issue.text);
    if (ids === undefined) {
      problems.push({
        build: issue.id,
        message: `issue.md に「${ISSUE_CRITERIA_HEADING}」の節がありません`,
      });
      continue;
    }
    for (const id of ids) {
      if (!seen.has(id)) {
        problems.push({ build: issue.id, message: `user-stories.md に無い受け入れ基準を参照しています: ${id}` });
      }
      covered.add(id);
    }
  }

  const missing = [...seen].filter((id) => !covered.has(id));
  if (missing.length > 0) {
    problems.push({
      message: `どのビルドにも割り当てられていない受け入れ基準があります: ${missing.join(", ")}`,
    });
  }
  return problems;
}
