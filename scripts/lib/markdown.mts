/**
 * Markdown テーブルの読み書き。
 *
 * document-guide.md / cycles.md / tasklist.md はいずれも Markdown テーブルを
 * 構造化データとして使うため、解析と再生成をここに集約する。
 *
 * テーブル以外の本文（見出し・説明文・Mermaid ブロックなど）は
 * 書き換え時にそのまま保持する。人間が書いた部分を壊さないため。
 */

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
  /** 元のソースにおける開始行（0 始まり） */
  startLine: number;
  /** 元のソースにおける終了行（0 始まり、この行を含む） */
  endLine: number;
}

const SEPARATOR_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** `|` 区切りのセルへ分割する（`\|` はエスケープとして扱う） */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string;
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);

  // 行頭・行末の `|` による空セルを落とす
  if (cells.length > 0 && cells[0]?.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]?.trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  return line.includes("|");
}

/** ソース中のすべての Markdown テーブルを見つける */
export function parseTables(source: string): MarkdownTable[] {
  const lines = source.split("\n");
  const tables: MarkdownTable[] = [];

  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = lines[i] as string;
    const separator = lines[i + 1] as string;
    if (!isTableRow(header) || !SEPARATOR_ROW.test(separator)) continue;

    const headers = splitRow(header);
    if (headers.length === 0) continue;

    const rows: string[][] = [];
    let end = i + 1;
    for (let j = i + 2; j < lines.length; j += 1) {
      const line = lines[j] as string;
      if (!isTableRow(line) || line.trim() === "") break;
      rows.push(splitRow(line));
      end = j;
    }

    tables.push({ headers, rows, startLine: i, endLine: end });
    i = end;
  }

  return tables;
}

/** 見出しの並びが一致する最初のテーブルを探す */
export function findTableByHeaders(source: string, required: string[]): MarkdownTable | undefined {
  return parseTables(source).find((table) =>
    required.every((name, index) => table.headers[index] === name),
  );
}

/** セル内の `|` をエスケープする */
export function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/** 表示幅を揃えた Markdown テーブルを生成する */
export function renderTable(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, column) =>
    Math.max(...all.map((row) => cellWidth(row[column] ?? ""))),
  );

  const line = (cells: string[]): string =>
    `| ${cells.map((cell, i) => cell + " ".repeat((widths[i] ?? 0) - cellWidth(cell))).join(" | ")} |`;

  const separator = `| ${widths.map((w) => "-".repeat(Math.max(w, 3))).join(" | ")} |`;
  return [line(headers), separator, ...rows.map((row) => line(padRow(row, headers.length)))].join("\n");
}

function padRow(row: string[], length: number): string[] {
  const out = [...row];
  while (out.length < length) out.push("");
  return out.slice(0, length);
}

function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
        ? 2
        : 1;
  }
  return width;
}

/** テーブルの範囲だけを差し替え、他の本文は保持する */
export function replaceTable(source: string, table: MarkdownTable, replacement: string): string {
  const lines = source.split("\n");
  lines.splice(table.startLine, table.endLine - table.startLine + 1, ...replacement.split("\n"));
  return lines.join("\n");
}

/**
 * マーカーで囲まれたブロックを差し替える。無ければ末尾に追加する。
 * 人間が書いた部分を壊さずに冪等な更新を行うための仕組み。
 */
export function upsertMarkerBlock(
  source: string,
  marker: string,
  body: string,
): { content: string; created: boolean } {
  const begin = `<!-- ${marker}:begin -->`;
  const end = `<!-- ${marker}:end -->`;
  const block = `${begin}\n${body.trimEnd()}\n${end}`;

  const beginIndex = source.indexOf(begin);
  const endIndex = source.indexOf(end);

  if (beginIndex !== -1 && endIndex !== -1 && endIndex > beginIndex) {
    const before = source.slice(0, beginIndex);
    const after = source.slice(endIndex + end.length);
    return { content: `${before}${block}${after}`, created: false };
  }

  const trimmed = source.replace(/\s+$/, "");
  const separator = trimmed === "" ? "" : "\n\n";
  return { content: `${trimmed}${separator}${block}\n`, created: true };
}
