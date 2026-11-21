/**
 * 区切りでの、完了までの見込み（[context] limit と比べる判定）。
 *
 * 区切り（G8・実装開始前・レビュー前）から完了までに増えるコンテキストは、大きさに関係なくかかる分
 * （レビュー・handoff・振り返り・PR）と、ビルドの大きさに比例する分（実装・テスト・指摘への対応）の和で見る:
 *
 *   残りの見込み = base + perPeak × そのビルドの予測ピーク
 *
 * 係数は、同じセッションで完了まで進んだビルドの記録（progress.jsonl）から最小二乗で求め、記録が
 * MIN_HISTORY_SAMPLES 件に満たないうちは既定値を使う。予測ピークは上限に依存しないので、上限を
 * 変える前の実績もそのまま使える。見込みの誤差は、同じ記録での上振れの p90 で見る。
 *
 * 推奨は、見込みに誤差を足した値が上限に収まる選択肢から決める:
 *
 *   continue  続けた場合の見込み × (1 + 誤差) が上限以下
 *   switch    新しいセッションで implement から続けた場合の見込み × (1 + 誤差) が上限以下で、続けるより低い
 *             （新しいセッションの開始値は、plan.md の内訳の固定費 + 読み込みで代える）
 *   split     どちらも上限を超える
 *
 * レビュー前の区切りでは、読み直しのほうが残りの作業より高くつくので、推奨は常に continue。
 * 上限に収まる選択肢のうちでは継続が最も安い（切り替えは読み直しの書き込みと呼び出しが増える）ので、
 * 費用を比べる判定は持たない。上限を超えそうな区切りで切り替えを分割より先に勧めるのも、
 * 分割はビルド1つ分の手順（plan〜G8、レビュー・PR）を払い直すため。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "./config.mts";
import { cycleDir, cyclesPath, loadCycles } from "./cycles.mts";
import { readProgress, type ProgressEvent } from "./progress.mts";
import { CHECKPOINT_LABELS, checkpointEvents, type CheckpointKey } from "./steps/checkpoints.mts";
import { estimateComponentsIn } from "./tokens-history.mts";

/** 区切りから完了までの見込みの段階。G8 と実装開始前は同じ残りの作業を持つ */
export type ForecastStage = "plan" | "review";

export const STAGE_OF: Record<CheckpointKey, ForecastStage> = { approval: "plan", implement: "plan", review: "review" };

export interface RemainingModel {
  /** 大きさに関係なくかかる分（トークン） */
  base: number;
  /** 予測ピークに比例する分の係数 */
  perPeak: number;
  /** 見込みの誤差（上振れの割合） */
  error: number;
  /** 係数を求めた記録の件数（既定値なら 0） */
  samples: number;
}

/**
 * 既定の係数。v3 の最初のサイクル（001-v3-core-concepts）の 17 ビルドから求めた値で、
 * 予測ピーク 210k〜435k の範囲の実績。誤差は G8 で上振れの最大 +10.7%、レビュー前で +5.0%
 */
export const DEFAULT_REMAINING: Record<ForecastStage, RemainingModel> = {
  plan: { base: 83_000, perPeak: 0.163, error: 0.1, samples: 0 },
  review: { base: 19_000, perPeak: 0.148, error: 0.05, samples: 0 },
};

/** 係数を実績から求めるのに要る記録の件数 */
export const MIN_HISTORY_SAMPLES = 5;
/** 実績から求めた誤差の下限。同じ記録で求めて同じ記録で測るので、小さく出やすい */
const MIN_ERROR = 0.03;

export interface RemainingSample {
  /** そのビルドの予測ピーク（builder が最後に報告した値） */
  peak: number;
  /** 区切りの値 */
  at: number;
  /** 同じセッションで完了（publish・pr）を報告したときの値 */
  completion: number;
}

/** builder が最後に報告した予測ピーク（plan / plan-review） */
export function reportedPeakOf(events: ProgressEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as ProgressEvent;
    if (event.skill === "builder" && event.peak !== undefined) return event.peak;
  }
  return undefined;
}

/** 1つのビルドの記録から、段階の実績を読む。同じセッションで完了まで進んでいなければ undefined */
export function sampleOf(events: ProgressEvent[], stage: ForecastStage): RemainingSample | undefined {
  const peak = reportedPeakOf(events);
  const key: CheckpointKey = stage === "plan" ? "implement" : "review";
  const at = checkpointEvents(events).find(([checkpoint]) => checkpoint === key)?.[1];
  if (peak === undefined || at?.context === undefined || at.session === undefined) return undefined;
  const completion = [...events]
    .reverse()
    .find((event) => event.skill === "builder" && (event.step === "publish" || event.step === "pr") && event.result === "done" && event.session === at.session);
  if (completion?.context === undefined || completion.context < at.context) return undefined;
  return { peak, at: at.context, completion: completion.context };
}

/** ワークスペースのすべてのサイクルのビルドから実績を集める。読めない記録は飛ばす */
export function collectSamples(hikyakuRoot: string, stage: ForecastStage): RemainingSample[] {
  if (!existsSync(cyclesPath(hikyakuRoot))) return [];
  let records: ReturnType<typeof loadCycles>;
  try {
    records = loadCycles(hikyakuRoot);
  } catch {
    // 索引を読めなければ実績なしとして既定の係数で見込む（区切りの判定で手順を止めない）
    return [];
  }
  const samples: RemainingSample[] = [];
  for (const record of records) {
    const directory = cycleDir(hikyakuRoot, record);
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory).filter((entry) => /^build-\d+$/.test(entry)).sort()) {
      try {
        const sample = sampleOf(readProgress(join(directory, name)), stage);
        if (sample !== undefined) samples.push(sample);
      } catch {
        // 壊れた記録は実績に数えない（手順の導出は step next 側が止める）
      }
    }
  }
  return samples;
}

/** 実績から係数を求める。件数が足りなければ既定値 */
export function fitRemaining(samples: RemainingSample[], fallback: RemainingModel): RemainingModel {
  if (samples.length < MIN_HISTORY_SAMPLES) return fallback;
  const xs = samples.map((s) => s.peak);
  const ys = samples.map((s) => s.completion - s.at);
  const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
  const mx = mean(xs);
  const my = mean(ys);
  const sxx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  const sxy = xs.reduce((sum, x, i) => sum + (x - mx) * ((ys[i] as number) - my), 0);
  // 予測ピークが全件同じか、大きいほど残りが小さいと出たときは、比例分を持たない平均で見る
  const perPeak = sxx === 0 || sxy < 0 ? 0 : sxy / sxx;
  const base = my - perPeak * mx;
  const overshoots = samples
    .map((s) => {
      const projected = s.at + base + perPeak * s.peak;
      return Math.max(0, (s.completion - projected) / projected);
    })
    .sort((a, b) => a - b);
  const p90 = overshoots[Math.ceil(overshoots.length * 0.9) - 1] ?? 0;
  return { base: Math.round(base), perPeak, error: Math.max(MIN_ERROR, p90), samples: samples.length };
}

export function remainingModel(hikyakuRoot: string, stage: ForecastStage): RemainingModel {
  return fitRemaining(collectSamples(hikyakuRoot, stage), DEFAULT_REMAINING[stage]);
}

export type Recommendation = "continue" | "switch" | "split";

export interface Forecast {
  checkpoint: CheckpointKey;
  label: string;
  /** 区切りでのコンテキスト */
  tokens: number;
  /** [context] limit */
  limit: number;
  /** 見込みに使った予測ピーク。報告が無ければ見積もりの上限で代える（peakAssumed） */
  peak: number;
  peakAssumed: boolean;
  /** 残りの見込み */
  remaining: number;
  /** 続けた場合の完了時点の見込みと、誤差を足した値 */
  continueAt: number;
  continueHigh: number;
  /** 新しいセッションで implement から続けた場合。レビュー前・plan.md の内訳が読めないときは null */
  switchAt: number | null;
  switchHigh: number | null;
  /** 続けた場合の見込み（誤差込み）が上限を超えるか */
  over: boolean;
  recommendation: Recommendation;
  model: RemainingModel;
}

export interface ForecastInput {
  checkpoint: CheckpointKey;
  tokens: number;
  peak: number | undefined;
  /** 新しいセッションの開始値（plan.md の内訳の固定費 + 読み込み） */
  switchStart: number | undefined;
  limit: number;
  estimateLimit: number;
  model: RemainingModel;
}

export function forecast(input: ForecastInput): Forecast {
  const peak = input.peak ?? input.estimateLimit;
  const { model } = input;
  const remaining = Math.round(model.base + model.perPeak * peak);
  const continueAt = input.tokens + remaining;
  const continueHigh = Math.round(continueAt * (1 + model.error));
  const canSwitch = STAGE_OF[input.checkpoint] === "plan" && input.switchStart !== undefined;
  const switchAt = canSwitch ? (input.switchStart as number) + remaining : null;
  const switchHigh = switchAt === null ? null : Math.round(switchAt * (1 + model.error));

  let recommendation: Recommendation = "continue";
  if (continueHigh > input.limit && STAGE_OF[input.checkpoint] === "plan") {
    recommendation = switchAt !== null && switchHigh !== null && switchHigh <= input.limit && switchAt < continueAt ? "switch" : "split";
  }
  return {
    checkpoint: input.checkpoint,
    label: CHECKPOINT_LABELS[input.checkpoint],
    tokens: input.tokens,
    limit: input.limit,
    peak,
    peakAssumed: input.peak === undefined,
    remaining,
    continueAt,
    continueHigh,
    switchAt,
    switchHigh,
    over: continueHigh > input.limit,
    recommendation,
    model,
  };
}

/** plan.md の内訳から、新しいセッションの開始値（固定費 + 読み込み）を求める。読めなければ undefined */
export function switchStartOf(unitDirectory: string): number | undefined {
  const path = join(unitDirectory, "plan.md");
  if (!existsSync(path)) return undefined;
  const components = estimateComponentsIn(readFileSync(path, "utf8"));
  if (components?.fixed === undefined || components.reading === undefined) return undefined;
  return components.fixed + components.reading;
}

/** 作業単位の記録と設定から、区切りの見込みを求める */
export function forecastFor(
  config: Pick<ResolvedConfig, "hikyakuRoot" | "context" | "peakBands">,
  unitDirectory: string,
  events: ProgressEvent[],
  checkpoint: CheckpointKey,
  tokens: number,
  models: Partial<Record<ForecastStage, RemainingModel>> = {},
): Forecast {
  const stage = STAGE_OF[checkpoint];
  return forecast({
    checkpoint,
    tokens,
    peak: reportedPeakOf(events),
    switchStart: switchStartOf(unitDirectory),
    limit: config.context.limit,
    estimateLimit: config.peakBands.estimateLimit,
    model: models[stage] ?? remainingModel(config.hikyakuRoot, stage),
  });
}

/**
 * 上限を超える見込みのまま継続した区切り。切り替え（handover）を記録した区切りは含めない。
 * ゲートの報告・完了の案内で伝える
 */
export function overrunsOf(
  config: Pick<ResolvedConfig, "hikyakuRoot" | "context" | "peakBands">,
  unitDirectory: string,
  events: ProgressEvent[],
): Forecast[] {
  const models: Partial<Record<ForecastStage, RemainingModel>> = {};
  const found: Forecast[] = [];
  for (const [checkpoint, event] of checkpointEvents(events)) {
    if (event.context === undefined) continue;
    const handedOver = events.some(
      (later) => later.result === "handover" && later.at >= event.at && (event.session === undefined || later.session === event.session),
    );
    if (handedOver) continue;
    const stage = STAGE_OF[checkpoint];
    models[stage] ??= remainingModel(config.hikyakuRoot, stage);
    const result = forecastFor(config, unitDirectory, events, checkpoint, event.context, models);
    if (result.over) found.push(result);
  }
  return found;
}
