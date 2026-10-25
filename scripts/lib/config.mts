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
export type ExternalTarget = "none" | "github" | "asana";

export const PROFILE_NAMES: ProfileName[] = ["express", "economy", "standard", "thorough"];

/**
 * 承認ゲート。ここに無いゲートは profile の管轄外で、常に有効:
 *   G6  tasklist / issue 変更承認（build-manager）
 *   G8  plan + test-spec 承認（builder）
 *   G10 永続ドキュメント昇格の承認（close-cycle）
 * profile で外せるのは「確認」であって「同意」ではない。
 */
export interface Gates {
  /**
   * G1 planner: user-stories 承認。
   * どのプロファイルでも on。要件の合意は後段の承認では代替できない
   * （設計も plan も「その要件で正しいか」を前提に置くため）。
   */
  userStories: boolean;
  /** G2 architect: codebase-survey 確認 */
  codebaseSurvey: boolean;
  /**
   * G3 architect: 設計案の選択。
   * off にすると AI が推奨案をそのまま採用する。express だけが off で、
   * 要件（G1）を人間が握っているなら、その先の trade-off は推奨に委ねても
   * 引き返せる、という判断による。採用理由と退けた案は ADR に残る。
   */
  designChoice: boolean;
  /** G4 architect: 設計ドキュメント承認 */
  architecture: boolean;
  /** G7 builder: plan 単独の承認（thorough のみ。他は G8 に統合） */
  plan: boolean;
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

/** レビューを実行するプロバイダ。auto はメインのセッションと同じものを使う */
export type ReviewProvider = "claude" | "codex";
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
export type ReviewProviderSource =
  | "cloud"
  | "env"
  | "kind.provider_for"
  | "kind"
  | "review.provider_for"
  | "review"
  | "default";

/**
 * provider を決める規則の1段。
 *   provider     その値をそのまま使う
 *   providerFor  メインのプロバイダの行があればその値を使い、無ければ次の段へ進む
 *
 * provider_for はメインのプロバイダが分からないと決まらないので、設定の段階では規則の列のまま持ち、
 * --self を受け取る review resolve / run で解決する（resolveReviewProvider）
 */
export type ReviewProviderRule =
  | { source: "cloud"; provider: ReviewProvider }
  | { source: "env" | "kind" | "review" | "default"; provider: ReviewProviderChoice }
  | { source: "kind.provider_for" | "review.provider_for"; providerFor: Partial<Record<ReviewProvider, ReviewProvider>> };

export interface ReviewKindSettings {
  /** 優先順に並んだ規則。最後は必ず default（auto） */
  providers: ReviewProviderRule[];
  /** 1 = 1回だけ / n = パスするまで最大 n 回 / 0 = 無制限 */
  maxRounds: number;
  /** maxRounds = 0（無制限）の2ラウンド目以降、指摘への対応を確認せずに直すか */
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
 * 各プロバイダのクラウド環境を示す環境変数。クラウド環境では相手のプロバイダの CLI が無いので、
 * そこで動いているプロバイダに固定する。レビューと conductor で共用し、設定ファイルより優先する。
 * レビューでは HIKYAKU_REVIEW_PROVIDER よりも優先する。
 * 両方が立っていれば並びの先（claude）を使う
 */
export const REVIEW_CLOUD_ENVS: { provider: ReviewProvider; variable: string; matches: (value: string) => boolean }[] = [
  { provider: "claude", variable: "CLAUDE_CODE_REMOTE", matches: (value) => value === "true" },
  { provider: "codex", variable: "CODEX_ENVIRONMENT_ID", matches: (value) => value !== "" },
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
  // 人間の時間を節約する。承認は減らすが AI には見させる。
  // 人間が握るのは要件（G1）だけで、その先の設計判断は AI の推奨に委ねる。
  // 委ねるぶん、security と retrospective は AI 側で回して担保を戻す
  express: {
    gates: {
      userStories: true,
      codebaseSurvey: false,
      designChoice: false,
      architecture: false,
      plan: false,
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
  // AI 実行コストを節約する。中間成果物のレビューを起動しないが人間は見る。
  // code だけは全プロファイルで残す（コードの差分は承認ゲートが拾える粒度を超えるため）。
  // security も落とさない（節約の対象にしてよい観点ではないため、既定は recommended）
  economy: {
    gates: {
      userStories: true,
      codebaseSurvey: false,
      designChoice: true,
      architecture: true,
      plan: false,
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
  // 完成した成果物の単位で、人間も AI も見る
  standard: {
    gates: {
      userStories: true,
      codebaseSurvey: false,
      designChoice: true,
      architecture: true,
      plan: false,
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
      userStories: true,
      codebaseSurvey: true,
      designChoice: true,
      architecture: true,
      plan: true,
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
export const REVIEWER_SKIP_TARGETS = ["init", "bp-guide", "create", "plan", "architect", "build", "close", "conductor"] as const;
export type ReviewerSkipTarget = (typeof REVIEWER_SKIP_TARGETS)[number];
/** セッション名の既定。空文字にするとセッション名を変更しない */
export const DEFAULT_SESSION_TITLE = "{cycle} {phase} {title}";
export const DEFAULT_BRANCH_PREFIX = "hikyaku";
export const DEFAULT_BRANCH_SEPARATOR = "/";
export const DEFAULT_BP_MAX = 8;

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
  bpMax: number;
  gates: Gates;
  reviews: Reviews;
  branch: BranchNaming;
  pr: { title: string; reviewers: string[]; reviewersSkip: ReviewerSkipTarget[] };
  /** セッション名のテンプレート。空文字なら変更しない */
  session: { title: string };
  security: { triggers: string };
  /** [review] — 各レビューのプロバイダ・モデル・回数 */
  review: ReviewSettings;
  external: { target: ExternalTarget; githubRepo?: string; asanaProjectGid?: string };
  conductor: ConductorConfig;
  /** [data_integrity] — ビルドのマージで本番データを壊さないための宣言 */
  dataIntegrity: DataIntegrityConfig;
  /**
   * ルート設定の ask に並んでいて、まだ答えが記録されていないキー。
   * create-cycle が尋ねる対象。サイクルを重ねた結果ここに残っていれば、
   * そのサイクルは未回答でルート設定の値のまま動いている
   */
  askAtCreate: AskKey[];
  /** 読み込んだ設定ファイルのパス（デバッグ用） */
  sources: string[];
}

export interface DataIntegrityConfig {
  /**
   * リリースされるブランチのパターン（glob）。ルート設定でのみ宣言できる。
   * デフォルトブランチは書かなくても暗黙に含まれる（判定は integrity.mts）
   */
  releaseBranches: string[];
  /** マージ時点で本番データの安全を保てないビルド分割を許すか。既定は false */
  allowUnsafeSplit: boolean;
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
export function readConductor(table: TomlTable | undefined, env: NodeJS.ProcessEnv = process.env): ConductorConfig {
  const where = "[conductor]";
  const budget = readNumber(table, "budget_per_run", where) ?? DEFAULT_CONDUCTOR.budgetPerRun;
  if (budget < 0) {
    throw new HikyakuError(`${where}.budget_per_run は 0 以上で指定してください（0 は上限なし）`);
  }
  const configured = checkEnum(readString(table, "provider", where), ["claude", "codex"] as const, `${where}.provider`);
  const cloud = detectCloudEnv(env);
  const provider = cloud?.provider ?? configured ?? DEFAULT_CONDUCTOR.provider;
  // 旧モデル設定は、環境判定前のプロバイダに属する。クラウドで切り替わっても持ち越さない。
  const legacy = readConductorModelSettings(table, where);
  const scoped = Object.fromEntries(REVIEW_PROVIDERS.map((name) => {
    const providerTable = requireTable(table, name, where);
    assertKnownKeys(providerTable, ["model", "models"], `[conductor.${name}]`);
    return [name, readConductorModelSettings(providerTable, `[conductor.${name}]`)];
  })) as Record<ReviewProvider, Pick<ConductorConfig, "model" | "models">>;
  const fallback = provider === (configured ?? DEFAULT_CONDUCTOR.provider) ? legacy : DEFAULT_CONDUCTOR;
  const selected = scoped[provider];
  const conductor: ConductorConfig = {
    provider,
    providerSource: cloud !== undefined ? "cloud" : configured !== undefined ? "config" : "default",
    escalate: readStringArray(table, "escalate", where) ?? DEFAULT_CONDUCTOR.escalate,
    delegate: readStringArray(table, "delegate", where) ?? DEFAULT_CONDUCTOR.delegate,
    allowedTools: readStringArray(table, "allowed_tools", where) ?? DEFAULT_CONDUCTOR.allowedTools,
    budgetPerRun: budget,
    requireApproval: readBoolean(table, "require_approval", where) ?? DEFAULT_CONDUCTOR.requireApproval,
    phaseReviewers: readReviewers(table, "phase_reviewers", where),
    reviewTimeoutMinutes: readTimeout(table, where),
    model: selected.model ?? fallback.model,
    // プロバイダ別の既定モデルは、旧形式のフェーズ別モデルよりも優先する。
    models: { ...(selected.model === undefined ? fallback.models : {}), ...selected.models },
  };
  if (provider === "codex" && (conductor.allowedTools.length > 0 || budget > 0)) {
    throw new HikyakuError(`${where}: codex では allowed_tools と budget_per_run は使えません（空配列・0 にしてください）`);
  }
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

/** 旧形式とプロバイダ別のモデル設定を同じ規則で検査する。未選択のプロバイダも検査する。 */
function readConductorModelSettings(table: TomlTable | undefined, where: string): Pick<ConductorConfig, "model" | "models"> {
  const model = readModel(table, "model", where);
  if (table?.["models"] !== undefined && readTable(table, "models") === undefined) {
    throw new HikyakuError(`${where}.models はテーブルで指定してください`);
  }
  const modelsTable = table === undefined ? undefined : readTable(table, "models");
  const modelsWhere = `${where.slice(0, -1)}.models]`;
  const models: Partial<Record<ConductorPhase, string>> = {};
  for (const key of Object.keys(modelsTable ?? {})) {
    if (!(CONDUCTOR_PHASES as readonly string[]).includes(key)) {
      throw new HikyakuError(
        `${modelsWhere} に指定できないキーです: ${key}`,
        `使用できるキー: ${CONDUCTOR_PHASES.join(" | ")}`,
      );
    }
    const phaseModel = readModel(modelsTable, key, modelsWhere);
    if (phaseModel !== undefined) models[key as ConductorPhase] = phaseModel;
  }
  return { model, models };
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
    ["provider", "provider_for", "max_rounds", "auto_fix", "timeout", ...REVIEW_PROVIDERS, ...REVIEW_KINDS],
    where,
  );

  const timeout = readNumber(table, "timeout", where) ?? DEFAULT_REVIEW_TIMEOUT_MINUTES;
  if (timeout <= 0) throw new HikyakuError(`${where}.timeout は 0 より大きい分数で指定してください`);

  const providers: ReviewProviderChoice[] = ["auto", ...REVIEW_PROVIDERS];
  const configured = readEnum(table, "provider", providers, where);
  const configuredFor = readProviderFor(requireTable(table, "provider_for", where), "[review.provider_for]");
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
        ? ["provider", "provider_for", ...REVIEW_PROVIDERS]
        : [
            "provider",
            "provider_for",
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
      providers: providerRules([
        cloud === undefined ? undefined : { source: "cloud", provider: cloud.provider },
        envProvider === undefined ? undefined : { source: "env", provider: envProvider },
        ruleFor("kind.provider_for", readProviderFor(requireTable(kindTable, "provider_for", kindWhere), `[review.${name}.provider_for]`)),
        ruleOf("kind", readEnum(kindTable, "provider", providers, kindWhere)),
        ruleFor("review.provider_for", configuredFor),
        ruleOf("review", configured),
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

/**
 * [review.provider_for] を読む。キーはメインのプロバイダ、値はレビューの実行先。
 * 「もう一方」のような相対の指定にしないのは、プロバイダが増えたときに意味が決まらなくなるため
 */
function readProviderFor(
  table: TomlTable | undefined,
  where: string,
): Partial<Record<ReviewProvider, ReviewProvider>> | undefined {
  if (table === undefined) return undefined;
  assertKnownKeys(table, REVIEW_PROVIDERS, where, `キーにはメインのセッションのプロバイダ（${REVIEW_PROVIDERS.join(" | ")}）を書きます`);
  const map: Partial<Record<ReviewProvider, ReviewProvider>> = {};
  for (const key of REVIEW_PROVIDERS) {
    const value = readEnum(table, key, REVIEW_PROVIDERS, where);
    if (value !== undefined) map[key] = value;
  }
  return map;
}

function ruleOf(source: "kind" | "review", provider: ReviewProviderChoice | undefined): ReviewProviderRule | undefined {
  return provider === undefined ? undefined : { source, provider };
}

function ruleFor(
  source: "kind.provider_for" | "review.provider_for",
  providerFor: Partial<Record<ReviewProvider, ReviewProvider>> | undefined,
): ReviewProviderRule | undefined {
  return providerFor === undefined ? undefined : { source, providerFor };
}

function providerRules(rules: (ReviewProviderRule | undefined)[]): ReviewProviderRule[] {
  return [...rules.filter((rule): rule is ReviewProviderRule => rule !== undefined), { source: "default", provider: "auto" }];
}

/** 規則の列を1行で表す（config の表示用）。左ほど優先 */
export function describeProviderRules(rules: ReviewProviderRule[]): string {
  // provider の段で必ず決まるので、それより後ろの段は表示しない
  const end = rules.findIndex((rule) => !("providerFor" in rule));
  return rules
    .slice(0, end + 1)
    .map((rule) => {
      if ("providerFor" in rule) {
        const pairs = REVIEW_PROVIDERS.filter((key) => rule.providerFor[key] !== undefined).map(
          (key) => `${key}→${rule.providerFor[key]}`,
        );
        return `provider_for（${pairs.length === 0 ? "空" : pairs.join(", ")}）`;
      }
      if (rule.source === "cloud") return `${rule.provider}（${cloudEnvLabel(rule.provider)}）`;
      return rule.source === "env" ? `${rule.provider}（環境変数 ${REVIEW_PROVIDER_ENV}）` : rule.provider;
    })
    .join(" > ");
}

export interface ResolvedReviewProvider {
  provider: ReviewProvider;
  source: ReviewProviderSource;
  /** provider_for で決まったとき、使った行のキー（メインのプロバイダ） */
  key: ReviewProvider | undefined;
}

/** 規則の列を、メインのプロバイダ（--self）で解決する。auto はメインと同じ */
export function resolveReviewProvider(settings: ReviewKindSettings, self: ReviewProvider): ResolvedReviewProvider {
  for (const rule of settings.providers) {
    if ("providerFor" in rule) {
      const target = rule.providerFor[self];
      if (target !== undefined) return { provider: target, source: rule.source, key: self };
      continue;
    }
    return { provider: rule.provider === "auto" ? self : rule.provider, source: rule.source, key: undefined };
  }
  return { provider: self, source: "default", key: undefined };
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
  const legacy = repoConfig ? checkLegacyKeys(repoConfig, repoConfigPath) : {};
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
  if (options.cycleDir !== undefined) {
    const cycleConfigPath = join(options.cycleDir, ".hikyaku.config");
    const cycleConfig = loadFile(cycleConfigPath);
    if (cycleConfig) {
      sources.push(cycleConfigPath);
      checkLegacyKeys(cycleConfig, cycleConfigPath);
      assertCycleOverridable(cycleConfig, cycleConfigPath);
      askAtCreate = askDeclared.filter((key) => readDotted(cycleConfig, key) === undefined);
      merged = mergeTables(merged, cycleConfig);
    }
  }

  return finalize(merged, root, hikyakuRoot, sources, options.profileOverride, askAtCreate);
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
    userStories: readBoolean(merged, "user_stories_gate", "config") ?? preset.gates.userStories,
    codebaseSurvey:
      readBoolean(merged, "codebase_survey_gate", "config") ?? preset.gates.codebaseSurvey,
    designChoice: readBoolean(merged, "design_choice_gate", "config") ?? preset.gates.designChoice,
    architecture: readBoolean(merged, "architecture_gate", "config") ?? preset.gates.architecture,
    plan: readBoolean(merged, "plan_gate", "config") ?? preset.gates.plan,
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
  const securityTable = readTable(reviewTable ?? {}, "security");
  const externalTable = readTable(merged, "external");

  return {
    repoRoot: root,
    hikyakuRoot,
    profile,
    baseBranch: readString(merged, "base_branch", "config"),
    bpMax: readInteger(merged, "bp_max", "config") ?? DEFAULT_BP_MAX,
    gates,
    reviews,
    branch: readBranchNaming(readTable(merged, "branch"), DEFAULT_NAMING),
    pr: {
      title: readString(readTable(merged, "pr"), "title", "[pr]") ?? DEFAULT_PR_TITLE,
      reviewers: readReviewers(readTable(merged, "pr"), "reviewers", "[pr]"),
      reviewersSkip: readReviewerSkip(readTable(merged, "pr")),
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
      target: readEnum(externalTable, "target", ["none", "github", "asana"], "[external]") ?? "none",
      githubRepo: readString(externalTable, "github_repo", "[external]"),
      asanaProjectGid: readString(externalTable, "asana_project_gid", "[external]"),
    },
    conductor: readConductor(readTable(merged, "conductor")),
    dataIntegrity: readDataIntegrity(readTable(merged, "data_integrity")),
    askAtCreate,
    sources,
  };
}
