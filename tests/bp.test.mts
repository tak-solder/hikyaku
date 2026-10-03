import assert from "node:assert/strict";
import { test } from "node:test";
import { bpVerdict, estimateBp, parseBpRules, validateInput, type BpInput } from "../scripts/lib/bp.mts";
import { HikyakuError } from "../scripts/lib/errors.mts";

// 既定値の期待ケースとは独立して、任意の基準表に対する計算規則を検証する。
const source = `levels = [1, 3, 8]
[metrics.files]
label = "ファイル数"
upper = [2, 5]
[metrics.lines]
label = "行数"
upper = [10, 20]
[additions.api]
label = "外部 API"
bp = 2
[additions.impact]
label = "影響"
per = 2
free = 1
cap = 3
[additions.entity]
label = "設計"
input = "files"
upper = [2, 4]
bp = [0, 1, 4]
`;
const rules = parseBpRules(source, "test-rules.toml");

test("BP: 指標の上限を含めて段階を選び、最大の指標をベースにする", () => {
  for (const [files, expected] of [[2, 1], [3, 3], [5, 3], [6, 8]] as const) {
    assert.equal(estimateBp(rules, { files }).baseBp, expected);
  }
  const result = estimateBp(rules, { files: 2, lines: 21 });
  assert.equal(result.baseBp, 8);
  assert.equal(result.metrics.find((m) => m.isBase)?.key, "lines");
  assert.equal(estimateBp(rules, {}).total, 1);
});

test("BP: flag・無料枠と上限のある per・指標を共有する tiered を加算する", () => {
  assert.equal(estimateBp(rules, { impact: 1 }).additionBp, 0);
  assert.equal(estimateBp(rules, { impact: 2 }).additionBp, 2);
  assert.equal(estimateBp(rules, { impact: 100 }).additionBp, 3);
  assert.equal(estimateBp(rules, { api: false }).additionBp, 0);
  const result = estimateBp(rules, { files: 5, api: true, impact: 3 });
  assert.equal(result.baseBp, 3);
  assert.equal(result.additionBp, 9);
  assert.equal(result.total, 12);
});

test("BP: 不明な入力・負数・小数・型違いを拒否する", () => {
  const invalidInputs: BpInput[] = [{ typo: 1 }, { files: -1 }, { files: 1.5 }, { files: true }, { api: 1 }];
  for (const input of invalidInputs) {
    assert.throws(() => validateInput(rules, input, "test"), HikyakuError);
  }
  assert.doesNotThrow(() => validateInput(rules, { files: 0, api: false }, "test"));
});

for (const [name, invalid] of [
  ["昇順でない levels", source.replace("[1, 3, 8]", "[1, 8, 3]")],
  ["段階数に合わない upper", source.replace("upper = [2, 5]", "upper = [2]")],
  ["存在しない共有指標", source.replace('input = "files"', 'input = "missing"')],
  ["不明な設定キー", source.replace('bp = 2', 'bp = 2\ntypo = 1')],
] as const) {
  test(`BP: ${name}を拒否する`, () => {
    assert.throws(() => parseBpRules(invalid, "test-rules.toml"), HikyakuError);
  });
}

test("BP: bp_max の直前・一致・超過で分割判定が切り替わる", () => {
  assert.equal(bpVerdict(5, 8), "fits");
  assert.equal(bpVerdict(6, 8), "split-recommended");
  assert.equal(bpVerdict(8, 8), "split-recommended");
  assert.equal(bpVerdict(9, 8), "split-required");
});
