/**
 * 設定の解決。
 *
 * 2階層をキー単位でマージする（hikyaku_root を除く）:
 *   リポジトリルート/.hikyaku.config    ← ベース設定
 *   {HIKYAKU_ROOT}/.hikyaku.config      ← このワークフロー固有の上書き
 *
 * profile は承認ゲートとレビューの既定値をまとめて与える。個別キーで上書きできる。
 * profile はサイクルの属性でもあるため、cycles.md の値を profileOverride で渡せる。
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { HikyakuError } from "./errors.mts";
import { findHikyakuRoot, repoRoot } from "./paths.mts";
import { parseToml, TomlError, type TomlTable, type TomlValue } from "./toml.mts";

export type ProfileName = "light" | "saving" | "standard" | "strict";
export type SecurityReviewMode = "off" | "recommended" | "on";
export type RetrospectiveMode = "skip" | "prompt" | "auto";
export type ValidateMode = "manual" | "phase" | "step";
export type ExternalTarget = "none" | "github" | "asana";

export const PROFILE_NAMES: ProfileName[] = ["light", "saving", "standard", "strict"];

/**
 * 承認ゲート。ここに無いゲートは profile の管轄外で、常に有効:
 *   G3  設計案の選択（architect）
 *   G6  tasklist / issue 変更承認（build-manager）
 *   G8  plan + test-spec 承認（builder）
 *   G10 永続ドキュメント昇格の承認（close-cycle）
 * profile で外せるのは「確認」であって「同意」ではない。
 */
export interface Gates {
  /** G1 planner: user-stories 承認 */
  userStories: boolean;
  /** G2 architect: codebase-survey 確認 */
  codebaseSurvey: boolean;
  /** G4 architect: 設計ドキュメント承認 */
  architecture: boolean;
  /** G7 builder: plan 単独の承認（strict のみ。他は G8 に統合） */
  plan: boolean;
}

export interface Reviews {
  userStories: boolean;
  architecture: boolean;
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
  // 人間の時間を節約する。承認は減らすが AI には見させる
  light: {
    gates: { userStories: false, codebaseSurvey: false, architecture: false, plan: false },
    reviews: {
      userStories: true,
      architecture: true,
      plan: true,
      code: true,
      security: "off",
      retrospective: "skip",
      validate: "manual",
    },
  },
  // AI 実行コストを節約する。サブエージェントを起動しないが人間は見る
  saving: {
    gates: { userStories: true, codebaseSurvey: false, architecture: true, plan: false },
    reviews: {
      userStories: false,
      architecture: false,
      plan: false,
      code: true,
      security: "off",
      retrospective: "skip",
      validate: "manual",
    },
  },
  standard: {
    gates: { userStories: true, codebaseSurvey: false, architecture: true, plan: false },
    reviews: {
      userStories: true,
      architecture: true,
      plan: true,
      code: true,
      security: "recommended",
      retrospective: "prompt",
      validate: "phase",
    },
  },
  strict: {
    gates: { userStories: true, codebaseSurvey: true, architecture: true, plan: true },
    reviews: {
      userStories: true,
      architecture: true,
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
export const DEFAULT_BRANCH_PREFIX = "hikyaku";
export const DEFAULT_BRANCH_SEPARATOR = "/";
export const DEFAULT_BP_MAX = 8;

export interface ResolvedConfig {
  repoRoot: string;
  hikyakuRoot: string;
  profile: ProfileName;
  /** 未設定ならリポジトリのデフォルトブランチを自動検出する（スキル側の責務） */
  baseBranch: string | undefined;
  bpMax: number;
  gates: Gates;
  reviews: Reviews;
  branch: { prefix: string; separator: string };
  pr: { title: string };
  security: { triggers: string };
  external: { target: ExternalTarget; githubRepo?: string; asanaProjectGid?: string };
  /** 読み込んだ設定ファイルのパス（デバッグ用） */
  sources: string[];
}

export interface LoadOptions {
  /** --root で明示指定された HIKYAKU_ROOT */
  root?: string | undefined;
  /** cycles.md のサイクル属性など、config より優先する profile */
  profileOverride?: string | undefined;
  /** HIKYAKU_ROOT が解決できなくてもエラーにしない（init 用） */
  allowMissingRoot?: boolean;
}

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

function readEnum<T extends string>(
  table: TomlTable | undefined,
  key: string,
  allowed: T[],
  where: string,
): T | undefined {
  const value = readString(table, key, where);
  if (value === undefined) return undefined;
  if (!(allowed as string[]).includes(value)) {
    throw new HikyakuError(
      `${where}.${key} の値が不正です: ${value}`,
      `使用できる値: ${allowed.join(" | ")}`,
    );
  }
  return value as T;
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

export function loadConfig(options: LoadOptions = {}): ResolvedConfig {
  const root = repoRoot();
  const sources: string[] = [];

  const repoConfigPath = join(root, ".hikyaku.config");
  const repoConfig = loadFile(repoConfigPath);
  if (repoConfig) sources.push(repoConfigPath);
  const legacy = repoConfig ? checkLegacyKeys(repoConfig, repoConfigPath) : {};

  // HIKYAKU_ROOT: --root → config の hikyaku_root（旧 doc_root）→ 上方向探索
  const configured =
    (repoConfig ? readString(repoConfig, "hikyaku_root", "config") : undefined) ?? legacy.docRoot;
  const candidate = options.root ?? configured ?? findHikyakuRoot();

  if (candidate === undefined) {
    if (options.allowMissingRoot) {
      return finalize(repoConfig ?? {}, root, "", sources, options.profileOverride);
    }
    throw new HikyakuError("HIKYAKU_ROOT を解決できませんでした", [
      "次のいずれかを指定してください:",
      "  --root <path> で明示する",
      "  リポジトリルートの .hikyaku.config に hikyaku_root を設定する",
      "  Hikyaku ワークスペース内で実行する",
    ].join("\n"));
  }

  const hikyakuRoot = isAbsolute(candidate) ? candidate : resolve(root, candidate);

  const workspaceConfigPath = join(hikyakuRoot, ".hikyaku.config");
  const workspaceConfig = loadFile(workspaceConfigPath);
  if (workspaceConfig) {
    sources.push(workspaceConfigPath);
    checkLegacyKeys(workspaceConfig, workspaceConfigPath);
    // hikyaku_root は HIKYAKU_ROOT 側では指定できない（自己参照になるため）
    if (workspaceConfig["hikyaku_root"] !== undefined) {
      throw new HikyakuError(
        `${workspaceConfigPath}: hikyaku_root はリポジトリルートの設定でのみ有効です`,
      );
    }
  }

  const merged = workspaceConfig ? mergeTables(repoConfig ?? {}, workspaceConfig) : (repoConfig ?? {});
  return finalize(merged, root, hikyakuRoot, sources, options.profileOverride);
}

function finalize(
  merged: TomlTable,
  root: string,
  hikyakuRoot: string,
  sources: string[],
  profileOverride: string | undefined,
): ResolvedConfig {
  const profile = resolveProfile(merged, profileOverride);
  const preset = PROFILES[profile];

  const gates: Gates = {
    userStories: readBoolean(merged, "user_stories_gate", "config") ?? preset.gates.userStories,
    codebaseSurvey:
      readBoolean(merged, "codebase_survey_gate", "config") ?? preset.gates.codebaseSurvey,
    architecture: readBoolean(merged, "architecture_gate", "config") ?? preset.gates.architecture,
    plan: readBoolean(merged, "plan_gate", "config") ?? preset.gates.plan,
  };

  const reviews: Reviews = {
    userStories: readBoolean(merged, "user_stories_review", "config") ?? preset.reviews.userStories,
    architecture:
      readBoolean(merged, "architecture_review", "config") ?? preset.reviews.architecture,
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

  const branchTable = readTable(merged, "branch");
  const separator = readString(branchTable, "separator", "[branch]") ?? DEFAULT_BRANCH_SEPARATOR;
  if (separator === "") {
    throw new HikyakuError(
      "[branch].separator に空文字は指定できません",
      "空文字にするとブランチ名からサイクルとフェーズを解析できなくなります。",
    );
  }

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
    branch: {
      prefix: readString(branchTable, "prefix", "[branch]") ?? DEFAULT_BRANCH_PREFIX,
      separator,
    },
    pr: { title: readString(readTable(merged, "pr"), "title", "[pr]") ?? DEFAULT_PR_TITLE },
    security: {
      triggers: readString(securityTable, "triggers", "[review.security]") ?? DEFAULT_SECURITY_TRIGGERS,
    },
    external: {
      target: readEnum(externalTable, "target", ["none", "github", "asana"], "[external]") ?? "none",
      githubRepo: readString(externalTable, "github_repo", "[external]"),
      asanaProjectGid: readString(externalTable, "asana_project_gid", "[external]"),
    },
    sources,
  };
}
