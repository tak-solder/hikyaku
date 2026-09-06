/**
 * 出力の整形。
 *
 * デフォルトは人間可読（LLM も読むため、トークン効率も良い）。
 * --json を付けると機械可読な JSON を出す。
 */

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/**
 * 結果を出力する。
 * @param data   --json のときに出力する構造化データ
 * @param render 人間可読モードで出力する文字列を作る関数
 */
export function emit(data: unknown, render: () => string): void {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const text = render();
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

/** 警告（stderr へ。JSON モードでも出す） */
export function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

/** 表形式の整形（人間可読モード用） */
export function table(rows: string[][], headers?: string[]): string {
  const all = headers ? [headers, ...rows] : rows;
  if (all.length === 0) return "";
  const widths: number[] = [];
  for (const row of all) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, displayWidth(cell));
    });
  }
  const lines = all.map((row) =>
    row
      .map((cell, i) => cell + " ".repeat((widths[i] ?? 0) - displayWidth(cell)))
      .join("  ")
      .trimEnd(),
  );
  if (headers) {
    const rule = widths.map((w) => "-".repeat(w)).join("  ");
    lines.splice(1, 0, rule);
  }
  return lines.join("\n");
}

/** 表示幅を揃えて右側を空白で埋める（日本語混在でも列がずれない） */
export function padDisplay(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? text + " ".repeat(pad) : text;
}

/** 全角文字を2幅として数える（日本語の列ずれを防ぐ） */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}
