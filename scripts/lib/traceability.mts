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

/**
 * test-spec.md で、受け入れ基準から一意に決まらず AI が解釈で決めた振る舞いのシナリオに付ける印。
 * シナリオの見出し（###）の末尾に付ける。G8 の提示（gate brief G8）がこの印のシナリオだけを示す
 */
export const INTERPRETED_MARK = "（解釈）";

/** test-spec.md のシナリオ（### 見出しの単位） */
export interface TestScenario {
  /** 見出しの文字列（`### ` を除く） */
  heading: string;
  /** 見出しの次の行から、次の見出しの手前まで（前後の空行は除く） */
  body: string;
  interpreted: boolean;
  /** 「- 対応:」の行に書かれた受け入れ基準の番号 */
  criteria: string[];
}

/** test-spec.md のシナリオ。コードブロックの中の見出しと番号は読まない */
export function testSpecScenarios(testSpec: string): TestScenario[] {
  const scenarios: TestScenario[] = [];
  let current: { heading: string; lines: string[] } | undefined;
  const flush = () => {
    if (current === undefined) return;
    const body = current.lines.join("\n").trim();
    const criteria: string[] = [];
    for (const line of current.lines) {
      if (/^\s*[-*]\s+対応\s*[:：]/.test(line)) criteria.push(...(line.match(CRITERION) ?? []));
    }
    scenarios.push({ heading: current.heading, body, interpreted: current.heading.endsWith(INTERPRETED_MARK), criteria });
    current = undefined;
  };
  for (const line of proseLines(testSpec)) {
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (heading) {
      flush();
      if (heading[1] === "###") current = { heading: heading[2] ?? "", lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return scenarios;
}

/** issue.md の見出しの節（見出しの次の行から、同じかより上の階層の次の見出しの手前まで）。無ければ undefined */
export function markdownSection(source: string, title: string): string | undefined {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^#{1,6}\\s+${escapeRegExp(title)}\\s*$`).test(line));
  if (start === -1) return undefined;
  const level = /^(#+)/.exec(lines[start] ?? "")?.[1]?.length ?? 2;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s/.exec(lines[i] ?? "");
    if (match && (match[1]?.length ?? 0) <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
