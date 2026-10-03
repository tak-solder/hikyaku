import assert from "node:assert/strict";
import { test } from "node:test";
import { flagBoolean, flagInteger, flagList, flagString, parseArgs } from "../scripts/lib/args.mts";
import { HikyakuError } from "../scripts/lib/errors.mts";

test("引数: 値付きオプションと真偽値フラグを混在できる", () => {
  const args = parseArgs(["tasklist", "add", "--json", "001", "--title=認証", "--bp", "3", "--dry-run"]);
  assert.deepEqual(args.positional, ["tasklist", "add", "001"]);
  assert.equal(flagString(args, "title"), "認証");
  assert.equal(flagInteger(args, "bp"), 3);
  assert.equal(flagBoolean(args, "json"), true);
  assert.equal(flagBoolean(args, "dry-run"), true);
  assert.equal(flagBoolean(args, "all"), false);
  assert.equal(flagString(args, "root"), undefined);
});

test("引数: -- 以降をオプションとして解釈しない", () => {
  const args = parseArgs(["--root=docs/hikyaku", "--", "--json", "-1"]);
  assert.deepEqual(args.positional, ["--json", "-1"]);
  assert.equal(flagBoolean(args, "json"), false);
});

test("引数: 必須値が無ければ次のフラグを消費せずエラーにする", () => {
  const args = parseArgs(["--root", "--json"]);
  assert.throws(() => flagString(args, "root"), HikyakuError);
  assert.equal(flagBoolean(args, "json"), true);
});

for (const value of ["1.5", "2abc", "01", "", "Infinity"]) {
  test(`引数: 整数でない表記 ${JSON.stringify(value)} を拒否する`, () => {
    assert.throws(() => flagInteger(parseArgs([`--bp=${value}`]), "bp"), HikyakuError);
  });
}

test("引数: リストの空要素と前後の空白を除去する", () => {
  assert.deepEqual(flagList(parseArgs(["--deps=1, 2,,3, "]), "deps"), ["1", "2", "3"]);
  assert.deepEqual(flagList(parseArgs(["--deps="]), "deps"), []);
  assert.equal(flagList(parseArgs([]), "deps"), undefined);
});
