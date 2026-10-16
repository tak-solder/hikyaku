/**
 * レビューの起動方法の解決。
 *
 * コードとセキュリティのレビューは、Claude Code（/code-review・/security-review）と
 * Codex（codex exec review）に組み込みのレビュー機能へ任せる。ここで決めるのは
 * 「どのプロバイダで、どのコマンドを、どの引数で起動するか」だけで、出力の解析や
 * 指摘の統合はしない（自由な文章なので、判断は呼び出し元の LLM が行う）。
 *
 * 押さえておく制約（issue #57 で確かめたもの）:
 *
 *   - codex exec review の --base と指示文（PROMPT）は排他。範囲を指定すると指示文を渡せない
 *   - /code-review はレベルとフラグより後ろを全てレビュー対象として読む。指示文を足せない
 *   - /security-review は引数を取らず、origin のデフォルトブランチとの差分を見る。
 *     スタックしていると先行ビルドの差分が混ざり、origin/HEAD が無いと黙って空を返す
 *   - Codex にはセキュリティ専用のレビュー機能が無い
 *
 * このため、/security-review を使えない場面と Codex のセキュリティレビューは、
 * 観点を書いた指示文（skills/builder/references/security-review.md）を渡す形で代える。
 */

import type { ReviewKind, ReviewKindSettings, ReviewModelSettings, ReviewProvider } from "./config.mts";

/**
 * 起動の形。
 *   agent    メインのセッションのサブエージェントで実行する（doc で、プロバイダがメインと同じとき）
 *   process  別プロセス（claude -p / codex exec）で実行する
 */
export type ReviewMode = "agent" | "process";

/**
 * 何を渡して起動するか。
 *   code-review      /code-review（Claude）・codex exec review --base（Codex）
 *   security-review  /security-review（Claude のみ）
 *   prompt           観点の指示文を渡す（スタックしたビルドのセキュリティ、Codex のセキュリティ、別プロバイダの doc）
 */
export type ReviewStyle = "code-review" | "security-review" | "prompt";

export interface ReviewPlanInput {
  kind: ReviewKind;
  /** メインのセッションのプロバイダ */
  self: ReviewProvider;
  settings: ReviewKindSettings;
  /** 差分の基準にする、ローカルで解決できる ref（pr base --ref の値）。doc では使わない */
  baseRef?: string | undefined;
  /** /security-review をそのまま使えるか。理由は nativeSecurityReason */
  nativeSecurity?: boolean;
}

export interface ReviewPlan {
  kind: ReviewKind;
  provider: ReviewProvider;
  mode: ReviewMode;
  style: ReviewStyle;
  model: string | undefined;
  effort: string | undefined;
  maxRounds: number;
  autoFix: boolean;
}

export function planReview(input: ReviewPlanInput): ReviewPlan {
  const { kind, self, settings } = input;
  const provider = settings.provider === "auto" ? self : settings.provider;
  const models: ReviewModelSettings = settings.models[provider];
  // doc はメインと同じプロバイダなら今までどおりサブエージェントで動かす。
  // code / security は実装したコンテキストから切り離すため、常に別プロセスにする
  const mode: ReviewMode = kind === "doc" && provider === self ? "agent" : "process";
  let style: ReviewStyle;
  if (kind === "code") style = "code-review";
  else if (kind === "security" && provider === "claude" && input.nativeSecurity === true) style = "security-review";
  else style = "prompt";
  return {
    kind,
    provider,
    mode,
    style,
    model: models.model,
    effort: models.effort,
    maxRounds: settings.maxRounds,
    autoFix: settings.autoFix,
  };
}

/**
 * /security-review をそのまま使えるか。
 *
 * /security-review は origin のデフォルトブランチとの差分を見るので、PR のマージ先が
 * それと一致し、かつ origin/HEAD が解決できるときだけ使う。origin/HEAD が無いと
 * エラーにならず空の結果を返し、指摘0件と見分けがつかない
 */
export function nativeSecurityReason(input: {
  originHead: string | undefined;
  prBase: string;
  stacked: boolean;
}): { native: boolean; reason: string } {
  if (input.originHead === undefined) {
    return { native: false, reason: "origin/HEAD を解決できない（/security-review は空の結果を返すため使わない）" };
  }
  if (input.stacked) {
    return { native: false, reason: "スタックしている（/security-review では先行ビルドの差分が混ざる）" };
  }
  if (input.prBase !== input.originHead) {
    return {
      native: false,
      reason: `PR のマージ先（${input.prBase}）が origin のデフォルトブランチ（${input.originHead}）と異なる`,
    };
  }
  return { native: true, reason: "PR のマージ先が origin のデフォルトブランチと一致する" };
}

export interface ReviewInvocation {
  command: "claude" | "codex";
  args: string[];
  /** Codex が最後のメッセージを書き出すファイル（-o）。Claude は標準出力の JSON から取る */
  outputFile: string | undefined;
}

/** Claude で書き換えを伴うツールを禁じる。レビューは指摘だけを返し、修正はメインのセッションが行う */
const CLAUDE_DISALLOWED = ["Edit", "Write", "NotebookEdit"];

/**
 * 起動するコマンドを組み立てる。
 *
 * Codex は読み取り専用のサンドボックスで起動する。既定の workspace-write のままだと、
 * レビューの途中で作業ツリーのコードを実行・変更できてしまう
 */
export function buildInvocation(
  plan: ReviewPlan,
  options: { baseRef: string | undefined; prompt: string | undefined; outputFile: string },
): ReviewInvocation {
  if (plan.mode === "agent") {
    throw new Error("サブエージェントで実行するレビューはコマンドを組み立てない");
  }
  if (plan.style === "prompt" && (options.prompt === undefined || options.prompt.trim() === "")) {
    throw new Error("指示文を渡すレビューに指示文がありません");
  }
  if (plan.style === "code-review" && options.baseRef === undefined) {
    throw new Error("コードレビューには差分の基準（ref）が要ります");
  }

  if (plan.provider === "claude") {
    let prompt: string;
    if (plan.style === "code-review") {
      // レベルを渡さないと前回手で打ったレベルが再利用されるので、effort があれば必ず渡す
      prompt = ["/code-review", plan.effort, `${options.baseRef}...HEAD`].filter((part) => part !== undefined).join(" ");
    } else if (plan.style === "security-review") {
      prompt = "/security-review";
    } else {
      prompt = options.prompt as string;
    }
    const args = ["-p", prompt, "--output-format", "json"];
    if (plan.model !== undefined) args.push("--model", plan.model);
    if (plan.effort !== undefined) args.push("--effort", plan.effort);
    args.push("--disallowedTools", ...CLAUDE_DISALLOWED);
    return { command: "claude", args, outputFile: undefined };
  }

  const config: string[] = [];
  if (plan.model !== undefined) config.push("-m", plan.model);
  if (plan.effort !== undefined) config.push("-c", `model_reasoning_effort=${JSON.stringify(plan.effort)}`);
  config.push("-c", 'sandbox_mode="read-only"', "-o", options.outputFile);

  if (plan.style === "code-review") {
    return {
      command: "codex",
      args: ["exec", "review", "--base", options.baseRef as string, ...config],
      outputFile: options.outputFile,
    };
  }
  // セキュリティはレビューの形式（優先度と箇所つきの指摘）で返させたいので exec review に指示文を渡す。
  // doc はコードのレビューではないので通常の exec にする
  const sub = plan.kind === "doc" ? ["exec"] : ["exec", "review"];
  return { command: "codex", args: [...sub, ...config, options.prompt as string], outputFile: options.outputFile };
}

/** frontmatter を取り除いた本文。エージェント定義を指示文として渡すときに使う */
export function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return (match === null ? markdown : markdown.slice(match[0].length)).trim();
}

export interface SecurityPromptInput {
  /** skills/builder/references/security-review.md の本文 */
  guide: string;
  baseRef: string;
  buildDirectory: string;
  triggers: string;
}

export function securityPrompt(input: SecurityPromptInput): string {
  return [
    // 冒頭のコメントは保守者向けの説明なので渡さない
    input.guide.replace(/<!--[\s\S]*?-->/g, "").trim(),
    "",
    "## 今回の対象",
    "",
    `- 対象ビルド: \`${input.buildDirectory}\`（plan.md と issue.md はここにある）`,
    `- 差分の基準: \`${input.baseRef}\`。コミット済みの差分は \`git diff $(git merge-base ${input.baseRef} HEAD)..HEAD\` で確認する。\`origin/main\` などで代用しない`,
    "- 未コミットの変更と未追跡ファイルも `git status` / `git diff` / `git diff --cached` で確認する",
    "- このリポジトリが機微情報として扱うもの（[review.security] triggers）:",
    ...input.triggers.split("\n").map((line) => `  ${line}`),
  ].join("\n");
}

export interface DocPromptInput {
  /** agents/doc-reviewer.md の本文（frontmatter を除く） */
  agent: string;
  context: string;
  files: string[];
}

export function docPrompt(input: DocPromptInput): string {
  return [
    input.agent.trim(),
    "",
    "## 今回の依頼",
    "",
    `- context: ${input.context}`,
    "- 読むファイル（関連ファイルは自分で探さず、ここに無いものは「検証不能」として扱う）:",
    ...input.files.map((file) => `  - \`${file}\``),
  ].join("\n");
}

export interface ReviewOutcome {
  ok: boolean;
  text: string;
  /** ok でないときの理由 */
  problem: string | undefined;
}

/**
 * claude -p --output-format json の結果を読む。
 *
 * 失敗の判定は結果の本文で行う。num_turns は /code-review が正常に返したときも 0 になるので
 * 使えない。origin/HEAD が無いときの /security-review は is_error: false のまま
 * 空の本文を返すので、空は成功（指摘0件）ではなく失敗として扱う
 */
export function parseClaudeResult(stdout: string): ReviewOutcome {
  // stdin を閉じ忘れたときの警告など、JSON の前に行が混ざることがある
  const start = stdout.indexOf("{");
  let raw: unknown;
  try {
    raw = JSON.parse(start === -1 ? stdout : stdout.slice(start));
  } catch {
    return { ok: false, text: "", problem: `claude の出力を JSON として読めません: ${stdout.slice(0, 200)}` };
  }
  const record = (raw ?? {}) as { is_error?: unknown; result?: unknown; subtype?: unknown };
  const text = typeof record.result === "string" ? record.result : "";
  if (record.is_error === true) {
    return { ok: false, text, problem: `claude がエラーを返しました（${String(record.subtype ?? "unknown")}）` };
  }
  if (text.trim() === "") {
    return {
      ok: false,
      text,
      problem: "claude が空の結果を返しました（/security-review なら origin/HEAD を確認してください）",
    };
  }
  return { ok: true, text, problem: undefined };
}

/** codex exec -o が書き出した最後のメッセージを読む */
export function parseCodexResult(fileContent: string | undefined): ReviewOutcome {
  if (fileContent === undefined || fileContent.trim() === "") {
    return { ok: false, text: "", problem: "codex が結果を書き出しませんでした" };
  }
  return { ok: true, text: fileContent, problem: undefined };
}
