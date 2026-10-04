/** conductor asks / launch / parse — 監督が子セッションを動かすための組み立てと解析 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { flagString, type ParsedArgs } from "../lib/args.mts";
import {
  CATEGORY_LABELS,
  collectTags,
  CONDUCTED_SKILLS,
  CONDUCTOR_PHASES,
  type ConductorPhase,
  defaultAllowedTools,
  judgePr,
  lintTags,
  modelFor,
  parseResultJson,
  resolveAllAsks,
  resolveAsk,
  settingsDigest,
  shellQuote,
  type PrView,
  type ResolvedAsk,
} from "../lib/conductor.mts";
import { branchName } from "../lib/branch.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { emit, table } from "../lib/output.mts";
import { pluginRoot } from "../lib/paths.mts";
import { register } from "../lib/registry.mts";
import { normalizeBuildId } from "../lib/tasklist.mts";
import type { ResolvedConfig } from "../lib/config.mts";
import { openCycle, type CycleContext } from "../lib/workspace.mts";


register({
  name: "conductor asks",
  summary: "子セッションが出しうる問いと、監督・人間への振り分けを一覧する",
  usage: "hikyaku conductor asks [<cycle>] [--root <path>] [--json]",
  details: [
    "サイクルの profile と [conductor] の escalate / delegate を重ねた結果を返します。",
    "監督は起動時にこれを読み、どの問いを自分が判断するかを人間に示します。",
    "",
    "  handler   supervisor（監督が答える）| human（人間に上げる）",
    "  source    default | escalate | delegate | fixed（設定で変えられない）",
    "  enabled   false なら、この profile ではそのゲートが無効で問いは出ない",
    "",
    "サイクルの中止（abandon）と ID の無い問い（other）は常に人間に上げます。",
    "",
    "JSON 出力には、子に許可するツールの一覧（allowedTools）と、委任の範囲を決める",
    "設定のダイジェスト（digest）も含みます。監督は人間と合意したときの digest を、",
    "以後の conductor launch / parse に --expect-digest で渡します。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const { config, context } = openCycle(args, operands[0]);
    const asks = resolveAllAsks(config.conductor, config);
    const digest = digestOf(config);
    const allowedTools = allowedToolsOf(config);
    const models = Object.fromEntries(
      CONDUCTOR_PHASES.map((phase) => [phase, modelFor(config.conductor, phase) ?? null]),
    );

    emit({ cycle: context.name, profile: config.profile, digest, allowedTools, models, asks }, () => {
      const ids = (filter: (ask: ResolvedAsk) => boolean): string =>
        asks.filter(filter).map((ask) => ask.id).join(" / ") || "なし";
      const consent = (ask: ResolvedAsk): boolean => ask.category === "consent";
      return [
        `サイクル ${context.name}（profile: ${config.profile}）`,
        "",
        `監督が判断する同意ゲート: ${ids((a) => consent(a) && a.enabled && a.handler === "supervisor")}`,
        `監督が判断するその他の問い: ${ids((a) => !consent(a) && a.enabled && a.handler === "supervisor")}`,
        `人間に上げる問い: ${ids((a) => a.enabled && a.handler === "human")}`,
        `この profile では出ない問い: ${ids((a) => !a.enabled)}`,
        `子に許可するツール: ${allowedTools.join(" ")}`,
        `子のモデル: ${CONDUCTOR_PHASES.map((phase) => `${phase}=${models[phase] ?? "既定"}`).join(" / ")}`,
        `設定のダイジェスト: ${digest}`,
        "",
        table(
          asks.map((ask) => [
            ask.id,
            ask.categoryLabel,
            ask.enabled ? (ask.handler === "supervisor" ? "監督" : "人間") : "（無効）",
            ask.source,
            ask.where,
          ]),
          ["id", "種別", "扱い", "根拠", "箇所"],
        ),
      ].join("\n");
    });
  },
});

register({
  name: "conductor launch",
  summary: "子セッション（claude -p）の起動コマンドを組み立てる。自分では実行しない",
  usage:
    "hikyaku conductor launch <architect|builder|close-cycle> [<cycle>] [<build>] --expect-digest <digest> " +
    "[--resume <session-id> --message <file>] [--out <file>] [--root <path>] [--json]",
  details: [
    "実行すべきコマンド行と session-id を返します。起動は呼び出し元（監督）が行います。",
    "起動を監督の Bash に置くのは、許可ルール（Bash(claude -p:*)）で人間が制御できる",
    "場所で権限を広げるためです。",
    "",
    "  architect     /hikyaku:architect <cycle> [build-NN]（build を渡すと差し戻しからの再設計）",
    "  builder       /hikyaku:builder <cycle> <build>（build は必須）",
    "  close-cycle   /hikyaku:close-cycle <cycle>",
    "",
    "--resume と --message は、gate で止まった子を再開するときに組で渡します。",
    "--message のファイルの中身が、子への回答としてそのまま渡ります。",
    "",
    "組み立てるコマンドには次が必ず入ります。",
    "",
    "  --append-system-prompt-file   非対話規約（skills/conductor/references/headless-protocol.md）",
    "  --disallowedTools AskUserQuestion",
    "  --permission-mode acceptEdits と --permission-prompts none",
    "  --allowedTools                既定に [conductor] allowed_tools を足したもの。既定の node は",
    "                                Hikyaku CLI の実行だけで、node -e などは許可しない",
    "  --output-format json          結果を --out のファイルに書く（conductor parse の入力）",
    "  < /dev/null                   バックグラウンド起動で stdin を待たないため",
    "",
    "[conductor] budget_per_run が 0 より大きければ --max-budget-usd も入ります。",
    "[conductor.models] のそのフェーズ、無ければ [conductor] model が指定されていれば",
    "--model も入ります。どちらも無ければ Claude Code の既定のモデルで動きます。",
    "--out を省くと、一時ディレクトリに session-id 入りの名前で書きます。",
    "",
    "--expect-digest には、監督が起動時に人間と合意したときの conductor asks の digest を",
    "渡します。設定が変わっていればエラーで止まります。子は .hikyaku.config を書き換えられる",
    "ので、書き換えた権限や振り分けが次の起動で黙って効くのを防ぐためです。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const phase = requireConductorPhase(operands[0]);
    const { config, context } = openCycle(args, operands[1]);
    requireDigest(args, config);
    const prompt = buildPrompt(phase, context, operands[2]);

    const resume = flagString(args, "resume");
    const messageFile = flagString(args, "message");
    if ((resume === undefined) !== (messageFile === undefined)) {
      throw new HikyakuError(
        "--resume と --message は組で指定してください",
        "gate で止まった子を再開するときは、子の session-id と回答を書いたファイルの両方が要ります。",
      );
    }

    let message: string | undefined;
    if (messageFile !== undefined) {
      if (!existsSync(messageFile)) throw new HikyakuError(`--message のファイルがありません: ${messageFile}`);
      message = readFileSync(messageFile, "utf8").trim();
      if (message === "") throw new HikyakuError(`--message のファイルが空です: ${messageFile}`);
    }

    const sessionId = resume ?? randomUUID();
    const out = flagString(args, "out") ?? join(tmpdir(), `hikyaku-conductor-${sessionId}-${Date.now()}.json`);
    const protocol = join(pluginRoot(), "skills", "conductor", "references", "headless-protocol.md");
    const allowedTools = allowedToolsOf(config);
    const model = modelFor(config.conductor, phase);

    const argv = [
      "claude",
      "-p",
      message ?? prompt,
      ...(resume === undefined ? ["--session-id", sessionId] : ["--resume", sessionId]),
      "--append-system-prompt-file",
      protocol,
      "--disallowedTools",
      "AskUserQuestion",
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
      "--allowedTools",
      ...allowedTools,
      ...(config.conductor.budgetPerRun > 0 ? ["--max-budget-usd", String(config.conductor.budgetPerRun)] : []),
      ...(model === undefined ? [] : ["--model", model]),
      "--output-format",
      "json",
    ];
    const command = `${argv.map(shellQuote).join(" ")} < /dev/null > ${shellQuote(out)}`;

    emit(
      {
        phase,
        cycle: context.name,
        prompt,
        sessionId,
        resumed: resume !== undefined,
        resultFile: out,
        budgetPerRun: config.conductor.budgetPerRun,
        model: model ?? null,
        allowedTools,
        argv,
        command,
      },
      () =>
        [
          `${resume === undefined ? "起動" : "再開"}: ${prompt}`,
          `session-id: ${sessionId}`,
          `結果: ${out}`,
          "",
          command,
        ].join("\n"),
    );
  },
});

register({
  name: "conductor parse",
  summary: "子セッションの結果から gate / done / blocked を取り出し、問いの振り分けを返す",
  usage: "hikyaku conductor parse <result.json> [<cycle>] --expect-digest <digest> [--root <path>] [--json]",
  details: [
    "conductor launch が組み立てたコマンドの結果ファイルを読みます。",
    "",
    "  gate       問いで止まった。id と、監督・人間のどちらが答えるか（ask）を返す",
    "  done       フェーズを終えた。next に子が案内した次のコマンド",
    "  blocked    子が続行できないと判断した。cycle status で次を決める",
    "  violation  規約どおりのブロックが無い。監督は自由文から推測せず、人間に上げる",
    "  error      予算超過などで子が異常終了した",
    "",
    "どの場合も sessionId と costUsd（その呼び出しの費用）を返します。再開しても",
    "session-id は変わらないので、次の conductor launch --resume にそのまま渡せます。",
    "問いの振り分けは conductor asks と同じ規則です。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const file = operands[0];
    if (file === undefined) throw new HikyakuError("結果ファイルを指定してください");
    if (!existsSync(file)) throw new HikyakuError(`結果ファイルがありません: ${file}`);

    const { config, context } = openCycle(args, operands[1]);
    requireDigest(args, config);
    const parsed = parseResultJson(readFileSync(file, "utf8"));
    const ask =
      parsed.outcome === "gate" && parsed.id !== undefined
        ? resolveAsk(parsed.id, config.conductor, config)
        : undefined;

    emit({ cycle: context.name, ...parsed, ask: ask ?? null }, () => {
      const lines = [`結果: ${parsed.outcome}`];
      if (ask !== undefined) {
        lines.push(
          `問い: ${ask.id}（${CATEGORY_LABELS[ask.category]}）→ ${ask.handler === "supervisor" ? "監督が答える" : "人間に上げる"}`,
        );
      }
      if (parsed.next) lines.push(`次: ${parsed.next}`);
      if (parsed.reason) lines.push(`理由: ${parsed.reason}`);
      lines.push(`session-id: ${parsed.sessionId ?? "不明"}`);
      if (parsed.costUsd !== null) lines.push(`費用: $${parsed.costUsd.toFixed(2)}`);
      lines.push("", parsed.body);
      return lines.join("\n");
    });
  },
});

const run = promisify(execFile);

register({
  name: "conductor check-pr",
  summary: "フェーズの PR を conductor ブランチに取り込んでよいか（マージ先と CI）を検証する",
  usage: "hikyaku conductor check-pr <pr> [<cycle>] [--root <path>] [--json]",
  details: [
    "<pr> は PR の番号か URL です。gh pr view で PR の状態を読み、次を確かめます。",
    "",
    "  マージ先   PR の base が、このサイクルの conductor ブランチであること",
    "  状態       PR が開いていること（マージ済み・クローズ済みでないこと）",
    "  CI         失敗しているチェックも、まだ終わっていないチェックも無いこと",
    "",
    "満たしていなければ終了コード 2 で、理由を problems に返します。",
    "",
    "監督は PR を GitHub の機能ではなく、ローカルの git merge と push で取り込みます。",
    "そのためブランチ保護の必須チェックが働きません。このコマンドがその代わりです。",
    "",
    "CI が1つも無い場合（paths フィルタで走らない、CI の無いリポジトリなど）は",
    "確かめるものが無いので失敗にせず、checks.status を none で返します。PR を作った直後は",
    "チェックがまだ登録されていないことがあるので、none のときは少し待って再実行してください。",
    "pending のときは、gh pr checks <pr> --watch で終わるのを待ってから再実行します。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const pr = operands[0];
    if (pr === undefined) throw new HikyakuError("PR の番号か URL を指定してください");
    const { config, context } = openCycle(args, operands[1]);
    const conductorBranch = branchName(config.branch, "conductor", context.name);

    let view: PrView;
    try {
      const { stdout } = await run(
        "gh",
        ["pr", "view", pr, "--json", "number,state,baseRefName,headRefName,statusCheckRollup"],
        { cwd: config.repoRoot, timeout: 30_000 },
      );
      view = JSON.parse(stdout) as PrView;
    } catch (error) {
      throw new HikyakuError(
        `PR ${pr} の状態を gh pr view で取得できませんでした`,
        error instanceof Error ? error.message : String(error),
      );
    }
    view = { ...view, statusCheckRollup: Array.isArray(view.statusCheckRollup) ? view.statusCheckRollup : [] };

    const verdict = judgePr(view, conductorBranch);
    emit(
      { cycle: context.name, pr: view.number, base: view.baseRefName, head: view.headRefName, conductorBranch, ...verdict },
      () =>
        [
          `PR #${view.number}（${view.headRefName} → ${view.baseRefName}）`,
          `マージ先: ${verdict.baseOk ? "✓" : "✗"} ${conductorBranch}`,
          `状態: ${verdict.stateOk ? "✓" : "✗"} ${view.state}`,
          `CI: ${verdict.checks.status}（${verdict.checks.total} 件）`,
          ...verdict.problems.map((problem) => `  ! ${problem}`),
        ].join("\n"),
    );
    if (!verdict.ok) throw new ValidationError(verdict.problems);
  },
});

register({
  name: "conductor lint",
  summary: "スキルに付けた問いの ID と、conductor の ID の表が食い違っていないか検査する",
  usage: "hikyaku conductor lint [--json]",
  details: [
    "プラグイン本体の開発用です。CI（check-scripts）が実行します。",
    "",
    `対象は子として動くスキル（${CONDUCTED_SKILLS.join(" / ")}）の SKILL.md と references/ です。`,
    "（G8）や（ask: branch）の形のタグを集め、scripts/lib/conductor.mts の ASKS と突き合わせます。",
    "",
    "  タグにあって ASKS に無い ID   子が出しても「分類できない問い」として人間に上がる",
    "  ASKS にあってタグに無い ID   改名や削除の取り残し。escalate に書いても効かない",
    "",
    "タグの付け忘れ（問いの箇所なのにタグが無い）は検出しません。",
  ].join("\n"),
  run: () => {
    const tagsByFile = new Map<string, string[]>();
    for (const skill of CONDUCTED_SKILLS) {
      const directory = join(pluginRoot(), "skills", skill);
      const references = join(directory, "references");
      const files = [
        join(directory, "SKILL.md"),
        ...(existsSync(references)
          ? readdirSync(references).filter((name) => name.endsWith(".md")).map((name) => join(references, name))
          : []),
      ];
      for (const file of files) {
        const tags = collectTags(readFileSync(file, "utf8"));
        if (tags.length > 0) tagsByFile.set(`skills/${file.slice(join(pluginRoot(), "skills").length + 1)}`, tags);
      }
    }

    const problems = lintTags(tagsByFile);
    if (problems.length > 0) throw new ValidationError(problems);
    const count = [...tagsByFile.values()].reduce((sum, tags) => sum + tags.length, 0);
    emit({ ok: true, files: Object.fromEntries(tagsByFile) }, () => `✓ ${tagsByFile.size} ファイル・${count} 個のタグが ASKS と一致しています`);
  },
});

function allowedToolsOf(config: ResolvedConfig): string[] {
  return [...defaultAllowedTools(pluginRoot()), ...config.conductor.allowedTools];
}

function digestOf(config: ResolvedConfig): string {
  const files = config.sources.map((path) => `${path}\n${readFileSync(path, "utf8")}`);
  return settingsDigest(config.profile, config, config.conductor, files);
}

function requireDigest(args: ParsedArgs, config: ResolvedConfig): void {
  const expected = flagString(args, "expect-digest");
  if (expected === undefined) {
    throw new HikyakuError(
      "--expect-digest を指定してください",
      "監督が起動時に人間と合意したときの conductor asks の digest を渡します。",
    );
  }
  const actual = digestOf(config);
  if (expected !== actual) {
    throw new HikyakuError(
      `委任の範囲を決める設定が、合意したときから変わっています（合意時: ${expected} / 現在: ${actual}）`,
      [
        "profile か .hikyaku.config（ルート・サイクル）の内容が変わりました。子が .hikyaku.config を",
        "書き換えた可能性があります。git log -p -- .hikyaku.config などで変更を確かめ、",
        "人間に委任の範囲を確認し直してください。",
      ].join("\n"),
    );
  }
}

function requireConductorPhase(raw: string | undefined): ConductorPhase {
  if (raw === undefined || !(CONDUCTOR_PHASES as readonly string[]).includes(raw)) {
    throw new HikyakuError(
      raw === undefined ? "フェーズを指定してください" : `フェーズの値が不正です: ${raw}`,
      `使用できる値: ${CONDUCTOR_PHASES.join(" | ")}（PLAN は人間が対話で行うため対象外）`,
    );
  }
  return raw as ConductorPhase;
}

function buildPrompt(phase: ConductorPhase, context: CycleContext, rawBuild: string | undefined): string {
  if (phase === "close-cycle") return `/hikyaku:close-cycle ${context.name}`;

  if (rawBuild === undefined) {
    if (phase === "builder") {
      throw new HikyakuError("builder にはビルドを指定してください", "hikyaku next で着手できるビルドを確認できます。");
    }
    return `/hikyaku:architect ${context.name}`;
  }

  const id = normalizeBuildId(rawBuild);
  if (!context.builds.some((build) => build.id === id)) {
    throw new HikyakuError(
      `${context.name} に build-${id.padStart(2, "0")} はありません`,
      "hikyaku tasklist read で登録済みのビルドを確認できます。",
    );
  }
  return phase === "builder"
    ? `/hikyaku:builder ${context.name} ${id}`
    : `/hikyaku:architect ${context.name} build-${id.padStart(2, "0")}`;
}
