/**
 * セッションのコンテキスト実測。
 *
 * 予測ピーク（メインセッションのコンテキストのピーク）と突き合わせる実測を、
 * Claude Code が残すトランスクリプトから読む（#68）。読むのはメインセッションだけで、
 * サブエージェントはウィンドウが別なのでコンパクションの判断に関わらない。
 *
 *   {CLAUDE_CONFIG_DIR|~/.claude}/projects/<cwd を変換した名前>/<session>.jsonl
 *   現在のセッションは CLAUDE_CODE_SESSION_ID がファイル名と一致する
 *
 * 形式は公開された仕様ではない。読めない・見つからないときは推測で
 * 埋めず、「計測不可」とその理由を返す。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";

/** 記録のホスト。v3 で Codex の計測を外したので Claude Code だけ */
export type SessionHost = "claude-code";

export const HOST_LABEL = "Claude Code";

/** 現在のセッションを特定する環境変数 */
export const CURRENT_SESSION_VARIABLE = "CLAUDE_CODE_SESSION_ID";

export interface SessionMeasure {
  host: SessionHost;
  /** Claude Code の version */
  hostVersion: string | undefined;
  /** Claude Code の entrypoint */
  client: string | undefined;
  path: string;
  sessionId: string | undefined;
  /** 呼び出しが最も多かったモデル */
  model: string | undefined;
  models: string[];
  /** 呼び出しごとのコンテキストの最大値 */
  peak: number;
  /** 最初の呼び出しのコンテキスト（開始時の固定分） */
  first: number;
  /** 最後の呼び出しのコンテキスト */
  latest: number;
  calls: number;
  outputTokens: number;
  compactions: number;
  /** ブランチごとの呼び出し回数 */
  callsByBranch: Record<string, number>;
  cwd: string | undefined;
  startedAt: string | undefined;
  endedAt: string | undefined;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function* jsonLines(text: string): Generator<Json> {
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = asObject(JSON.parse(line));
      if (parsed !== undefined) yield parsed;
    } catch {
      // 書き込み途中の末尾行などは読み飛ばす
    }
  }
}

function mostFrequent(counts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

interface CallSample {
  context: number;
  output: number;
}

function summarize(samples: CallSample[]): Pick<SessionMeasure, "peak" | "first" | "latest" | "calls" | "outputTokens"> {
  return {
    peak: samples.reduce((max, s) => Math.max(max, s.context), 0),
    first: samples[0]?.context ?? 0,
    latest: samples[samples.length - 1]?.context ?? 0,
    calls: samples.length,
    outputTokens: samples.reduce((sum, s) => sum + s.output, 0),
  };
}

/**
 * Claude Code のトランスクリプトを読む。
 *
 * type=="assistant" で isSidechain でない行を message.id で重複除去し（1回の応答が
 * 内容ブロックごとに複数行になる）、input + cache_creation + cache_read を
 * その呼び出しのコンテキストとする。コンパクションは compact_boundary の行だけを
 * 数える（直後の isCompactSummary の行も数えると二重になる）。
 * 呼び出しが1件も無ければ undefined。
 */
export function parseClaudeTranscript(text: string, path: string): SessionMeasure | undefined {
  const calls = new Map<string, CallSample & { model: string; branch: string | undefined }>();
  let compactions = 0;
  let version: string | undefined;
  let entrypoint: string | undefined;
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  for (const line of jsonLines(text)) {
    if (line["isSidechain"] === true) continue;
    const timestamp = asString(line["timestamp"]);
    if (timestamp !== undefined) {
      startedAt ??= timestamp;
      endedAt = timestamp;
    }
    sessionId ??= asString(line["sessionId"]);
    cwd ??= asString(line["cwd"]);
    version = asString(line["version"]) ?? version;
    entrypoint = asString(line["entrypoint"]) ?? entrypoint;

    if (line["type"] === "system" && line["subtype"] === "compact_boundary") {
      compactions += 1;
      continue;
    }
    if (line["type"] !== "assistant") continue;
    const message = asObject(line["message"]);
    const usage = asObject(message?.["usage"]);
    if (message === undefined || usage === undefined) continue;
    const model = asString(message["model"]) ?? "unknown";
    // API エラーなどの合成メッセージは呼び出しではない
    if (model === "<synthetic>") continue;
    const context =
      asNumber(usage["input_tokens"]) +
      asNumber(usage["cache_creation_input_tokens"]) +
      asNumber(usage["cache_read_input_tokens"]);
    if (context <= 0) continue;
    const id = asString(message["id"]) ?? asString(line["uuid"]) ?? `line-${calls.size}`;
    const output = asNumber(usage["output_tokens"]);
    const existing = calls.get(id);
    if (existing === undefined) {
      calls.set(id, { context, output, model, branch: asString(line["gitBranch"]) });
    } else {
      // 同じ応答の後の行ほど output_tokens が確定に近い
      existing.output = Math.max(existing.output, output);
    }
  }

  if (calls.size === 0) return undefined;

  const samples = [...calls.values()];
  const modelCounts = new Map<string, number>();
  const callsByBranch: Record<string, number> = {};
  for (const call of samples) {
    modelCounts.set(call.model, (modelCounts.get(call.model) ?? 0) + 1);
    if (call.branch !== undefined) callsByBranch[call.branch] = (callsByBranch[call.branch] ?? 0) + 1;
  }

  return {
    host: "claude-code",
    hostVersion: version,
    client: entrypoint,
    path,
    sessionId: sessionId ?? basename(path, ".jsonl"),
    model: mostFrequent(modelCounts),
    models: [...modelCounts.keys()],
    ...summarize(samples),
    compactions,
    callsByBranch,
    cwd,
    startedAt,
    endedAt,
  };
}

// ---------------------------------------------------------------------------
// 記録の所在

export type Env = Record<string, string | undefined>;

export function claudeConfigDir(env: Env): string {
  return asString(env["CLAUDE_CONFIG_DIR"]) ?? join(homedir(), ".claude");
}

/** Claude Code がプロジェクトのディレクトリ名に使う変換（英数字以外を - にする） */
export function encodeProjectPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

function listDirectories(directory: string): string[] {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

/** 直下の *.jsonl だけ。サブエージェントは <session>/subagents/ に分かれている */
function listTranscripts(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

export function findClaudeTranscript(env: Env, sessionId: string): string | undefined {
  for (const directory of listDirectories(join(claudeConfigDir(env), "projects"))) {
    const candidate = join(directory, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * リポジトリの作業ツリー（メインと worktree）に対応するプロジェクトのディレクトリの
 * トランスクリプト。メインの配下に置かれた worktree（削除済みも含む）は名前の
 * 前方一致で拾う
 */
export function claudeTranscriptsFor(env: Env, roots: string[]): string[] {
  const encoded = roots.map(encodeProjectPath);
  return listDirectories(join(claudeConfigDir(env), "projects"))
    .filter((directory) => {
      const name = basename(directory);
      return encoded.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));
    })
    .flatMap(listTranscripts);
}

export function readMeasure(path: string): SessionMeasure | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  return parseClaudeTranscript(text, path);
}

// ---------------------------------------------------------------------------
// 現在のセッション

export interface CurrentLookup {
  id: string;
  /** トランスクリプトのパス。見つからなければ undefined */
  path: string | undefined;
}

/** 環境変数から現在のセッションの記録を探す。変数が無ければ undefined */
export function lookupCurrent(env: Env): CurrentLookup | undefined {
  const id = asString(env[CURRENT_SESSION_VARIABLE]);
  return id === undefined ? undefined : { id, path: findClaudeTranscript(env, id) };
}

/** 現在のセッションの記録が見つからないときの理由。推測で埋めないために文で返す */
export function describeMissingCurrent(env: Env, lookup: CurrentLookup | undefined): string {
  if (lookup === undefined) {
    return `現在のセッションを特定できません（${CURRENT_SESSION_VARIABLE} が設定されていません）。--transcript <path> で指定できます`;
  }
  return `Claude Code のトランスクリプトが見つかりません: ${join(claudeConfigDir(env), "projects", "*", `${lookup.id}.jsonl`)}`;
}

// ---------------------------------------------------------------------------
// ブランチからビルドのセッションを集める

export interface RepositoryScope {
  /** メインの作業ツリーと、いま登録されている worktree */
  roots: string[];
}

function underRoots(cwd: string | undefined, roots: string[]): boolean {
  if (cwd === undefined) return false;
  return roots.some((root) => cwd === root || cwd.startsWith(root.endsWith(sep) ? root : `${root}${sep}`));
}

/**
 * ブランチに対応付くセッションを集める。
 * 各行の gitBranch で、そのブランチでの呼び出しが1件以上あるもの。
 */
export function collectBranchSessions(env: Env, scope: RepositoryScope, branch: string): SessionMeasure[] {
  const measures: SessionMeasure[] = [];
  for (const path of claudeTranscriptsFor(env, scope.roots)) {
    const measure = readMeasure(path);
    if (measure === undefined || (measure.callsByBranch[branch] ?? 0) === 0) continue;
    if (!underRoots(measure.cwd, scope.roots)) continue;
    measures.push(measure);
  }
  return measures;
}

export interface Candidate {
  measure: SessionMeasure;
  /** このブランチでの呼び出し回数。本体の判別に使う */
  branchCalls: number;
  current: boolean;
}

/**
 * 本体の判別規則: **そのブランチでの呼び出し回数が最も多いセッション**。
 *
 * レビュー用の別プロセスや中断後の短い再開は呼び出しが少なく、conductor の
 * 監督のように複数のビルドをまたぐセッションは、そのブランチでの呼び出しが少ない。
 * 同数なら総呼び出し回数、それも同じなら最後に記録されたもの。
 */
export function selectMain(candidates: Candidate[]): Candidate | undefined {
  return [...candidates].sort(
    (a, b) =>
      b.branchCalls - a.branchCalls ||
      b.measure.calls - a.measure.calls ||
      (b.measure.endedAt ?? "").localeCompare(a.measure.endedAt ?? ""),
  )[0];
}

export const SELECTION_RULE = "そのブランチでの API 呼び出しが最も多いセッションを本体とする";

// ---------------------------------------------------------------------------
// retrospective.md に貼る表

/** retrospective.md の「セッションの実測」表の見出し。tokens-history.mts が読む */
export const SESSION_TABLE_HEADERS = ["計測項目", "値"];

export const SESSION_LABELS = {
  peak: "ピーク",
  first: "開始時の固定分",
  calls: "呼び出し回数",
  output: "出力トークン",
  compactions: "コンパクション",
  /** v3 のベータ版で Codex の記録から書いていた行。読むだけで、もう書かない */
  window: "ウィンドウ",
  model: "モデル",
  host: "ホスト",
  hikyaku: "Hikyaku",
  session: "セッション",
} as const;

export function formatTokens(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString("en-US");
}

export function hostLabel(measure: Pick<SessionMeasure, "host" | "hostVersion">): string {
  return [HOST_LABEL, measure.hostVersion].filter(Boolean).join(" ");
}

export interface SessionTableInput {
  measure: SessionMeasure | undefined;
  /** 計測できなかった理由。measure が無いときに使う */
  reason: string | undefined;
  hikyakuVersion: string | undefined;
  /** セッションの欄に添える補足（「本体。ほか 2 件」など） */
  note: string | undefined;
}

export function renderSessionMarkdown(input: SessionTableInput): string {
  const { measure } = input;
  const dash = "—";
  const rows: [string, string][] = [
    [SESSION_LABELS.peak, measure === undefined ? `計測不可（${input.reason ?? "理由不明"}）` : formatTokens(measure.peak)],
    [SESSION_LABELS.first, measure === undefined ? dash : formatTokens(measure.first)],
    [SESSION_LABELS.calls, measure === undefined ? dash : String(measure.calls)],
    [SESSION_LABELS.output, measure === undefined ? dash : formatTokens(measure.outputTokens)],
    [SESSION_LABELS.compactions, measure === undefined ? dash : String(measure.compactions)],
    [SESSION_LABELS.model, measure?.model ?? dash],
    [SESSION_LABELS.host, measure === undefined ? dash : hostLabel(measure)],
    [SESSION_LABELS.hikyaku, input.hikyakuVersion ?? dash],
    [
      SESSION_LABELS.session,
      measure === undefined
        ? dash
        : `${(measure.sessionId ?? basename(measure.path)).slice(0, 8)}${input.note === undefined ? "" : `（${input.note}）`}`,
    ],
  ];
  const escape = (cell: string): string => cell.replace(/\|/g, "\\|");
  return [
    `| ${SESSION_TABLE_HEADERS.join(" | ")} |`,
    `|${SESSION_TABLE_HEADERS.map(() => "------").join("|")}|`,
    ...rows.map(([label, value]) => `| ${label} | ${escape(value)} |`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 区切りでの実測（step next / step report）

export interface CurrentContext {
  /** 現在のセッションの ID。環境変数が無ければ undefined */
  sessionId: string | undefined;
  /** 最後の呼び出しのコンテキスト。計測できなければ undefined */
  tokens: number | undefined;
  model: string | undefined;
  /** 計測できなかった理由 */
  reason: string | undefined;
}

/** 現在のセッションのコンテキストを測る。読めなければ推測せず理由を返す */
export function measureCurrent(env: Env): CurrentContext {
  const lookup = lookupCurrent(env);
  const sessionId = lookup?.id;
  if (lookup?.path === undefined) {
    return { sessionId, tokens: undefined, model: undefined, reason: describeMissingCurrent(env, lookup) };
  }
  const measure = readMeasure(lookup.path);
  if (measure === undefined) {
    return {
      sessionId, tokens: undefined, model: undefined,
      reason: `API 呼び出しの記録がまだありません: ${lookup.path}`,
    };
  }
  return { sessionId, tokens: measure.latest, model: measure.model, reason: undefined };
}
