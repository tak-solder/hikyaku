/** review resolve / review run — コードとセキュリティ（と別プロバイダの doc）のレビューを起動する */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { flagBoolean, flagInteger, flagList, flagString, type ParsedArgs } from "../lib/args.mts";
import {
  REVIEW_KINDS,
  REVIEW_PROVIDER_ENV,
  REVIEW_PROVIDERS,
  cloudEnvLabel,
  type ResolvedConfig,
  type ReviewKind,
  type ReviewProvider,
  type ReviewProviderSource,
} from "../lib/config.mts";
import { shellQuote } from "../lib/conductor.mts";
import { HikyakuError } from "../lib/errors.mts";
import { defaultBranch, gitPath } from "../lib/git.mts";
import { emit } from "../lib/output.mts";
import { pluginRoot } from "../lib/paths.mts";
import { register } from "../lib/registry.mts";
import {
  buildInvocation,
  docPrompt,
  nativeSecurityReason,
  parseClaudeResult,
  parseCodexResult,
  planReview,
  securityPrompt,
  stripFrontmatter,
  type ReviewInvocation,
  type ReviewOutcome,
  type ReviewPlan,
} from "../lib/review.mts";
import { requirePhase, resolvePrBase, scopeFor, type Scope } from "../lib/stack.mts";
import type { Phase } from "../lib/branch.mts";

function requireKind(raw: string | undefined): ReviewKind {
  if (raw === undefined || !(REVIEW_KINDS as string[]).includes(raw)) {
    throw new HikyakuError(
      raw === undefined ? "レビューの種類を指定してください" : `レビューの種類が不正です: ${raw}`,
      `使用できる値: ${REVIEW_KINDS.join(" | ")}`,
    );
  }
  return raw as ReviewKind;
}

function requireSelf(args: ParsedArgs): ReviewProvider {
  const raw = flagString(args, "self");
  if (raw === undefined || !(REVIEW_PROVIDERS as string[]).includes(raw)) {
    throw new HikyakuError(
      raw === undefined ? "--self にメインのセッションのプロバイダを指定してください" : `--self の値が不正です: ${raw}`,
      `使用できる値: ${REVIEW_PROVIDERS.join(" | ")}（provider = "auto" の解決に使います）`,
    );
  }
  return raw as ReviewProvider;
}

interface Resolved {
  scope: Scope;
  phase: Phase;
  plan: ReviewPlan;
  /** code / security の差分の基準 */
  base: { name: string; ref: string | undefined; stacked: string | undefined } | undefined;
  security: { native: boolean; reason: string } | undefined;
  enabled: boolean | string;
  timeoutMinutes: number;
}

async function resolve(args: ParsedArgs, operands: string[]): Promise<Resolved & { kind: ReviewKind }> {
  const kind = requireKind(operands[0]);
  const phase = requirePhase(operands[1]);
  const self = requireSelf(args);
  if (kind !== "doc" && !phase.startsWith("build-")) {
    throw new HikyakuError(`${kind} のレビューはビルド（build-NN）でだけ実行します: ${phase}`);
  }
  const scope = scopeFor(args, phase, operands[2]);
  const { config } = scope;

  let base: Resolved["base"];
  let security: Resolved["security"];
  if (kind !== "doc") {
    const prBase = await resolvePrBase(scope, phase, { fetch: !flagBoolean(args, "no-fetch") });
    base = { name: prBase.base, ref: prBase.ref, stacked: prBase.stacked?.name };
    if (kind === "security") {
      security = nativeSecurityReason({
        originHead: defaultBranch(config.repoRoot),
        prBase: prBase.base,
        stacked: prBase.stacked !== undefined,
      });
    }
  }

  const plan = planReview({
    kind,
    self,
    settings: config.review[kind],
    baseRef: base?.ref,
    nativeSecurity: security?.native,
  });
  return {
    kind,
    scope,
    phase,
    plan,
    base,
    security,
    enabled: enabledOf(config, kind),
    timeoutMinutes: config.review.timeoutMinutes,
  };
}

function enabledOf(config: ResolvedConfig, kind: ReviewKind): boolean | string {
  if (kind === "code") return config.reviews.code;
  if (kind === "security") return config.reviews.security;
  return true;
}

function describe(resolved: Resolved & { kind: ReviewKind }): string[] {
  const { plan } = resolved;
  const lines = [
    `${plan.kind}: ${plan.provider}（${plan.mode === "agent" ? "サブエージェント" : "別プロセス"}・${styleLabel(plan)}）`,
    `  出所    ${sourceLabel(plan)}`,
    `  model   ${plan.model ?? "(プロバイダの既定)"}`,
    `  effort  ${plan.effort ?? "(プロバイダの既定)"}`,
  ];
  if (plan.kind !== "doc") {
    lines.push(
      `  回数    ${plan.maxRounds === 0 ? "無制限" : `最大 ${plan.maxRounds} 回`}（auto_fix ${plan.autoFix ? "on" : "off"}）`,
      `  有効    ${String(resolved.enabled)}`,
    );
  }
  if (resolved.base !== undefined) {
    lines.push(
      `  基準    ${resolved.base.ref ?? `(ローカルで解決できない: ${resolved.base.name})`}${resolved.base.stacked === undefined ? "" : `（スタック元: ${resolved.base.stacked}）`}`,
    );
  }
  if (resolved.security !== undefined && plan.provider === "claude") {
    lines.push(`  /security-review  ${resolved.security.native ? "使う" : "使わない"}（${resolved.security.reason}）`);
  }
  return lines;
}

export function sourceLabel(plan: Pick<ReviewPlan, "kind" | "provider" | "providerSource" | "providerKey">): string {
  const source: ReviewProviderSource = plan.providerSource;
  if (source === "cloud") return cloudEnvLabel(plan.provider);
  if (source === "env") return `環境変数 ${REVIEW_PROVIDER_ENV}`;
  if (source === "kind.provider_for") return `[review.${plan.kind}.provider_for] の ${plan.providerKey}`;
  if (source === "kind") return `[review.${plan.kind}] の provider`;
  if (source === "review.provider_for") return `[review.provider_for] の ${plan.providerKey}`;
  if (source === "review") return "[review] の provider";
  return "既定（auto = メインのセッションと同じ）";
}

function styleLabel(plan: ReviewPlan): string {
  if (plan.mode === "agent") return "doc-reviewer";
  if (plan.style === "code-review") return plan.provider === "claude" ? "/code-review" : "codex exec review --base";
  if (plan.style === "security-review") return "/security-review";
  return "観点の指示文";
}

register({
  name: "review resolve",
  summary: "レビューを、どのプロバイダ・モデル・回数で、どう起動するかを返す",
  usage: "hikyaku review resolve <code|security|doc> <phase> [<cycle>] --self <claude|codex> [--no-fetch] [--root <path>] [--json]",
  details: [
    "[review] の設定を重ねて、レビューの起動方法を決めます。実行はしません。",
    "",
    "--self にはメインのセッションのプロバイダを渡します（provider = \"auto\" と provider_for の解決に使います）。",
    "",
    "  mode: agent    メインのセッションのサブエージェント（doc-reviewer）で実行する",
    "  mode: process  review run で別プロセスとして実行する",
    "",
    "code と security は、メインと同じプロバイダでも常に別プロセスです。実装したコンテキストから",
    "切り離すためです。doc はメインと同じプロバイダならサブエージェントのまま動かします。",
    "",
    "security を Claude で行うとき、/security-review を使うのは PR のマージ先が origin の",
    "デフォルトブランチと一致するときだけです（security.native）。スタックしていると先行ビルドの",
    "差分が混ざり、origin/HEAD が無いと /security-review は黙って空を返すためです。使えないときは",
    "観点の指示文を渡す形に切り替えます。",
    "",
    "maxRounds が 0 なら回数は無制限です。enabled は code_review / security_review の値です。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const resolved = await resolve(args, operands);
    const { plan } = resolved;
    emit(
      {
        ...plan,
        phase: resolved.phase,
        cycle: resolved.scope.cycle,
        enabled: resolved.enabled,
        timeoutMinutes: resolved.timeoutMinutes,
        base: resolved.base ?? null,
        security: resolved.security ?? null,
      },
      () => describe(resolved).join("\n"),
    );
  },
});

register({
  name: "review run",
  summary: "レビューを別プロセス（claude -p / codex exec）で実行し、生の出力を保存する",
  usage:
    "hikyaku review run <code|security|doc> <phase> [<cycle>] --self <claude|codex> [--round <n>] " +
    "[--context <context> --files <path,...>] [--dry-run] [--no-fetch] [--root <path>] [--json]",
  details: [
    "review resolve と同じ解決をしたうえで、レビューを実行します。出力の解析や指摘の統合はしません。",
    "生の出力は .git の中（git rev-parse --git-path hikyaku/reviews）の",
    "<cycle>/<phase>/round-<n>-<kind>.md に保存し、パスと本文を返します。コミットはしません。",
    "",
    "レビューの対象はコミット済みの差分です。実行する前にローカルでコミットしてください。",
    "",
    "  --round <n>   何回目のレビューか（既定 1）。max_rounds を超えるとエラーにします",
    "  --context     doc のときだけ。doc-reviewer に渡す context（plan / test-spec など）",
    "  --files       doc のときだけ。レビューするファイルと関連ファイルをカンマ区切りで",
    "",
    "起動するコマンド:",
    "",
    "  claude code      claude -p \"/code-review <effort> <ref>...HEAD\" --output-format json",
    "  claude security  claude -p \"/security-review\"（使えないときは観点の指示文）",
    "  codex code       codex exec review --base <ref> -c sandbox_mode=\"read-only\" -o <file>",
    "  codex security   codex exec review -c sandbox_mode=\"read-only\" -o <file> \"<観点の指示文>\"",
    "  doc（別プロバイダ） doc-reviewer の本文を指示文にして claude -p / codex exec に渡す",
    "",
    "Claude では Edit / Write / NotebookEdit を禁じ、Codex は読み取り専用のサンドボックスで",
    "起動します。レビューは指摘を返すだけで、修正はメインのセッションが行います。",
    "",
    "空の結果、claude の is_error、0 以外の終了コード、[review] timeout（分）の超過は失敗として",
    "終了コード 1 を返します。空の結果を指摘0件と取り違えないためです。",
    "",
    "--dry-run では、起動するコマンドと保存先を返すだけで、何も実行しません。",
  ].join("\n"),
  writes: true,
  run: async ({ args, operands }) => {
    const resolved = await resolve(args, operands);
    const { plan, scope, phase } = resolved;
    const { config } = scope;
    const cycle = scope.cycle;
    if (cycle === undefined || scope.context === undefined) {
      throw new HikyakuError("レビューはサイクルの中で実行します");
    }
    if (plan.mode === "agent") {
      throw new HikyakuError(
        "このレビューはメインのセッションのサブエージェントで実行します（mode: agent）",
        "doc-reviewer をサブエージェントとして起動してください。review run は別プロセスのときだけ使います。",
      );
    }

    const round = flagInteger(args, "round") ?? 1;
    if (round < 1) throw new HikyakuError("--round は 1 以上で指定してください");
    if (plan.maxRounds > 0 && round > plan.maxRounds) {
      throw new HikyakuError(
        `${plan.kind} のレビューは最大 ${plan.maxRounds} 回です（--round ${round}）`,
        "残った指摘への対応をユーザーに確認してください。",
      );
    }

    const prompt = buildPrompt(args, resolved, config);
    if (plan.style === "code-review" && resolved.base?.ref === undefined) {
      throw new HikyakuError(
        `差分の基準をローカルで解決できません: ${resolved.base?.name ?? "(不明)"}`,
        "git fetch してから実行し直してください。",
      );
    }

    const directory = await gitPath(config.repoRoot, join("hikyaku", "reviews", cycle, phase));
    if (directory === undefined) throw new HikyakuError("レビューの出力先（.git の中）を決められません");
    const name = plan.kind === "doc" ? `round-${round}-doc-${flagString(args, "context")}` : `round-${round}-${plan.kind}`;
    const outputPath = join(directory, `${name}.md`);
    const rawPath = join(directory, `${name}.raw`);

    const invocation = buildInvocation(plan, { baseRef: resolved.base?.ref, prompt, outputFile: rawPath });
    const commandLine = `${[invocation.command, ...invocation.args].map(shellQuote).join(" ")} < /dev/null`;
    const dryRun = flagBoolean(args, "dry-run");

    if (dryRun) {
      emit(
        { ...plan, round, dryRun, command: invocation.command, args: invocation.args, commandLine, output: outputPath },
        () => [...describe(resolved), "", `ラウンド ${round}（--dry-run）`, `  実行: ${commandLine}`, `  保存先: ${outputPath}`].join("\n"),
      );
      return;
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    // 出力先はラウンドと種類で決まる固定のパスなので、同じラウンドを再実行すると前回のファイルが残っている。
    // 今回のプロセスが何も書かずに終わったとき、前回の結果を今回のものとして読まないよう先に消す
    for (const path of [outputPath, rawPath]) rmSync(path, { force: true });
    const started = Date.now();
    const outcome = await execute(invocation, config.repoRoot, resolved.timeoutMinutes);
    const seconds = Math.round((Date.now() - started) / 1000);
    writeFileSync(outputPath, outcome.text, "utf8");

    if (!outcome.ok) {
      throw new HikyakuError(
        `${plan.kind} のレビューに失敗しました（${plan.provider}・${seconds} 秒）: ${outcome.problem}`,
        [
          `実行: ${commandLine}`,
          `出力: ${outputPath}`,
          "パス（指摘0件）として扱わず、ユーザーに報告してください。",
          // クラウド環境ではプロバイダを固定するので、環境変数で切り替えても効かない
          ...(outcome.launchFailed && plan.providerSource !== "cloud"
            ? [
                `${plan.provider} の CLI が使えない環境なら、環境変数 ${REVIEW_PROVIDER_ENV} で別のプロバイダを指定できます`,
                `（例: ${REVIEW_PROVIDER_ENV}=${plan.provider === "codex" ? "claude" : "codex"}）。設定ファイルより優先されます。`,
              ]
            : []),
        ].join("\n"),
      );
    }
    emit({ ...plan, round, dryRun, commandLine, output: outputPath, seconds, result: outcome.text }, () =>
      [`${plan.kind} のレビュー（${plan.provider}・ラウンド ${round}・${seconds} 秒）: ${outputPath}`, "", outcome.text].join("\n"),
    );
  },
});

function buildPrompt(args: ParsedArgs, resolved: Resolved, config: ResolvedConfig): string | undefined {
  const { plan, scope, phase } = resolved;
  if (plan.style !== "prompt") return undefined;
  const root = pluginRoot();
  if (plan.kind === "doc") {
    const context = flagString(args, "context");
    const files = flagList(args, "files") ?? [];
    if (context === undefined || files.length === 0) {
      throw new HikyakuError("doc のレビューには --context と --files を指定してください");
    }
    return docPrompt({
      agent: stripFrontmatter(readFileSync(join(root, "agents", "doc-reviewer.md"), "utf8")),
      context,
      files,
    });
  }
  const guidePath = join(root, "skills", "builder", "references", "security-review.md");
  if (!existsSync(guidePath)) throw new HikyakuError(`セキュリティレビューの観点が見つかりません: ${guidePath}`);
  return securityPrompt({
    guide: readFileSync(guidePath, "utf8"),
    baseRef: resolved.base?.ref ?? resolved.base?.name ?? "",
    buildDirectory: join(scope.context?.directory ?? "", phase),
    triggers: config.security.triggers,
  });
}

/**
 * レビューを実行する。stdin は閉じて渡す。開いたままだと claude -p が入力を待ち、
 * 待ちきれなかった警告が出力の JSON に混ざる
 */
function execute(
  invocation: ReviewInvocation,
  cwd: string,
  timeoutMinutes: number,
): Promise<ReviewOutcome & { launchFailed?: boolean }> {
  return new Promise((resolvePromise) => {
    const child = spawn(invocation.command, invocation.args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    // spawn の timeout オプションは使わない。起動に失敗したときにタイマーが残り、プロセスが終われなくなる
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMinutes * 60_000);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        text: "",
        problem: `${invocation.command} を起動できません: ${error.message}`,
        launchFailed: true,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal !== null) {
        const reason = timedOut ? `[review] timeout（${timeoutMinutes} 分）を超えました` : `中断されました（${signal}）`;
        resolvePromise({ ok: false, text: stdout, problem: reason });
        return;
      }
      const outcome =
        invocation.outputFile === undefined
          ? parseClaudeResult(stdout)
          : parseCodexResult(existsSync(invocation.outputFile) ? readFileSync(invocation.outputFile, "utf8") : undefined);
      if (code !== 0) {
        const detail = (stderr.trim().split("\n").at(-1) ?? "").slice(0, 300);
        resolvePromise({ ok: false, text: outcome.text, problem: `終了コード ${code}${detail === "" ? "" : `: ${detail}`}` });
        return;
      }
      resolvePromise(outcome);
    });
  });
}
