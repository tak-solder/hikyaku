/**
 * 設定の解決。
 *
 * 設定を置ける場所は2箇所だけで、キー単位でマージする:
 *   リポジトリルート/.hikyaku.config                    ← 必須。ベース設定
 *   {HIKYAKU_ROOT}/cycles/{NNN}-{slug}/.hikyaku.config  ← 任意。サイクル固有の上書き
 *
 * サイクル側で上書きできないのは hikyaku_root だけ。ワークスペースの所在が
 * サイクルごとに変わると、そのサイクル設定自体をどこから読むかが決まらない。
 *
 * [branch] もサイクル側で上書きできる。ブランチ名は全サイクル横断で解析するが、
 * 「どの規則で解析するか」はサイクルごとに引ける（cycleBranchNaming）。
 * 解析する側はサイクルを1件ずつ、そのサイクル自身の規則で照合する。
 *
 * profile は cycles.md が唯一の正。サイクル設定に書けるようにすると同じ状態が
 * 2箇所に載り、必ず食い違う。
 *
 * profile は承認ゲートとレビューの既定値をまとめて与える。個別キーで上書きできる。
 *
 * ルート設定の ask に並べたキーは、create-cycle がサイクルごとに尋ねる（→ ASK_KEYS）。
 * 値そのものは既定の提示として残るので、profile と同じ「config は推奨、
 * 作成時に明示的に決める」形になる。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type DiffPatterns,
  DEFAULT_ASSERTION_MARKERS,
  DEFAULT_DIFF_EXCLUDE,
  DEFAULT_DIFF_TESTS,
  DEFAULT_SKIP_MARKERS,
  DEFAULT_TEST_DECLARATIONS,
} from "./diff-stats.mts";
import type { PeakBands } from "./tokens.mts";
import type { BranchNaming } from "./branch.mts";
import {
  checkConductorAsks,
  CONDUCTOR_PHASES,
  DEFAULT_CONDUCTOR,
  type ConductorConfig,
  type ConductorPhase,
} from "./conductor.mts";
import { HikyakuError } from "./errors.mts";
import { repoRoot } from "./paths.mts";
import { parseToml, TomlError, type TomlTable, type TomlValue } from "./toml.mts";

export type ProfileName = "express" | "economy" | "standard" | "thorough";
export type SecurityReviewMode = "off" | "recommended" | "on";
export type RetrospectiveMode = "skip" | "prompt" | "auto";
export type ValidateMode = "manual" | "phase" | "step";
export const EXTERNAL_TARGETS = ["none", "github"] as const;
export type ExternalTarget = (typeof EXTERNAL_TARGETS)[number];

/** [external] target・--external に値が渡されたときの検査。Asana は廃止を伝える */
export function checkExternalTarget(value: string, where: string): ExternalTarget {
  const hint = `使用できる値: ${EXTERNAL_TARGETS.join(" | ")}`;
  if (value === "asana") throw new HikyakuError(`${where}: Asana への投影は v3 で廃止しました`, hint);
  if (!(EXTERNAL_TARGETS as readonly string[]).includes(value)) throw new HikyakuError(`${where} の値が不正です: ${value}`, hint);
  return value as ExternalTarget;
}

export const PROFILE_NAMES: ProfileName[] = ["express", "economy", "standard", "thorough"];

/**
 * 確認ゲートのオン・オフ。ここに無いゲートは profile の管轄外で、常に有効:
 *   G1  user-stories 承認（planner。要件の合意なので常に同意で、設定で外せない）
 *   G6  tasklist / issue 変更承認（build-manager）
 *   G8  plan + test-spec 承認（builder）
 *   G10 永続ドキュメント昇格の承認（close-cycle）
 * profile で外せるのは「確認」であって「同意」ではない。同意の回（差し戻しからの再設計の
 * G3・G4 など）は、ここが false でもステップ定義の consent が手順に残す。
 */
export interface Gates {
  /** G2 architect: codebase-survey 確認 */
  codebaseSurvey: boolean;
  /**
   * G3 architect: 設計案の選択。
   * off にすると AI が推奨案をそのまま採用する。express だけが off で、
   * 要件（G1）をユーザーが握っているなら、その先の trade-off は推奨に委ねても
   * 引き返せる、という判断による。採用理由と退けた案は ADR に残る。
   */
  designChoice: boolean;
  /** G4 architect: 設計ドキュメント承認 */
  architecture: boolean;
  /** G7 builder: plan 単独の承認（thorough のみ。他は G8 に統合） */
  plan: boolean;
  /**
   * G10 close-cycle: 永続ドキュメントへの昇格の承認のうち、確認の回（同意が要る変更が無い回）。
   * express だけ off。decisions・constraints の変更を含む回は同意で、ここに関わらず手順に残る
   */
  promotion: boolean;
}

export interface Reviews {
  userStories: boolean;
  architecture: boolean;
  tasklist: boolean;
  plan: boolean;
  testSpec: boolean;
  code: boolean;
  security: SecurityReviewMode;
  retrospective: RetrospectiveMode;
  validate: ValidateMode;
}

/**
 * レビューを実行するプロバイダ。auto はメインのセッションと同じもの（claude）を使う。
 * メインのセッションは常に Claude Code で、Codex はレビューの実行先としてだけ使う
 */
export type ReviewProvider = "claude" | "codex";
export const MAIN_PROVIDER: ReviewProvider = "claude";
export const REVIEW_PROVIDERS: ReviewProvider[] = ["claude", "codex"];
export type ReviewProviderChoice = "auto" | ReviewProvider;

/** プロバイダを選べるレビューの種類。doc は doc-reviewer エージェント */
export type ReviewKind = "code" | "security" | "doc";
export const REVIEW_KINDS: ReviewKind[] = ["code", "security", "doc"];

/** Claude の effort。ultra はクラウドのレビューになるので受け付けない */
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** 空なら各プロバイダの既定に任せる */
export interface ReviewModelSettings {
  model?: string;
  effort?: string;
}

/** provider の値がどこから来たか。設定ファイルと違う結果になったときに理由を示すため */
export type ReviewProviderSource = "cloud" | "env" | "kind" | "review" | "default";

/**
 * 設定から決まった provider と、その出所。
 * クラウド環境 → 環境変数 → [review.<kind>] → [review] → 既定（auto）の順に、最初に値があったもの
 */
export type ReviewProviderSetting =
  | { source: "cloud"; provider: ReviewProvider }
  | { source: "env" | "kind" | "review" | "default"; provider: ReviewProviderChoice };

export interface ReviewKindSettings {
  provider: ReviewProviderSetting;
  /** 1 = 1回だけ / n = パスするまで最大 n 回 / 0 = 無制限 */
  maxRounds: number;
  /** 無制限の2ラウンド目以降、指摘への対応を確認せずに直すか */
  autoFix: boolean;
  /** [review.<kind>.<provider>] → [review.<provider>] の順に重ねた値 */
  models: Record<ReviewProvider, ReviewModelSettings>;
}

export interface ReviewSettings {
  /** レビューのプロセス1回あたりの上限（分） */
  timeoutMinutes: number;
  code: ReviewKindSettings;
  security: ReviewKindSettings;
  doc: ReviewKindSettings;
}

export const DEFAULT_REVIEW_TIMEOUT_MINUTES = 30;

/**
 * provider を全種類まとめて上書きする環境変数。設定ファイルより優先する。
 * クラウド環境のように、設定したプロバイダの CLI が使えない場所でリポジトリの設定を変えずに済ませるため
 */
export const REVIEW_PROVIDER_ENV = "HIKYAKU_REVIEW_PROVIDER";

/**
 * クラウド環境を示す環境変数。Claude Code のクラウド環境には codex の CLI が無いので、
 * claude に固定する。HIKYAKU_REVIEW_PROVIDER と設定ファイルより優先する
 */
export const REVIEW_CLOUD_ENVS: { provider: ReviewProvider; variable: string; matches: (value: string) => boolean }[] = [
  { provider: "claude", variable: "CLAUDE_CODE_REMOTE", matches: (value) => value === "true" },
];

/** いま動いているクラウド環境。クラウド環境でなければ undefined */
export function detectCloudEnv(env: NodeJS.ProcessEnv): (typeof REVIEW_CLOUD_ENVS)[number] | undefined {
  return REVIEW_CLOUD_ENVS.find(({ variable, matches }) => {
    const value = env[variable]?.trim();
    return value !== undefined && matches(value);
  });
}

/** クラウド環境の出所の表示名（例: 「クラウド環境（CLAUDE_CODE_REMOTE）」） */
export function cloudEnvLabel(provider: ReviewProvider): string {
  const variable = REVIEW_CLOUD_ENVS.find((entry) => entry.provider === provider)?.variable;
  return `クラウド環境（${variable}）`;
}

interface ProfileDefinition {
  gates: Gates;
  reviews: Reviews;
  /** code / security の max_rounds の既定 */
  reviewRounds: number;
}

const PROFILES: Record<ProfileName, ProfileDefinition> = {
  // ユーザーの時間を節約する。承認は減らすが AI には見させる。
  // ユーザーが握るのは要件（G1）だけで、その先の設計判断は AI の推奨に委ねる。
  // 委ねるぶん、security と retrospective は AI 側で回して担保を戻す
  express: {
    gates: {
      codebaseSurvey: false,
      designChoice: false,
      architecture: false,
      plan: false,
      promotion: false,
    },
    reviews: {
      userStories: true,
      architecture: true,
      tasklist: true,
      plan: true,
      testSpec: true,
      code: true,
      security: "recommended",
      retrospective: "auto",
      validate: "manual",
    },
    reviewRounds: 1,
  },
  // AI 実行コストを節約する。中間成果物のレビューを起動しないがユーザーは見る。
  // code だけは全プロファイルで残す（コードの差分は承認ゲートが拾える粒度を超えるため）。
  // security も落とさない（節約の対象にしてよい観点ではないため、既定は recommended）
  economy: {
    gates: {
      codebaseSurvey: false,
      designChoice: true,
      architecture: true,
      plan: false,
      promotion: true,
    },
    reviews: {
      userStories: false,
      architecture: false,
      tasklist: false,
      plan: false,
      testSpec: false,
      code: true,
      security: "recommended",
      retrospective: "skip",
      validate: "manual",
    },
    reviewRounds: 1,
  },
  // 完成した成果物の単位で、ユーザーも AI も見る
  standard: {
    gates: {
      codebaseSurvey: false,
      designChoice: true,
      architecture: true,
      plan: false,
      promotion: true,
    },
    reviews: {
      userStories: true,
      architecture: true,
      tasklist: true,
      plan: true,
      testSpec: true,
      code: true,
      security: "recommended",
      retrospective: "auto",
      validate: "phase",
    },
    reviewRounds: 2,
  },
  // 判定基準が厳しくなるのではなく、チェックポイントが細かくなる。
  // 完成前の中間状態（codebase-survey だけ / plan だけ / 各ステップ）でも止まり、
  // 条件付きの security も該当判定を挟まず常に実行する
  thorough: {
    gates: {
      codebaseSurvey: true,
      designChoice: true,
      architecture: true,
      plan: true,
      promotion: true,
    },
    reviews: {
      userStories: true,
      architecture: true,
      tasklist: true,
      plan: true,
      testSpec: true,
      code: true,
      security: "on",
      retrospective: "auto",
      validate: "step",
    },
    reviewRounds: 3,
  },
};

/** security_review を推奨する既定の判定基準。config で丸ごと置き換えられる */
export const DEFAULT_SECURITY_TRIGGERS = `- 個人情報・秘密情報を扱う（氏名/住所/連絡先/生年月日、パスワード、トークン、APIキー）
- 認証・認可（ログイン、セッション、権限判定、アクセス制御）
- 決済（支払い、カード情報、請求、返金）`;

export const DEFAULT_PR_TITLE = "[hikyaku] {cycle}: {phase} {title}";

/**
 * レビュアーのアサインをオフにできる単位。PR を作るスキルに対応する。
 * build は build-NN の全て、conductor は監督が作る最後の PR
 */
export const REVIEWER_SKIP_TARGETS = ["init", "token-guide", "create", "plan", "architect", "build", "close", "conductor", "patch"] as const;
export type ReviewerSkipTarget = (typeof REVIEWER_SKIP_TARGETS)[number];
/** セッション名の既定。空文字にするとセッション名を変更しない */
export const DEFAULT_SESSION_TITLE = "{cycle} {phase} {title}";
export const DEFAULT_BRANCH_PREFIX = "hikyaku";
export const DEFAULT_BRANCH_SEPARATOR = "/";

const DEFAULT_NAMING: BranchNaming = {
  prefix: DEFAULT_BRANCH_PREFIX,
  separator: DEFAULT_BRANCH_SEPARATOR,
};

/**
 * create-cycle 時に決められるキー。表示順もこの並び。
 *
 * ルート設定の ask にこの名前を並べると、create-cycle がその値を尋ねる。
 * 値の側を番兵（"ask" など）にしないのは、base_branch = "ask" のように
 * 本物の値と区別できない組み合わせがあるため。宣言を分けたことで、
 * キーの値は「尋ねるときに提示する既定」として使えるようにもなっている。
 */
export type AskKey =
  | "base_branch"
  | "branch.prefix"
  | "branch.separator"
  | "pr.title"
  | "session.title"
  | "external.target";

export const ASK_KEYS: AskKey[] = [
  "base_branch",
  "branch.prefix",
  "branch.separator",
  "pr.title",
  "session.title",
  "external.target",
];

export interface ResolvedConfig {
  repoRoot: string;
  hikyakuRoot: string;
  profile: ProfileName;
  /** 未設定ならリポジトリのデフォルトブランチを自動検出する（スキル側の責務） */
  baseBranch: string | undefined;
  gates: Gates;
  reviews: Reviews;
  branch: BranchNaming;
  pr: { title: string; reviewers: string[]; reviewersSkip: ReviewerSkipTarget[]; autoReady: boolean };
  /** セッション名のテンプレート。空文字なら変更しない */
  session: { title: string };
  security: { triggers: string };
  /** [review] — 各レビューのプロバイダ・モデル・回数 */
  review: ReviewSettings;
  external: { target: ExternalTarget; githubRepo?: string };
  conductor: ConductorConfig;
  /** [data_integrity] — ビルドのマージで本番データを壊さないための宣言 */
  dataIntegrity: DataIntegrityConfig;
  /** [app] と [[app.areas]]（作業ツリーの宣言）。無ければ undefined（上限を設けない）。基準側との比較は risk.mts */
  app: AppDeclaration | undefined;
  /** [boundaries]。照合は gate brief（build-12） */
  boundaries: Boundaries;
  /** [consent]（サイクル設定の素の値）。有効の判定は deferred-consent.mts（git を読むのでここでは計算しない） */
  consent: ConsentConfig;
  /** [diff] — ビルドの差分の集計（tokens history build-NN）が数えない生成物と、テストとして分けるパス */
  diff: DiffPatterns;
  /** [context] — メインセッションのコンテキストの上限と割合 */
  context: ContextLimits;
  /** [context] から求めた予測ピークの判定の帯（見積もりの上限・統合の目安） */
  peakBands: PeakBands;
  /** [rules] — rule を機械の検査やリファクタへ移す候補を出す感度 */
  rules: RulesConfig;
  /** [areas] — 領域が休眠しているとみなす期間 */
  areas: AreasConfig;
  /** [metrics] — 基準を消した PR のマージ前後の指標の比較 */
  metrics: MetricsConfig;
  /**
   * ルート設定の ask に並んでいて、まだ答えが記録されていないキー。
   * create-cycle が尋ねる対象。サイクルを重ねた結果ここに残っていれば、
   * そのサイクルは未回答でルート設定の値のまま動いている
   */
  askAtCreate: AskKey[];
  /** 読み込んだ設定ファイルのパス（デバッグ用） */
  sources: string[];
  /**
   * サイクル設定に残っている v3 で廃止したキーのエラー。読むだけの操作では無視し、
   * v3 の作業に使うときに assertCurrentConfig で止める
   */
  retired: HikyakuError[];
}

/**
 * [context] — メインセッションのコンテキストの上限と、そこから求める予測ピークの判定の帯。
 *
 * ユーザーが決めるのは上限（limit）だけで、見積もりの上限（plan と build-manager の予測ピークと比べる）と
 * 統合の目安は上限に対する割合で求める。割合は見積もりの誤差のための余裕なので、ほとんどの人は変えない。
 * ビルドの途中の区切り（G8・実装開始前・レビュー前）は、完了までの見込みを上限と比べる（forecast.mts）。
 * 既定値は 1M のウィンドウを前提にした値
 */
export interface ContextLimits {
  /** 1セッションのピークの上限（トークン） */
  limit: number;
  /** 見積もりの上限 = limit × この割合 */
  estimateRatio: number;
  /** 統合の目安 = limit × この割合 */
  mergeRatio: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = { limit: 600_000, estimateRatio: 0.9, mergeRatio: 0.6 };

/** 上限と割合から、予測ピークの判定の帯を求める */
export function peakBandsOf(limits: ContextLimits): PeakBands {
  return { mergeHint: Math.round(limits.limit * limits.mergeRatio), estimateLimit: Math.round(limits.limit * limits.estimateRatio) };
}

export interface RulesConfig {
  /** レビューの記録で、同じ rule がこの回数以上引かれたら移す候補にする（サイクルをまたいで数える） */
  hitThreshold: number;
}

export interface AreasConfig {
  /** 最終変更からこの日数を超えた領域を休眠とみなす */
  dormantDays: number;
}

export const DEFAULT_RULES: RulesConfig = { hitThreshold: 3 };
export const DEFAULT_AREAS: AreasConfig = { dormantDays: 180 };

export interface MetricsConfig {
  /** 基準を消した PR のマージ前後で、それぞれ何サイクルを比べるか */
  window: number;
}

export const DEFAULT_METRICS: MetricsConfig = { window: 2 };

export interface DataIntegrityConfig {
  /**
   * リリースされるブランチのパターン（glob）。ルート設定でのみ宣言できる。
   * デフォルトブランチは書かなくても暗黙に含まれる（判定は integrity.mts）
   */
  releaseBranches: string[];
  /** マージ時点で本番データの安全を保てないビルド分割を許すか。既定は false */
  allowUnsafeSplit: boolean;
}

/** アプリケーションの状況の3軸（ADR risk-ceiling-table）。並びは軽い段から重い段 */
export const EXPOSURES = ["personal", "internal", "public"] as const;
export const DATA_WEIGHTS = ["none", "internal", "personal-or-secret"] as const;
export const IMPACTS = ["low", "medium", "high"] as const;
export type Exposure = (typeof EXPOSURES)[number];
export type DataWeight = (typeof DATA_WEIGHTS)[number];
export type Impact = (typeof IMPACTS)[number];

export interface AppAxes {
  exposure: Exposure;
  data: DataWeight;
  impact: Impact;
}

/**
 * 重い領域（[[app.areas]]）。name は前提の参照 `area:<name>` に使う。軸は省略でき、
 * 省略した軸はアプリケーションの値になる（重い領域に触れる受け入れは害の重さに関わらず
 * 上限を超えるので、軸はゲートの判定には効かない）
 */
export interface AppArea {
  name: string;
  paths: string[];
  exposure?: Exposure;
  data?: DataWeight;
  impact?: Impact;
}

/** [app] — AI に任せてよい害の上限を決める宣言。ルート設定でのみ書ける */
export interface AppDeclaration {
  axes: AppAxes;
  /** マージがユーザーの関門である前提（事後同意の前提。"user" だけを受け付ける） */
  mergeGate: "user" | undefined;
  areas: AppArea[];
}

/** [boundaries] — 外との境界・内部の境界のパス（glob）。ルート設定でのみ書ける */
export interface Boundaries {
  external: string[];
  internal: string[];
}

export interface LoadOptions {
  /** --root で明示指定された HIKYAKU_ROOT */
  root?: string | undefined;
  /** cycles.md のサイクル属性など、config より優先する profile */
  profileOverride?: string | undefined;
  /** サイクル固有設定を重ねる場合、そのサイクルのディレクトリ */
  cycleDir?: string | undefined;
  /** 設定ファイルや HIKYAKU_ROOT が無くてもエラーにしない（init / doctor 用） */
  allowMissingRoot?: boolean;
}

/**
 * サイクル設定で上書きできないキー。
 *
 * hikyaku_root はワークスペースそのものの所在で、サイクル設定を読む前に確定して
 * いなければならない。サイクルごとに動かせるようにすると、そのサイクル設定を
 * どこから読むかが決まらない（自己参照になる）。
 *
 * profile は別メッセージで案内するため含めない。
 */
const CYCLE_LOCKED_KEYS = ["hikyaku_root"];

function readTable(table: TomlTable, key: string): TomlTable | undefined {
  const value = table[key];
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value;
}

function readString(table: TomlTable | undefined, key: string, where: string): string | undefined {
  const value = table?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new HikyakuError(`${where}.${key} は文字列で指定してください（現在: ${typeof value}）`);
  }
  return value;
}

function readBoolean(table: TomlTable | undefined, key: string, where: string): boolean | undefined {
  const value = table?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new HikyakuError(`${where}.${key} は true / false で指定してください`);
  }
  return value;
}

function readInteger(table: TomlTable | undefined, key: string, where: string): number | undefined {
  const value = table?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HikyakuError(`${where}.${key} は整数で指定してください`);
  }
  return value;
}

function readPositiveInteger(table: TomlTable | undefined, key: string, where: string, fallback: number): number {
  const value = readInteger(table, key, where);
  if (value === undefined) return fallback;
  if (value <= 0) throw new HikyakuError(`${where}.${key} は正の整数で指定してください（現在: ${value}）`);
  return value;
}

function readRulesConfig(table: TomlTable | undefined): RulesConfig {
  return { hitThreshold: readPositiveInteger(table, "hit_threshold", "[rules]", DEFAULT_RULES.hitThreshold) };
}

function readAreasConfig(table: TomlTable | undefined): AreasConfig {
  return { dormantDays: readPositiveInteger(table, "dormant_days", "[areas]", DEFAULT_AREAS.dormantDays) };
}

function readMetricsConfig(table: TomlTable | undefined): MetricsConfig {
  return { window: readPositiveInteger(table, "window", "[metrics]", DEFAULT_METRICS.window) };
}

function readNumber(table: TomlTable | undefined, key: string, where: string): number | undefined {
  const value = table?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HikyakuError(`${where}.${key} は数値で指定してください`);
  }
  return value;
}

function readStringArray(table: TomlTable | undefined, key: string, where: string): string[] | undefined {
  const value = table?.[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HikyakuError(`${where}.${key} は文字列の配列で指定してください`);
  }
  return value as string[];
}

/**
 * [conductor] を読む。配列はキー単位のマージなので、サイクル設定に書くと
 * ルート設定の配列を置き換える（足し合わせない）
 */
function readConductor(table: TomlTable | undefined): ConductorConfig {
  const where = "[conductor]";
  const budget = readNumber(table, "budget_per_run", where) ?? DEFAULT_CONDUCTOR.budgetPerRun;
  if (budget < 0) {
    throw new HikyakuError(`${where}.budget_per_run は 0 以上で指定してください（0 は上限なし）`);
  }
  const conductor: ConductorConfig = {
    escalate: readStringArray(table, "escalate", where) ?? DEFAULT_CONDUCTOR.escalate,
    delegate: readStringArray(table, "delegate", where) ?? DEFAULT_CONDUCTOR.delegate,
    allowedTools: readStringArray(table, "allowed_tools", where) ?? DEFAULT_CONDUCTOR.allowedTools,
    budgetPerRun: budget,
    requireApproval: readBoolean(table, "require_approval", where) ?? DEFAULT_CONDUCTOR.requireApproval,
    phaseReviewers: readReviewers(table, "phase_reviewers", where),
    reviewTimeoutMinutes: readTimeout(table, where),
    model: readModel(table, "model", where),
    models: readConductorModels(readConductorModelsTable(table, where)),
  };
  checkConductorAsks(conductor, where);
  return conductor;
}

/**
 * レビュアーの指定を読む。人（login）、チーム（org/team）、Copilot（@copilot）を並べる。
 * 空白やカンマを含む値は gh に渡すときに別の値として解釈されるので、その場で拒否する
 */
function readReviewers(table: TomlTable | undefined, key: string, where: string): string[] {
  const values = readStringArray(table, key, where) ?? [];
  for (const value of values) {
    if (value === "" || /[\s,]/.test(value)) {
      throw new HikyakuError(
        `${where}.${key} に指定できない値があります: ${JSON.stringify(value)}`,
        "人は login、チームは org/team、Copilot は @copilot で、1要素に1つずつ書いてください。",
      );
    }
  }
  return values;
}

/** [pr] reviewers_skip を読む。名前のタイプミスを黙って捨てると、オフにしたつもりのスキルにアサインされる */
function readReviewerSkip(table: TomlTable | undefined): ReviewerSkipTarget[] {
  const values = readStringArray(table, "reviewers_skip", "[pr]") ?? [];
  for (const value of values) {
    if (!(REVIEWER_SKIP_TARGETS as readonly string[]).includes(value)) {
      throw new HikyakuError(
        `[pr].reviewers_skip に指定できない値があります: ${value}`,
        `使用できる値: ${REVIEWER_SKIP_TARGETS.join(" | ")}`,
      );
    }
  }
  return values as ReviewerSkipTarget[];
}

function readTimeout(table: TomlTable | undefined, where: string): number {
  const value = readNumber(table, "review_timeout", where) ?? DEFAULT_CONDUCTOR.reviewTimeoutMinutes;
  if (value < 0) throw new HikyakuError(`${where}.review_timeout は 0 以上で指定してください（0 は待たない）`);
  return value;
}

function readModel(table: TomlTable | undefined, key: string, where: string): string | undefined {
  const value = readString(table, key, where);
  if (value !== undefined && value.trim() === "") {
    throw new HikyakuError(`${where}.${key} に空文字は指定できません`, "Claude Code の既定に任せるなら、キーごと消してください。");
  }
  return value;
}

/**
 * [conductor.models] を読む。フェーズ名のタイプミスを黙って捨てると、指定したつもりの
 * モデルが効かないまま既定のモデルで動くので、未知のキーはエラーにする
 */
/** [conductor.models] を取り出す。models = "opus" のようにテーブル以外で書かれたら、黙って無視せず止める */
function readConductorModelsTable(table: TomlTable | undefined, where: string): TomlTable | undefined {
  if (table?.["models"] === undefined) return undefined;
  const models = readTable(table, "models");
  if (models === undefined) {
    throw new HikyakuError(
      `${where}.models はテーブルで指定してください`,
      "全フェーズの既定は [conductor] の model に、フェーズごとの上書きは [conductor.models] の下に build = \"opus\" の形で書きます。",
    );
  }
  return models;
}

function readConductorModels(table: TomlTable | undefined): Partial<Record<ConductorPhase, string>> {
  const where = "[conductor.models]";
  const models: Partial<Record<ConductorPhase, string>> = {};
  for (const key of Object.keys(table ?? {})) {
    if (!(CONDUCTOR_PHASES as readonly string[]).includes(key)) {
      throw new HikyakuError(
        `${where} に指定できないキーです: ${key}`,
        `使用できるキー: ${CONDUCTOR_PHASES.join(" | ")}`,
      );
    }
    const model = readModel(table, key, where);
    if (model !== undefined) models[key as ConductorPhase] = model;
  }
  return models;
}

/** テーブルに許可していないキーが無いか。タイプミスを黙って捨てると、設定したつもりの値が効かない */
function assertKnownKeys(table: TomlTable | undefined, allowed: string[], where: string, hint?: string): void {
  for (const key of Object.keys(table ?? {})) {
    if (!allowed.includes(key)) {
      throw new HikyakuError(`${where} に指定できないキーです: ${key}`, hint ?? `使用できるキー: ${allowed.join(" | ")}`);
    }
  }
}

/** テーブルとして書くべきキーを取り出す。値で書かれたら黙って無視せず止める */
function requireTable(table: TomlTable | undefined, key: string, where: string): TomlTable | undefined {
  if (table?.[key] === undefined) return undefined;
  const value = readTable(table, key);
  if (value === undefined) {
    const path = where === "config" ? key : `${where.slice(1, -1)}.${key}`;
    throw new HikyakuError(`${key} はテーブル（[${path}]）で指定してください`);
  }
  return value;
}

/** [...claude] / [...codex] を読む。空文字はキーが無いのと同じ（各プロバイダの既定に任せる） */
function readReviewModel(
  table: TomlTable | undefined,
  provider: ReviewProvider,
  where: string,
  fallback: ReviewModelSettings,
): ReviewModelSettings {
  assertKnownKeys(table, ["model", "effort"], where);
  const model = readString(table, "model", where)?.trim();
  const effort = readString(table, "effort", where)?.trim();
  // Codex の effort はモデルによって使える値が変わるので検証しない
  if (provider === "claude" && effort !== undefined && effort !== "") {
    checkEnum(effort, CLAUDE_EFFORTS, `${where}.effort`);
  }
  const out: ReviewModelSettings = { ...fallback };
  if (model !== undefined) {
    if (model === "") delete out.model;
    else out.model = model;
  }
  if (effort !== undefined) {
    if (effort === "") delete out.effort;
    else out.effort = effort;
  }
  return out;
}

function readMaxRounds(table: TomlTable | undefined, where: string): number | undefined {
  const value = readInteger(table, "max_rounds", where);
  if (value !== undefined && value < 0) {
    throw new HikyakuError(`${where}.max_rounds は 0 以上の整数で指定してください（0 は無制限）`);
  }
  return value;
}

/**
 * [review] を読む。
 *
 * 値は「[review.<kind>.<provider>] → [review.<kind>] → [review.<provider>] / [review] → profile」
 * の順に重ねる。モデルとエフォートをプロバイダごとに分けるのは、provider だけを切り替えたときに
 * 互換性のないモデル名やエフォートが渡らないようにするため。
 */
function readReview(
  table: TomlTable | undefined,
  reviewRounds: number,
  env: NodeJS.ProcessEnv = process.env,
): ReviewSettings {
  const where = "[review]";
  assertKnownKeys(
    table,
    ["provider", "max_rounds", "auto_fix", "timeout", ...REVIEW_PROVIDERS, ...REVIEW_KINDS],
    where,
  );

  const timeout = readNumber(table, "timeout", where) ?? DEFAULT_REVIEW_TIMEOUT_MINUTES;
  if (timeout <= 0) throw new HikyakuError(`${where}.timeout は 0 より大きい分数で指定してください`);

  const providers: ReviewProviderChoice[] = ["auto", ...REVIEW_PROVIDERS];
  const configured = readEnum(table, "provider", providers, where);
  const rawEnv = env[REVIEW_PROVIDER_ENV]?.trim();
  // 不正な値を黙って捨てると、設定ファイルのプロバイダに戻って同じように失敗する
  const envProvider =
    rawEnv === undefined || rawEnv === "" ? undefined : checkEnum(rawEnv, providers, `環境変数 ${REVIEW_PROVIDER_ENV}`);
  const cloud = detectCloudEnv(env);
  const baseRounds = readMaxRounds(table, where) ?? reviewRounds;
  const baseAutoFix = readBoolean(table, "auto_fix", where) ?? false;
  const baseModels = Object.fromEntries(
    REVIEW_PROVIDERS.map((provider) => [
      provider,
      readReviewModel(requireTable(table, provider, where), provider, `[review.${provider}]`, {}),
    ]),
  ) as Record<ReviewProvider, ReviewModelSettings>;

  const kind = (name: ReviewKind): ReviewKindSettings => {
    const kindWhere = `[review.${name}]`;
    const kindTable = requireTable(table, name, where);
    // doc は1回だけのレビューで、回数の設定は持たない（指摘への対応は各フェーズの承認で決める）
    const allowed =
      name === "doc"
        ? ["provider", ...REVIEW_PROVIDERS]
        : [
            "provider",
            "max_rounds",
            "auto_fix",
            ...REVIEW_PROVIDERS,
            ...(name === "security" ? ["triggers"] : []),
          ];
    assertKnownKeys(
      kindTable,
      allowed,
      kindWhere,
      name === "doc" ? `使用できるキー: ${allowed.join(" | ")}（ドキュメントのレビューは1回だけで、回数は設定できません）` : undefined,
    );
    return {
      provider: firstProvider([
        cloud === undefined ? undefined : { source: "cloud", provider: cloud.provider },
        envProvider === undefined ? undefined : { source: "env", provider: envProvider },
        settingOf("kind", readEnum(kindTable, "provider", providers, kindWhere)),
        settingOf("review", configured),
      ]),
      maxRounds: name === "doc" ? 1 : (readMaxRounds(kindTable, kindWhere) ?? baseRounds),
      autoFix: name === "doc" ? false : (readBoolean(kindTable, "auto_fix", kindWhere) ?? baseAutoFix),
      models: Object.fromEntries(
        REVIEW_PROVIDERS.map((provider) => [
          provider,
          readReviewModel(
            requireTable(kindTable, provider, kindWhere),
            provider,
            `[review.${name}.${provider}]`,
            baseModels[provider],
          ),
        ]),
      ) as Record<ReviewProvider, ReviewModelSettings>,
    };
  };

  return { timeoutMinutes: timeout, code: kind("code"), security: kind("security"), doc: kind("doc") };
}

function settingOf(source: "kind" | "review", provider: ReviewProviderChoice | undefined): ReviewProviderSetting | undefined {
  return provider === undefined ? undefined : { source, provider };
}

/** 優先順に並べた候補のうち、最初に値があったもの。どれも無ければ既定の auto */
function firstProvider(candidates: (ReviewProviderSetting | undefined)[]): ReviewProviderSetting {
  return candidates.find((candidate) => candidate !== undefined) ?? { source: "default", provider: "auto" };
}

/** provider を1行で表す（config の表示用）。設定ファイル以外から来たときは出所を添える */
export function describeProvider(setting: ReviewProviderSetting): string {
  if (setting.source === "cloud") return `${setting.provider}（${cloudEnvLabel(setting.provider)}）`;
  return setting.source === "env" ? `${setting.provider}（環境変数 ${REVIEW_PROVIDER_ENV}）` : setting.provider;
}

export interface ResolvedReviewProvider {
  provider: ReviewProvider;
  source: ReviewProviderSource;
}

/** auto をメインのセッションのプロバイダ（claude）に解決する */
export function resolveReviewProvider(settings: ReviewKindSettings): ResolvedReviewProvider {
  const { provider, source } = settings.provider;
  return { provider: provider === "auto" ? MAIN_PROVIDER : provider, source };
}

function checkEnum<T extends string>(
  value: string | undefined,
  allowed: T[],
  where: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as string[]).includes(value)) {
    throw new HikyakuError(
      `${where} の値が不正です: ${value}`,
      `使用できる値: ${allowed.join(" | ")}`,
    );
  }
  return value as T;
}

function readEnum<T extends string>(
  table: TomlTable | undefined,
  key: string,
  allowed: T[],
  where: string,
): T | undefined {
  return checkEnum(readString(table, key, where), allowed, `${where}.${key}`);
}

/**
 * ルート設定の ask を読む。
 *
 * 未知のキーは黙って無視せずエラーにする。タイプミスを捨てると
 * 「尋ねるはずのキーが尋ねられない」という、起きてから気づけない壊れ方になる。
 */
function readAskKeys(table: TomlTable | undefined, path: string): AskKey[] {
  const value = table?.["ask"];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HikyakuError(
      `${path}: ask はキー名の配列で指定してください`,
      `例: ask = ["base_branch", "external.target"]`,
    );
  }

  const keys: AskKey[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(ASK_KEYS as string[]).includes(item)) {
      throw new HikyakuError(
        `${path}: ask に指定できないキーです: ${String(item)}`,
        `使用できるキー: ${ASK_KEYS.join(" | ")}`,
      );
    }
    keys.push(item as AskKey);
  }
  return ASK_KEYS.filter((key) => keys.includes(key));
}

/** ドット記法（branch.prefix）で値を引く。ask の検査にだけ使う */
function readDotted(table: TomlTable, key: AskKey): TomlValue | undefined {
  let current: TomlValue | undefined = table;
  for (const part of key.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as TomlTable)[part];
  }
  return current;
}

/** [branch] を fallback に重ねる。サイクル設定でも同じ規則で読むため関数に切り出す */
function readBranchNaming(table: TomlTable | undefined, fallback: BranchNaming): BranchNaming {
  const separator = readString(table, "separator", "[branch]") ?? fallback.separator;
  if (separator === "") {
    throw new HikyakuError(
      "[branch].separator に空文字は指定できません",
      "空文字にするとブランチ名からサイクルとフェーズを解析できなくなります。",
    );
  }
  return { prefix: readString(table, "prefix", "[branch]") ?? fallback.prefix, separator };
}

function loadFile(path: string): TomlTable | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return parseToml(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof TomlError) {
      throw new HikyakuError(`${path} の解析に失敗しました: ${error.message}`);
    }
    throw error;
  }
}

/** v1 の設定キーを検出して、移行を促す */
function checkLegacyKeys(table: TomlTable, path: string): { docRoot?: string } {
  if (table["issue_backend"] !== undefined) {
    throw new HikyakuError(
      `${path}: issue_backend は v2.0.0 で廃止されました`,
      [
        "[external] target = \"github\" などへ移行してください。",
        "完了判定が GitHub のライブ照会から tasklist.md の PR 列に変わるため、",
        "挙動が変わります。黙って読み替えることはしません。",
      ].join("\n"),
    );
  }
  const docRoot = table["doc_root"];
  if (docRoot !== undefined && typeof docRoot === "string") {
    return { docRoot };
  }
  return {};
}

/** マージ済みテーブルから profile を決める */
function resolveProfile(merged: TomlTable, override: string | undefined): ProfileName {
  const raw = override ?? readString(merged, "profile", "config");
  if (raw === undefined) return "standard";
  if (!(PROFILE_NAMES as string[]).includes(raw)) {
    throw new HikyakuError(
      `profile の値が不正です: ${raw}`,
      `使用できる値: ${PROFILE_NAMES.join(" | ")}`,
    );
  }
  return raw as ProfileName;
}

/** 2つのテーブルをキー単位でマージする（ネストしたテーブルは再帰的に） */
function mergeTables(base: TomlTable, override: TomlTable): TomlTable {
  const out: TomlTable = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    const bothTables =
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing);
    out[key] = bothTables ? mergeTables(existing as TomlTable, value as TomlTable) : (value as TomlValue);
  }
  return out;
}

/**
 * [diff] を読む。exclude / tests は既定値を置き換える（足し合わせない）。
 * 既定値に足したいときは、既定値（hikyaku config --json の diff）を写してから足す。
 * 差分の事実の印（test_declarations / skip_markers / assertion_markers）は既定に追加される。
 * 既定を消せると、テストの後退を設定で見えなくできてしまう
 */
function readDiffPatterns(table: TomlTable | undefined): DiffPatterns {
  const where = "[diff]";
  const read = (key: string, fallback: string[]): string[] => {
    const values = readStringArray(table, key, where) ?? fallback;
    if (values.some((pattern) => pattern.trim() === "")) {
      throw new HikyakuError(`${where}.${key} に空のパターンがあります`);
    }
    return values;
  };
  const extend = (key: string, defaults: string[]): string[] => [...new Set([...defaults, ...read(key, [])])];
  return {
    exclude: read("exclude", DEFAULT_DIFF_EXCLUDE),
    tests: read("tests", DEFAULT_DIFF_TESTS),
    testDeclarations: extend("test_declarations", DEFAULT_TEST_DECLARATIONS),
    skipMarkers: extend("skip_markers", DEFAULT_SKIP_MARKERS),
    assertionMarkers: extend("assertion_markers", DEFAULT_ASSERTION_MARKERS),
  };
}

/**
 * トークン数の指定。整数（250000）か、k / m の単位を付けた文字列（"250k"・"1.2m"）で書ける。
 * 引用符の無い 250k は TOML として不正なので、単位を付けるときは文字列にする
 */
export function parseTokenCount(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s*$/.exec(value);
  if (match === null) return undefined;
  const unit = (match[2] ?? "").toLowerCase();
  const scale = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1;
  const tokens = Number(match[1]) * scale;
  return Number.isInteger(tokens) && tokens > 0 ? tokens : undefined;
}

/** 割合の指定。"90%" か 0〜1 の小数（0.9）で書ける */
export function parseRatio(value: unknown): number | undefined {
  let ratio: number | undefined;
  if (typeof value === "number") ratio = value;
  else if (typeof value === "string") {
    const match = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(value);
    if (match !== null) ratio = Number(match[1]) / 100;
  }
  return ratio !== undefined && ratio > 0 && ratio < 1 ? ratio : undefined;
}

function readContextLimits(table: TomlTable | undefined): ContextLimits {
  const where = "[context]";
  let limit = DEFAULT_CONTEXT_LIMITS.limit;
  const rawLimit = table?.["limit"];
  if (rawLimit !== undefined) {
    const value = parseTokenCount(rawLimit);
    if (value === undefined) {
      throw new HikyakuError(
        `${where}.limit はトークン数で指定してください（現在: ${JSON.stringify(rawLimit)}）`,
        '正の整数（600000）か、k / m の単位を付けた文字列（"600k"）で書いてください。',
      );
    }
    limit = value;
  }
  const ratio = (key: "estimate_ratio" | "merge_ratio", fallback: number): number => {
    const raw = table?.[key];
    if (raw === undefined) return fallback;
    const value = parseRatio(raw);
    if (value === undefined) {
      throw new HikyakuError(
        `${where}.${key} は 0 より大きく 1 より小さい割合で指定してください（現在: ${JSON.stringify(raw)}）`,
        '"90%" か 0.9 のように書いてください。',
      );
    }
    return value;
  };
  const limits = {
    limit,
    estimateRatio: ratio("estimate_ratio", DEFAULT_CONTEXT_LIMITS.estimateRatio),
    mergeRatio: ratio("merge_ratio", DEFAULT_CONTEXT_LIMITS.mergeRatio),
  };
  if (limits.mergeRatio >= limits.estimateRatio) {
    throw new HikyakuError(
      `${where}.merge_ratio（${limits.mergeRatio}）は estimate_ratio（${limits.estimateRatio}）より小さくしてください`,
      "予測ピークが limit × merge_ratio 未満なら統合を検討、limit × estimate_ratio（見積もりの上限）超なら分割を検討します。",
    );
  }
  return limits;
}

/** v3 で廃止したキー */
const RETIRED_KEYS = ["bp_max", "bp_actual", "user_stories_gate"] as const;

/** v3 で廃止した [context] のキー（limit と割合に置き換えた） */
const RETIRED_CONTEXT_KEYS = ["merge_below", "split_above", "approval", "implement", "review"] as const;

/**
 * v3 で廃止したキーの、移行先を示すエラー。黙って無視すると「設定したのに効かない」になるので、
 * v3 の作業に使う設定からは必ず止める（ルート設定は読んだ時点、サイクル設定は assertCurrentConfig で）
 */
function retiredKeyErrors(table: TomlTable, where: string): HikyakuError[] {
  const errors: HikyakuError[] = [];
  if (table["bp_max"] !== undefined) {
    errors.push(new HikyakuError(
      `${where}: bp_max は v3 で廃止しました`,
      [
        "ビルドの大きさは BP ではなく、メインセッションのコンテキストの予測ピーク（トークン）で判定します。",
        '上限は [context] limit（既定 "600k"）で、予測ピークが見積もりの上限（limit の 90%）を超えたら分割を検討します。',
        "bp_max を削除してください（docs/migration/v2-to-v3.md）。",
      ].join("\n"),
    ));
  }
  if (table["bp_actual"] !== undefined) {
    errors.push(new HikyakuError(
      `${where}: [bp_actual] は [diff] に改名しました`,
      "exclude / tests の書き方は同じです。テーブル名を [diff] に変えてください。",
    ));
  }
  if (table["user_stories_gate"] !== undefined) {
    errors.push(new HikyakuError(
      `${where}: user_stories_gate は v3 で廃止しました`,
      [
        "G1（user-stories の承認）は要件の合意なので同意として扱い、どのプロファイル・設定でも外せません。",
        "user_stories_gate を削除してください（docs/configuration/profiles.md）。",
      ].join("\n"),
    ));
  }
  const context = table["context"];
  const retiredContext = isTable(context) ? RETIRED_CONTEXT_KEYS.filter((key) => context[key] !== undefined) : [];
  if (retiredContext.length > 0) {
    errors.push(new HikyakuError(
      `${where}: [context] ${retiredContext.join(" / ")} は v3 で廃止しました`,
      [
        "[context] は上限（limit、既定 \"600k\"）だけを決める形になりました。",
        "見積もりの上限（分割を検討する境目）は limit × estimate_ratio（既定 90%）、統合の目安は limit × merge_ratio（既定 60%）で求めます。",
        "区切り（G8・実装開始前・レビュー前）の目安は、完了までの見込みを limit と比べる判定に置き換わりました。",
        "split_above を変えていたなら limit = split_above ÷ 0.9 を目安に書き換え、ほかのキーは削除してください（docs/migration/v2-to-v3.md）。",
      ].join("\n"),
    ));
  }
  const review = table["review"];
  if (isTable(review) && hasProviderFor(review)) {
    errors.push(new HikyakuError(
      `${where}: [review] provider_for は v3 で廃止しました`,
      [
        "メインのセッションは常に Claude Code になったので、メインのプロバイダごとに実行先を分ける必要がなくなりました。",
        'claude = "codex" と書いていたなら、[review] provider = "codex"（種類ごとなら [review.<種類>] provider）に書き換えてください。',
        "codex の行だけなら削除してください（docs/migration/v2-to-v3.md）。",
      ].join("\n"),
    ));
  }
  const external = table["external"];
  if (isTable(external) && (external["target"] === "asana" || external["asana_project_gid"] !== undefined)) {
    errors.push(new HikyakuError(
      `${where}: Asana への投影は v3 で廃止しました`,
      [
        "外部システムへの投影は、サイクルごとの GitHub issue の作成とクローズだけになりました。",
        `[external] target を ${EXTERNAL_TARGETS.map((target) => `"${target}"`).join(" か ")} にし、asana_project_gid を削除してください（docs/migration/v2-to-v3.md）。`,
      ].join("\n"),
    ));
  }
  return errors;
}

function isTable(value: unknown): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** [review] と [review.<種類>] のどこかに provider_for があるか */
function hasProviderFor(review: TomlTable): boolean {
  return review["provider_for"] !== undefined || REVIEW_KINDS.some((kind) => {
    const table = review[kind];
    return isTable(table) && table["provider_for"] !== undefined;
  });
}

/** 廃止したキーを取り除く。閉じたサイクルの設定に残っていても、読むだけの操作は止めない */
function stripRetiredKeys(table: TomlTable): void {
  for (const key of RETIRED_KEYS) delete table[key];
  const context = table["context"];
  if (isTable(context)) for (const key of RETIRED_CONTEXT_KEYS) delete context[key];
  const review = table["review"];
  if (isTable(review)) {
    delete review["provider_for"];
    for (const kind of REVIEW_KINDS) {
      const kindTable = review[kind];
      if (isTable(kindTable)) delete kindTable["provider_for"];
    }
  }
  const external = table["external"];
  if (isTable(external)) {
    if (external["target"] === "asana") delete external["target"];
    delete external["asana_project_gid"];
  }
}

/**
 * サイクル設定に残った廃止キーを、v3 の作業（step の手順・予測ピークの見積もり・tasklist の書き込み）に
 * 使う前に止める。読むだけの操作（cycle list / status、validate の閉じたサイクル）では止めない。
 * 閉じた v2 のサイクルの設定には bp_max が残っていてよく、それで全体の操作が止まらないようにするため
 */
export function assertCurrentConfig(config: ResolvedConfig): void {
  const [first] = config.retired;
  if (first !== undefined) throw first;
}

function readDataIntegrity(table: TomlTable | undefined): DataIntegrityConfig {
  const where = "[data_integrity]";
  const releaseBranches = readStringArray(table, "release_branches", where) ?? [];
  if (releaseBranches.some((pattern) => pattern.trim() === "")) {
    throw new HikyakuError(`${where}.release_branches に空のパターンがあります`);
  }
  return {
    releaseBranches,
    allowUnsafeSplit: readBoolean(table, "allow_unsafe_split", where) ?? false,
  };
}

function readAxis<T extends string>(table: TomlTable, key: string, values: readonly T[], where: string): T | undefined {
  const value = table[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new HikyakuError(`${where}.${key} の値が不正です: ${JSON.stringify(value)}`, `使用できる値: ${values.join(" | ")}`);
  }
  return value as T;
}

function readPaths(table: TomlTable, key: string, where: string, required: boolean): string[] {
  const paths = readStringArray(table, key, where);
  if (paths === undefined) {
    if (required) throw new HikyakuError(`${where}.${key} がありません`, "パス（glob）の配列で書いてください。");
    return [];
  }
  if (paths.some((path) => path.trim() === "")) throw new HikyakuError(`${where}.${key} に空のパスがあります`);
  if (required && paths.length === 0) throw new HikyakuError(`${where}.${key} が空です`);
  return paths;
}

/**
 * [app] を読む。作業ツリーのルート設定と、基準（merge-base）のルート設定の両方で使う。
 * 宣言は上限を決めるので、不正な値・知らないキーは黙って捨てずにエラーにする
 */
export function readAppDeclaration(table: TomlTable | undefined, where = "[app]"): AppDeclaration | undefined {
  if (table === undefined) return undefined;
  assertKnownKeys(table, ["exposure", "data", "impact", "merge_gate", "areas"], where);
  const exposure = readAxis(table, "exposure", EXPOSURES, where);
  const data = readAxis(table, "data", DATA_WEIGHTS, where);
  const impact = readAxis(table, "impact", IMPACTS, where);
  if (exposure === undefined || data === undefined || impact === undefined) {
    throw new HikyakuError(
      `${where} には exposure・data・impact の3つが必要です`,
      "どれかを省くと上限を決められません。3軸すべてを書いてください（docs/configuration/config-file.md）。",
    );
  }
  const mergeGate = readAxis(table, "merge_gate", ["user"] as const, where);

  const rawAreas = table["areas"];
  const areas: AppArea[] = [];
  if (rawAreas !== undefined) {
    if (!Array.isArray(rawAreas) || rawAreas.some((item) => !isTable(item))) {
      throw new HikyakuError(`${where}.areas は [[app.areas]] のテーブル配列で書いてください`);
    }
    rawAreas.forEach((item, index) => {
      const area = item as TomlTable;
      const at = `[[app.areas]] の ${index + 1} 件目`;
      assertKnownKeys(area, ["name", "paths", "exposure", "data", "impact"], at);
      const name = readString(area, "name", at);
      if (name === undefined || name.trim() === "") throw new HikyakuError(`${at} に name がありません`, "前提の参照 area:<name> に使う名前を書いてください。");
      if (areas.some((entry) => entry.name === name)) throw new HikyakuError(`[[app.areas]] の name が重複しています: ${name}`);
      const entry: AppArea = { name, paths: readPaths(area, "paths", at, true) };
      const areaExposure = readAxis(area, "exposure", EXPOSURES, at);
      const areaData = readAxis(area, "data", DATA_WEIGHTS, at);
      const areaImpact = readAxis(area, "impact", IMPACTS, at);
      if (areaExposure !== undefined) entry.exposure = areaExposure;
      if (areaData !== undefined) entry.data = areaData;
      if (areaImpact !== undefined) entry.impact = areaImpact;
      areas.push(entry);
    });
  }
  return { axes: { exposure, data, impact }, mergeGate, areas };
}

/** [consent]（サイクル設定でだけ書ける）。deferred は書いた素の値で、有効かは deferred-consent.mts が判定する */
export interface ConsentConfig {
  deferred: boolean | undefined;
}

/**
 * [consent] を読む。作業ツリーのサイクル設定と、基準（merge-base）のサイクル設定の両方で使う。
 * 事後同意は緩める向きの設定なので、知らないキー・真偽値でない値は黙って捨てずにエラーにする
 */
export function readConsent(table: TomlTable | undefined, where = "[consent]"): ConsentConfig {
  if (table === undefined) return { deferred: undefined };
  assertKnownKeys(table, ["deferred"], where);
  return { deferred: readBoolean(table, "deferred", where) };
}

/** サイクル設定でだけ書けるテーブル（ルートに書くと全サイクルに効き、G1 の合意を経ずに緩められる） */
const CYCLE_ONLY_TABLES = ["consent"] as const;

/** ルート設定に、サイクル設定でだけ書けるテーブルが無いか検査する */
function assertNotCycleOnly(table: TomlTable, path: string): void {
  const found = CYCLE_ONLY_TABLES.filter((key) => table[key] !== undefined);
  if (found.length === 0) return;
  throw new HikyakuError(
    `${path}: ${found.map((key) => `[${key}]`).join("・")} はリポジトリルートの設定では指定できません`,
    [
      "事後同意（[consent] deferred）はサイクルごとに G1 でユーザーが合意して選ぶ設定なので、",
      "サイクルの .hikyaku.config にだけ書けます（docs/configuration/config-file.md）。",
    ].join("\n"),
  );
}

/** [boundaries] を読む。作業ツリーのルート設定と、基準（merge-base）のルート設定の両方で使う */
export function readBoundaries(table: TomlTable | undefined): Boundaries {
  if (table === undefined) return { external: [], internal: [] };
  const where = "[boundaries]";
  assertKnownKeys(table, ["external", "internal"], where);
  return { external: readPaths(table, "external", where, false), internal: readPaths(table, "internal", where, false) };
}

/**
 * サイクル設定に、サイクル側では決められないキーが無いか検査する。
 *
 * 黙って無視すると「設定したのに効かない」という最も気づきにくい壊れ方をするので、
 * 見つけたらエラーにする。
 */
function assertCycleOverridable(table: TomlTable, path: string): void {
  if (table["profile"] !== undefined) {
    throw new HikyakuError(
      `${path}: profile はサイクル設定では指定できません`,
      [
        "profile はサイクルの属性で、cycles.md が唯一の正です。",
        "同じ状態を2箇所に持つと必ず食い違うため、cycles.md 側で変更してください。",
      ].join("\n"),
    );
  }

  // ask は「作成時に決める」の宣言。サイクルが存在する時点で尋ねる相手も
  // タイミングも無いので、書いても効かない
  if (table["ask"] !== undefined) {
    throw new HikyakuError(
      `${path}: ask はサイクル設定では指定できません`,
      [
        "ask は「create-cycle 時に決める」という宣言なので、リポジトリルートの",
        ".hikyaku.config でのみ意味を持ちます。サイクル設定には決まった値を書いてください。",
      ].join("\n"),
    );
  }

  // リリースされるブランチはリポジトリの運用で決まる。サイクルが自分の base_branch を
  // 外せると、緩和を許すかどうかの判断をサイクル自身が下せてしまう
  const integrity = readTable(table, "data_integrity");
  if (integrity?.["release_branches"] !== undefined) {
    throw new HikyakuError(
      `${path}: data_integrity.release_branches はサイクル設定では指定できません`,
      [
        "リリースされるブランチはリポジトリのブランチ運用で決まるので、リポジトリルートの",
        ".hikyaku.config でのみ宣言できます。サイクルで決められるのは allow_unsafe_split だけです。",
      ].join("\n"),
    );
  }

  // アプリケーションの状況と境界はリポジトリの宣言。サイクルが自分の上限を緩められると、
  // 害の受け入れを AI に任せてよいかの判断をサイクル自身が下せてしまう
  const declared = ["app", "boundaries"].filter((key) => table[key] !== undefined);
  if (declared.length > 0) {
    throw new HikyakuError(
      `${path}: ${declared.map((key) => `[${key}]`).join("・")} はサイクル設定では指定できません`,
      [
        "アプリケーションの状況（[app]・[[app.areas]]）と境界（[boundaries]）はリポジトリの宣言なので、",
        "リポジトリルートの .hikyaku.config でのみ書けます。",
      ].join("\n"),
    );
  }

  const locked = CYCLE_LOCKED_KEYS.filter((key) => table[key] !== undefined);
  if (locked.length > 0) {
    throw new HikyakuError(
      `${path}: サイクル設定では上書きできないキーがあります: ${locked.join(", ")}`,
      [
        "hikyaku_root はワークスペースの所在そのものなので、リポジトリルートの",
        ".hikyaku.config でのみ宣言できます。サイクルごとに動かせるようにすると、",
        "そのサイクル設定をどこから読むかが決まりません。",
      ].join("\n"),
    );
  }
}

export function loadConfig(options: LoadOptions = {}): ResolvedConfig {
  const root = repoRoot();
  const sources: string[] = [];

  const repoConfigPath = join(root, ".hikyaku.config");
  const repoConfig = loadFile(repoConfigPath);
  if (repoConfig) {
    sources.push(repoConfigPath);
  } else if (options.root === undefined && !options.allowMissingRoot) {
    // --root で明示された場合は CI やテストからの直接実行とみなして許容する
    throw new HikyakuError(
      `リポジトリルートに .hikyaku.config がありません: ${repoConfigPath}`,
      [
        "/hikyaku:init を実行して生成してください。",
        "hikyaku_root はこのファイルでのみ宣言できます。",
      ].join("\n"),
    );
  }
  if (repoConfig) assertNotCycleOnly(repoConfig, repoConfigPath);
  const legacy = repoConfig ? checkLegacyKeys(repoConfig, repoConfigPath) : {};
  // ルート設定は全サイクルに効くので、読んだ時点で止める
  const [retiredAtRoot] = repoConfig ? retiredKeyErrors(repoConfig, repoConfigPath) : [];
  if (retiredAtRoot !== undefined) throw retiredAtRoot;
  const askDeclared = readAskKeys(repoConfig, repoConfigPath);

  // HIKYAKU_ROOT: --root → config の hikyaku_root（旧 doc_root）
  const configured =
    (repoConfig ? readString(repoConfig, "hikyaku_root", "config") : undefined) ?? legacy.docRoot;
  const candidate = options.root ?? configured;

  if (candidate === undefined) {
    if (options.allowMissingRoot) {
      return finalize(repoConfig ?? {}, root, "", sources, options.profileOverride, askDeclared);
    }
    throw new HikyakuError("HIKYAKU_ROOT を解決できませんでした", [
      "次のいずれかを指定してください:",
      "  リポジトリルートの .hikyaku.config に hikyaku_root を設定する（/hikyaku:init が生成します）",
      "  --root <path> で明示する",
    ].join("\n"));
  }

  // 絶対パスも正規化する。末尾の `.` や `..` を残すと、同じディレクトリでも
  // 文字列比較をすり抜けてリポジトリルートを HIKYAKU_ROOT にできてしまう。
  const hikyakuRoot = resolve(root, candidate);

  // リポジトリルート自身は HIKYAKU_ROOT にできない。ルートの .hikyaku.config と
  // ワークスペースの .hikyaku.config が同じファイルになり、以下の古い設定の検出が
  // 自分自身を弾く。cycles/ や document-guide.md をルート直下に散らかす形にもなる
  if (hikyakuRoot === root) {
    throw new HikyakuError(
      "hikyaku_root にリポジトリルート自身は指定できません",
      "docs/hikyaku のようなサブディレクトリを指定してください。",
    );
  }

  // v2.0 の初期実装が生成していた中間層。読まなくなったので、置いたままだと
  // 「設定したつもりの値が効かない」状態になる。黙って無視せず対処を促す
  const staleWorkspaceConfig = join(hikyakuRoot, ".hikyaku.config");
  if (existsSync(staleWorkspaceConfig)) {
    throw new HikyakuError(
      `${staleWorkspaceConfig} は読み込まれません`,
      [
        "設定を置ける場所はリポジトリルートとサイクルディレクトリの2箇所です。",
        "内容をリポジトリルートの .hikyaku.config へ移してから、このファイルを削除してください。",
      ].join("\n"),
    );
  }

  let merged: TomlTable = repoConfig ?? {};
  // 宣言されたキーのうち、そのサイクルがまだ答えていないもの。
  // サイクルが決まっていない（create-cycle 前）なら宣言そのまま
  let askAtCreate = askDeclared;
  let retired: HikyakuError[] = [];
  if (options.cycleDir !== undefined) {
    const cycleConfigPath = join(options.cycleDir, ".hikyaku.config");
    const cycleConfig = loadFile(cycleConfigPath);
    if (cycleConfig) {
      sources.push(cycleConfigPath);
      checkLegacyKeys(cycleConfig, cycleConfigPath);
      // 閉じた v2 のサイクルにも残りうるので、ここでは止めずに記録し、v3 の作業に使うときに止める
      retired = retiredKeyErrors(cycleConfig, cycleConfigPath);
      stripRetiredKeys(cycleConfig);
      assertCycleOverridable(cycleConfig, cycleConfigPath);
      askAtCreate = askDeclared.filter((key) => readDotted(cycleConfig, key) === undefined);
      merged = mergeTables(merged, cycleConfig);
    }
  }

  return { ...finalize(merged, root, hikyakuRoot, sources, options.profileOverride, askAtCreate), retired };
}

/**
 * そのサイクルのブランチ命名規則だけを引く。
 *
 * サイクルの解決にはブランチ名の解析が要り、ブランチ名の解析には命名規則が要る。
 * その命名規則をサイクル側で上書きできるので、loadConfig（サイクルが決まっている
 * 前提）では循環する。ここは [branch] だけをサイクル設定から読んで先に決める。
 *
 * 設定ファイルが無ければベースの規則をそのまま返すので、既定では全サイクルが
 * 同じ規則になる。
 */
export function cycleBranchNaming(base: ResolvedConfig, cycleDirectory: string): BranchNaming {
  const table = loadFile(join(cycleDirectory, ".hikyaku.config"));
  if (table === undefined) return base.branch;
  return readBranchNaming(readTable(table, "branch"), base.branch);
}

function finalize(
  merged: TomlTable,
  root: string,
  hikyakuRoot: string,
  sources: string[],
  profileOverride: string | undefined,
  askAtCreate: AskKey[],
): ResolvedConfig {
  const profile = resolveProfile(merged, profileOverride);
  const preset = PROFILES[profile];

  const gates: Gates = {
    codebaseSurvey:
      readBoolean(merged, "codebase_survey_gate", "config") ?? preset.gates.codebaseSurvey,
    designChoice: readBoolean(merged, "design_choice_gate", "config") ?? preset.gates.designChoice,
    architecture: readBoolean(merged, "architecture_gate", "config") ?? preset.gates.architecture,
    plan: readBoolean(merged, "plan_gate", "config") ?? preset.gates.plan,
    promotion: readBoolean(merged, "promotion_gate", "config") ?? preset.gates.promotion,
  };

  const reviews: Reviews = {
    userStories: readBoolean(merged, "user_stories_review", "config") ?? preset.reviews.userStories,
    architecture:
      readBoolean(merged, "architecture_review", "config") ?? preset.reviews.architecture,
    tasklist: readBoolean(merged, "tasklist_review", "config") ?? preset.reviews.tasklist,
    plan: readBoolean(merged, "plan_review", "config") ?? preset.reviews.plan,
    testSpec: readBoolean(merged, "test_spec_review", "config") ?? preset.reviews.testSpec,
    code: readBoolean(merged, "code_review", "config") ?? preset.reviews.code,
    security:
      readEnum(merged, "security_review", ["off", "recommended", "on"], "config") ??
      preset.reviews.security,
    retrospective:
      readEnum(merged, "retrospective", ["skip", "prompt", "auto"], "config") ??
      preset.reviews.retrospective,
    validate:
      readEnum(merged, "validate", ["manual", "phase", "step"], "config") ?? preset.reviews.validate,
  };

  const reviewTable = requireTable(merged, "review", "config");
  const contextLimits = readContextLimits(readTable(merged, "context"));
  const securityTable = readTable(reviewTable ?? {}, "security");
  const externalTable = readTable(merged, "external");

  return {
    repoRoot: root,
    hikyakuRoot,
    profile,
    baseBranch: readString(merged, "base_branch", "config"),
    gates,
    reviews,
    branch: readBranchNaming(readTable(merged, "branch"), DEFAULT_NAMING),
    pr: {
      title: readString(readTable(merged, "pr"), "title", "[pr]") ?? DEFAULT_PR_TITLE,
      reviewers: readReviewers(readTable(merged, "pr"), "reviewers", "[pr]"),
      reviewersSkip: readReviewerSkip(readTable(merged, "pr")),
      autoReady: readBoolean(readTable(merged, "pr"), "auto_ready", "[pr]") ?? true,
    },
    session: {
      title:
        readString(readTable(merged, "session"), "title", "[session]") ?? DEFAULT_SESSION_TITLE,
    },
    security: {
      triggers: readString(securityTable, "triggers", "[review.security]") ?? DEFAULT_SECURITY_TRIGGERS,
    },
    review: readReview(reviewTable, preset.reviewRounds),
    external: {
      target: readEnum(externalTable, "target", [...EXTERNAL_TARGETS], "[external]") ?? "none",
      githubRepo: readString(externalTable, "github_repo", "[external]"),
    },
    conductor: readConductor(readTable(merged, "conductor")),
    dataIntegrity: readDataIntegrity(readTable(merged, "data_integrity")),
    app: readAppDeclaration(requireTable(merged, "app", "config")),
    boundaries: readBoundaries(requireTable(merged, "boundaries", "config")),
    consent: readConsent(requireTable(merged, "consent", "config")),
    diff: readDiffPatterns(readTable(merged, "diff")),
    context: contextLimits,
    peakBands: peakBandsOf(contextLimits),
    rules: readRulesConfig(readTable(merged, "rules")),
    areas: readAreasConfig(readTable(merged, "areas")),
    metrics: readMetricsConfig(readTable(merged, "metrics")),
    askAtCreate,
    sources,
    retired: [],
  };
}
