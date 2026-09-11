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
import { isAbsolute, join, resolve } from "node:path";
import type { BranchNaming } from "./branch.mts";
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
  code: boolean;
  security: SecurityReviewMode;
  retrospective: RetrospectiveMode;
  validate: ValidateMode;
}

interface ProfileDefinition {
  gates: Gates;
  reviews: Reviews;
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
      code: true,
      security: "recommended",
      retrospective: "auto",
      validate: "manual",
    },
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
      code: true,
      security: "recommended",
      retrospective: "skip",
      validate: "manual",
    },
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
      code: true,
      security: "recommended",
      retrospective: "auto",
      validate: "phase",
    },
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
      code: true,
      security: "on",
      retrospective: "auto",
      validate: "step",
    },
  },
};

/** security_review を推奨する既定の判定基準。config で丸ごと置き換えられる */
export const DEFAULT_SECURITY_TRIGGERS = `- 個人情報・秘密情報を扱う（氏名/住所/連絡先/生年月日、パスワード、トークン、APIキー）
- 認証・認可（ログイン、セッション、権限判定、アクセス制御）
- 決済（支払い、カード情報、請求、返金）`;

export const DEFAULT_PR_TITLE = "[hikyaku] {cycle}: {phase} {title}";
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
  pr: { title: string };
  /** セッション名のテンプレート。空文字なら変更しない */
  session: { title: string };
  security: { triggers: string };
  external: { target: ExternalTarget; githubRepo?: string; asanaProjectGid?: string };
  /**
   * ルート設定の ask に並んでいて、まだ答えが記録されていないキー。
   * create-cycle が尋ねる対象。サイクルを重ねた結果ここに残っていれば、
   * そのサイクルは未回答でルート設定の値のまま動いている
   */
  askAtCreate: AskKey[];
  /** 読み込んだ設定ファイルのパス（デバッグ用） */
  sources: string[];
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

  const hikyakuRoot = isAbsolute(candidate) ? candidate : resolve(root, candidate);

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

  const securityTable = readTable(readTable(merged, "review") ?? {}, "security");
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
    pr: { title: readString(readTable(merged, "pr"), "title", "[pr]") ?? DEFAULT_PR_TITLE },
    session: {
      title:
        readString(readTable(merged, "session"), "title", "[session]") ?? DEFAULT_SESSION_TITLE,
    },
    security: {
      triggers: readString(securityTable, "triggers", "[review.security]") ?? DEFAULT_SECURITY_TRIGGERS,
    },
    external: {
      target: readEnum(externalTable, "target", ["none", "github", "asana"], "[external]") ?? "none",
      githubRepo: readString(externalTable, "github_repo", "[external]"),
      asanaProjectGid: readString(externalTable, "asana_project_gid", "[external]"),
    },
    askAtCreate,
    sources,
  };
}
