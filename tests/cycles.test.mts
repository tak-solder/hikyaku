import assert from "node:assert/strict";
import { test } from "node:test";
import { findCycleByKey, nextCycleId, normalizeSlug, parseCycles, renderCyclesFile } from "../scripts/lib/cycles.mts";
import { HikyakuError } from "../scripts/lib/errors.mts";
import { cycle } from "./helpers.mts";

test("cycles: 列を追加・並べ替えても見出し名で解析し、任意列の欠落を許容する", () => {
  const source = `| ID | slug | status | 要約 | 追加列 | profile |
| --- | --- | --- | --- | --- | --- |
| 001 | test | active | 要約文 | 無視 | standard |`;
  assert.deepEqual(parseCycles(source), [cycle("001", { hikyaku: "", started: "", summary: "要約文" })]);
});

test("cycles: 不正な status を active に変換しない", () => {
  assert.throws(() => parseCycles("| ID | slug | status |\n| --- | --- | --- |\n| 001 | test | typo |"), HikyakuError);
});

test("cycles: slug の再利用時は進行中を選び、ID 指定は終了済みも選べる", () => {
  const old = cycle("001", { status: "closed" });
  const active = cycle("002");
  assert.equal(findCycleByKey([old, active], "test"), active);
  assert.equal(findCycleByKey([old, active], "001"), old);
  assert.equal(findCycleByKey([old, active], "001-test"), old);
  assert.equal(findCycleByKey([old, active], "missing"), undefined);
});

test("cycles: 同一 slug の候補を特定できない場合は推測しない", () => {
  assert.throws(() => findCycleByKey([cycle("001"), cycle("002")], "test"), HikyakuError);
  assert.throws(() => findCycleByKey([cycle("001", { status: "closed" }), cycle("002", { status: "abandoned" })], "test"), HikyakuError);
});

test("cycles: 索引の再生成で依存と | を含む要約を保持する", () => {
  const records = [cycle("002", { dependsOn: ["001"], summary: "認証 | 認可" }), cycle("001")];
  assert.deepEqual(parseCycles(renderCyclesFile(records)), [records[1], records[0]]);
  assert.equal(nextCycleId(records), "003");
  assert.equal(nextCycleId([]), "001");
});

test("cycles: slug を正規化し、英数字が無い入力を拒否する", () => {
  assert.equal(normalizeSlug("  User__Auth!!  "), "user-auth");
  assert.throws(() => normalizeSlug("日本語"), HikyakuError);
});
