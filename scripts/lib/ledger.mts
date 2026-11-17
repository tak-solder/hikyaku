/**
 * 未決事項と決定の記録（decisions.jsonl）— ADR 20261116-pending-items-ledger。
 *
 * 作業単位（planning/・design/・build-NN/・サイクル直下・patches/{YYYYMM}/{slug}/）ごとに追記型の
 * decisions.jsonl を置き、hikyaku ledger だけが書く。レコードは2種類:
 *
 *   open    事項（question / provisional / objection / risk）。記録した作業単位のファイルに書く
 *   decide  決定（decided / consented / rejected / resolved）。決めた作業単位のファイルに書く
 *
 * 決定を事項のファイルではなく決めた単位のファイルに書くのは、並行するビルドが前のフェーズの
 * 事項にそれぞれ決定を足しても、同じファイルへの追記にならず、マージで衝突しないため。
 * 事項と決定は ID で結び、状態（決まったか・期限が来たか）はサイクルの全ファイルと
 * progress.jsonl から毎回導く。状態を表す欄は持たない。
 *
 * 付け替えの禁止: who を変えるレコードは無い。同じ ID の2回目の open はエラー。
 * who=user の事項はユーザーだけが決められる（by=user は --input 必須）。
 *
 * 期限の判定（timingOf）がこのサイクルの期限の唯一の正。PR 本文の節（build-06）もこれを呼ぶ。
 */

import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isPhase, type Phase } from "./branch.mts";
import { ANSWER_ENV, needsRiskDeclaration } from "./conductor.mts";
import { HikyakuError } from "./errors.mts";
import { appendJsonl, parseJsonl, readJsonl, type JsonlLabels } from "./jsonl.mts";
import { listPatchUnits, patchPhaseOf, patchUnitDirectory } from "./patch.mts";
import { readProgress, RESTART, type ProgressEvent } from "./progress.mts";
import type { Harm } from "./risk.mts";
import type { ResolvedConfig } from "./config.mts";
import { currentEvents, evaluate, type SkillSteps } from "./steps/engine.mts";
import type { CycleContext } from "./workspace.mts";
import { ownerOf, SKILL_STEPS } from "./steps/index.mts";
import { buildDirName, normalizeBuildId, type BuildRecord } from "./tasklist.mts";

export const LEDGER_FILE = "decisions.jsonl";

export type ItemType = "question" | "provisional" | "objection" | "risk";
export const ITEM_TYPES: ItemType[] = ["question", "provisional", "objection", "risk"];
export type Decision = "decided" | "consented" | "rejected" | "resolved";
export const DECISIONS: Decision[] = ["decided", "consented", "rejected", "resolved"];
export const HARMS: Harm[] = ["高", "中"];
/**
 * 異議へのユーザーの決定。consented は異議を聞いたうえで選択どおりに進める（受け入れる）、
 * decided はユーザーが選択を改めた（受け入れるものが無い）
 */
export const OBJECTION_DECISIONS: Decision[] = ["consented", "decided"];

/** 「誰が」: user / ai:<phase> / supervisor */
export type Who = "user" | `ai:${string}` | "supervisor";

export interface OpenRecord {
  record: "open";
  at: string;
  id: string;
  /** 事項を記録した作業単位（plan / architect / build-NN / close / create / patch-YYYYMM-slug） */
  unit: string;
  /**
   * 記録したときのその単位の現在のステップ（内部スキルの最中なら呼ばれた側のステップ）。
   * 回は at と progress.jsonl の restart の記録から導く
   */
  step?: string;
  type: ItemType;
  summary: string;
  /** 正規化した「いつ」（gate・merge は @unit を補って保存する） */
  when: string;
  who: Who;
  /** 拠り所にした外の前提の参照 */
  premises?: string[];
  /** 異議の根拠（食い違う宣言・記録。ledger object が書く） */
  basis?: string;
  /** 失うもの（退けた安全側の案の利点） */
  loses?: string;
  harm?: Harm;
  /** 問いの ID（conductor の ASKS かゲートの ID） */
  ask?: string;
  /**
   * step report が自動で書いた事項（G3・G4 の事後同意の risk）。ledger open には欄の指定が無いので、手書きの事項には
   * 付かない。G3・G4 を deferred にする条件（steps/architect.mts）は、この欄のある事項だけを数える
   */
  source?: "step-report";
  /**
   * 異議の害が上限を超えると ledger object / ledger open が判定した（US-13.3）。害が中でも高と同じに扱い、
   * 受け入れには言葉と前提が要る（isHighObjection）
   */
  exceedsCeiling?: true;
  session?: string;
  hikyaku?: string;
}

export interface DecideRecord {
  record: "decide";
  at: string;
  id: string;
  /** 決めた作業単位（このレコードを置くファイル） */
  unit: string;
  decision: Decision;
  by: Who;
  /** ユーザーの答え（by=user で必須） */
  input?: string;
  /** ユーザーが受け入れると書いた言葉 */
  accepts?: string;
  reason?: string;
  /** 答えの出どころ（conductor の子で HIKYAKU_ANSWER_FROM の値） */
  from?: string;
  /** 監督の答えの問いの ID（conductor の子で HIKYAKU_ANSWER_ASK の値） */
  ask?: string;
  /** 監督の答えの値（HIKYAKU_ANSWER_CHOICE の値） */
  choice?: string;
  /** 監督の答えが受け入れるリスクの申告（HIKYAKU_ANSWER_RISK の値。子が省けない） */
  risk?: RiskDeclaration;
  /** 監督の答えを渡した起動の印（HIKYAKU_ANSWER_TOKEN。conductor parse --expect-answer が照合する） */
  token?: string;
  /** ledger object の決定が閉じる、ユーザーの答えを待っていた事項の ID（conductor の子の --answers） */
  answers?: string;
  session?: string;
  hikyaku?: string;
}

/** 監督の答えのリスクの申告。none は --no-risk */
export type RiskDeclaration = { kind: "none" } | { kind: "declared"; harm: Harm; premises: string[] };

export type LedgerRecord = OpenRecord | DecideRecord;

const LABELS: JsonlLabels = {
  writer: "decisions.jsonl は hikyaku ledger だけが追記します。",
  shape: "未決事項の記録",
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is LedgerRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (!isString(r["at"]) || !isString(r["id"]) || !isString(r["unit"])) return false;
  if (r["record"] === "open") {
    return (
      ITEM_TYPES.includes(r["type"] as ItemType) && isString(r["summary"]) && isString(r["when"]) && isString(r["who"]) &&
      (r["premises"] === undefined || (Array.isArray(r["premises"]) && r["premises"].every(isString)))
    );
  }
  if (r["record"] === "decide") {
    return DECISIONS.includes(r["decision"] as Decision) && isString(r["by"]);
  }
  return false;
}

// ---------------------------------------------------------------------------
// 誰が

export function parseWho(raw: string): Who {
  const value = raw.trim();
  if (value === "user" || value === "supervisor") return value;
  const phase = value.startsWith("ai:") ? normalizeUnit(value.slice(3)) : undefined;
  if (phase !== undefined) return `ai:${phase}`;
  throw new HikyakuError(
    `「誰が」の値が不正です: ${raw}`,
    "使用できる値: user | ai:<フェーズ>（ai:architect / ai:build-03 など）| supervisor",
  );
}

export function whoLabel(who: string): string {
  if (who === "user") return "ユーザー";
  if (who === "supervisor") return "監督";
  if (who.startsWith("ai:")) return `AI（${who.slice(3)}）`;
  return who;
}

/**
 * 付け替えの禁止。who=user の事項はユーザーだけが決められる。ユーザーはどの事項も決められる
 * （ai・supervisor の事項でも、決める権限をユーザーから取り上げない）。それ以外は who と同じ決め手だけ
 * （ai:architect の事項を ai:build-05 は決められない）。by=user は答え（input）が必須
 */
export function assertDecider(item: Pick<OpenRecord, "id" | "who">, by: Who, input: string | undefined): void {
  if (by === "user") {
    if (input === undefined || input.trim() === "") {
      throw new HikyakuError("--by user には --input でユーザーの答えを添えてください");
    }
    return;
  }
  if (item.who !== by) {
    throw new HikyakuError(
      `${item.id} は ${whoLabel(item.who)} が決める事項です。${whoLabel(by)} は決められません`,
      item.who === "user"
        ? "ユーザーが決める事項を、AI や監督が決める事項に付け替える手順はありません。ユーザーに尋ねてください。"
        : "決める人を変える手順はありません。",
    );
  }
}

// ---------------------------------------------------------------------------
// 答えの出どころ（conductor の子）— US-19.7・US-15.3

/** 子に渡された答え（conductor launch が置いた環境変数）。conductor の子でなければ undefined */
export interface ChildAnswer {
  from: "user" | "supervisor" | undefined;
  /** --from user の --closes の ID。子の中の --by user は、この ID の事項にだけ書ける */
  items: string[];
  ask?: string;
  choice?: string;
  risk?: RiskDeclaration;
  token?: string;
}

/** HIKYAKU_ANSWER_RISK の値を読む（none か <害>:<前提,...>）。読めなければ undefined（申告なしとして扱う） */
export function parseRiskDeclaration(raw: string | undefined): RiskDeclaration | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = raw.trim();
  if (value === "none") return { kind: "none" };
  const separator = value.indexOf(":");
  if (separator === -1) return undefined;
  const harm = value.slice(0, separator) as Harm;
  if (!HARMS.includes(harm)) return undefined;
  const premises = value.slice(separator + 1).split(",").map((premise) => premise.trim()).filter((premise) => premise !== "");
  return { kind: "declared", harm, premises };
}

/** RiskDeclaration を HIKYAKU_ANSWER_RISK の値にする */
export function formatRiskDeclaration(risk: RiskDeclaration): string {
  return risk.kind === "none" ? "none" : `${risk.harm}:${risk.premises.join(",")}`;
}

export function childAnswer(env: NodeJS.ProcessEnv = process.env): ChildAnswer | undefined {
  // steps/consent.mts の isConductorChild と同じ判定（consent.mts はこのファイルを読み込むので、循環を避けて直接見る）
  if (env["HIKYAKU_CONDUCTOR_CHILD"] !== "1") return undefined;
  const text = (key: string): string | undefined => {
    const value = env[key];
    return value === undefined || value.trim() === "" ? undefined : value.trim();
  };
  const fromRaw = text(ANSWER_ENV.from);
  const risk = parseRiskDeclaration(text(ANSWER_ENV.risk));
  const ask = text(ANSWER_ENV.ask);
  const choice = text(ANSWER_ENV.choice);
  const token = text(ANSWER_ENV.token);
  return {
    from: fromRaw === "user" || fromRaw === "supervisor" ? fromRaw : undefined,
    items: (text(ANSWER_ENV.items) ?? "").split(",").map((id) => id.trim()).filter((id) => id !== ""),
    ...(ask === undefined ? {} : { ask }),
    ...(choice === undefined ? {} : { choice }),
    ...(risk === undefined ? {} : { risk }),
    ...(token === undefined ? {} : { token }),
  };
}

/**
 * conductor の子で、この決定を書いてよいか。だめなら理由。
 * --by user は、ユーザーの答えで再開した子（HIKYAKU_ANSWER_FROM=user）が、--closes で渡された事項にだけ書ける
 * （ユーザーが答えていない事項に、同じ実行の中で書けない）。--by supervisor は監督の答えで再開した子だけが書け、
 * 申告の要る答えでは申告が渡っていること。子が環境変数を自分で付ける偽装は防がない（ADR pending-items-ledger）
 */
export function answerProblem(by: Who, itemId: string, answer: ChildAnswer | undefined): string | undefined {
  if (answer === undefined) return undefined;
  if (by === "user") {
    if (answer.from !== "user") {
      return "conductor の子では、ユーザーの答えで再開されたとき（HIKYAKU_ANSWER_FROM=user）だけ --by user を記録できます。ユーザーに上げる問いは記録して blocked で終えてください";
    }
    if (!answer.items.includes(itemId)) {
      return `${itemId} はユーザーが答えた事項（${answer.items.join(", ") || "なし"}）にありません。ユーザーが答えていない事項に --by user は記録できません`;
    }
    return undefined;
  }
  if (by === "supervisor") {
    if (answer.from !== "supervisor") {
      return "conductor の子では、監督の答えで再開されたとき（HIKYAKU_ANSWER_FROM=supervisor）だけ --by supervisor を記録できます";
    }
    if (answer.risk === undefined && needsRiskDeclaration(answer.ask, answer.choice)) {
      return `この答え（${answer.ask ?? "問い不明"}${answer.choice === undefined ? "" : ` / ${answer.choice}`}）にはリスクの申告が要りますが、起動に申告がありません。監督に申告つきで再開してもらってください`;
    }
  }
  return undefined;
}

/** 決定のレコードに足す欄。子でなければ空（ユーザーが直接立てたセッションは何も足さない） */
export function answerFields(by: Who, answer: ChildAnswer | undefined): Partial<DecideRecord> {
  if (answer === undefined || answer.from === undefined) return {};
  if (by === "user") return { from: answer.from };
  if (by !== "supervisor") return {};
  return {
    from: answer.from,
    ...(answer.ask === undefined ? {} : { ask: answer.ask }),
    ...(answer.choice === undefined ? {} : { choice: answer.choice }),
    ...(answer.risk === undefined ? {} : { risk: answer.risk }),
    ...(answer.token === undefined ? {} : { token: answer.token }),
  };
}

/** ユーザーの答えを待つ事項か: question・who=user・when=now で、決定が無い（答えを待つ blocked と conductor waiting が使う） */
export function isWaitingItem(item: LedgerItem): boolean {
  return item.open.type === "question" && item.open.who === "user" && item.open.when === "now" && item.latest === undefined;
}

// ---------------------------------------------------------------------------
// 前提の参照

/** 前提の参照 `app.<key>` に使える [app] のキー（premises.mts の宣言の差分も同じものを使う） */
export const APP_KEYS = ["exposure", "data", "impact", "merge_gate"];

export type Premise =
  | { kind: "app"; key: string }
  | { kind: "area"; name: string }
  | { kind: "constraints"; anchor: string }
  | { kind: "adr"; file: string }
  | { kind: "assumption"; text: string };

const PREMISE_HINT =
  "書式: app.exposure | app.data | app.impact | app.merge_gate | area:<name> | constraints#<anchor> | adr:<file> | assumption:<短い文>";

export function parsePremise(raw: string): Premise {
  const value = raw.trim();
  const rest = (prefix: string): string | undefined => (value.startsWith(prefix) ? value.slice(prefix.length).trim() : undefined);
  const app = rest("app.");
  if (app !== undefined && APP_KEYS.includes(app)) return { kind: "app", key: app };
  const area = rest("area:");
  if (area !== undefined && area !== "") return { kind: "area", name: area };
  const anchor = rest("constraints#");
  if (anchor !== undefined && anchor !== "") return { kind: "constraints", anchor };
  const adr = rest("adr:");
  if (adr !== undefined && adr !== "") return { kind: "adr", file: adr };
  const assumption = rest("assumption:");
  if (assumption !== undefined && assumption !== "") return { kind: "assumption", text: assumption };
  throw new HikyakuError(`前提の参照の書式が不正です: ${raw}`, PREMISE_HINT);
}

/** カンマ区切りの前提の参照。区切りにカンマを使うので、assumption の文中にカンマは書けない */
export function parsePremises(raw: string): string[] {
  const parts = raw.split(",").map((part) => part.trim());
  for (const part of parts) parsePremise(part);
  return parts;
}

// ---------------------------------------------------------------------------
// いつ

export type When =
  | { kind: "now" }
  | { kind: "phase"; phase: string }
  | { kind: "gate"; gate: string; unit: string }
  | { kind: "merge"; unit: string }
  | { kind: "close" };

/** 参照先の検査に使う、サイクルの実在する単位 */
export interface RefContext {
  cycleDirectory: string;
  builds: BuildRecord[];
  /** 事項を記録する作業単位 */
  opening: string;
}

const WHEN_HINT = "使用できる値: now | phase:<フェーズ> | gate:<G?>[@<作業単位>] | merge[@<作業単位>] | close";
/** 固定のフェーズ。gate の @unit を省いたとき、ゲートを持つスキルがこれを担えばそれを補う */
const FIXED_UNITS = ["plan", "architect", "close", "create"] as const;

/** 作業単位を正規化する（build-3 → build-03）。フェーズでなければ undefined */
function normalizeUnit(raw: string): string | undefined {
  const value = raw.trim();
  if (/^build-\d+$/i.test(value)) return buildDirName(normalizeBuildId(value));
  return isPhase(value) ? value : undefined;
}

/** サイクルに実在する作業単位か */
export function unitExists(unit: string, ctx: Pick<RefContext, "cycleDirectory" | "builds">): boolean {
  if ((FIXED_UNITS as readonly string[]).includes(unit)) return true;
  if (unit.startsWith("build-")) {
    return ctx.builds.some((build) => buildDirName(normalizeBuildId(build.id)) === unit);
  }
  const patch = patchUnitDirectory(unit);
  return patch !== undefined && existsSync(join(ctx.cycleDirectory, patch));
}

function requireUnit(raw: string, ctx: RefContext): string {
  const unit = normalizeUnit(raw);
  if (unit === undefined || unit === "init" || unit === "token-guide" || unit === "conductor" || !unitExists(unit, ctx)) {
    throw new HikyakuError(
      `「いつ」の参照先がこのサイクルにありません: ${raw}`,
      "plan / architect / close / create、tasklist.md にあるビルド（build-NN）、このサイクルの patch（patch-YYYYMM-slug）を指定してください。",
    );
  }
  return unit;
}

/** ゲートの ID（G1〜・P1〜）を持つスキル */
export function gateOwners(gate: string): SkillSteps[] {
  return SKILL_STEPS.filter((skill) => skill.steps.some((step) => step.kind === "gate" && step.id === gate));
}

/** ゲートの ID の一覧 */
export function gateIds(): string[] {
  return [
    ...new Set(
      SKILL_STEPS.flatMap((skill) => skill.steps.filter((step) => step.kind === "gate" && /^[GP]\d+$/.test(step.id)).map((step) => step.id)),
    ),
  ];
}

/** そのスキルのゲートを、その作業単位が担うか。内部スキルは、それを呼ぶスキルが担う単位で担う */
function handles(skill: SkillSteps, unit: string): boolean {
  if (skill.internal !== true) return skill.unit?.(unit as Phase) !== undefined;
  return SKILL_STEPS.some(
    (caller) => caller.steps.some((step) => step.kind === "call" && step.call === skill.skill) && caller.unit?.(unit as Phase) !== undefined,
  );
}

export function parseWhen(raw: string, ctx: RefContext): When {
  const value = raw.trim();
  if (value === "now") return { kind: "now" };
  if (value === "close") return { kind: "close" };
  if (value.startsWith("phase:")) {
    const unit = requireUnit(value.slice("phase:".length), ctx);
    if (unit === "create") throw new HikyakuError("phase:create は指定できません（サイクルの作成はもう終わっています）");
    return { kind: "phase", phase: unit };
  }
  if (value === "merge" || value.startsWith("merge@")) {
    const unit = value === "merge" ? ctx.opening : requireUnit(value.slice("merge@".length), ctx);
    if (unit === "create") throw new HikyakuError("merge@create は指定できません（サイクルの作成はもう終わっています）");
    return { kind: "merge", unit };
  }
  if (value.startsWith("gate:")) {
    const [gate = "", target] = value.slice("gate:".length).split("@");
    const owners = gateOwners(gate);
    if (gate === "" || owners.length === 0 || !gateIds().includes(gate)) {
      throw new HikyakuError(`「いつ」のゲートがありません: ${gate}`, `使用できるゲート: ${gateIds().join(" / ")}`);
    }
    let unit: string;
    if (target !== undefined) {
      unit = requireUnit(target, ctx);
    } else {
      const fixed = FIXED_UNITS.find((phase) => owners.some((owner) => owner.internal !== true && owner.unit?.(phase) !== undefined));
      unit = fixed ?? ctx.opening;
    }
    if (!owners.some((owner) => handles(owner, unit))) {
      throw new HikyakuError(`${gate} は ${unit} の手順にありません`, "ゲートを担う作業単位を @ で指定してください（例: gate:G8@build-02）。");
    }
    return { kind: "gate", gate, unit };
  }
  throw new HikyakuError(`「いつ」の値が不正です: ${raw}`, WHEN_HINT);
}

export function formatWhen(when: When): string {
  if (when.kind === "phase") return `phase:${when.phase}`;
  if (when.kind === "gate") return `gate:${when.gate}@${when.unit}`;
  if (when.kind === "merge") return `merge@${when.unit}`;
  return when.kind;
}

/** 保存済みの「いつ」を読む（参照先は検査しない。記録した時点で検査済み） */
export function readWhen(stored: string): When | undefined {
  if (stored === "now") return { kind: "now" };
  if (stored === "close") return { kind: "close" };
  if (stored.startsWith("phase:")) return { kind: "phase", phase: stored.slice(6) };
  if (stored.startsWith("merge@")) return { kind: "merge", unit: stored.slice(6) };
  if (stored.startsWith("gate:")) {
    const [gate = "", unit = ""] = stored.slice(5).split("@");
    return { kind: "gate", gate, unit };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 読み書き

export interface LedgerItem {
  open: OpenRecord;
  /** 読み順（at の後の並び） */
  decisions: DecideRecord[];
  latest: DecideRecord | undefined;
}

export interface Ledger {
  items: LedgerItem[];
  /** 事項がこのツリーに無い決定（事項がまだマージされていない並行ビルドのものなど） */
  orphans: DecideRecord[];
}

/** サイクルの作業単位のディレクトリ（サイクルのディレクトリからの相対パス）。読み順 */
export function unitDirectories(cycleDirectory: string): string[] {
  const builds = existsSync(cycleDirectory)
    ? readdirSync(cycleDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^build-\d+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
    : [];
  return ["", "planning", "design", ...builds, ...listPatchUnits(cycleDirectory)];
}

/** ディレクトリ（相対パス）が表す作業単位。サイクル直下は close と create の両方 */
export function unitsOfDirectory(relative: string): string[] {
  if (relative === "") return ["close", "create"];
  if (relative === "planning") return ["plan"];
  if (relative === "design") return ["architect"];
  if (/^build-\d+$/.test(relative)) return [relative];
  const patch = patchPhaseOf(relative);
  return patch === undefined ? [] : [patch];
}

export function ledgerPath(cycleDirectory: string, unit: string): string {
  const owner = ownerOf(unit as Phase);
  if (owner === undefined) throw new HikyakuError(`${unit} の作業単位のディレクトリが分かりません`);
  return join(cycleDirectory, owner.directory, LEDGER_FILE);
}

/** decisions.jsonl の中身を読む（別のブランチの記録を git show で読んだときに使う）。壊れた行はエラー */
export function parseLedgerRecords(text: string, source: string): LedgerRecord[] {
  return parseJsonl(text, source, isRecord, LABELS);
}

export function readLedger(cycleDirectory: string): Ledger {
  const opens: OpenRecord[] = [];
  const decides: DecideRecord[] = [];
  for (const relative of unitDirectories(cycleDirectory)) {
    for (const record of readJsonl(join(cycleDirectory, relative, LEDGER_FILE), isRecord, LABELS)) {
      if (record.record === "open") opens.push(record);
      else decides.push(record);
    }
  }
  const items = new Map<string, LedgerItem>();
  for (const open of opens) {
    if (items.has(open.id)) {
      throw new HikyakuError(`未決事項 ${open.id} の記録（open）が2つあります`, LABELS.writer);
    }
    items.set(open.id, { open, decisions: [], latest: undefined });
  }
  const orphans: DecideRecord[] = [];
  // at の順。同時刻は読み順（Array.prototype.sort は安定）
  const ordered = [...decides].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const decide of ordered) {
    const item = items.get(decide.id);
    if (item === undefined) {
      orphans.push(decide);
      continue;
    }
    item.decisions.push(decide);
    item.latest = decide;
  }
  return { items: [...items.values()], orphans };
}

export function findItem(ledger: Ledger, id: string): LedgerItem {
  const item = ledger.items.find((entry) => entry.open.id === id);
  if (item === undefined) {
    throw new HikyakuError(`未決事項 ${id} がありません`, "hikyaku ledger list で ID を確かめてください（別のブランチの事項は、マージまで見えません）。");
  }
  return item;
}

/**
 * その作業単位の次の ID（{unit}.{n}-{4桁の16進}）。連番はこのツリーに見える事項から数えるので、
 * 2つのブランチが同じ作業単位に事項を足すと連番が重なる。末尾の乱数で、マージしても同じ ID にならない
 */
export function nextItemId(ledger: Ledger, unit: string): string {
  const prefix = `${unit}.`;
  const used = ledger.items
    .map((item) => item.open.id)
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number.parseInt(id.slice(prefix.length), 10))
    .filter((n) => Number.isInteger(n));
  return `${prefix}${Math.max(0, ...used) + 1}-${randomBytes(2).toString("hex")}`;
}

export function openItem(cycleDirectory: string, record: OpenRecord, ledger: Ledger): void {
  if (ledger.items.some((item) => item.open.id === record.id)) {
    throw new HikyakuError(`未決事項 ${record.id} はすでに記録されています`, "同じ ID の事項は記録し直せません（決める人を変える手順はありません）。");
  }
  appendJsonl(ledgerPath(cycleDirectory, record.unit), record);
}

export function decideItem(cycleDirectory: string, record: DecideRecord, ledger: Ledger): void {
  const item = findItem(ledger, record.id);
  assertDecider(item.open, record.by, record.input);
  appendJsonl(ledgerPath(cycleDirectory, record.unit), record);
}

// ---------------------------------------------------------------------------
// 異議

/** 高として扱う異議か: 害が高か、上限を超える（exceedsCeiling）。受け入れには言葉と前提が要る */
export function isHighObjection(item: Pick<LedgerItem, "open">): boolean {
  return item.open.type === "objection" && (item.open.harm === "高" || item.open.exceedsCeiling === true);
}

/**
 * 高の異議が片づいたか: ユーザーが選択を改めた（decided）か、受け入れると書いて進めた（accepts 付きの
 * consented）。拠り所の前提は、記録するとき（ledger open / object）に求める。決定では前提を足せないので、
 * ここで求めると前提の無い事項を受け入れで片づける手段が無くなる
 */
export function objectionSettled(item: LedgerItem): boolean {
  const latest = item.latest;
  if (latest === undefined || latest.by !== "user") return false;
  if (latest.decision === "decided") return true;
  return latest.decision === "consented" && latest.accepts !== undefined && latest.accepts.trim() !== "";
}

/**
 * 1つの作業単位の decisions.jsonl だけから組み立てた記録。サイクルのほかの単位の記録が壊れていて
 * readLedger が失敗したときに、その単位の異議を確かめるのに使う（ほかの単位の決定は見えないので、
 * 片づいていない側に倒れる）
 */
export function readUnitLedger(cycleDirectory: string, unit: string): Ledger {
  const items: LedgerItem[] = [];
  const decides: DecideRecord[] = [];
  for (const record of readJsonl(ledgerPath(cycleDirectory, unit), isRecord, LABELS)) {
    if (record.record === "open") items.push({ open: record, decisions: [], latest: undefined });
    else decides.push(record);
  }
  for (const decide of [...decides].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    const item = items.find((entry) => entry.open.id === decide.id);
    if (item === undefined) continue;
    item.decisions.push(decide);
    item.latest = decide;
  }
  return { items, orphans: [] };
}

/**
 * そのゲートの承認を止める異議。その作業単位・そのステップで記録した高として扱う objection（害が高か、
 * 上限を超える）のうち、片づいていないもの。中の異議は記録だけで進むので数えない（US-1.3・US-1.4）。
 * ledger object --defer で同意ゲートへ回した異議（who=user・記録した作業単位の when=merge@<unit>・exceedsCeiling）は、
 * その単位のマージの前の同意ゲートで決めるので数えない。それ以外の merge@ の異議（who が user でない、ほかの単位の
 * merge@、上限を超えない）は同意ゲートで決まる保証が無いので、ここで止める
 */
export function unacceptedObjections(ledger: Ledger, unit: string, step: string): LedgerItem[] {
  return ledger.items.filter(
    (item) =>
      isHighObjection(item) && item.open.unit === unit && item.open.step === step &&
      !isDeferredObjection(item) &&
      !objectionSettled(item),
  );
}

/** ledger object --defer が書く形の異議（記録した単位の同意ゲートへ回した） */
function isDeferredObjection(item: LedgerItem): boolean {
  const open = item.open;
  return open.who === "user" && open.when === `merge@${open.unit}` && open.exceedsCeiling === true;
}

/**
 * その作業単位の decisions.jsonl を読めないときの理由。読めれば undefined。
 * 割り込みのきっかけを記録に置くスキル（builder）は、読めなければ手順に入らずに止まる。きっかけが
 * 見えないまま進むと、ユーザーに尋ねるゲートが黙って消えるため
 */
export function unitLedgerProblem(unitDirectory: string): string | undefined {
  try {
    readJsonl(join(unitDirectory, LEDGER_FILE), isRecord, LABELS);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * その作業単位のディレクトリの decisions.jsonl だけを読み、条件に合う事項の最新の at を返す。
 * ステップ定義の割り込みのきっかけ（builder の delegation）が使うので、手順の位置だけを読む経路
 * （Stop フック・step where・conductor parse）もこの1ファイルだけは読む。例外は投げず、読めなければ
 * undefined を返す（読めないことは、スキルの stop が unitLedgerProblem で先に止める）
 */
export function latestOpenAt(unitDirectory: string, matches: (record: OpenRecord) => boolean): string | undefined {
  let records: LedgerRecord[];
  try {
    records = readJsonl(join(unitDirectory, LEDGER_FILE), isRecord, LABELS);
  } catch {
    return undefined;
  }
  let latest: string | undefined;
  for (const record of records) {
    if (record.record === "open" && matches(record) && (latest === undefined || record.at > latest)) latest = record.at;
  }
  return latest;
}

// ---------------------------------------------------------------------------
// 事後同意（build-06）

/** 同意ゲートの対象になる記録か: risk / objection、who=user、when=merge@<unit>（記録した作業単位は問わない） */
function isConsentRecord(record: OpenRecord, unit: string): boolean {
  return (record.type === "risk" || record.type === "objection") && record.who === "user" && record.when === `merge@${unit}`;
}

/** 同意ゲートの一覧の対象 */
export function isConsentItem(item: LedgerItem, unit: string): boolean {
  return isConsentRecord(item.open, unit);
}

/** その作業単位の同意ゲートの一覧（サイクル全体の記録から、記録順） */
export function consentItemsOf(ledger: Ledger, unit: string): LedgerItem[] {
  return ledger.items.filter((item) => isConsentItem(item, unit));
}

/**
 * ユーザーの決定があるか。最新の決定が by=user の consented / decided / resolved なら決定とする。
 * rejected は数えない（作り直しのあとユーザーが resolved を記録するまで止める）。高として扱う異議（害が高か、
 * 上限を超える）は受け入れの言葉の無い consented を数えない（objectionSettled と同じ基準。resolved は片づきとして数える）
 */
export function consentDecided(item: LedgerItem): boolean {
  const latest = item.latest;
  if (latest === undefined || latest.by !== "user") return false;
  if (latest.decision === "rejected") return false;
  if (latest.decision === "resolved") return true;
  if (isHighObjection(item)) return objectionSettled(item);
  return true;
}

/** 決定が足りない項目（決定が無い、ユーザーの決定でない、最新が rejected、受け入れの言葉の無い高の異議） */
export function undecidedConsentItems(items: LedgerItem[]): LedgerItem[] {
  return items.filter((item) => !consentDecided(item));
}

/**
 * その作業単位の decisions.jsonl 1つだけに同意の対象があるか。手順の位置だけを読む経路（Stop フック・
 * step where・conductor parse）も同意ゲートの when でこれを呼ぶ（builder の delegation のきっかけと同じ種類の
 * 例外）。読めなければ true（ゲートを手順に入れる＝安全側）
 */
export function unitHasConsentItems(unitDirectory: string, unit: string): boolean {
  try {
    return readJsonl(join(unitDirectory, LEDGER_FILE), isRecord, LABELS).some(
      (record) => record.record === "open" && isConsentRecord(record, unit),
    );
  } catch {
    return true;
  }
}

/**
 * その作業単位の decisions.jsonl 1つだけから、ある時刻より後に記録した決定の足りない同意の対象。
 * 同意ゲートの承認のあとに対象が足されたら承認を取り直すのに使う。読めなければ undefined
 */
export function unitConsentItemsAfter(cycleDirectory: string, unit: string, at: string): LedgerItem[] | undefined {
  try {
    const ledger = readUnitLedger(cycleDirectory, unit);
    return undecidedConsentItems(consentItemsOf(ledger, unit)).filter((item) => item.open.at > at);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 期限

export type Timing = "pending" | "due" | "overdue";

export interface CycleTimeline {
  /** cycles.md の status が active か */
  active: boolean;
  /** 作業単位ごとの progress.jsonl の記録（サイクル直下は close と create の両方に入る） */
  events: Map<string, ProgressEvent[]>;
  /** engine で評価した現在のステップ（null は完了）。無い単位は記録から近似する */
  current: Map<string, string | null>;
  /** ベースブランチへマージ済みのビルド（build-NN）。分からなければ undefined */
  merged: Set<string> | undefined;
}

/**
 * サイクルの作業単位の記録を集め、記録のある単位を engine で評価して現在のステップを入れる。
 * 記録から近似すると、when で外れたステップ（振り返りの skip など）に現在地が落ちて期限を誤るため。
 * 評価に失敗した単位は近似に戻す（ほかの単位の状態で status や notices を止めない）
 */
export function cycleTimeline(config: ResolvedConfig, cycle: CycleContext, merged?: Set<string>): CycleTimeline {
  const events = new Map<string, ProgressEvent[]>();
  const current = new Map<string, string | null>();
  for (const relative of unitDirectories(cycle.directory)) {
    const units = unitsOfDirectory(relative);
    if (units.length === 0) continue;
    const unitDirectory = join(cycle.directory, relative);
    const read = readProgress(unitDirectory);
    for (const unit of units) {
      events.set(unit, read);
      const skill = ownerOf(unit as Phase)?.skill;
      if (skill === undefined || !read.some((event) => event.skill === skill.skill)) continue;
      try {
        const evaluation = evaluate(skill, { config, cycle, unit, unitDirectory, events: read });
        // 割り込みのゲート（delegation）が現在地でも、期限は並びの位置で判定する
        current.set(unit, evaluation.sequential?.definition.id ?? null);
      } catch {
        // 近似に戻す
      }
    }
  }
  return { active: cycle.record.status === "active", events, current, merged };
}

const COMPLETED = new Set(["done", "skipped", "approved"]);

function stepIndex(skill: SkillSteps, step: string): number {
  return skill.steps.findIndex((definition) => definition.id === step);
}

/**
 * その単位の現在のステップの位置（定義の並びの添字。完了なら steps.length）。
 * engine の評価があればそれを使い、無ければ今回の回で完了したステップのうち最も後ろのものの次とする
 */
function currentIndex(unit: string, skill: SkillSteps, timeline: CycleTimeline): number {
  const evaluated = timeline.current.get(unit);
  if (evaluated === null) return skill.steps.length;
  if (evaluated !== undefined) {
    const index = stepIndex(skill, evaluated);
    if (index !== -1) return index;
  }
  const events = currentEvents(skill, timeline.events.get(unit) ?? []);
  let last = -1;
  for (const event of events) {
    if (event.skill !== skill.skill || !COMPLETED.has(event.result)) continue;
    last = Math.max(last, stepIndex(skill, event.step));
  }
  return last + 1;
}

function eventsAfter(unit: string, at: string, timeline: CycleTimeline): ProgressEvent[] {
  return (timeline.events.get(unit) ?? []).filter((event) => event.at > at && event.result !== RESTART);
}

/** マージの前の区切り: consent があればそれ、patch は publish（Draft PR を実装より前に作るため）、ほかは pr */
function mergeAnchor(skill: SkillSteps): string {
  if (stepIndex(skill, "consent") !== -1) return "consent";
  if (skill.skill === "patch") return "publish";
  return "pr";
}

/**
 * phase の期限。後のフェーズの記録で過ぎたとするとき、事項を記録した単位自身の記録は数えない
 * （build-03 で記録した phase:architect が、build-03 の次の報告で過ぎたにならないように）。
 * 記録した時点でそのフェーズがもう終わっていたら（engine の評価で完了、その後の記録なし）、過ぎたとする
 */
function phaseTiming(phase: string, item: OpenRecord, timeline: CycleTimeline): Timing {
  if (phase === "close") return closeTiming(item.at, timeline);
  const later = (predicate: (unit: string) => boolean): boolean =>
    [...timeline.events.keys()].some((unit) => unit !== item.unit && predicate(unit) && eventsAfter(unit, item.at, timeline).length > 0);
  if (phase === "plan" && later((unit) => unit === "architect")) return "overdue";
  if (phase === "architect" && later((unit) => unit.startsWith("build-"))) return "overdue";
  if (phase.startsWith("build-") && timeline.merged?.has(phase) === true) return "overdue";
  if (eventsAfter(phase, item.at, timeline).length > 0) return "due";
  return timeline.current.get(phase) === null ? "overdue" : "pending";
}

function closeTiming(at: string, timeline: CycleTimeline): Timing {
  if (!timeline.active) return "overdue";
  return eventsAfter("close", at, timeline).some((event) => event.skill === "close-cycle") ? "due" : "pending";
}

function gateTiming(gate: string, unit: string, at: string, timeline: CycleTimeline): Timing {
  const after = eventsAfter(unit, at, timeline);
  const recorded = after.filter((event) => event.step === gate);
  if (recorded.some((event) => event.result === "approved")) return "overdue";
  if (recorded.length > 0 || timeline.current.get(unit) === gate) return "due";
  const skill = ownerOf(unit as Phase)?.skill;
  if (skill === undefined) return "pending";
  const index = stepIndex(skill, gate);
  if (index === -1) return "pending"; // 内部スキルのゲート（G6）は記録だけで判定する
  // 外れたゲート: 記録が無いまま、事項より後に G より後ろのステップが完了した
  const passed = after.some((event) => event.skill === skill.skill && COMPLETED.has(event.result) && stepIndex(skill, event.step) > index);
  if (passed) return "overdue";
  // 今回の回の現在地が G より後ろ（記録した時点でもう過ぎていた・外れていた）なら過ぎた
  const position = currentIndex(unit, skill, timeline);
  return position > index ? "overdue" : position === index ? "due" : "pending";
}

function mergeTiming(unit: string, timeline: CycleTimeline): Timing {
  if (unit.startsWith("build-") && timeline.merged?.has(unit) === true) return "overdue";
  const skill = ownerOf(unit as Phase)?.skill;
  if (skill === undefined) return "pending";
  const anchor = stepIndex(skill, mergeAnchor(skill));
  if (anchor === -1) return "pending";
  return currentIndex(unit, skill, timeline) >= anchor ? "due" : "pending";
}

/** 未決の事項の期限。期限の判定の唯一の正 */
export function timingOf(item: LedgerItem, timeline: CycleTimeline): Timing {
  const when = readWhen(item.open.when);
  if (when === undefined) return "pending";
  if (when.kind === "now") return "due";
  if (when.kind === "close") return closeTiming(item.open.at, timeline);
  if (when.kind === "phase") return phaseTiming(when.phase, item.open, timeline);
  if (when.kind === "gate") return gateTiming(when.gate, when.unit, item.open.at, timeline);
  return mergeTiming(when.unit, timeline);
}

export interface TimedItem extends LedgerItem {
  timing: Timing;
}

export interface LedgerSummary {
  /** 期限が来た・過ぎた未決の事項 */
  due: TimedItem[];
  /** 未決の事項すべて（due も含む） */
  open: TimedItem[];
  /** 最新の決定が rejected の事項（未解決の退け） */
  rejected: LedgerItem[];
}

export function summarize(ledger: Ledger, timeline: CycleTimeline): LedgerSummary {
  const open = ledger.items
    .filter((item) => item.latest === undefined)
    .map((item) => ({ ...item, timing: timingOf(item, timeline) }));
  return {
    due: open.filter((item) => item.timing !== "pending"),
    open,
    rejected: ledger.items.filter((item) => item.latest?.decision === "rejected"),
  };
}

export function itemLine(item: TimedItem): string {
  const label = item.timing === "overdue" ? "期限を過ぎた未決事項" : item.timing === "due" ? "期限が来た未決事項" : "未決事項";
  return `${label} ${item.open.id}（いつ: ${item.open.when}・決める人: ${whoLabel(item.open.who)}）: ${item.open.summary}`;
}

/** directive の notices に載せる行（1事項1行） */
export function noticeLines(summary: LedgerSummary): string[] {
  return summary.due.map(itemLine);
}

/** JSON に出す形 */
export function itemJson(item: LedgerItem & { timing?: Timing }): Record<string, unknown> {
  return {
    id: item.open.id,
    unit: item.open.unit,
    type: item.open.type,
    summary: item.open.summary,
    when: item.open.when,
    who: item.open.who,
    ...(item.timing === undefined ? {} : { timing: item.timing }),
    latest: item.latest ?? null,
  };
}
