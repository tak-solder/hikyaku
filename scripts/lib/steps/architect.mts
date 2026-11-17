/**
 * architect（ARCHITECT フェーズ）のステップ。
 *
 * 並びは移行前の SKILL.md の Step 1〜6 と同じ。Step 0（設定の解決・入力の読み込み・ブランチ・
 * セッション名）はセッションごとにやり直す準備なので、ここには含めず SKILL.md に置く。
 * 進捗は design/progress.jsonl にあるので、ブランチを決めるまでは現在地を導出できない。
 *
 * 同じ design/ で手順を回し直す回が2種類ある。どちらも step restart --round で区切り、
 * 回の種類は currentRound で読む。
 *
 *   return   差し戻しからの再設計。差し戻し元のビルドのブランチで行い、PR を作らず、
 *            最後に return.md と古い plan.md / test-spec.md を消す
 *   add      指摘からの追加設計。調査を行わず、設計の変更が要るときだけ設計を見直し、
 *            指摘に対応するビルドを足す
 *
 * --round を付けずに区切った回と、区切りが無い回は通常の設計（design）。
 *
 * 再設計の回で差し戻しを解決した（resolve-return を終えた）あとに、同じブランチで新しく差し戻されたら、
 * 前の回のまま進めずに止まる。改めて step restart --round return で区切らないと、新しい return.md を
 * 消すだけで差し戻しを解決できてしまうため。
 */

import { publicationStep } from "./publication.mts";
import { consentProblem, consentStep } from "./consent.mts";
import { declarationArgs } from "../premises.mts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadCycles } from "../cycles.mts";
import { deferredConsent } from "../deferred-consent.mts";
import { readUnitLedger } from "../ledger.mts";
import {
  ceilingAxes,
  ceilingOf,
  effectiveDeclaration,
  exceeds,
  heavyAreasHit,
  overlaps,
  repositoryFiles,
  type Harm,
} from "../risk.mts";
import { boundaryChanges, DESIGN_DELTA, designTouchedPaths, UNVERIFIED_NOTICE, type BoundaryChanges } from "../gate-brief.mts";
import { pluginRoot } from "../paths.mts";
import { describeEscalationProblems } from "../escalation.mts";
import { readReturn, RETURN_FILE } from "../phase.mts";
import { buildDirName, loadTasklist } from "../tasklist.mts";
import {
  currentEvents,
  currentRound,
  type ConsentJudgement,
  type DeferredRisk,
  type SkillSteps,
  type StepContext,
  type StepDefinition,
} from "./engine.mts";

export type ArchitectRound = "design" | "return" | "add";

/** step restart architect --round で指定できる回の種類 */
const ROUNDS: Exclude<ArchitectRound, "design">[] = ["return", "add"];

/** いまの回の種類。--round で始めた回ならその値、それ以外は通常の設計 */
export function roundOf(ctx: StepContext): ArchitectRound {
  const round = currentRound(ARCHITECT_STEPS, ctx.events);
  return ROUNDS.find((entry) => entry === round) ?? "design";
}

/** いまの回で、そのステップが最後にスキップと記録されたか */
function skipped(ctx: StepContext, step: string): boolean {
  const events = currentEvents(ARCHITECT_STEPS, ctx.events).filter((event) => event.skill === "architect" && event.step === step);
  return events[events.length - 1]?.result === "skipped";
}

/** 自分のほかに進行中のサイクルがあるか（cycle list --active と同じ判定） */
function otherActiveCycles(ctx: StepContext): boolean {
  const self = ctx.cycle?.record.id;
  return loadCycles(ctx.config.hikyakuRoot).some((record) => record.status === "active" && record.id !== self);
}

/** いまの回で、そのスキルのそのステップが done と記録されたか */
function doneThisRound(ctx: StepContext, skill: string, step: string): boolean {
  return currentEvents(ARCHITECT_STEPS, ctx.events).some((event) => event.skill === skill && event.step === step && event.result === "done");
}

/**
 * build-manager が書き込んだ印。tasklist.md にビルドがあること。追加設計の回では、それに加えて
 * この回で build-manager が書き込み（write）を終えていること。未完了のビルドがあるかは完了の印にしない。
 * 足したビルドがすべて PR まで進むと条件が崩れ、完了した build-split に巻き戻るため（報告のときだけ
 * addedBuild で確かめる）
 */
function splitRecorded(ctx: StepContext): boolean {
  if (ctx.cycle === undefined) return false;
  if (loadTasklist(ctx.cycle.directory).length === 0) return false;
  return roundOf(ctx) !== "add" || doneThisRound(ctx, "build-manager", "write");
}

/** 追加設計の回で、報告の時点で未完了のビルドが足されているか */
function addedBuild(ctx: StepContext): string | undefined {
  if (ctx.cycle === undefined || roundOf(ctx) !== "add") return undefined;
  if (loadTasklist(ctx.cycle.directory).some((build) => build.pr.trim() === "")) return undefined;
  return "追加設計なのに、未完了のビルドが tasklist.md にありません。build-manager で指摘に対応するビルドを足してください";
}

/** 追加設計で、指摘への対応に設計の変更が要ると判断したか */
function designChanges(ctx: StepContext): boolean {
  return roundOf(ctx) !== "add" || !skipped(ctx, "design-change");
}

const mode = (ctx: StepContext) => ({ round: roundOf(ctx) });

/** 差し戻しからの再設計の回は、委任の前提が崩れたあとなので G3・G4 をユーザーが行う（US-14.4） */
const ON_RETURN = { timing: "now", reason: "差し戻しからの再設計の回" } as const;

/**
 * options の done の申告（--harm / --paths）。この回の最後の options の done から読む。done が無ければ undefined。
 * 記録の値の形が違えば欠けとして扱う（progress.jsonl の任意欄は読み込みで検査しないので、読む側で同意に倒す）
 */
export function riskDeclaration(ctx: StepContext): { harm?: Harm; paths?: string[] } | undefined {
  const events = currentEvents(ARCHITECT_STEPS, ctx.events).filter(
    (event) => event.skill === "architect" && event.step === "options" && event.result === "done",
  );
  const event = events[events.length - 1];
  return event === undefined ? undefined : declarationOf(event);
}

function declarationOf(event: StepContext["events"][number]): { harm?: Harm; paths?: string[] } {
  const out: { harm?: Harm; paths?: string[] } = {};
  if (event.harm === "高" || event.harm === "中") out.harm = event.harm;
  const paths: unknown = event.paths;
  if (Array.isArray(paths) && paths.length > 0 && paths.every((path) => typeof path === "string" && path.trim() !== "")) {
    out.paths = paths as string[];
  }
  return out;
}

/** 宣言がどこにも無く、厳しさの分からない基準も無い（上限を設けない。G3・G4 は従来どおりプロファイルで決まる） */
function undeclared(ctx: StepContext): boolean {
  const effective = effectiveDeclaration(ctx.config);
  return effective.declaration === undefined && !effective.incomplete;
}

const INCOMPLETE = { timing: "now", reason: "基準の宣言を読めず、AI に任せてよい害の上限が分からない" } as const;

/**
 * 宣言による同意（上限を超えるリスクの受け入れ）。事後同意が有効なら deferred に回せる唯一の種類。
 * premises は、その受け入れの拠り所（上限を決めた軸 app.<axis>、当たった重い領域 area:<name>）
 */
interface Exceeded {
  exceeded: { reason: string; premises: string[]; harm?: Harm };
}

/**
 * G3 の判定の元（ADR approval-kind-in-step-definitions・risk-ceiling-table）。上限を超える受け入れなら Exceeded、
 * それ以外は判定をそのまま返す（差し戻しの回・基準を読めない回・申告の欠けは事後同意に回さない）。
 * withDeclaration が false なら、宣言による同意を含めない（options の done の前に designChoiceGate を返すとき。
 * 申告がまだ無いため）
 */
function g3Base(ctx: StepContext, withDeclaration: boolean): ConsentJudgement | Exceeded {
  if (roundOf(ctx) === "return") return ON_RETURN;
  if (!withDeclaration || passedOver(ctx, "options", "adr")) return false;
  // options の done の前は判定するものが無い（git を読まない。G3 は options の後ろなので位置も変わらない）
  const declared = riskDeclaration(ctx);
  if (declared === undefined) return false;
  const effective = effectiveDeclaration(ctx.config);
  if (effective.incomplete) return INCOMPLETE;
  const declaration = effective.declaration;
  if (declaration === undefined) return false;
  if (declared.harm === undefined || declared.paths === undefined) {
    const missing = [declared.harm === undefined ? "--harm" : "", declared.paths === undefined ? "--paths" : ""].filter(Boolean).join(" と ");
    return { timing: "now", reason: `options の申告（${missing}）が欠けている` };
  }
  const reasons: string[] = [];
  const premises: string[] = [];
  const ceiling = ceilingOf(declaration.axes);
  if (exceeds(declared.harm, ceiling)) {
    reasons.push(`害の申告（${declared.harm}）が上限（${ceiling === "なし" ? "何も任せない" : `${ceiling}まで`}）を超える`);
    premises.push(...ceilingAxes(declaration.axes).map((axis) => `app.${axis}`));
    // 事後同意が無効なら、重い領域の照合（リポジトリ全体のファイル一覧）は判定を変えないので省く。
    // 有効なら、積む事項の前提に当たった領域も要る
    if (ctx.cycle === undefined || !deferredConsent(ctx.config, ctx.cycle.directory).effective) {
      return { exceeded: { reason: reasons[0] as string, premises, harm: declared.harm } };
    }
  }
  // 重い領域のパスに触れる受け入れは、害の重さに関わらず上限を超えるとみなす
  const hit = heavyAreasHit(declaration, declared.paths, repositoryFiles(ctx.config));
  if (hit.length > 0) {
    reasons.push(`申告したパスが重い領域（${hit.map((area) => area.name).join(", ")}）に当たる`);
    premises.push(...hit.map((area) => `area:${area.name}`));
  }
  if (reasons.length === 0) return false;
  return { exceeded: { reason: reasons.join("。"), premises, harm: declared.harm } };
}

function isExceeded(judged: ConsentJudgement | Exceeded): judged is Exceeded {
  return judged !== false && "exceeded" in judged;
}

/**
 * 上限を超える受け入れの時機。事後同意が有効で、step report が自動で積んだ事項（source: step-report、ask が
 * そのゲート、その回の積んだステップの最後の done 以後）があり、その前提がいまの判定の前提をすべて覆うときだけ
 * deferred。覆っていなければ（設計の文書が変わって新しい重い領域に触れた、など）その場で同意を取る。
 * 事項は design/ の decisions.jsonl 1つだけを読む。手順の位置だけを読む経路でも同じ結果を返し、G3・G4 の
 * 位置（step next・Stop フック・conductor parse の現在地）をずらさない（同意ゲートの when と同じ種類の例外）
 */
function timingOf(ctx: StepContext, gate: string, step: string, exceeded: Exceeded["exceeded"]): ConsentJudgement {
  const now = { timing: "now", reason: exceeded.reason } as const;
  if (ctx.cycle === undefined || !deferredConsent(ctx.config, ctx.cycle.directory).effective) return now;
  const events = currentEvents(ARCHITECT_STEPS, ctx.events).filter((event) => event.skill === "architect" && event.step === step && event.result === "done");
  const since = events[events.length - 1]?.at;
  if (since === undefined) return now;
  let items;
  try {
    items = readUnitLedger(ctx.cycle.directory, "architect").items;
  } catch {
    return now;
  }
  const covered = items.some(
    ({ open }) =>
      open.source === "step-report" && open.type === "risk" && open.ask === gate && open.at >= since &&
      exceeded.premises.every((premise) => open.premises?.includes(premise) === true) &&
      // ユーザーが退けた事項は、もう同意を遅らせる根拠にならない（その場の同意に戻す）
      latestDecision(items, open.id) !== "rejected",
  );
  return covered ? { timing: "deferred", reason: `${exceeded.reason}（事後同意: マージの前の同意ゲートで同意を取る）` } : now;
}

function latestDecision(items: { open: { id: string }; latest?: { decision: string } | undefined }[], id: string): string | undefined {
  return items.find((item) => item.open.id === id)?.latest?.decision;
}

function g3Consent(ctx: StepContext, withDeclaration: boolean): ConsentJudgement {
  const judged = g3Base(ctx, withDeclaration);
  return isExceeded(judged) ? timingOf(ctx, "G3", "options", judged.exceeded) : judged;
}

/** 事後同意で積む受け入れ（事後同意が有効で、上限を超える受け入れの回だけ） */
function deferredRisk(ctx: StepContext, gate: string, step: string, judged: ConsentJudgement | Exceeded, summary: string): DeferredRisk | undefined {
  if (!isExceeded(judged) || ctx.cycle === undefined) return undefined;
  if (!deferredConsent(ctx.config, ctx.cycle.directory).effective) return undefined;
  const risk: DeferredRisk = { gate, step, summary: `${summary}: ${judged.exceeded.reason}`, premises: judged.exceeded.premises };
  if (judged.exceeded.harm !== undefined) risk.harm = judged.exceeded.harm;
  return risk;
}

/** 設計が触れた重い領域のうち、G3 の申告（--paths）に当たっていないもの */
interface UndeclaredArea {
  name: string;
  /** その領域に当たった、設計の文書が触れたパス */
  touched: string[];
}

/**
 * G3 の申告の裏取り。design-delta.md とこのサイクルの ADR が触れるパスを重い領域と照合し、G3 の申告が
 * 当たっている領域を除く。申告が領域に当たるかは G3 と同じ heavyAreasHit・同じファイル一覧で見る。
 * options をスキップした回・--paths が無い回は、申告を空とみなす。ADR の一覧を読めなければ Error を返す
 */
function undeclaredAreas(ctx: StepContext): UndeclaredArea[] | Error {
  // 1回の評価で consent・args・notices から何度も呼ばれる（git と ADR の読み込みを繰り返さない）
  const cached = areasCache.get(ctx.events);
  if (cached !== undefined) return cached;
  const result = computeUndeclaredAreas(ctx);
  areasCache.set(ctx.events, result);
  return result;
}

const areasCache = new WeakMap<StepContext["events"], UndeclaredArea[] | Error>();

/**
 * その回で、ゲートの前のステップ（before）の最後の done より後に、ゲートの後のステップ（after）の done があるか。
 * failed は数えない（中断したあとに直した文書や、同意として受けた承認を、通り過ぎたものとして扱わないため）。
 * あれば、ゲートはその時点の判定で通り過ぎている。宣言による同意は、通り過ぎたあとに宣言や設計の文書が
 * 変わっても付け直さない（付け直すと、承認の記録の無いゲートが現在地に戻り、後ろの作業がやり直しになる）。
 * 前のステップを報告し直せば、また判定する
 */
function passedOver(ctx: StepContext, before: string, after: string): boolean {
  const events = currentEvents(ARCHITECT_STEPS, ctx.events);
  const last = events.findLastIndex((event) => event.skill === "architect" && event.step === before && event.result === "done");
  if (last === -1) return false;
  return events.slice(last + 1).some((event) => event.skill === "architect" && event.step === after && event.result === "done");
}

function computeUndeclaredAreas(ctx: StepContext): UndeclaredArea[] | Error {
  const declaration = effectiveDeclaration(ctx.config).declaration;
  if (declaration === undefined) return [];
  const read = designTouchedPaths(ctx.config, ctx.unitDirectory);
  if (read instanceof Error) return read;
  const touched = read.touched;
  const files = repositoryFiles(ctx.config);
  const covered = new Set(heavyAreasHit(declaration, declaredPaths(ctx), files).map((area) => area.name));
  return declaration.areas
    .filter((area) => !covered.has(area.name))
    .map((area) => ({ name: area.name, touched: touched.filter((path) => area.paths.some((own) => overlaps(own, path, files))) }))
    .filter((area) => area.touched.length > 0);
}

/**
 * 申告として数えるパス。この回の options をスキップした・--paths が無いときは、この回の分は空とみなす。
 * 前の回（追加設計より前の設計など）の options の申告も足す。design-delta.md と ADR はサイクルで積み上がるので、
 * 前の回に G3 で申告した領域まで、この回の申告に無いとして毎回上げないため
 */
function declaredPaths(ctx: StepContext): string[] {
  const own = skipped(ctx, "options") ? [] : (riskDeclaration(ctx)?.paths ?? []);
  const current = new Set(currentEvents(ARCHITECT_STEPS, ctx.events));
  const earlier = ctx.events
    .filter((event) => !current.has(event) && event.skill === "architect" && event.step === "options" && event.result === "done")
    .flatMap((event) => declarationOf(event).paths ?? []);
  return [...own, ...earlier];
}

/** G4 の境界の照合（boundaryChanges が config ごとに持つので、consent・args・notices から呼び直してよい） */
function boundaries(ctx: StepContext): BoundaryChanges | Error {
  return boundaryChanges(ctx.config, ctx.unitDirectory);
}

/**
 * 外との境界による同意。外との境界はユーザーが同意するもので、事後同意（deferred）には回さない。
 * [app] の宣言の有無に関わらず判定する（[boundaries] だけを宣言したワークスペースでも効かせる）。
 * Error は境界を宣言しているときだけ返る（宣言が無ければ ADR を読まない）
 */
function boundaryConsent(ctx: StepContext): ConsentJudgement {
  const changes = boundaries(ctx);
  if (changes instanceof Error) return { timing: "now", reason: "外との境界を照合できない（このサイクルの ADR を読めない）" };
  if (changes.unverified) return { timing: "now", reason: "基準の [boundaries] を確かめられず、作業ツリーの境界が狭められていないかが分からない" };
  if (changes.external.length > 0) {
    return { timing: "now", reason: `設計が外との境界（${changes.external.map((hit) => hit.boundary).join(", ")}）に触れている` };
  }
  return false;
}

/** G3 の申告の裏取りの結果（G4 の args と gate brief G4 が使う）。[app] の宣言が無ければ空で verified */
export function g4Verification(ctx: StepContext): { undeclaredAreas: UndeclaredArea[]; verified: boolean } {
  if (undeclared(ctx)) return { undeclaredAreas: [], verified: true };
  const areas = undeclaredAreas(ctx);
  return areas instanceof Error ? { undeclaredAreas: [], verified: false } : { undeclaredAreas: areas, verified: true };
}

function g4Consent(ctx: StepContext): ConsentJudgement {
  const judged = g4Base(ctx);
  return isExceeded(judged) ? timingOf(ctx, "G4", "design-delta", judged.exceeded) : judged;
}

/**
 * G4 の判定の元。順序は build-12 のまま（差し戻し → design-delta の前 → 通り過ぎた → 外との境界 → 基準を読めない →
 * 宣言なし → 裏取り）。外との境界はユーザーが同意するもので、事後同意に回さないので、裏取りより先に now を返す。
 * Exceeded になるのは最後の裏取りの分岐だけ
 */
function g4Base(ctx: StepContext): ConsentJudgement | Exceeded {
  if (roundOf(ctx) === "return") return ON_RETURN;
  // design-delta の done の前は裏取りするものが無い（git を読まない。G4 は design-delta の後ろなので位置も変わらない）
  if (!doneThisRound(ctx, "architect", "design-delta")) return false;
  if (passedOver(ctx, "design-delta", "build-split")) return false;
  const boundary = boundaryConsent(ctx);
  if (boundary !== false) return boundary;
  if (effectiveDeclaration(ctx.config).incomplete) return INCOMPLETE;
  if (undeclared(ctx)) return false;
  const areas = undeclaredAreas(ctx);
  if (areas instanceof Error) return { timing: "now", reason: "G3 の申告を裏取りできない（このサイクルの ADR を読めない）" };
  if (areas.length > 0) {
    return {
      exceeded: {
        reason: `設計が G3 の申告に無い重い領域（${areas.map((area) => area.name).join(", ")}）に触れている`,
        premises: areas.map((area) => `area:${area.name}`),
      },
    };
  }
  return false;
}

/** 基準の宣言を読めなかったこと。宣言がどこにも無く、厳しさの分からない基準も無い回は出さない（提示を変えない） */
function declarationNotices(ctx: StepContext): string[] {
  if (undeclared(ctx)) return [];
  return effectiveDeclaration(ctx.config).notices;
}

const G3: StepDefinition = {
  id: "G3",
  kind: "gate",
  title: "設計案の選択",
  when: (ctx) => designChanges(ctx) && !skipped(ctx, "options"),
  enabled: (ctx) => ctx.config.gates.designChoice,
  consent: (ctx) => g3Consent(ctx, true),
  notices: declarationNotices,
  ask: "G3",
};

/**
 * その回に設計案の選択（G3）をユーザーが行うか。false なら options・adr は推奨案をそのまま採る。
 * express でも再設計の回は G3 が同意として入るので、設定の値だけでは決めない。
 * options の done がまだ無い間は、宣言による同意を含めない（申告が無いので判定できない。done のあと
 * G3 が同意になれば、G3 で提示する）。
 * options をスキップした回でも false にしない（構造の条件 when は見ない。案が無いだけで、
 * 推奨案を黙って採ったわけではないため）
 */
const designChoiceGate = (ctx: StepContext) => {
  // 手順の位置だけを読む経路は値を使わないので、git を読む宣言の判定を省く
  const consent = g3Consent(ctx, ctx.positionOnly !== true && riskDeclaration(ctx) !== undefined);
  return { designChoiceGate: (consent !== false && consent.timing === "now") || G3.enabled?.(ctx) !== false };
};

export const ARCHITECT_STEPS: SkillSteps = {
  skill: "architect",
  unit: (phase) => (phase === "architect" ? "design" : undefined),
  rounds: ROUNDS,
  // 差し戻し中なのに再設計の回を始めていなければ、前回の記録のまま進めない
  stop: (ctx) => {
    if (ctx.cycle === undefined) return undefined;
    const record = readReturn(ctx.cycle.directory);
    if (record === undefined) return undefined;
    // 再設計の回の途中なら進める。その回で差し戻しを解決したあとの return.md は、新しい差し戻し
    const resolved = roundOf(ctx) === "return" && doneThisRound(ctx, "architect", "resolve-return");
    if (roundOf(ctx) === "return" && !resolved) return undefined;
    const build = record.buildId === undefined ? "build-NN" : buildDirName(record.buildId);
    const cli = `node "${join(pluginRoot(), "scripts", "hikyaku.mts")}"`;
    if (record.problems.length > 0) {
      // 欠けたままでは step restart --round return が受け付けない。区切る前に直させる
      return [
        `このブランチは architect に差し戻されていますが、差し戻しの記録が欠けています（${RETURN_FILE}）。`,
        describeEscalationProblems(record.problems),
        `${RETURN_FILE} を直してから、再設計の回を区切ってください:`,
        `  ${cli} step restart architect ${ctx.cycle.name} --round return --reason "${build} からの差し戻し"`,
      ].join("\n");
    }
    return [
      resolved
        ? `前の再設計で差し戻しを解決したあと、もう一度 architect に差し戻されています（${RETURN_FILE}）。新しい再設計の回を区切ってから始めてください:`
        : `このブランチは architect に差し戻されています（${RETURN_FILE}）。再設計の回を区切ってから始めてください:`,
      `  ${cli} step restart architect ${ctx.cycle.name} --round return --reason "${build} からの差し戻し"`,
    ].join("\n");
  },
  steps: [
    {
      // 差し戻しは委任の前提が崩れた出来事なので、再設計の回の先頭で委任を続けるかを尋ねる（US-14.2）
      id: "delegation",
      kind: "gate",
      title: "委任を続けるかの確認（差し戻しのあと）",
      when: (ctx) => roundOf(ctx) === "return",
      consent: () => ({ timing: "now", reason: "委任の前提が崩れた出来事（差し戻し）のあと" }),
      ask: "delegation",
    },
    {
      id: "design-change",
      kind: "run",
      title: "指摘への対応に設計の変更が要るかの判断（追加設計）",
      when: (ctx) => roundOf(ctx) === "add",
      // 設計の変更が要らなければスキップし、ビルドの追加へ進む
      skippable: true,
    },
    {
      id: "cycle-scan",
      kind: "run",
      title: "並行サイクルの確認（cycle-scanner）",
      when: (ctx) => roundOf(ctx) !== "add" && otherActiveCycles(ctx),
    },
    {
      id: "survey",
      kind: "run",
      title: "既存コードベースの差分調査と codebase-survey.md の作成",
      when: (ctx) => roundOf(ctx) !== "add",
      produces: ["codebase-survey.md"],
      // 既存コードが無い（新規開発）なら調査しない
      skippable: true,
      args: mode,
    },
    {
      id: "G2",
      kind: "gate",
      title: "codebase-survey.md の確認",
      when: (ctx) => roundOf(ctx) !== "add" && !skipped(ctx, "survey"),
      enabled: (ctx) => ctx.config.gates.codebaseSurvey,
      consent: false,
      ask: "G2",
    },
    { id: "questions", kind: "run", title: "設計に関する質問（反復ループ）", when: designChanges, args: mode },
    {
      id: "options",
      kind: "run",
      title: "主要な設計判断の特定と、分岐がある判断の案の生成（code-architect）",
      when: designChanges,
      // 分岐がある判断が無ければ、案の生成・G3・ADR を行わない
      skippable: true,
      // G3 に提示する案のうち最も重い害と、全案が触れるパス（G3 の同意の判定と G4 の裏取りに使う）
      declaresRisk: true,
      // 事後同意が有効で G3 が上限を超える受け入れになる回は、止まらずに risk の事項として積む（US-20.2）
      defers: (ctx) => deferredRisk(ctx, "G3", "options", g3Base(ctx, true), "G3 の設計案の選択"),
      args: designChoiceGate,
    },
    G3,
    {
      id: "adr",
      kind: "run",
      title: "採用案を ADR に追記",
      when: (ctx) => designChanges(ctx) && !skipped(ctx, "options"),
      args: designChoiceGate,
    },
    {
      id: "design-delta",
      kind: "run",
      title: "design-delta.md の作成",
      when: designChanges,
      produces: ["design-delta.md"],
      // 設計が G3 の申告に無い重い領域に触れる回は、事後同意が有効なら risk の事項として積む（外との境界は積まない）
      defers: (ctx) => deferredRisk(ctx, "G4", "design-delta", g4Base(ctx), "G4 の設計ドキュメントの承認"),
      args: mode,
    },
    {
      id: "architecture-review",
      kind: "run",
      title: "doc-reviewer による設計のレビュー",
      when: (ctx) => designChanges(ctx) && ctx.config.reviews.architecture,
    },
    {
      id: "G4",
      kind: "gate",
      title: "設計ドキュメントの承認",
      when: designChanges,
      enabled: (ctx) => ctx.config.gates.architecture,
      consent: g4Consent,
      // 当たった領域を G4 の提示に使う（宣言が無ければ空）。手順の位置だけを読む経路では組み立てない
      // 提示の正は gate brief G4。args は G4.md と conductor の分岐に使う。境界は [app] の宣言の有無より先に組む
      args: (ctx) => {
        if (ctx.positionOnly === true) return { undeclaredAreas: [] };
        const changes = boundaries(ctx);
        const boundaryArgs = changes instanceof Error
          ? { boundaries: { declared: true, external: [], internal: [], error: changes.message } }
          : { boundaries: { declared: changes.declared, external: changes.external, internal: changes.internal } };
        const verification = g4Verification(ctx);
        // 裏取りできなかった回は、領域が空でも同意になる。提示で取り違えないよう、そのことを値でも示す
        return verification.verified ? { undeclaredAreas: verification.undeclaredAreas, ...boundaryArgs } : { ...verification, ...boundaryArgs };
      },
      notices: (ctx) => {
        const changes = boundaries(ctx);
        // 境界を理由に同意にした回だけ、その旨を出す（差し戻しの回・design-delta の前は境界で判定していない）
        const judgement = g4Consent(ctx);
        const byBoundary = judgement !== false && judgement.reason === (boundaryConsent(ctx) || undefined)?.reason;
        const boundaryNotices = changes instanceof Error
          ? (byBoundary ? [`外との境界を照合できないので、G4 を同意にしています: ${changes.message}`] : [])
          : changes.notices.filter((notice) => !notice.startsWith(DESIGN_DELTA) && (byBoundary || !notice.startsWith(UNVERIFIED_NOTICE)));
        const notices = [...declarationNotices(ctx), ...boundaryNotices];
        if (undeclared(ctx)) return notices;
        const areas = undeclaredAreas(ctx);
        return areas instanceof Error ? [...notices, `G3 の申告を裏取りできないので、G4 を同意にしています: ${areas.message}`] : notices;
      },
      ask: "G4",
    },
    {
      id: "build-split",
      kind: "call",
      title: "ビルド分割（build-manager）",
      call: "build-manager",
      evidence: splitRecorded,
      accepts: addedBuild,
      reason: (ctx) =>
        ({
          design: "設計に基づいてビルドを分割し、tasklist.md と issue.md を作る（G6 は build-manager が取る）",
          return: "差し戻し元のビルドと、影響を受けるビルドを更新する（G6 は build-manager が取る）",
          add: "指摘に対応するビルドを追加する。完了済みのビルドは更新しない（G6 は build-manager が取る）",
        })[roundOf(ctx)],
      args: mode,
    },
    { id: "validate", kind: "run", title: "受け入れ基準の割り当てと記録の検証" },
    {
      id: "retrospective",
      kind: "call",
      title: "振り返り",
      call: "retrospective",
      when: (ctx) => ctx.config.reviews.retrospective !== "skip",
      reason: () => "設計フェーズの最後の振り返り",
    },
    {
      id: "resolve-return",
      kind: "run",
      title: "差し戻しの解決（return.md と古い plan.md / test-spec.md の削除）",
      when: (ctx) => roundOf(ctx) === "return",
      evidence: (ctx) => ctx.cycle !== undefined && !existsSync(join(ctx.cycle.directory, RETURN_FILE)),
    },
    consentStep("architect", (ctx) => roundOf(ctx) !== "return"),
    {
      id: "pr",
      kind: "run",
      title: "PR の作成とレビュアーのアサイン",
      when: (ctx) => roundOf(ctx) !== "return",
      recordsPr: true,
      accepts: consentProblem("architect"),
      args: (ctx) => ({ ...designChoiceGate(ctx), round: roundOf(ctx), ...declarationArgs(ctx) }),
    },
    publicationStep("architect", (ctx) => roundOf(ctx) !== "return"),
  ],
};
