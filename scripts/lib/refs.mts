/**
 * 外部システムへの参照（issue / PR / タスク）の表記。
 *
 * tasklist.md の issue 列・PR 列、cycles.md の外部列で表記を揃える。
 * 生の URL のままだと表が横に伸びて読めなくなるため `[#12](URL)` に整える。
 *
 * 完了判定は「PR 列が非空かどうか」の一点なので、この整形が判定に影響することはない。
 */

/** 既に Markdown リンクになっているか */
function isMarkdownLink(raw: string): boolean {
  return /^\[[^\]]*\]\([^)]+\)$/.test(raw.trim());
}

/**
 * 参照から番号を取り出す。
 * GitHub の issue / PR、GitLab の MR、末尾の #N に対応する。
 */
export function refNumber(raw: string): string | undefined {
  return (
    /\/(?:issues|pull|merge_requests)\/(\d+)/.exec(raw)?.[1] ??
    /(?:^|[\s(])#(\d+)(?:[\s)]|$)/.exec(raw)?.[1]
  );
}

/**
 * 参照を `[#12](URL)` に整える。
 *
 * - 既に Markdown リンクならそのまま（人が書いた表記を壊さない）
 * - 番号を判別できなければ `[{label}](URL)`
 * - URL ですらなければそのまま返す
 */
export function formatRef(raw: string, label = "link"): string {
  const text = raw.trim();
  if (text === "" || isMarkdownLink(text)) return text;
  if (!/^https?:\/\//.test(text)) return text;

  const number = refNumber(text);
  return `[${number === undefined ? label : `#${number}`}](${text})`;
}

/** Markdown リンクから URL を取り出す（無ければそのまま） */
export function refUrl(raw: string): string | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  const link = /^\[[^\]]*\]\(([^)]+)\)$/.exec(text)?.[1];
  if (link !== undefined) return link;
  return /^https?:\/\//.test(text) ? text : undefined;
}
