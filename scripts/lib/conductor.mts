/**
 * conductor — 非対話の子セッションが出す問いの分類と、子の起動コマンドの組み立て。
 *
 * 監督（LLM）は子の問いに答えるか人間に上げるかを決める。そのうち ID だけで
 * 機械的に決まる部分（既定の振り分けと、設定による上書き）をここに置く。
 * 「スコープを広げる回答か」のように成果物を読まないと決まらない判断は監督が行う。
 *
 * 問いの ID は SKILL.md の「（G8）」「（ask: branch）」と1対1で対応する。
 * スキル側に ID を足したら、ここにも足すこと。
 */

import { createHash } from "node:crypto";
import type { Gates, Reviews } from "./config.mts";
import { HikyakuError } from "./errors.mts";

export type AskCategory = "route" | "confirm" | "consent" | "spec" | "failure" | "abandon" | "unknown";
export type Handler = "supervisor" | "human";

export const CATEGORY_LABELS: Record<AskCategory, string> = {
  route: "経路の判断",
  confirm: "確認ゲート",
  consent: "同意ゲート",
  spec: "仕様の確認",
  failure: "障害",
  abandon: "サイクルの中止",
  unknown: "分類できない問い",
};

const DEFAULT_HANDLERS: Record<AskCategory, Handler> = {
  route: "supervisor",
  confirm: "supervisor",
  consent: "supervisor",
  spec: "supervisor",
  failure: "human",
  abandon: "human",
  unknown: "human",
};

/** 設定で振り分けを変えられない種別。中止と分類できない問いは常に人間が判断する */
const FIXED_CATEGORIES: AskCategory[] = ["abandon", "unknown"];

export interface AskDefinition {
  id: string;
  category: AskCategory;
  /** どこで出る問いか */
  where: string;
  /** profile や設定によって出ない問いなら、出る条件 */
  enabledWhen?: (settings: AskSettings) => boolean;
}

/** 問いが出るかどうかを決める設定（ResolvedConfig の一部） */
export interface AskSettings {
  gates: Gates;
  reviews: Reviews;
}

/**
 * conductor が起動するフェーズ（architect / builder / close-cycle と、そこから
 * 呼ばれる build-manager / retrospective）の問い。PLAN は人間が対話で行うので含めない
 */
export const ASKS: AskDefinition[] = [
  { id: "cycle", category: "route", where: "対象サイクルを決められない" },
  { id: "branch", category: "route", where: "ブランチが命名規則と一致しない" },
  { id: "build-select", category: "route", where: "builder: 着手中のビルドを選ぶ" },
  { id: "overlap", category: "route", where: "architect: 並行サイクルとの重複" },
  { id: "G2", category: "confirm", where: "architect: codebase-survey の確認", enabledWhen: (s) => s.gates.codebaseSurvey },
  { id: "G3", category: "confirm", where: "architect: 設計案の選択", enabledWhen: (s) => s.gates.designChoice },
  { id: "G4", category: "confirm", where: "architect: 設計ドキュメントの承認", enabledWhen: (s) => s.gates.architecture },
  { id: "G7", category: "confirm", where: "builder: plan 単独の承認", enabledWhen: (s) => s.gates.plan },
  {
    id: "retrospective",
    category: "confirm",
    where: "retrospective: 振り返りを実施するか",
    enabledWhen: (s) => s.reviews.retrospective === "prompt",
  },
  { id: "docs-link", category: "confirm", where: "close-cycle: AGENTS.md の索引の更新" },
  { id: "G6", category: "consent", where: "build-manager: tasklist / issue の変更" },
  { id: "G8", category: "consent", where: "builder: plan + test-spec の承認" },
  { id: "G10", category: "consent", where: "close-cycle: 永続ドキュメントへの昇格" },
  { id: "questions", category: "spec", where: "architect / builder: 質問ループ" },
  { id: "adr-status", category: "spec", where: "architect / close-cycle: ADR に status 欄が無い" },
  { id: "design-conflict", category: "spec", where: "builder: 設計どおりでは要件を満たせない" },
  { id: "review-findings", category: "spec", where: "builder: コードレビュー指摘への対応" },
  { id: "retry-limit", category: "failure", where: "builder: リトライの上限に達した" },
  { id: "abandon", category: "abandon", where: "close-cycle: 未完了のまま締める" },
  { id: "other", category: "unknown", where: "ID の付いていない箇所での問い" },
];

export const ASK_IDS: string[] = ASKS.map((ask) => ask.id);

/** 子として動くスキル。conductor lint はこれらの SKILL.md と references/ からタグを集める */
export const CONDUCTED_SKILLS = ["architect", "builder", "build-manager", "close-cycle", "retrospective"];

/** タグとして扱う書式。（G8）と（ask: branch） */
const TAG_PATTERN = /（(?:ask: ([a-z][a-z-]*)|(G\d+))）/g;

export function collectTags(text: string): string[] {
  return [...text.matchAll(TAG_PATTERN)].map((m) => (m[1] ?? m[2]) as string);
}

/**
 * スキルのタグと ASKS の突き合わせ。食い違うと子は表に無い ID で gate を出し、
 * 監督は「分類できない問い」として人間に上げ続ける。動作は止まらず静かにずれるので、
 * CI で検出する
 */
export function lintTags(tagsByFile: Map<string, string[]>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [file, tags] of tagsByFile) {
    for (const id of tags) {
      seen.add(id);
      if (!ASK_IDS.includes(id)) {
        problems.push(`${file}: ${id} が scripts/lib/conductor.mts の ASKS にありません`);
      }
    }
  }
  for (const id of ASK_IDS) {
    if (id !== "other" && !seen.has(id)) {
      problems.push(`ASKS の ${id} に対応するタグが ${CONDUCTED_SKILLS.join(" / ")} のどこにもありません`);
    }
  }
  return problems;
}

/** conductor が子として起動するフェーズ（スキル名） */
export const CONDUCTOR_PHASES = ["architect", "builder", "close-cycle"] as const;
export type ConductorPhase = (typeof CONDUCTOR_PHASES)[number];

export interface ConductorConfig {
  /** 既定では監督が答える問いのうち、人間に上げるもの */
  escalate: string[];
  /** 既定では人間に上げる問いのうち、監督に任せるもの */
  delegate: string[];
  /** 子に許可するツール（既定に追加される） */
  allowedTools: string[];
  /** 呼び出し1回ごとの費用の上限（USD）。0 なら上限を渡さない */
  budgetPerRun: number;
  /** 子のモデル（全フェーズの既定）。未指定なら Claude Code の既定に任せる */
  model: string | undefined;
  /** フェーズごとのモデル。model より優先する */
  models: Partial<Record<ConductorPhase, string>>;
}

export const DEFAULT_CONDUCTOR: ConductorConfig = {
  escalate: [],
  delegate: [],
  allowedTools: [],
  budgetPerRun: 0,
  model: undefined,
  models: {},
};

/** そのフェーズの子に渡すモデル。undefined なら --model を渡さない */
export function modelFor(conductor: ConductorConfig, phase: ConductorPhase): string | undefined {
  return conductor.models[phase] ?? conductor.model;
}

/**
 * escalate / delegate の検査。
 *
 * タイプミスを黙って捨てると、人間に上げるつもりの問いを監督が答えてしまう。
 * 起きてから気づけない壊れ方なので、未知の ID はエラーにする
 */
export function checkConductorAsks(config: ConductorConfig, where: string): void {
  for (const key of ["escalate", "delegate"] as const) {
    for (const id of config[key]) {
      const ask = findAsk(id);
      if (ask === undefined) {
        throw new HikyakuError(
          `${where}.${key} に不明な問いの ID があります: ${id}`,
          `使用できる ID: ${ASK_IDS.filter((x) => !isFixed(x)).join(" | ")}`,
        );
      }
      if (isFixed(id)) {
        throw new HikyakuError(
          `${where}.${key} に ${id} は指定できません`,
          `${CATEGORY_LABELS[ask.category]}は常に人間が判断します。`,
        );
      }
    }
  }

  const both = config.escalate.filter((id) => config.delegate.includes(id));
  if (both.length > 0) {
    throw new HikyakuError(
      `${where}: escalate と delegate の両方に指定されています: ${both.join(", ")}`,
      "どちらか一方にしてください。",
    );
  }
}

function findAsk(id: string): AskDefinition | undefined {
  return ASKS.find((ask) => ask.id === id);
}

function isFixed(id: string): boolean {
  const ask = findAsk(id);
  return ask !== undefined && FIXED_CATEGORIES.includes(ask.category);
}

export interface ResolvedAsk {
  id: string;
  category: AskCategory;
  categoryLabel: string;
  where: string;
  handler: Handler;
  /** 振り分けの根拠。fixed は設定で変えられない種別 */
  source: "default" | "escalate" | "delegate" | "fixed";
  /** profile や設定で無効なら false（その問いは出ない） */
  enabled: boolean;
}

/**
 * 問いの ID を振り分ける。表に無い ID は「分類できない問い」として人間に上げる
 * （子が規約にない ID を出したとき、監督が推測で答えないようにするため）
 */
export function resolveAsk(id: string, conductor: ConductorConfig, settings: AskSettings): ResolvedAsk {
  const ask = findAsk(id) ?? { id, category: "unknown" as const, where: "表に無い ID" };
  const base = {
    id,
    category: ask.category,
    categoryLabel: CATEGORY_LABELS[ask.category],
    where: ask.where,
    enabled: ask.enabledWhen === undefined ? true : ask.enabledWhen(settings),
  };

  if (FIXED_CATEGORIES.includes(ask.category)) {
    return { ...base, handler: "human", source: "fixed" };
  }
  if (conductor.escalate.includes(id)) return { ...base, handler: "human", source: "escalate" };
  if (conductor.delegate.includes(id)) return { ...base, handler: "supervisor", source: "delegate" };
  return { ...base, handler: DEFAULT_HANDLERS[ask.category], source: "default" };
}

export function resolveAllAsks(conductor: ConductorConfig, settings: AskSettings): ResolvedAsk[] {
  return ASK_IDS.map((id) => resolveAsk(id, conductor, settings));
}

// ---------------------------------------------------------------------------
// 子の出力の解析

export type Outcome = "gate" | "done" | "blocked" | "violation" | "error";

export interface ParsedResult {
  outcome: Outcome;
  /** gate の問いの ID */
  id?: string;
  /** done の next */
  next?: string;
  /** ブロックの本文（violation / error では最終出力の末尾） */
  body: string;
  sessionId: string | null;
  costUsd: number | null;
  /** violation / error の理由 */
  reason?: string;
}

const BLOCK_PATTERN =
  /^<hikyaku-(gate|done|blocked)((?:\s+[a-z]+="[^"]*")*)\s*>\n?([\s\S]*?)\n?^<\/hikyaku-\1>\s*$/gm;
const ATTRIBUTE_PATTERN = /([a-z]+)="([^"]*)"/g;

/** 最終出力の末尾に置かれたブロックを1つ取り出す */
export function parseFinalText(text: string): Omit<ParsedResult, "sessionId" | "costUsd"> {
  const blocks = [...text.matchAll(BLOCK_PATTERN)];
  const tail = text.trimEnd().slice(-2000);

  if (blocks.length === 0) {
    return { outcome: "violation", body: tail, reason: "gate / done / blocked のブロックがありません" };
  }
  if (blocks.length > 1) {
    return {
      outcome: "violation",
      body: tail,
      reason: `ブロックが ${blocks.length} 個あります（最後に1つだけ置く規約です）`,
    };
  }

  const block = blocks[0] as RegExpMatchArray;
  const end = (block.index ?? 0) + block[0].length;
  if (text.slice(end).trim() !== "") {
    return { outcome: "violation", body: tail, reason: "ブロックの後に出力が続いています" };
  }

  const kind = block[1] as "gate" | "done" | "blocked";
  const attributes = new Map([...(block[2] ?? "").matchAll(ATTRIBUTE_PATTERN)].map((m) => [m[1], m[2]]));
  const body = (block[3] ?? "").trim();

  if (kind === "gate") {
    const id = attributes.get("id");
    if (id === undefined || id === "") {
      return { outcome: "violation", body, reason: "gate に id がありません" };
    }
    return { outcome: "gate", id, body };
  }
  if (kind === "done") return { outcome: "done", next: attributes.get("next") ?? "", body };
  return { outcome: "blocked", body };
}

/**
 * claude -p --output-format json の結果を読む。
 *
 * 予算超過やターン上限で終わった場合は result が無いか、途中の出力になる。
 * それを規約違反と混同しないよう、is_error / subtype を先に見る
 */
export function parseResultJson(raw: string): ParsedResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  // null や配列も JSON としては読めるが、結果オブジェクトではない
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      outcome: "error",
      body: raw.trimEnd().slice(-2000),
      sessionId: null,
      costUsd: null,
      reason: "結果を JSON のオブジェクトとして読めません（--output-format json で起動されていないか、途中で終了しました）",
    };
  }
  const json = parsed as Record<string, unknown>;

  const sessionId = typeof json["session_id"] === "string" ? json["session_id"] : null;
  const costUsd = typeof json["total_cost_usd"] === "number" ? json["total_cost_usd"] : null;
  const result = typeof json["result"] === "string" ? json["result"] : "";
  const subtype = typeof json["subtype"] === "string" ? json["subtype"] : "";

  if (json["is_error"] === true || (subtype !== "" && subtype !== "success")) {
    return {
      outcome: "error",
      body: result.trimEnd().slice(-2000),
      sessionId,
      costUsd,
      // 利用上限への到達などは subtype が success のまま is_error だけが立ち、
      // 理由は result の本文にしか無い。subtype だけでは原因が分からないので本文を添える
      reason: [
        `子セッションがエラーで終了しました（${subtype !== "" && subtype !== "success" ? subtype : "is_error"}）`,
        result.trim().split("\n")[0] ?? "",
      ]
        .filter((part) => part !== "")
        .join(": "),
    };
  }

  return { ...parseFinalText(result), sessionId, costUsd };
}

// ---------------------------------------------------------------------------
// 起動コマンドの組み立て

/**
 * 子に既定で許可するツール。
 *
 * bypassPermissions は渡さず、ここに列挙したものだけを許可する。監督の目が
 * 届かないところで何でもできる状態を作らないため。PR の作成に gh が要るが、
 * マージなどはさせないので pr create / pr view に絞る。
 *
 * node は Hikyaku CLI の実行だけを許す。Bash(node:*) にすると node -e で
 * 任意のコマンドを実行でき、他の許可をすべて迂回できる。スキルはパスを
 * 二重引用符でくくって呼ぶので、くくった形とくくらない形の両方を許可する。
 *
 * git もサブコマンドを列挙する。Bash(git:*) にすると git -c alias.x='!…' x の形で
 * 任意のコマンドを実行できる。ただし、子は .git/hooks を書けて git commit で
 * 実行されるので、ツールの許可だけでは完全には隔離できない
 */
/** スキルが子の中で使う git のサブコマンド */
const GIT_SUBCOMMANDS = [
  "status",
  "diff",
  "log",
  "show",
  "add",
  "commit",
  "push",
  "fetch",
  "switch",
  "checkout",
  "branch",
  "mv",
  "rm",
  "merge-base",
  "rev-parse",
  "ls-files",
];

export function defaultAllowedTools(pluginRootPath: string): string[] {
  const cli = `${pluginRootPath}/scripts/hikyaku.mts`;
  return [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Agent",
    "Skill",
    ...GIT_SUBCOMMANDS.map((command) => `Bash(git ${command}:*)`),
    `Bash(node ${cli}:*)`,
    `Bash(node "${cli}":*)`,
    "Bash(ls:*)",
    "Bash(cat:*)",
    "Bash(gh pr create:*)",
    "Bash(gh pr view:*)",
  ];
}

/** POSIX シェルの単一引用符でくくる */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 委任の範囲を決める設定のダイジェスト。
 *
 * 子は Write / Edit を持つので、.hikyaku.config の allowed_tools や delegate を
 * 書き換えられる。launch / parse は起動のたびに設定を読み直すため、書き換えが
 * 次の起動で効くと、人間が合意していない権限や振り分けになる。監督は起動時に
 * 人間と合意したときのダイジェストを全呼び出しに渡し、変わっていれば止める。
 *
 * 設定ファイルの内容そのもの（configFiles）も含める。base_branch や [branch] が
 * 変わると、PR の向き先や completed の判定まで変わるため。キーを選んで含めると
 * 追加漏れが起きる。conductor が実行するフェーズは .hikyaku.config を書き換えない
 * ので、正常な流れで止まることはない。profile は cycles.md が正なので別に含める
 */
export function settingsDigest(
  profile: string,
  settings: AskSettings,
  conductor: ConductorConfig,
  configFiles: string[] = [],
): string {
  const canonical = JSON.stringify({
    profile,
    gates: settings.gates,
    reviews: settings.reviews,
    conductor,
    configFiles,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}
