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
  type LedgerItem,
} from "../ledger.mts";
import { currentEvents, isOn, type SkillSteps, type StepContext, type StepDefinition } from "./engine.mts";
import { stepsOf } from "./index.mts";

export const CONSENT_STEP = "consent";

// ---------------------------------------------------------------------------
// 退けた項目の作り直し（build-17・US-20.11）

/**
 * ゲートで記録した事項の戻り先。ゲートは done で報告し直せないので、そのゲートが承認した成果物を作る
 * run ステップへ戻す。表に無いゲートは、そのゲートより前で最も近い、手順に入っている run ステップ
 */
const GATE_REWORK: Record<string, Record<string, string>> = {
  architect: { G3: "options", G4: "design-delta" },
  builder: { G7: "plan", G8: "plan" },
  patch: { P1: "scope" },
};

/** 手順に入っているか。評価が投げたら入っているとみなす（戻り先を手順から外して黙って飛ばさないため） */
function safeOn(definition: StepDefinition, ctx: StepContext): boolean {
  try {
    return isOn(definition, ctx);
  } catch {
    return true;
  }
}

/** 位置 index より前で最も近い、手順に入っている run ステップ */
function previousRun(steps: StepDefinition[], index: number, on: (definition: StepDefinition) => boolean): string | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const definition = steps[i] as StepDefinition;
    if (definition.kind === "run" && on(definition)) return definition.id;
  }
  return undefined;
}

/**
 * 事項を記録したステップ（OpenRecord.step）を、done で報告し直せる戻り先に対応させる。
 *
 *   - ゲートは GATE_REWORK の対応先（手順に入っている run のとき）。無ければそのゲートより前で最も近い run
 *   - run / call で手順に入っていればそのステップ。入っていなければそれより前で最も近い run
 *   - 内部スキル（build-manager・retrospective）のステップ（G6 など）は、その内部スキルを呼ぶ call ステップとして扱う
 *     （G6 の受け入れを退けて G2〜G4 まで取り直さないため）。同じ ID を持つ内部スキルが複数あれば、手順で前の call
 *   - それでも決まらなければ、手順に入っている最初の run（安全側＝全部やり直す）
 */
export function reworkStepOf(skill: SkillSteps, step: string | undefined, ctx: StepContext): string {
  const steps = skill.steps;
  const on = (definition: StepDefinition) => safeOn(definition, ctx);
  const first = () => steps.find((definition) => definition.kind === "run" && on(definition))?.id ?? steps[0]?.id ?? CONSENT_STEP;
  if (step === undefined) return first();

  let index = steps.findIndex((definition) => definition.id === step);
  if (index === -1) {
    // 内部スキルのステップなら、その内部スキルを呼ぶ call の位置
    index = steps.findIndex(
      (definition) => definition.kind === "call" && definition.call !== undefined &&
        (stepsOf(definition.call)?.steps.some((inner) => inner.id === step) ?? false),
    );
    if (index === -1) return first();
  }
  const definition = steps[index] as StepDefinition;
  if (definition.kind === "gate") {
    const target = GATE_REWORK[skill.skill]?.[definition.id];
    const mapped = target === undefined ? undefined : steps.find((entry) => entry.id === target);
    if (mapped !== undefined && mapped.kind === "run" && on(mapped)) return mapped.id;
  } else if (on(definition)) {
    return definition.id;
  }
  return previousRun(steps, index, on) ?? first();
}

export interface ConsentRejections {
  /** 同じ作業単位で退け、戻り先をまだ done で報告し直していない項目と、その戻り先 */
  rework: { id: string; step: string }[];
  /** 同じ作業単位で退け、戻り先を退けの決定より後に done で報告し直した項目（resolved までは未解決の退け） */
  reworked: string[];
  /** 前のフェーズ（記録した作業単位が別）で退けた項目。resolved まで受け付けない */
  returns: string[];
}

/** 最新の決定が rejected の項目を、作り直しの経路ごとに分ける */
export function consentRejections(skill: string, items: LedgerItem[], ctx: StepContext): ConsentRejections {
  const result: ConsentRejections = { rework: [], reworked: [], returns: [] };
  const rejected = items.filter((item) => item.latest?.decision === "rejected");
  if (rejected.length === 0) return result;
  const steps = stepsOf(skill);
  for (const item of rejected) {
    if (item.open.unit !== ctx.unit || steps === undefined) {
      result.returns.push(item.open.id);
      continue;
    }
    const step = reworkStepOf(steps, item.open.step, ctx);
    const at = item.latest?.at ?? "";
    // 退けの決定より後（同じ時刻は数えない）に、戻り先を done で報告し直したか
    const redone = ctx.events.some((event) => event.skill === skill && event.step === step && event.result === "done" && event.at > at);
    if (redone) result.reworked.push(item.open.id);
    else result.rework.push({ id: item.open.id, step });
  }
  return result;
}

/** 戻り先のうち、手順で最も前のもの（そこを報告し直せば、後ろの戻り先もやり直しになる） */
function earliestStep(skill: string, steps: string[]): string | undefined {
  const order = stepsOf(skill)?.steps.map((definition) => definition.id) ?? [];
  return [...steps].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
}

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
    let pending: LedgerItem[];
    try {
      pending = undecidedConsentItems(consentItemsOf(readLedger(ctx.cycle.directory), ctx.unit));
    } catch (error) {
      return `未決事項の記録を読めず、事後同意の決定を確かめられません: ${error instanceof Error ? error.message : String(error)}（hikyaku ledger list で確かめてください）`;
    }
    if (pending.length === 0) return undefined;
    // 同じ作業単位で退けて作り直した項目は受け付ける（resolved までは PR 本文と cycle status に未解決の退けとして出る）
    const rejections = consentRejections(skill, pending, ctx);
    const rejectedIds = new Set([...rejections.rework.map((entry) => entry.id), ...rejections.returns, ...rejections.reworked]);
    const undecided = pending.filter((item) => !rejectedIds.has(item.open.id));
    const problems: string[] = [];
    if (undecided.length > 0) {
      const ids = undecided.map((item) => item.open.id).join(", ");
      // 同意ゲートが手順に入るのは、この作業単位のファイルに対象があるときだけ。ほかの単位で記録した対象だけなら
      // ゲートは外れているので、consent.md（承認の報告で終わる）ではなく、その場で示す案内にする
      const guide = isConductorChild()
        ? "conductor の子では同意ゲートが手順に入りません。PR を完了にせず、blocked でユーザーに上げてください。"
        : GATED.has(skill) && unitHasConsentItems(ctx.unitDirectory, ctx.unit) && !gateApproved(skill, ctx)
          ? `skills/${skill}/steps/consent.md の手順で一覧をユーザーに示し、決定を記録してから報告し直してください。`
          : `その場で一覧（hikyaku ledger consent-list ${ctx.unit}）をユーザーに示し、項目ごとにユーザーの決定を hikyaku ledger decide ${ctx.unit} <ID> --decision <decision> --by user --input "<ユーザーの答え>" で記録してから報告し直してください。`;
      problems.push(`マージの前にユーザーの同意が要る項目に、ユーザーの決定がありません（${ids}）。${guide}`);
    }
    if (rejections.rework.length > 0) {
      const list = rejections.rework.map((entry) => `${entry.id} → ${entry.step}`).join(", ");
      problems.push(
        `退けた項目を作り直していません（${list}）。戻り先のステップ（${earliestStep(skill, rejections.rework.map((entry) => entry.step))}）を作り直して done で報告し直してください（そこから後ろはやり直しになります）。作り直したら、resolved の前でも承認と PR の作成を受け付けます。`,
      );
    }
    if (rejections.returns.length > 0) {
      const how = skill === "builder"
        ? "skills/builder/references/return.md の「同意ゲートで前のフェーズの判断を退けたとき」に従い、architect へ差し戻してください。"
        : "記録したフェーズで作り直してください。";
      problems.push(
        `前のフェーズで記録した項目を退けています（${rejections.returns.join(", ")}）。${how}作り直しが済んでユーザーが resolved を記録するまで受け付けません。`,
      );
    }
    return problems.length === 0 ? undefined : problems.join(" ");
  };
}

/** 今回の回で、PR を作るステップ（architect・builder は pr、patch は publish）を done で報告したか */
function anchorDone(skill: string, ctx: StepContext): boolean {
  const anchor = skill === "patch" ? "publish" : "pr";
  return currentEvents({ skill }, ctx.events).some((event) => event.skill === skill && event.step === anchor && event.result === "done");
}

/** その回で同意ゲートを承認したか（承認のあとに pr の accepts が止めたのは、ほかの単位で記録した項目） */
function gateApproved(skill: string, ctx: StepContext): boolean {
  return currentEvents({ skill }, ctx.events).some((event) => event.skill === skill && event.step === CONSENT_STEP && event.result === "approved");
}

/** 同意ゲート。when はスキルごとの構造の条件（architect の差し戻しの回を外す、など） */
export function consentStep(skill: string, when?: (ctx: StepContext) => boolean): StepDefinition {
  return {
    id: CONSENT_STEP,
    kind: "gate",
    title: "事後同意（マージの前にユーザーが同意する項目）",
    // PR を作るステップをこの回で終えたら、もう手順に入れない。そのとき pr / publish の accepts が決定を確かめ済み。
    // 入れたままだと、あとから対象が足されたときや、conductor の子が終えた単位を子でない環境で評価したときに、
    // 承認の無いゲートが PR の前に現れ、終えた pr / publish をやり直しにする（コードレビュー2回目の指摘）
    when: (ctx) =>
      (when === undefined || when(ctx)) && ctx.cycle !== undefined && !isConductorChild() && !anchorDone(skill, ctx) &&
      unitHasConsentItems(ctx.unitDirectory, ctx.unit),
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
        const items = consentItemsOf(readLedger(ctx.cycle.directory), ctx.unit);
        const args: Record<string, unknown> = { items: items.map((item) => item.open.id) };
        // 退けた項目があるときだけ、作り直しの戻り先（同じ作業単位）と差し戻す項目（前のフェーズ）を添える
        const rejections = consentRejections(skill, undecidedConsentItems(items), ctx);
        if (rejections.rework.length > 0) {
          args["reworkFrom"] = earliestStep(skill, rejections.rework.map((entry) => entry.step));
          args["rework"] = rejections.rework;
        }
        if (rejections.returns.length > 0) args["returns"] = rejections.returns;
        return args;
      } catch (error) {
        // 空の一覧だけを返すと「同意する項目は無い」と読まれる。読めないことを示す（承認は accepts が拒む）
        return { items: [], error: `未決事項の記録を読めません: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}
