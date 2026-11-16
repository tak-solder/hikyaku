import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEscalation, describeEscalationProblems } from "../scripts/lib/escalation.mts";
import { ESCALATION_BODY } from "./helpers.mts";

test("checkEscalation: 見出しの形で3つの節がそろっていれば通る", () => {
  assert.deepEqual(checkEscalation(ESCALATION_BODY), { ok: true, problems: [] });
});

test("checkEscalation: 行頭のラベル（同じ行の本文）でも読める", () => {
  const text = "試したこと: タイムアウトを 30s に延ばした\n選択肢: CSV 出力を外す（失うもの: CSV での取り込み）\n推奨: CSV 出力を外す";
  assert.deepEqual(checkEscalation(text), { ok: true, problems: [] });
});

test("checkEscalation: 太字のラベルと全角コロンでも読める", () => {
  const text = "**試したこと**：\n- 2回直した\n**問題を変える選択肢**：\n- やめる 失うもの：機能そのもの\n**推奨**：やめる";
  assert.equal(checkEscalation(text).ok, true);
});

test("checkEscalation: 試したことの節が無ければ欠けになる", () => {
  const text = "## 選択肢\n- やめる 失うもの: 機能\n## 推奨\nやめる";
  assert.deepEqual(checkEscalation(text).problems, ["「試したこと」の節がありません"]);
});

test("checkEscalation: 中身がテンプレートの置き場所の印だけなら欠けになる", () => {
  const text = "## 試したこと\n\n- （何を試したか）\n\n## 選択肢\n- やめる 失うもの: 機能\n## 推奨\nやめる";
  assert.deepEqual(checkEscalation(text).problems, ["「試したこと」に項目がありません"]);
});

test("checkEscalation: 文中に括弧を含む行は置き場所の印とみなさない", () => {
  const text = "## 試したこと\n- タイムアウト（30s）に延ばした\n## 選択肢\n- やめる 失うもの: 機能\n## 推奨\nやめる";
  assert.equal(checkEscalation(text).ok, true);
});

test("checkEscalation: 選択肢の項目に失うものが無ければ何件目かを示す", () => {
  const text = "## 試したこと\n- 直した\n## 問題を変える選択肢\n- 削る 失うもの: CSV\n- 緩める\n## 推奨\n削る";
  assert.deepEqual(checkEscalation(text).problems, ["「選択肢」の2件目に「失うもの:」がありません"]);
});

test("checkEscalation: 字下げした続きの行の失うものも項目に数える", () => {
  const text = "## 試したこと\n- 直した\n## 選択肢\n- 削る\n  - 失うもの: CSV\n## 推奨\n削る";
  assert.equal(checkEscalation(text).ok, true);
});

test("checkEscalation: 選択肢が空・推奨が空なら欠けになる", () => {
  const text = "## 試したこと\n- 直した\n## 選択肢\n\n## 推奨\n\n";
  assert.deepEqual(checkEscalation(text).problems, ["「選択肢」に項目がありません", "「推奨」が空です"]);
});

test("checkEscalation: 節は次の見出しで終わる（ほかの見出しの中身を数えない）", () => {
  const text = "## 試したこと\n- 直した\n## 選択肢\n- 削る 失うもの: CSV\n## 推奨\n## このビルドの状態\n- 進んだところ: plan.md";
  assert.deepEqual(checkEscalation(text).problems, ["「推奨」が空です"]);
});

test("checkEscalation: 3つとも欠ければ3件を返す", () => {
  const result = checkEscalation("テストが通らないので止まります");
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 3);
});

test("checkEscalation: テンプレートの選択肢の行（（…） 失うもの: （…））を埋めずに残せば欠けになる", () => {
  const text = "## 試したこと\n- 直した\n## 問題を変える選択肢\n- （スコープを削る など） 失うもの: （この選択肢で失うもの）\n## 推奨\n削る";
  assert.deepEqual(checkEscalation(text).problems, ["「選択肢」の1件目の選択肢が空です", "「選択肢」の1件目の「失うもの:」が空です"]);
});

test("checkEscalation: リストの項目の「推奨:」は節を切り替えない", () => {
  const text = "## 試したこと\n- 直した\n## 選択肢\n- 推奨: A案 失うもの: 時間\n- B案\n## このビルドの状態\n- x";
  assert.deepEqual(checkEscalation(text).problems, ["「選択肢」の2件目に「失うもの:」がありません", "「推奨」の節がありません"]);
});

test("checkEscalation: 見出しは節の名前で終わるものだけを読む", () => {
  const text = `${ESCALATION_BODY}\n## 推奨しない理由\n`;
  assert.deepEqual(checkEscalation(text).problems, []);
  assert.deepEqual(checkEscalation("## 推奨しない理由\nx").problems.includes("「推奨」の節がありません"), true);
});

test("checkEscalation: 「・」の項目も1件ずつ数える", () => {
  const text = "## 試したこと\n- 直した\n## 選択肢\n・A: 別案 失うもの: X\n・B: やめる\n## 推奨\nA";
  assert.deepEqual(checkEscalation(text).problems, ["「選択肢」の2件目に「失うもの:」がありません"]);
});

test("describeEscalationProblems: 欠けと書き直しの案内を複数行で返す", () => {
  const text = describeEscalationProblems(["「推奨」が空です"]);
  assert.match(text, /^行き詰まりの報告に欠けがあります:\n {2}- 「推奨」が空です\n/);
  assert.match(text, /失うもの:/);
});
