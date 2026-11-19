import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_REMAINING,
  fitRemaining,
  forecast,
  MIN_HISTORY_SAMPLES,
  overrunsOf,
  sampleOf,
  switchStartOf,
  type RemainingSample,
} from "../scripts/lib/forecast.mts";
import type { ProgressEvent } from "../scripts/lib/progress.mts";
import { estimateComponentsIn } from "../scripts/lib/tokens-history.mts";
import { temporaryDirectory } from "./helpers.mts";

const LIMITS = { limit: 500_000, estimateLimit: 450_000 };

function event(step: string, result: ProgressEvent["result"], context: number, extra: Partial<ProgressEvent> = {}): ProgressEvent {
  return { at: new Date(Date.UTC(2026, 10, 1, 0, 0, context / 1000)).toISOString(), skill: "builder", step, result, context, session: "s1", ...extra };
}

test("forecast: 誤差を足した見込みが上限に収まれば継続", () => {
  const result = forecast({ checkpoint: "approval", tokens: 250_000, peak: 400_000, switchStart: 250_000, ...LIMITS, model: DEFAULT_REMAINING.plan });
  assert.equal(result.remaining, Math.round(83_000 + 0.163 * 400_000));
  assert.equal(result.continueAt, 250_000 + result.remaining);
  assert.equal(result.continueHigh, Math.round(result.continueAt * 1.1));
  assert.equal(result.over, false);
  assert.equal(result.recommendation, "continue");
});

test("forecast: 続けると上限を超え、新しいセッションなら収まるときは切り替え。どちらも超えれば分割", () => {
  // build-07 の値: G8 で 412k、予測ピーク 435k、plan.md の固定費 90k + 読み込み 160k
  const switched = forecast({ checkpoint: "approval", tokens: 412_000, peak: 435_000, switchStart: 250_000, ...LIMITS, model: DEFAULT_REMAINING.plan });
  assert.equal(switched.over, true);
  assert.equal(switched.recommendation, "switch");
  assert.ok((switched.switchHigh ?? Infinity) <= 500_000);

  const split = forecast({ checkpoint: "approval", tokens: 412_000, peak: 435_000, switchStart: 380_000, ...LIMITS, model: DEFAULT_REMAINING.plan });
  assert.equal(split.recommendation, "split");

  const unknown = forecast({ checkpoint: "implement", tokens: 412_000, peak: 435_000, switchStart: undefined, ...LIMITS, model: DEFAULT_REMAINING.plan });
  assert.equal(unknown.switchAt, null);
  assert.equal(unknown.recommendation, "split", "切り替えた場合を見込めなければ分割");
});

test("forecast: 切り替えても見込みが下がらないなら切り替えを勧めない", () => {
  const result = forecast({ checkpoint: "implement", tokens: 300_000, peak: 450_000, switchStart: 320_000, limit: 400_000, estimateLimit: 360_000, model: DEFAULT_REMAINING.plan });
  assert.equal(result.over, true);
  assert.equal(result.recommendation, "split");
});

test("forecast: レビュー前は上限を超える見込みでも継続を勧め、切り替えを見込まない", () => {
  const result = forecast({ checkpoint: "review", tokens: 440_000, peak: 400_000, switchStart: 200_000, ...LIMITS, model: DEFAULT_REMAINING.review });
  assert.equal(result.over, true);
  assert.equal(result.recommendation, "continue");
  assert.equal(result.switchAt, null);
});

test("forecast: 予測ピークの報告が無ければ見積もりの上限で代える", () => {
  const result = forecast({ checkpoint: "approval", tokens: 200_000, peak: undefined, switchStart: undefined, ...LIMITS, model: DEFAULT_REMAINING.plan });
  assert.equal(result.peak, 450_000);
  assert.equal(result.peakAssumed, true);
});

test("fitRemaining: 実績が足りなければ既定値、足りれば最小二乗と上振れの p90", () => {
  const few: RemainingSample[] = [{ peak: 300_000, at: 200_000, completion: 340_000 }];
  assert.equal(fitRemaining(few, DEFAULT_REMAINING.plan), DEFAULT_REMAINING.plan);

  // 残り = 50k + 0.2 × 予測ピーク（誤差なし）
  const exact: RemainingSample[] = [200_000, 250_000, 300_000, 350_000, 400_000].map((peak) => ({ peak, at: 100_000, completion: 100_000 + 50_000 + 0.2 * peak }));
  assert.equal(exact.length, MIN_HISTORY_SAMPLES);
  const model = fitRemaining(exact, DEFAULT_REMAINING.plan);
  assert.equal(model.base, 50_000);
  assert.ok(Math.abs(model.perPeak - 0.2) < 1e-9);
  assert.equal(model.error, 0.03, "上振れが無くても下限を残す");
  assert.equal(model.samples, 5);

  // 予測ピークが大きいほど残りが小さいと出たら、比例分を持たない平均で見る
  const inverse: RemainingSample[] = [200_000, 250_000, 300_000, 350_000, 400_000].map((peak, i) => ({ peak, at: 100_000, completion: 300_000 - i * 10_000 }));
  const flat = fitRemaining(inverse, DEFAULT_REMAINING.plan);
  assert.equal(flat.perPeak, 0);
  assert.equal(flat.base, 180_000);
});

test("sampleOf: 区切りと同じセッションで完了を報告したビルドだけを実績にする", () => {
  const events: ProgressEvent[] = [
    event("plan", "done", 150_000, { peak: 400_000 }),
    event("G8", "approved", 230_000),
    event("verify", "done", 290_000),
    event("pr", "done", 370_000),
    event("publish", "done", 379_000),
  ];
  assert.deepEqual(sampleOf(events, "plan"), { peak: 400_000, at: 230_000, completion: 379_000 });
  assert.deepEqual(sampleOf(events, "review"), { peak: 400_000, at: 290_000, completion: 379_000 });

  const switched = events.map((e) => (e.step === "publish" || e.step === "pr" || e.step === "verify" ? { ...e, session: "s2" } : e));
  assert.equal(sampleOf(switched, "plan"), undefined, "切り替えたビルドは数えない");
});

test("switchStartOf / estimateComponentsIn: plan.md の内訳の最後の表から固定費と読み込みを読む", (t) => {
  const directory = temporaryDirectory(t);
  const table = (fixed: string, reading: string): string =>
    `| 成分 | 予測 | 根拠 |\n|------|------|------|\n| 固定費 | ${fixed} | — |\n| 読み込み | ${reading} | — |\n| 実装 | 80k | — |\n| テスト | 50k | — |\n| 未知の領域 | 40k | — |\n`;
  assert.equal(switchStartOf(directory), undefined);
  writeFileSync(join(directory, "plan.md"), `# plan\n\n${table("90k", "100k")}\n## 見積もり直し\n\n${table("100k", "160k")}`);
  assert.deepEqual(estimateComponentsIn(table("90k", "100k")), { fixed: 90_000, reading: 100_000, implementation: 80_000, tests: 50_000, unknown: 40_000 });
  assert.equal(switchStartOf(directory), 260_000);
});

test("overrunsOf: 上限を超える見込みのまま継続した区切りだけを返し、切り替えた区切りは除く", (t) => {
  const root = temporaryDirectory(t);
  const unit = join(root, "build-01");
  mkdirSync(unit);
  const config = { hikyakuRoot: root, context: { limit: 500_000, estimateRatio: 0.9, mergeRatio: 0.6 }, peakBands: { mergeHint: 300_000, estimateLimit: 450_000 } };
  const base: ProgressEvent[] = [event("plan", "done", 150_000, { peak: 435_000 }), event("G8", "approved", 412_000)];
  const over = overrunsOf(config, unit, base);
  assert.deepEqual(over.map((f) => f.checkpoint), ["approval", "implement"]);

  const handedOver = [...base, event("implement", "handover", 413_000, { reason: "切り替え" })];
  assert.deepEqual(overrunsOf(config, unit, handedOver), []);
});
