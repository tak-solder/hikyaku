/**
 * 事後同意の同意ゲート（build-06・ADR 20261116-deferred-consent）。
 *
 * architect・builder は pr の直前、patch は publish の直前に置く。対象は type が risk か objection で、
 * who=user・when=merge@<その作業単位> の事項（記録した作業単位は問わない）。一覧の全項目にユーザーの決定が
 * あるまで、ゲートも PR の作成（pr / publish の accepts）も完了しない。
 *
 *   - when はその作業単位の decisions.jsonl 1つだけを読む（手順の位置だけを読む経路でも呼ばれるため）。
 *     ほかの作業単位で記録した when=merge@<この単位> の事項は、pr の accepts（報告の時だけサイクル全体を読む）が止める
 *   - conductor の子では、ユーザーに固定の問いで子が止まるのを避けるため手順に入れない（conductor での扱いは
 *     build-07）。pr / publish の accepts は外さないので、決定の無い項目があれば PR は完了せずユーザーに上がる
 *
 * ledger.mts は steps/index.mts を import しているので、ここからは ledger.mts の関数を呼び出し時にだけ使い、
 * ledger.mts からこのファイルを import しない（循環で未初期化の値を読まないため）。
 */

import {
  consentItemsOf,
  readLedger,
  undecidedConsentItems,
  unitConsentItemsAfter,
  unitHasConsentItems,
} from "../ledger.mts";
import type { StepContext, StepDefinition } from "./engine.mts";

export const CONSENT_STEP = "consent";

/** conductor の子（非対話）か */
export function isConductorChild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["HIKYAKU_CONDUCTOR_CHILD"] === "1";
}

/**
 * conductor の子として手順を評価する。監督（親）が子の手順の位置を確かめるときに使う。親のプロセスには
 * HIKYAKU_CONDUCTOR_CHILD が無いので、そのまま評価すると子が外した同意ゲートを現在地と読み、正しく終えた子を違反とする
 */
export function asConductorChild<T>(run: () => T): T {
  const saved = process.env["HIKYAKU_CONDUCTOR_CHILD"];
  process.env["HIKYAKU_CONDUCTOR_CHILD"] = "1";
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env["HIKYAKU_CONDUCTOR_CHILD"];
    else process.env["HIKYAKU_CONDUCTOR_CHILD"] = saved;
  }
}

/** 同意ゲートを手順に置くスキル。それ以外（planner・close-cycle）は pr の accepts だけを持つ */
const GATED = new Set(["architect", "builder", "patch"]);

/**
 * pr / publish（と同意ゲート）の accepts。サイクル全体の記録を読み、その作業単位の対象のうち決定の
 * 足りないものがあれば理由を返す。記録を読めなければ受け付けない（安全側）
 */
export function consentProblem(skill: string): (ctx: StepContext) => string | undefined {
  return (ctx) => {
    if (ctx.cycle === undefined) return undefined;
    let pending;
    try {
      pending = undecidedConsentItems(consentItemsOf(readLedger(ctx.cycle.directory), ctx.unit));
    } catch (error) {
      return `未決事項の記録を読めず、事後同意の決定を確かめられません: ${error instanceof Error ? error.message : String(error)}（hikyaku ledger list で確かめてください）`;
    }
    if (pending.length === 0) return undefined;
    const ids = pending.map((item) => item.open.id).join(", ");
    // 同意ゲートが手順に入るのは、この作業単位のファイルに対象があるときだけ。ほかの単位で記録した対象だけなら
    // ゲートは外れているので、consent.md（承認の報告で終わる）ではなく、その場で示す案内にする
    const guide = isConductorChild()
      ? "conductor の子では同意ゲートが手順に入りません。PR を完了にせず、blocked でユーザーに上げてください。"
      : GATED.has(skill) && unitHasConsentItems(ctx.unitDirectory, ctx.unit)
        ? `skills/${skill}/steps/consent.md の手順で一覧をユーザーに示し、決定を記録してから報告し直してください。`
        : `その場で一覧（hikyaku ledger consent-list ${ctx.unit}）をユーザーに示し、項目ごとにユーザーの決定を hikyaku ledger decide ${ctx.unit} <ID> --decision <decision> --by user --input "<ユーザーの答え>" で記録してから報告し直してください。`;
    return `マージの前にユーザーの同意が要る項目に、ユーザーの決定がありません（${ids}）。${guide}`;
  };
}

/** 同意ゲート。when はスキルごとの構造の条件（architect の差し戻しの回を外す、など） */
export function consentStep(skill: string, when?: (ctx: StepContext) => boolean): StepDefinition {
  return {
    id: CONSENT_STEP,
    kind: "gate",
    title: "事後同意（マージの前にユーザーが同意する項目）",
    when: (ctx) =>
      (when === undefined || when(ctx)) && ctx.cycle !== undefined && !isConductorChild() && unitHasConsentItems(ctx.unitDirectory, ctx.unit),
    consent: () => ({ timing: "now", reason: "上限を超えるリスクの受け入れ（事後同意）" }),
    ask: "deferred-consent",
    accepts: consentProblem(skill),
    // 承認のあとに、その作業単位の記録に決定の足りない対象が足されたら取り直す（ファイル1つだけを読む）
    reopens: (ctx, approval) => {
      if (ctx.cycle === undefined) return undefined;
      const added = unitConsentItemsAfter(ctx.cycle.directory, ctx.unit, approval.at);
      if (added === undefined) return "未決事項の記録を読めず、承認のあとに足された同意の対象を確かめられません";
      if (added.length === 0) return undefined;
      return `承認のあとに、同意の対象が足されました（${added.map((item) => item.open.id).join(", ")}）。一覧を示し直してください`;
    },
    args: (ctx) => {
      if (ctx.positionOnly === true || ctx.cycle === undefined) return { items: [] };
      try {
        return { items: consentItemsOf(readLedger(ctx.cycle.directory), ctx.unit).map((item) => item.open.id) };
      } catch {
        return { items: [] };
      }
    },
  };
}
