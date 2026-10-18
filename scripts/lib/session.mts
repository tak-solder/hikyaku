/**
 * セッションのコンテキスト実測。
 *
 * BP を「メインセッションのコンテキスト消費量」で校正するための目的変数を、
 * ホストが残す記録から読む（#68）。読むのはメインセッションだけで、
 * サブエージェントはウィンドウが別なのでコンパクションの判断に関わらない。
 *
 *   Claude Code  {CLAUDE_CONFIG_DIR|~/.claude}/projects/<cwd を変換した名前>/<session>.jsonl
 *                現在のセッションは CLAUDE_CODE_SESSION_ID がファイル名と一致する
 *   Codex        {CODEX_HOME|~/.codex}/sessions/**\/rollout-*<thread>.jsonl
 *                現在のスレッドは CODEX_THREAD_ID（CODEX_SESSION_ID も同じ値）
 *
 * どちらの形式も公開された仕様ではない。読めない・見つからないときは推測で
 * 埋めず、「計測不可」とその理由を返す（Codex のクラウドでは rollout が保存されない）。
 */

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";

export type SessionHost = "claude-code" | "codex";
/** main 以外（サブエージェント・guardian）は計測の対象外 */
export type SessionKind = "main" | "subagent" | "guardian";

export const HOST_LABELS: Record<SessionHost, string> = { "claude-code": "Claude Code", codex: "Codex" };

export interface SessionMeasure {
  host: SessionHost;
  /** Claude Code の version / Codex の cli_version */
  hostVersion: string | undefined;
  /** Claude Code の entrypoint / Codex の originator */
  client: string | undefined;
  path: string;
  sessionId: string | undefined;
  kind: SessionKind;
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
  /** コンテキストウィンドウ。記録に無ければ undefined（Claude Code は記録しない） */
  window: number | undefined;
  /** ブランチごとの呼び出し回数。Codex はセッション開始時のブランチだけ */
  callsByBranch: Record<string, number>;
  cwd: string | undefined;
  repositoryUrl: string | undefined;
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
    kind: "main",
    model: mostFrequent(modelCounts),
    models: [...modelCounts.keys()],
    ...summarize(samples),
    compactions,
    window: undefined,
    callsByBranch,
    cwd,
    repositoryUrl: undefined,
    startedAt,
    endedAt,
  };
}

/** session_meta から、メインセッションか、サブエージェント・guardian かを判定する */
export function codexKind(meta: Json | undefined): SessionKind {
  if (meta === undefined) return "main";
  const threadSource = asString(meta["thread_source"]);
  const source = meta["source"];
  const originator = asString(meta["originator"]) ?? "";
  const subagent = asObject(source)?.["subagent"];
  const describe = JSON.stringify(subagent ?? "");
  if (
    threadSource === "guardian_review" ||
    describe.includes("guardian") ||
    originator.includes("auto-review") ||
    (typeof source === "string" && source.includes("auto-review"))
  ) {
    return "guardian";
  }
  if (subagent !== undefined || threadSource === "subagent") return "subagent";
  return "main";
}

/**
 * Codex の rollout を読む。
 *
 * token_count の info.last_token_usage.input_tokens を呼び出しのコンテキスト、
 * info.model_context_window をウィンドウとする。同じ累計（total_token_usage）の
 * token_count が続くのは同じ呼び出しの再通知なので1件にまとめる。コンパクション
 * 直後の token_count は 0 になるので呼び出しに数えない。コンパクションは
 * 最上位の type=="compacted" の行。呼び出しが1件も無ければ undefined。
 */
export function parseCodexRollout(text: string, path: string): SessionMeasure | undefined {
  const samples: CallSample[] = [];
  const modelCounts = new Map<string, number>();
  let meta: Json | undefined;
  let model: string | undefined;
  let window: number | undefined;
  let compactions = 0;
  let lastTotal: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  for (const line of jsonLines(text)) {
    const timestamp = asString(line["timestamp"]);
    if (timestamp !== undefined) {
      startedAt ??= timestamp;
      endedAt = timestamp;
    }
    const payload = asObject(line["payload"]);
    if (line["type"] === "session_meta") {
      meta ??= payload;
      continue;
    }
    if (line["type"] === "compacted") {
      compactions += 1;
      continue;
    }
    if (line["type"] === "turn_context") {
      model = asString(payload?.["model"]) ?? model;
      continue;
    }
    if (payload?.["type"] !== "token_count") continue;
    const info = asObject(payload["info"]);
    if (info === undefined) continue;
    const total = JSON.stringify(info["total_token_usage"] ?? null);
    if (total === lastTotal) continue;
    lastTotal = total;
    const last = asObject(info["last_token_usage"]);
    const context = asNumber(last?.["input_tokens"]);
    const reported = asNumber(info["model_context_window"]);
    if (reported > 0) window = reported;
    if (context <= 0) continue;
    samples.push({ context, output: asNumber(last?.["output_tokens"]) });
    const key = model ?? "unknown";
    modelCounts.set(key, (modelCounts.get(key) ?? 0) + 1);
  }

  if (samples.length === 0) return undefined;

  const git = asObject(meta?.["git"]);
  const branch = asString(git?.["branch"]);
  return {
    host: "codex",
    hostVersion: asString(meta?.["cli_version"]),
    client: asString(meta?.["originator"]),
    path,
    sessionId: asString(meta?.["id"]) ?? asString(meta?.["session_id"]),
    kind: codexKind(meta),
    model: mostFrequent(modelCounts),
    models: [...modelCounts.keys()],
    ...summarize(samples),
    compactions,
    window,
    callsByBranch: branch === undefined ? {} : { [branch]: samples.length },
    cwd: asString(meta?.["cwd"]),
    repositoryUrl: asString(git?.["repository_url"]),
    startedAt,
    endedAt,
  };
}

/** 中身から形式を判定する。Codex の rollout は各行が payload を持つ */
export function detectHost(text: string): SessionHost | undefined {
  for (const line of jsonLines(text)) {
    if ("payload" in line) return "codex";
    if ("sessionId" in line || line["type"] === "assistant" || line["type"] === "user") return "claude-code";
  }
  return undefined;
}

export function parseTranscript(text: string, path: string, host: SessionHost): SessionMeasure | undefined {
  return host === "codex" ? parseCodexRollout(text, path) : parseClaudeTranscript(text, path);
}

// ---------------------------------------------------------------------------
// 記録の所在

export type Env = Record<string, string | undefined>;

export function claudeConfigDir(env: Env): string {
  return asString(env["CLAUDE_CONFIG_DIR"]) ?? join(homedir(), ".claude");
}

export function codexHome(env: Env): string {
  return asString(env["CODEX_HOME"]) ?? join(homedir(), ".codex");
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

function walkRollouts(directory: string, found: string[]): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkRollouts(path, found);
    else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) found.push(path);
  }
}

export function codexRollouts(env: Env): string[] {
  const found: string[] = [];
  walkRollouts(join(codexHome(env), "sessions"), found);
  return found.sort();
}

export function findCodexRollout(env: Env, threadId: string): string | undefined {
  // ファイル名は rollout-<日時>-<thread>.jsonl。ID の一部だけで一致させない
  return codexRollouts(env).find((path) => basename(path).endsWith(`-${threadId}.jsonl`));
}

/** 先頭行（Codex の session_meta）だけを読む。rollout 全体を読まずに絞り込むため */
export function readFirstLine(path: string): string {
  const fd = openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      const chunk = buffer.subarray(0, read);
      const newline = chunk.indexOf(10);
      if (newline !== -1) {
        chunks.push(Buffer.from(chunk.subarray(0, newline)));
        break;
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export function codexMeta(path: string): Json | undefined {
  try {
    const first = asObject(JSON.parse(readFirstLine(path)));
    return first?.["type"] === "session_meta" ? asObject(first["payload"]) : undefined;
  } catch {
    return undefined;
  }
}

export function readMeasure(path: string, host?: SessionHost): SessionMeasure | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const detected = host ?? detectHost(text);
  return detected === undefined ? undefined : parseTranscript(text, path, detected);
}

function modifiedAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 現在のセッション

export interface CurrentLookup {
  host: SessionHost;
  variable: string;
  id: string;
  path: string | undefined;
}

/** 環境変数から現在のセッションの記録を探す。host を指定するとそのホストだけ */
export function lookupCurrent(env: Env, host?: SessionHost): CurrentLookup[] {
  const found: CurrentLookup[] = [];
  const claudeId = asString(env["CLAUDE_CODE_SESSION_ID"]);
  if (claudeId !== undefined && host !== "codex") {
    found.push({ host: "claude-code", variable: "CLAUDE_CODE_SESSION_ID", id: claudeId, path: findClaudeTranscript(env, claudeId) });
  }
  const codexVariable = asString(env["CODEX_THREAD_ID"]) !== undefined ? "CODEX_THREAD_ID" : "CODEX_SESSION_ID";
  const codexId = asString(env[codexVariable]);
  if (codexId !== undefined && host !== "claude-code") {
    found.push({ host: "codex", variable: codexVariable, id: codexId, path: findCodexRollout(env, codexId) });
  }
  return found;
}

/**
 * 両方の変数がある（片方のホストからもう片方を起動した）ときは、
 * いま追記されている側、つまり最後に更新された記録を現在のセッションとする
 */
export function pickCurrent(lookups: CurrentLookup[]): CurrentLookup | undefined {
  const located = lookups.filter((lookup) => lookup.path !== undefined);
  located.sort((a, b) => modifiedAt(b.path as string) - modifiedAt(a.path as string));
  return located[0];
}

/** 現在のセッションが見つからないときの理由。推測で埋めないために文で返す */
export function describeMissingCurrent(env: Env, lookups: CurrentLookup[]): string {
  if (lookups.length === 0) {
    return "現在のセッションを特定できません（CLAUDE_CODE_SESSION_ID も CODEX_THREAD_ID も設定されていません）。--transcript <path> で指定できます";
  }
  return lookups
    .map((lookup) => {
      if (lookup.host === "claude-code") {
        return `Claude Code のトランスクリプトが見つかりません: ${join(claudeConfigDir(env), "projects", "*", `${lookup.id}.jsonl`)}`;
      }
      const cloud = asString(env["CODEX_ENVIRONMENT_ID"]) !== undefined;
      return cloud
        ? "Codex のクラウドでは rollout が保存されないため計測できません"
        : `Codex の rollout が見つかりません: ${join(codexHome(env), "sessions")} に ${lookup.id} のファイルがありません`;
    })
    .join("。");
}

// ---------------------------------------------------------------------------
// ブランチからビルドのセッションを集める

export interface RepositoryScope {
  /** メインの作業ツリーと、いま登録されている worktree */
  roots: string[];
  originUrl: string | undefined;
}

function underRoots(cwd: string | undefined, roots: string[]): boolean {
  if (cwd === undefined) return false;
  return roots.some((root) => cwd === root || cwd.startsWith(root.endsWith(sep) ? root : `${root}${sep}`));
}

export interface BranchSessions {
  measures: SessionMeasure[];
  /** 対象外にしたセッション（サブエージェント・guardian） */
  excluded: SessionMeasure[];
}

/**
 * ブランチに対応付くセッションを集める。
 *
 * Claude Code は各行の gitBranch で、そのブランチでの呼び出しが1件以上あるもの。
 * Codex は session_meta の git.branch（セッション開始時のブランチ）で、
 * cwd がこのリポジトリの作業ツリーの中か、repository_url が origin と一致するもの。
 */
export function collectBranchSessions(env: Env, scope: RepositoryScope, branch: string, host?: SessionHost): BranchSessions {
  const measures: SessionMeasure[] = [];
  const excluded: SessionMeasure[] = [];

  if (host !== "codex") {
    for (const path of claudeTranscriptsFor(env, scope.roots)) {
      const measure = readMeasure(path, "claude-code");
      if (measure === undefined || (measure.callsByBranch[branch] ?? 0) === 0) continue;
      if (!underRoots(measure.cwd, scope.roots)) continue;
      measures.push(measure);
    }
  }

  if (host !== "claude-code") {
    for (const path of codexRollouts(env)) {
      const meta = codexMeta(path);
      const git = asObject(meta?.["git"]);
      if (asString(git?.["branch"]) !== branch) continue;
      const sameRepository =
        underRoots(asString(meta?.["cwd"]), scope.roots) ||
        (scope.originUrl !== undefined && asString(git?.["repository_url"]) === scope.originUrl);
      if (!sameRepository) continue;
      const measure = readMeasure(path, "codex");
      if (measure === undefined) continue;
      (measure.kind === "main" ? measures : excluded).push(measure);
    }
  }

  return { measures, excluded };
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

/** retrospective.md の「セッションの実測」表の見出し。bp-history.mts が読む */
export const SESSION_TABLE_HEADERS = ["計測項目", "値"];

export const SESSION_LABELS = {
  peak: "ピーク",
  first: "開始時の固定分",
  calls: "呼び出し回数",
  output: "出力トークン",
  compactions: "コンパクション",
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
  return [HOST_LABELS[measure.host], measure.hostVersion].filter(Boolean).join(" ");
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
    [SESSION_LABELS.window, measure?.window === undefined ? dash : formatTokens(measure.window)],
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
