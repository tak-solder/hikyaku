import assert from "node:assert/strict";
import { test } from "node:test";
import { parseToml, TomlError } from "../scripts/lib/toml.mts";

test("TOML: コメント・文字列・数値・真偽値・配列・階層を解析する", () => {
  assert.deepEqual(parseToml(String.raw`
# 設定
hikyaku_root = "docs/#hikyaku" # 文字列内の # は保持する
bp_max = 1_000
enabled = true
ratio = 1.5e2
branch.prefix = 'work'
[review.security]
triggers = [
  "認証", # 配列内のコメント
  '決済',
]
`), {
    hikyaku_root: "docs/#hikyaku", bp_max: 1000, enabled: true, ratio: 150,
    branch: { prefix: "work" }, review: { security: { triggers: ["認証", "決済"] } },
  });
});

test("TOML: エスケープとリテラル文字列を区別する", () => {
  assert.deepEqual(parseToml(String.raw`basic = "a\n\t\u65e5\U0001F600"
literal = 'a\n\t'`), { basic: "a\n\t日😀", literal: String.raw`a\n\t` });
});

test("TOML: 複数行文字列の先頭改行を除去し、行末の継続を畳む", () => {
  assert.deepEqual(parseToml(`basic = """\n一行目\\\n  二行目\n"""\nliteral = '''\n一行目\n二行目\n'''`), {
    basic: "一行目二行目\n", literal: "一行目\n二行目\n",
  });
});

test("TOML: 引用されたキー内のドットは階層にしない", () => {
  assert.deepEqual(parseToml(`"branch.prefix" = 'work'\nbranch.separator = '/'`), {
    "branch.prefix": "work", branch: { separator: "/" },
  });
});

for (const [name, source] of [
  ["重複キー", "x = 1\nx = 2"],
  ["値とテーブルの衝突", "x = 1\n[x.y]"],
  ["未閉鎖文字列", 'x = "abc'],
  ["未閉鎖配列", "x = [1, 2"],
  ["区切りのない配列", "x = ['a' 'b']"],
  ["不明なエスケープ", String.raw`x = "\q"`],
  ["日時型", "x = 2026-10-03"],
  ["インラインテーブル", "x = { y = 1 }"],
  ["テーブル配列", "[[x]]"],
] as const) {
  test(`TOML: ${name}を黙って無視しない`, () => {
    assert.throws(() => parseToml(source), TomlError);
  });
}

test("TOML: エラーに問題がある行番号を含める", () => {
  assert.throws(() => parseToml("# コメント\nx = 1\nx = 2"), { name: "TomlError", line: 3 });
});
