/**
 * 事後同意の同意ゲート（build-06・ADR 20261116-deferred-consent）。
 *
 * architect・builder は pr の直前、patch は publish の直前に置く。対象は type が risk か objection で、
 * who=user・when=merge@<その作業単位> の事項（記録した作業単位は問わない）。一覧の全項目にユーザーの決定が
 * あるまで、ゲートも PR の作成（pr / publish の accepts）も完了しない。
 *
 *   - when は、事後同意を選んでいないサイクルではその作業単位の decisions.jsonl 1つだけを読む（手順の位置だけを
 *     読む経路でも呼ばれるため）。ほかの作業単位で記録した when=merge@<この単位> の事項は、pr の accepts（報告の時だけ
 *     サイクル全体を読む）が止める。事後同意を選んだサイクルではサイクル全体から探す（build-18。hasConsentItems）
 *   - conductor の子の扱いは conductorConsentMode が決める（build-19）。事後同意が有効なサイクルでは、最後のビルドの
 *     子だけが同意ゲートを持ち、対象はサイクル全体。architect と最後以外のビルドの子は同意ゲートを持たず、pr の accepts も
 *     決定の無い項目で止めない（最後のビルドの同意ゲートへ回す）。有効でないサイクルの子と close-cycle の子は
 *     同意ゲートを持たず、pr / publish の accepts が決定の無い項目で止めてユーザーに上げる
 *
 * ledger.mts は steps/index.mts を import しているので、ここからは ledger.mts の関数を呼び出し時にだけ使い、
 * ledger.mts からこのファイルを import しない（循環で未初期化の値を読まないため）。
 */

import { deferredConsent } from "../deferred-consent.mts";
import {
  consentItemsOf,
  cycleConsentItems,
  readLedger,
  undecidedConsentItems,
  unitConsentItemsAfter,
  unitHasConsentItems,
  type Ledger,
  type LedgerItem,
} from "../ledger.mts";
import { loadTasklist, normalizeBuildId } from "../tasklist.mts";
import { currentEvents, isOn, type SkillSteps, type StepContext, type StepDefinition } from "./engine.mts";
import { stepsOf } from "./index.mts";

export const CONSENT_STEP = "consent";

// ---------------------------------------------------------------------------
// 退けた項目の作り直し（build-17・US-20.11）

/**
 * 手順に入っているかを、1回の判定の中ではステップごとに1度だけ評価する（when・consent は記録や git を読むため）。
 * 評価が投げたら入っているとみなす（戻り先を手順から外して黙って飛ばさないため）
 */
function onChecker(ctx: StepContext): (definition: StepDefinition) => boolean {
  const cache = new Map<StepDefinition, boolean>();
  return (definition) => {
    let on = cache.get(definition);
    if (on === undefined) {
      try {
        on = isOn(definition, ctx);
      } catch {
        on = true;
      }
      cache.set(definition, on);
    }
    return on;
  };
}

/**
 * 内部スキルのステップ ID から、その内部スキルを呼ぶ call の位置。同じ ID を持つ内部スキルが複数あれば
 * （build-manager と retrospective の write など）、事項を記録した時刻までに最後に記録を残した内部スキルで決め、
 * 決まらなければ手順で前の call（安全側＝多くやり直す）
 */
function internalCallIndex(steps: StepDefinition[], step: string, ctx: StepContext, at: string | undefined): number {
  const calls = steps
    .map((definition, index) => ({ definition, index }))
    .filter(({ definition }) => definition.kind === "call" && definition.call !== undefined &&
      (stepsOf(definition.call)?.steps.some((inner) => inner.id === step) ?? false));
  if (calls.length <= 1 || at === undefined) return calls[0]?.index ?? -1;
  const callees = new Set(calls.map(({ definition }) => definition.call));
  const last = ctx.events.filter((event) => callees.has(event.skill) && event.at <= at).at(-1);
  return (calls.find(({ definition }) => definition.call === last?.skill) ?? calls[0])?.index ?? -1;
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
 *   - ゲートは定義の reworks（手順に入っている run のとき）。無ければそのゲートより前で最も近い run
 *   - run / call で手順に入っていればそのステップ。入っていなければそれより前で最も近い run
 *   - 内部スキル（build-manager・retrospective）のステップ（G6 など）は、その内部スキルを呼ぶ call ステップとして扱う
 *     （G6 の受け入れを退けて G2〜G4 まで取り直さないため）
 *   - 同意ゲートより後ろ（pr / publish）は、ゲートが承認されるまで報告し直せないので、ゲートより前で最も近い run
 *   - それでも決まらなければ、手順に入っている最初の run（安全側＝全部やり直す）
 *
 * at は事項を記録した時刻（同じ ID を持つ内部スキルの見分けに使う）
 */
export function reworkStepOf(
  skill: SkillSteps,
  step: string | undefined,
  ctx: StepContext,
  at?: string,
  on: (definition: StepDefinition) => boolean = onChecker(ctx),
): string {
  const steps = skill.steps;
  const first = () => steps.find((definition) => definition.kind === "run" && on(definition))?.id ?? steps[0]?.id ?? "";
  if (step === undefined) return first();

  let index = steps.findIndex((definition) => definition.id === step);
  if (index === -1) index = internalCallIndex(steps, step, ctx, at);
  if (index === -1) return first();
  // 同意ゲート（無いスキルは PR を作るステップ）から後ろは、決定が足りないあいだ報告し直せないので、その前の run
  let gate = steps.findIndex((definition) => definition.id === CONSENT_STEP);
  if (gate === -1) gate = steps.findIndex((definition) => definition.id === "pr" || definition.id === "publish");
  if (gate !== -1 && index >= gate) return previousRun(steps, gate, on) ?? first();
  const definition = steps[index] as StepDefinition;
  if (definition.kind === "gate") {
    const mapped = definition.reworks === undefined ? undefined : steps.find((entry) => entry.id === definition.reworks);
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
  /**
   * returns のうち、退けの決定より後にこの単位の手順を報告している項目（差し戻しの再設計を経て作業を再開した）。
   * 差し戻しの前は、退けたあと手順を報告せずに止まるので、作り直しが済んだかをユーザーに尋ねる段階と見分けられる
   */
  resumed: string[];
}

/** 最新の決定が rejected の項目を、作り直しの経路ごとに分ける */
export function consentRejections(skill: string, items: LedgerItem[], ctx: StepContext): ConsentRejections {
  const result: ConsentRejections = { rework: [], reworked: [], returns: [], resumed: [] };
  const rejected = items.filter((item) => item.latest?.decision === "rejected");
  if (rejected.length === 0) return result;
  const steps = stepsOf(skill);
  const on = onChecker(ctx);
  // step restart の区切りより前の報告し直しは数えない（区切ったあとの回で作り直していない）
  const events = currentEvents({ skill }, ctx.events);
  // 完了の報告（skippable なステップを作り直しで skipped にした回も作り直しに数える）
  const completed = (event: (typeof events)[number]) => event.skill === skill && (event.result === "done" || event.result === "skipped");
  for (const item of rejected) {
    const at = item.latest?.at ?? "";
    if (item.open.unit !== ctx.unit || steps === undefined) {
      result.returns.push(item.open.id);
      if (events.some((event) => completed(event) && event.at > at)) result.resumed.push(item.open.id);
      continue;
    }
    const step = reworkStepOf(steps, item.open.step, ctx, item.open.at, on);
    // 退けの決定より後（同じ時刻は数えない）に、戻り先を報告し直したか
    const redone = events.some((event) => completed(event) && event.step === step && event.at > at);
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
 * 作業ツリーの tasklist で、このビルド以外の全ビルドの PR 列が埋まっているか（conductor の最後のビルド）。
 * build-NN でなければ false。tasklist を読めない・そのビルドの行が無ければ true（同意ゲートを置いて止める向き）
 */
export function isLastBuild(cycleDirectory: string, unit: string): boolean {
  if (!/^build-\d+$/.test(unit)) return false;
  const id = normalizeBuildId(unit);
  try {
    const builds = loadTasklist(cycleDirectory);
    if (!builds.some((build) => build.id === id)) return true;
    return builds.every((build) => build.id === id || build.pr !== "");
  } catch {
    return true;
  }
}

/**
 * conductor の子の同意の扱い（build-19・ADR deferred-consent）。
 *
 *   last      最後のビルドの子。同意ゲートを手順に入れ、対象はサイクル全体
 *   deferred  architect の子と、最後以外のビルドの子。同意ゲートを手順に入れず、pr の accepts も決定の無い項目で
 *             止めない（最後のビルドの同意ゲートへ回す）。ledger object --defer は置き場を問わず受け付ける
 *   none      子でない、architect・ビルド以外の子（close-cycle・patch）、または事後同意が有効でないサイクルの子。従来どおり
 *
 * last と deferred は、事後同意が有効なサイクルの子だけ（選んでいない・有効でないサイクルで同意を後ろへ回さない。原則11）。
 * 子と監督（asConductorChild）は ctx と環境変数から同じ評価をする
 */
export type ConductorConsentMode = "last" | "deferred" | "none";

export function conductorConsentMode(skill: string, ctx: Pick<StepContext, "config" | "cycle" | "unit">): ConductorConsentMode {
  if (!isConductorChild() || ctx.cycle === undefined) return "none";
  if (skill !== "architect" && skill !== "builder") return "none";
  // config が無い単体テストの ctx でも読めるよう、?. で読む（requested でなければ git を読まない）
  if (ctx.config?.consent?.deferred !== true) return "none";
  if (!deferredConsent(ctx.config, ctx.cycle.directory).effective) return "none";
  if (skill === "architect") return "deferred";
  return isLastBuild(ctx.cycle.directory, ctx.unit) ? "last" : "deferred";
}

/**
 * 同意ゲート・pr の accepts・consent-list・pr-section・return-draft・launch --closes が使う対象。
 * 最後のビルドの子（last）ならサイクル全体、それ以外はその作業単位（when=merge@<unit>）
 */
export function consentTargets(ledger: Ledger, skill: string, ctx: Pick<StepContext, "config" | "cycle" | "unit">): LedgerItem[] {
  return conductorConsentMode(skill, ctx) === "last" ? cycleConsentItems(ledger) : consentItemsOf(ledger, ctx.unit);
}

/**
 * pr / publish（と同意ゲート）の accepts。サイクル全体の記録を読み、対象（consentTargets）のうち決定の
 * 足りないものがあれば理由を返す。記録を読めなければ受け付けない（安全側）
 */
export function consentProblem(skill: string): (ctx: StepContext) => string | undefined {
  return (ctx) => {
    if (ctx.cycle === undefined) return undefined;
    const mode = conductorConsentMode(skill, ctx);
    let pending: LedgerItem[];
    try {
      pending = undecidedConsentItems(consentTargets(readLedger(ctx.cycle.directory), skill, ctx));
    } catch (error) {
      return `未決事項の記録を読めず、事後同意の決定を確かめられません: ${error instanceof Error ? error.message : String(error)}（hikyaku ledger list で確かめてください）`;
    }
    if (pending.length === 0) return undefined;
    // 同じ作業単位で退けて作り直した項目は受け付ける（resolved までは PR 本文と cycle status に未解決の退けとして出る）
    const rejections = consentRejections(skill, pending, ctx);
    // 最後以外の子（deferred）は、決定の無い項目では止めない（最後のビルドの同意ゲートが拾う）。退けの作り直しは確かめる
    const undecided = mode === "deferred" ? [] : pending.filter((item) => item.latest?.decision !== "rejected");
    const problems: string[] = [];
    if (undecided.length > 0) {
      const ids = undecided.map((item) => item.open.id).join(", ");
      // 同意ゲートが手順に入るのは、対象があるときだけ。ゲートが外れているなら、consent.md（承認の報告で終わる）
      // ではなく、その場で示す案内にする
      const guide = isConductorChild() && mode === "none"
        ? "conductor の子では同意ゲートが手順に入りません。PR を完了にせず、blocked でユーザーに上げてください。"
        : GATED.has(skill) && hasConsentItems(skill, ctx) && !gateApproved(skill, ctx)
          ? `skills/${skill}/steps/consent.md の手順で一覧をユーザーに示し、決定を記録してから報告し直してください。`
          : `その場で一覧（hikyaku ledger consent-list ${ctx.unit}）をユーザーに示し、項目ごとにユーザーの決定を hikyaku ledger decide ${ctx.unit} <ID> --decision <decision> --by user --input "<ユーザーの答え>" [--accepts "<受け入れる言葉>"] で記録してから報告し直してください（高として扱う異議（害が高か、上限を超える）は、ユーザーが受け入れると自分の言葉で書いたことを --accepts に添える）。`;
      problems.push(`マージの前にユーザーの同意が要る項目に、ユーザーの決定がありません（${ids}）。${guide}`);
    }
    if (rejections.rework.length > 0) {
      const list = rejections.rework.map((entry) => `${entry.id} → ${entry.step}`).join(", ");
      problems.push(
        `退けた項目を作り直していません（${list}）。戻り先のステップ（${earliestStep(skill, rejections.rework.map((entry) => entry.step))}）を作り直して done で報告し直してください（そこから後ろはやり直しになります）。作り直したら、resolved の前でも承認と PR の作成を受け付けます。`,
      );
    }
    const resumed = new Set(rejections.resumed);
    const notYet = rejections.returns.filter((id) => !resumed.has(id));
    if (notYet.length > 0) {
      const how = skill === "builder"
        ? "skills/builder/references/return.md の「同意ゲートで前のフェーズの判断を退けたとき」に従い、architect へ差し戻してください。"
        : "記録したフェーズで作り直してください。";
      problems.push(
        `前のフェーズで記録した項目を退けています（${notYet.join(", ")}）。${how}作り直しが済んでユーザーが resolved を記録するまで受け付けません。`,
      );
    }
    if (resumed.size > 0) {
      // 退けのあとに作業を再開している（差し戻しの再設計を経た）。もう一度差し戻さず、作り直しが済んだかを尋ねる
      problems.push(
        `前のフェーズで記録して退けた項目（${rejections.resumed.join(", ")}）は、退けのあとに作業を再開しています。作り直しが済んだかをユーザーに尋ね、認めたら hikyaku ledger decide ${ctx.unit} <ID> --decision resolved --by user --input "<ユーザーの答え>" で記録してから報告し直してください（認めなければ、もう一度差し戻すかをユーザーと決めてください）。`,
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

/**
 * 同意の対象があるか（同意ゲートが手順に入るかの後半）。
 *
 *   - 事後同意を選んだサイクル（requested）でなければ、その作業単位の decisions.jsonl 1つだけを読む（build-06）
 *   - requested なら、ほかの作業単位で記録した when=merge@<この単位> の事項（ledger object --defer・G3/G4 の積み上げ）も
 *     ゲートで示すため、サイクル全体の記録を読む。読めなければ手順に入れる
 *   - requested で手順の位置だけを読む経路（Stop フック・step where・conductor parse）は、記録を読まずに手順に入れる
 *     （安全側。位置だけの経路は壊れた記録で止めない）
 *   - conductor の最後のビルドの子（last）は、位置だけの経路でもサイクル全体の記録を読む。監督の childStep と子の
 *     step next で、最後のビルドの同意ゲートの有無をそろえるため（build-06 の handoff）。読めなければ手順に入れる
 */
function hasConsentItems(skill: string, ctx: StepContext): boolean {
  if (ctx.cycle === undefined) return false;
  if (conductorConsentMode(skill, ctx) === "last") {
    try {
      return cycleConsentItems(readLedger(ctx.cycle.directory)).length > 0;
    } catch {
      return true;
    }
  }
  // config が無い単体テストの ctx でも読めるよう、?. で読む
  if (ctx.config.consent?.deferred !== true) return unitHasConsentItems(ctx.unitDirectory, ctx.unit);
  if (ctx.positionOnly === true) return true;
  try {
    return consentItemsOf(readLedger(ctx.cycle.directory), ctx.unit).length > 0;
  } catch {
    return true;
  }
}

/** 置き場（slot）を持つ同意ゲートの定義。ledger object --defer が、今の回に置き場があるかを確かめるのに使う */
interface ConsentStepDefinition extends StepDefinition {
  slot: (ctx: StepContext) => boolean;
}

/**
 * その作業単位の今の回に、同意ゲートの置き場があるか。無ければ理由を返す（ledger object --defer と、
 * conductor launch の監督の上限を超える答えの検査が使う）。
 * 同意ゲートを持たないスキル（planner・close-cycle・create-cycle）、architect の差し戻しの回、
 * この回で PR を作るステップを done にした後は、置き場が無い（積んでもこの回のゲートに載らない）。
 * conductor の最後以外の子（deferred）は置き場を問わない（記録は when=merge@<その単位> のまま、最後のビルドの
 * 同意ゲートがサイクル全体から拾う）
 */
export function consentGateSlot(skill: SkillSteps, ctx: StepContext): string | undefined {
  const definition = skill.steps.find((step) => step.id === "consent") as ConsentStepDefinition | undefined;
  if (definition === undefined) return `${ctx.unit} の手順には同意ゲートがありません（同意ゲートは architect・ビルド・サイクルに属す patch の PR の前に置かれます）`;
  if (conductorConsentMode(skill.skill, ctx) === "deferred") return undefined;
  if (!definition.slot(ctx)) {
    return `${ctx.unit} の今の回には同意ゲートが現れません（差し戻しからの再設計の回か、この回で PR を作るステップをもう終えた、または conductor の子）`;
  }
  return undefined;
}

/** 同意ゲート。when はスキルごとの構造の条件（architect の差し戻しの回を外す、など） */
export function consentStep(skill: string, when?: (ctx: StepContext) => boolean): StepDefinition {
  // 置き場: 構造の条件・サイクルがある・conductor の子でないか最後のビルドの子（last）・この回で PR を作るステップを
  // 終えていない。モジュールの const の表に持たない（循環 import で、このファイルの本体より先に consentStep が呼ばれるため）
  const slot = (ctx: StepContext): boolean =>
    (when === undefined || when(ctx)) && ctx.cycle !== undefined &&
    (!isConductorChild() || conductorConsentMode(skill, ctx) === "last") && !anchorDone(skill, ctx);
  const definition: ConsentStepDefinition = {
    slot,
    // CONSENT_STEP と同じ値。steps/<skill>.mts の評価中に呼ばれ、循環 import（consent → ledger・index →
    // architect / builder / patch → consent）でこのファイルを先に読み始めたときは const がまだ初期化されていないので、
    // リテラルで書く
    id: "consent",
    kind: "gate",
    title: "事後同意（マージの前にユーザーが同意する項目）",
    // PR を作るステップをこの回で終えたら、もう手順に入れない。そのとき pr / publish の accepts が決定を確かめ済み。
    // 入れたままだと、あとから対象が足されたときや、conductor の子が終えた単位を子でない環境で評価したときに、
    // 承認の無いゲートが PR の前に現れ、終えた pr / publish をやり直しにする（コードレビュー2回目の指摘）
    when: (ctx) => slot(ctx) && hasConsentItems(skill, ctx),
    consent: () => ({ timing: "now", reason: "上限を超えるリスクの受け入れ（事後同意）" }),
    ask: "deferred-consent",
    accepts: consentProblem(skill),
    // 承認のあとに、決定の足りない対象が足されたら取り直す。ふだんはその作業単位のファイル1つだけを読み、
    // 最後のビルドの子（last）はサイクル全体を読む（ほかの単位に足された対象もゲートに載るため）
    reopens: (ctx, approval) => {
      if (ctx.cycle === undefined) return undefined;
      let added: LedgerItem[] | undefined;
      if (conductorConsentMode(skill, ctx) === "last") {
        try {
          added = undecidedConsentItems(cycleConsentItems(readLedger(ctx.cycle.directory))).filter((item) => item.open.at > approval.at);
        } catch {
          added = undefined;
        }
      } else {
        added = unitConsentItemsAfter(ctx.cycle.directory, ctx.unit, approval.at);
      }
      if (added === undefined) return "未決事項の記録を読めず、承認のあとに足された同意の対象を確かめられません";
      if (added.length === 0) return undefined;
      return `承認のあとに、同意の対象が足されました（${added.map((item) => item.open.id).join(", ")}）。一覧を示し直してください`;
    },
    args: (ctx) => {
      if (ctx.positionOnly === true || ctx.cycle === undefined) return { items: [] };
      try {
        const items = consentTargets(readLedger(ctx.cycle.directory), skill, ctx);
        const args: Record<string, unknown> = { items: items.map((item) => item.open.id) };
        // 退けた項目があるときだけ、作り直しの戻り先（同じ作業単位）と差し戻す項目（前のフェーズ）を添える
        const rejections = consentRejections(skill, undecidedConsentItems(items), ctx);
        if (rejections.rework.length > 0) {
          args["reworkFrom"] = earliestStep(skill, rejections.rework.map((entry) => entry.step));
          args["rework"] = rejections.rework;
        }
        if (rejections.returns.length > 0) args["returns"] = rejections.returns;
        // 差し戻しの再設計を経て再開した項目（もう一度差し戻さず、作り直しが済んだかを尋ねる）
        if (rejections.resumed.length > 0) args["resumed"] = rejections.resumed;
        return args;
      } catch (error) {
        // 空の一覧だけを返すと「同意する項目は無い」と読まれる。読めないことを示す（承認は accepts が拒む）
        return { items: [], error: `未決事項の記録を読めません: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
  return definition;
}
