/**
 * 依存ゼロの TOML パーサ（Hikyaku の設定ファイルに必要な範囲のサブセット）。
 *
 * 対応: コメント / 基本文字列 / 複数行基本文字列 / リテラル文字列 /
 *       複数行リテラル文字列 / 整数 / 浮動小数 / 真偽値 / 配列 /
 *       テーブル（ドット区切り可） / ドット区切りキー
 * 非対応: 日時型 / インラインテーブル / テーブル配列（[[x]]）
 *
 * 非対応の構文に遭遇した場合は TomlError を投げる（黙って無視しない）。
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export class TomlError extends Error {
  line: number;

  constructor(message: string, line: number) {
    super(`${message} (行 ${line})`);
    this.name = "TomlError";
    this.line = line;
  }
}

const BARE_KEY = /[A-Za-z0-9_-]/;

export function parseToml(source: string): TomlTable {
  const root: TomlTable = {};
  let current: TomlTable = root;
  let pos = 0;
  let line = 1;

  const eof = (): boolean => pos >= source.length;
  const peek = (): string => source[pos] ?? "";

  const advance = (): string => {
    const ch = source[pos] ?? "";
    pos += 1;
    if (ch === "\n") line += 1;
    return ch;
  };

  const fail = (message: string): never => {
    throw new TomlError(message, line);
  };

  /** 空白（改行を除く）とコメントを読み飛ばす */
  const skipInlineSpace = (): void => {
    for (;;) {
      const ch = peek();
      if (ch === " " || ch === "\t" || ch === "\r") {
        advance();
      } else if (ch === "#") {
        while (!eof() && peek() !== "\n") advance();
      } else {
        return;
      }
    }
  };

  /** 空白・コメント・改行をまとめて読み飛ばす */
  const skipBlank = (): void => {
    for (;;) {
      skipInlineSpace();
      if (peek() === "\n") {
        advance();
        continue;
      }
      return;
    }
  };

  const readBasicStringBody = (multiline: boolean): string => {
    let out = "";
    for (;;) {
      if (eof()) fail("文字列が閉じられていません");
      const ch = peek();

      if (ch === '"') {
        if (multiline) {
          if (source.startsWith('"""', pos)) {
            pos += 3;
            // TOML では閉じ引用符の直後に続く " も文字列に含まれる（最大5個）
            let extra = "";
            while (peek() === '"' && extra.length < 2) {
              extra += advance();
            }
            return out + extra;
          }
          out += advance();
          continue;
        }
        advance();
        return out;
      }

      if (ch === "\n") {
        if (!multiline) fail("基本文字列の中で改行はできません");
        out += advance();
        continue;
      }

      if (ch === "\\") {
        advance();
        const esc = advance();
        if (multiline && (esc === "\n" || esc === " " || esc === "\t" || esc === "\r")) {
          // 行末バックスラッシュ: 続く空白と改行を畳む
          let sawNewline = esc === "\n";
          while (!eof()) {
            const c = peek();
            if (c === "\n") {
              sawNewline = true;
              advance();
            } else if (c === " " || c === "\t" || c === "\r") {
              advance();
            } else {
              break;
            }
          }
          if (!sawNewline) fail("不正なエスケープシーケンスです");
          continue;
        }
        if (esc === "n") out += "\n";
        else if (esc === "t") out += "\t";
        else if (esc === "r") out += "\r";
        else if (esc === '"') out += '"';
        else if (esc === "\\") out += "\\";
        else if (esc === "b") out += "\b";
        else if (esc === "f") out += "\f";
        else if (esc === "u" || esc === "U") {
          const width = esc === "u" ? 4 : 8;
          const hex = source.slice(pos, pos + width);
          if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== width) {
            fail(`不正な Unicode エスケープです: \\${esc}${hex}`);
          }
          for (let i = 0; i < width; i += 1) advance();
          out += String.fromCodePoint(Number.parseInt(hex, 16));
        } else {
          fail(`不明なエスケープシーケンスです: \\${esc}`);
        }
        continue;
      }

      out += advance();
    }
  };

  const readLiteralStringBody = (multiline: boolean): string => {
    let out = "";
    for (;;) {
      if (eof()) fail("リテラル文字列が閉じられていません");
      const ch = peek();
      if (ch === "'") {
        if (multiline) {
          if (source.startsWith("'''", pos)) {
            pos += 3;
            let extra = "";
            while (peek() === "'" && extra.length < 2) {
              extra += advance();
            }
            return out + extra;
          }
          out += advance();
          continue;
        }
        advance();
        return out;
      }
      if (ch === "\n" && !multiline) fail("リテラル文字列の中で改行はできません");
      out += advance();
    }
  };

  const readString = (): string => {
    if (source.startsWith('"""', pos)) {
      pos += 3;
      // 開始直後の改行は取り除く（TOML 仕様）
      if (peek() === "\r") advance();
      if (peek() === "\n") advance();
      return readBasicStringBody(true);
    }
    if (source.startsWith("'''", pos)) {
      pos += 3;
      if (peek() === "\r") advance();
      if (peek() === "\n") advance();
      return readLiteralStringBody(true);
    }
    if (peek() === '"') {
      advance();
      return readBasicStringBody(false);
    }
    advance(); // '
    return readLiteralStringBody(false);
  };

  const readKeySegment = (): string => {
    skipInlineSpace();
    const ch = peek();
    if (ch === '"' || ch === "'") return readString();
    let out = "";
    while (!eof() && BARE_KEY.test(peek())) out += advance();
    if (out === "") fail("キーが見つかりません");
    return out;
  };

  /** ドット区切りのキーパスを読む（a.b.c） */
  const readKeyPath = (): string[] => {
    const path = [readKeySegment()];
    for (;;) {
      skipInlineSpace();
      if (peek() !== ".") return path;
      advance();
      path.push(readKeySegment());
    }
  };

  const readValue = (): TomlValue => {
    skipInlineSpace();
    const ch = peek();
    if (ch === "") fail("値が見つかりません");
    if (ch === '"' || ch === "'") return readString();

    if (ch === "[") {
      advance();
      const items: TomlValue[] = [];
      for (;;) {
        skipBlank();
        if (eof()) fail("配列が閉じられていません");
        if (peek() === "]") {
          advance();
          return items;
        }
        items.push(readValue());
        skipBlank();
        if (peek() === ",") {
          advance();
          continue;
        }
        skipBlank();
        if (peek() === "]") {
          advance();
          return items;
        }
        fail("配列の要素は , で区切ってください");
      }
    }

    if (ch === "{") fail("インラインテーブルには対応していません");

    let raw = "";
    while (!eof() && !"\n,]#".includes(peek())) raw += advance();
    raw = raw.trim();
    if (raw === "") fail("値が見つかりません");
    if (raw === "true") return true;
    if (raw === "false") return false;

    const numeric = raw.replace(/_/g, "");
    if (/^[+-]?\d+$/.test(numeric)) return Number.parseInt(numeric, 10);
    if (/^[+-]?(\d+\.\d+([eE][+-]?\d+)?|\d+[eE][+-]?\d+)$/.test(numeric)) {
      return Number.parseFloat(numeric);
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      fail(`日時型には対応していません: ${raw}。文字列として "..." で囲ってください`);
    }
    return fail(`値を解釈できません: ${raw}`);
  };

  /** キーパスをたどって最終セグメントの親テーブルを返す */
  const descend = (table: TomlTable, path: string[]): TomlTable => {
    let node = table;
    for (const segment of path) {
      const existing = node[segment];
      if (existing === undefined) {
        const created: TomlTable = {};
        node[segment] = created;
        node = created;
      } else if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
        node = existing;
      } else {
        fail(`キー ${segment} は既に値として定義されています`);
      }
    }
    return node;
  };

  for (;;) {
    skipBlank();
    if (eof()) return root;

    if (peek() === "[") {
      advance();
      if (peek() === "[") fail("テーブル配列（[[...]]）には対応していません");
      const path = readKeyPath();
      skipInlineSpace();
      if (peek() !== "]") fail("テーブル名が ] で閉じられていません");
      advance();
      current = descend(root, path);
      skipInlineSpace();
      if (!eof() && peek() !== "\n") fail("テーブル名の後に余分な文字があります");
      continue;
    }

    const path = readKeyPath();
    skipInlineSpace();
    if (peek() !== "=") fail("キーの後に = がありません");
    advance();
    const value = readValue();

    const leaf = path[path.length - 1] as string;
    const parent = descend(current, path.slice(0, -1));
    if (parent[leaf] !== undefined) fail(`キーが重複しています: ${path.join(".")}`);
    parent[leaf] = value;

    skipInlineSpace();
    if (!eof() && peek() !== "\n") fail("値の後に余分な文字があります");
  }
}
