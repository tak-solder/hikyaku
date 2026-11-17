/** conductor asks / launch / parse — 監督が子セッションを動かすための組み立てと解析 */

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flagBoolean, flagList, flagString, type ParsedArgs } from "../lib/args.mts";
import {
  ANSWER_ENV,
  type Approval,
  ASK_IDS,
  closesMessage,
  escalateMessage,
  escalateUnit,
  needsRiskDeclaration,
  CATEGORY_LABELS,
  collectTags,
  CONDUCTED_SKILLS,
  CONDUCTOR_PHASES,
  CONSENT_WHEN,
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
  type ParsedResult,
  type PrVerdict,
  type PrView,
  type ResolvedAsk,
} from "../lib/conductor.mts";
import { branchName } from "../lib/branch.mts";
import { fetchPrGraphql, parsePrView, PR_VIEW_FIELDS, run } from "../lib/github.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { emit, table } from "../lib/output.mts";
import { pluginRoot } from "../lib/paths.mts";
import { register } from "../lib/registry.mts";
import type { Directive } from "../lib/steps/directive.mts";
import { asConductorChild } from "../lib/steps/consent.mts";
import { directiveOf, locateSession } from "../lib/steps/locate.mts";
import { normalizeBuildId } from "../lib/tasklist.mts";
import type { ResolvedConfig } from "../lib/config.mts";
import {
  formatRiskDeclaration,
  HARMS,
  isWaitingItem,
  parsePremises,
  readLedger,
  type Ledger,
  type RiskDeclaration,
} from "../lib/ledger.mts";
import { effectiveDeclaration, exceedsCeilingFor, type Harm } from "../lib/risk.mts";
import { deriveWaiting, waitingLines } from "../lib/waiting.mts";
import { openCycle, type CycleContext } from "../lib/workspace.mts";

/**
 * 子に使わせないツール。問いは gate を出して終了し、回答は --resume で受け取る。
 * タイマー（ScheduleWakeup / CronCreate）で回答を待たれると、claude -p が終了せず、
 * 結果ファイルも完了の通知も監督に届かない
 */
const DISALLOWED_TOOLS = ["AskUserQuestion", "ScheduleWakeup", "CronCreate"];

/** 問いを積む方針（conductor asks が示し、監督が Step 0 でユーザーに確認する） */
const QUEUEING =
  "ユーザーに上げる問いは記録に積み、依存しないビルドを先に進める（着手できるビルドが無くなったら、待っている問いをまとめて尋ねる。障害・2回目の違反・PR の検証の不合格はその場で上げる）";

register({
  name: "conductor asks",
  summary: "子セッションが出しうる問いと、監督・ユーザーへの振り分けを一覧する",
  usage: "hikyaku conductor asks [<cycle>] [--root <path>] [--json]",
  details: [
    "サイクルの profile と [conductor] の escalate / delegate を重ねた結果を返します。",
    "監督は起動時にこれを読み、どの問いを自分が判断するかをユーザーに示します。",
    "",
    "  handler   supervisor（監督が答える）| user（ユーザーに上げる）",
    "  source    default | escalate | delegate | fixed（設定で変えられない）",
    "  enabled   false なら、この profile ではそのゲートが無効で問いは出ない",
    "",
    "同意ゲート（delegation など）、サイクルの中止（abandon）、ID の無い問い（other）は常にユーザーに上げます。",
    "G3 / G4 は差し戻しからの再設計の回、G10 は decisions・constraints の変更を含む回が、",
    "同意としてユーザーに上がります（consentWhen）。",
    "回ごとの判定は conductor parse が子の手順の位置から行います。",
    "",
    "JSON 出力には、子に許可するツールの一覧（allowedTools）と、委任の範囲を決める",
    "設定のダイジェスト（digest）も含みます。監督はユーザーと合意したときの digest を、",
    "以後の conductor launch / parse に --expect-digest で渡します。",
    "各問いには、監督が選べる答えの表（safe。自由文で答える問いは null）と、リスクの申告が要りうるか（declaresRisk）、",
    "JSON の queueing には問いを積む方針（ユーザーに上げる問いは記録に積み、依存しないビルドを先に進める）が入ります。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const { config, context } = openCycle(args, operands[0]);
    const asks = resolveAllAsks(config.conductor, config);
    const digest = digestOf(config);
    const allowedTools = allowedToolsOf(config);
    const models = Object.fromEntries(
      CONDUCTOR_PHASES.map((phase) => [phase, modelFor(config.conductor, phase) ?? null]),
    );

    const review = {
      phaseReviewers: config.conductor.phaseReviewers,
      timeoutMinutes: config.conductor.reviewTimeoutMinutes,
      requireApproval: config.conductor.requireApproval,
      finalReviewers: config.pr.reviewers,
      skipped: config.pr.reviewersSkip,
    };

    emit({ cycle: context.name, profile: config.profile, digest, allowedTools, models, review, asks, consentWhen: CONSENT_WHEN, queueing: QUEUEING }, () => {
      // profile で出ない問いでも、回によって同意になるゲートは条件を添える（その回は出てユーザーに上がる）
      const ids = (filter: (ask: ResolvedAsk) => boolean): string =>
        asks
          .filter(filter)
          .map((ask) => (!ask.enabled && CONSENT_WHEN[ask.id] !== undefined ? `${ask.id}（${CONSENT_WHEN[ask.id]}）` : ask.id))
          .join(" / ") || "なし";
      const consent = (ask: ResolvedAsk): boolean => ask.category === "consent";
      return [
        `サイクル ${context.name}（profile: ${config.profile}）`,
        "",
        `ユーザーに上げる同意ゲート: ${ids((a) => consent(a) && a.enabled)}`,
        `回によって同意になるゲート: ${Object.entries(CONSENT_WHEN).map(([id, when]) => `${id}（${when}）`).join(" / ")}`,
        `監督が判断する問い: ${ids((a) => a.enabled && a.handler === "supervisor")}`,
        `ユーザーに上げるその他の問い: ${ids((a) => !consent(a) && a.enabled && a.handler === "user")}`,
        `この profile では出ない問い: ${ids((a) => !a.enabled)}`,
        `問いの扱い: ${QUEUEING}`,
        `子に許可するツール: ${allowedTools.join(" ")}`,
        `子のモデル: ${CONDUCTOR_PHASES.map((phase) => `${phase}=${models[phase] ?? "既定"}`).join(" / ")}`,
        `フェーズの PR のレビュアー: ${review.phaseReviewers.length === 0 ? "なし" : review.phaseReviewers.join(", ")}（待つ上限 ${review.timeoutMinutes} 分、承認${review.requireApproval ? "必須" : "不問"}）`,
        `最後の PR のレビュアー: ${review.finalReviewers.length === 0 || review.skipped.includes("conductor") ? "なし" : review.finalReviewers.join(", ")}`,
        `設定のダイジェスト: ${digest}`,
        "",
        table(
          asks.map((ask) => [
            ask.id,
            ask.categoryLabel,
            ask.enabled ? (ask.handler === "supervisor" ? "監督" : "ユーザー") : "（無効）",
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
    "hikyaku conductor launch <architect|builder|close-cycle> [<cycle>] [<build>|add] --expect-digest <digest> " +
    "[--resume <session-id>] [--message <file> (--from user --closes <ID,...> [--ask <id>] | " +
    "--from supervisor --ask <id> [--choice <値>] [--harm 高|中 --premises <ref,...> | --no-risk] | --notice)] " +
    "[--escalate --ask <id>] [--out <file>] [--root <path>] [--json]",
  details: [
    "実行すべきコマンド行と session-id を返します。起動は呼び出し元（監督）が行います。",
    "起動を監督の Bash に置くのは、許可ルール（Bash(claude -p:*)）で人間が制御できる",
    "場所で権限を広げるためです。",
    "",
    "  architect     /hikyaku:architect <cycle> [build-NN]（build を渡すと差し戻しからの再設計）",
    "                /hikyaku:architect <cycle> add <指摘>（add を渡すと指摘からの追加設計）",
    "  builder       /hikyaku:builder <cycle> <build>（build は必須）",
    "  close-cycle   /hikyaku:close-cycle <cycle>",
    "",
    "--resume と --message は、gate で止まった子を再開するときに組で渡します。",
    "--message のファイルの中身が、子への回答としてそのまま渡ります。再開の --message には、",
    "答えの出どころ（--from）か、答えではないこと（--notice）を必ず添えます。",
    "",
    "  --from user        ユーザーの答え。--closes に答えで閉じる待ちの事項の ID（作業ツリーの記録にある、",
    "                     決定の無い question・who=user・when=now）が要ります。回答の先頭に、その ID を",
    "                     ledger decide --by user で閉じる固定文を足します",
    "  --from supervisor  監督の答え。--ask が要ります。答えの値の表がある問い（conductor asks の safe）は",
    "                     --choice が要り、安全側（safe）に無い値は拒みます。handler が user の問い（同意の回、",
    "                     escalate、中止など）も拒みます。リスクを受け入れうる答え（questions、review-findings の",
    "                     proceed）は --harm と --premises か --no-risk が要り、上限（[app] の宣言）を超える",
    "                     申告は拒みます。拒まれたら --escalate でユーザーに上げます",
    "  --notice           答えではない知らせ（中断からの再開、書き直しの依頼、ブランチを取り込んだ知らせ）",
    "",
    "--from を添えたときは、子のコマンドの前に答えの環境変数（HIKYAKU_ANSWER_FROM・_ITEMS・_ASK・_CHOICE・",
    "_RISK・_TOKEN）を置きます。子の中の ledger decide / object は、この値で書ける決定を縛られ、監督の答えの",
    "問い・値・申告を決定に必ず残します。JSON の answerToken は、conductor parse --expect-answer に渡します。",
    "",
    "--escalate はユーザーに上げる問いを、子に記録させる固定文（ledger open --type question --who user",
    "--when now --ask <id>、コミット・push、本文に waiting: <ID> を置いた blocked）で再開します。",
    "--message は取りません。",
    "",
    "architect の add（指摘からの追加設計）では、--resume なしの初回の起動にも --message が要ります。",
    "ファイルの中身（対応する指摘）が、プロンプトの add の後ろに続けて渡ります。",
    "--from を添えれば、ほかのフェーズでも初回の起動に --message を渡せます（session-id が手元に無く、",
    "答えを新しい起動で渡すとき）。",
    "",
    "組み立てるコマンドには次が必ず入ります。",
    "",
    "  --append-system-prompt-file   非対話規約（skills/conductor/references/headless-protocol.md）",
    `  --disallowedTools             ${DISALLOWED_TOOLS.join(" ")}`,
    "                                子は回答を同じプロセスで待たず、ブロックを出して終了する。",
    "                                タイマーで待つと結果ファイルが書かれず、監督に完了が届かない",
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
    const adding = phase === "architect" && operands[2] === "add";

    const resume = flagString(args, "resume");
    const messageFile = flagString(args, "message");
    const fromRaw = flagString(args, "from");
    if (fromRaw !== undefined && fromRaw !== "user" && fromRaw !== "supervisor") {
      throw new HikyakuError(`--from の値が不正です: ${fromRaw}`, "使用できる値: user | supervisor");
    }
    const from = fromRaw as "user" | "supervisor" | undefined;
    const notice = flagBoolean(args, "notice");
    const escalate = flagBoolean(args, "escalate");
    const ask = flagString(args, "ask");
    const unit = escalateUnit(phase, phase === "builder" && operands[2] !== undefined ? normalizeBuildId(operands[2]) : undefined);

    if (from !== undefined && notice) {
      throw new HikyakuError("--from と --notice は一緒に指定できません", "答えを渡す再開は --from、答えではない知らせ（中断からの再開・書き直しの依頼）は --notice です。");
    }
    if (escalate) {
      if (messageFile !== undefined || from !== undefined || notice) {
        throw new HikyakuError("--escalate は --message・--from・--notice と一緒に指定できません", "--escalate は、ユーザーに上げる問いを記録させる固定文だけで子を再開します。");
      }
      if (resume === undefined) throw new HikyakuError("--escalate には --resume で子の session-id を渡してください");
      if (ask === undefined) throw new HikyakuError("--escalate には --ask で問いの ID を渡してください");
    } else {
      if (adding && resume === undefined && messageFile === undefined) {
        throw new HikyakuError(
          "architect の add には、対応する指摘を書いたファイルを --message で渡してください",
          "指摘の内容が、子への最初のプロンプトとして渡ります。",
        );
      }
      if (resume !== undefined && messageFile === undefined) {
        throw new HikyakuError(
          "--resume には --message（回答か知らせのファイル）を添えてください",
          "ユーザーに上げる問いを子に記録させるときは --escalate --ask <id> を使います。",
        );
      }
      if ((from !== undefined || notice) && messageFile === undefined) {
        throw new HikyakuError(`--${from !== undefined ? "from" : "notice"} には --message で回答か知らせのファイルを渡してください`);
      }
      // 回答の無い初回の起動に --message を渡せるのは、architect の add と、答えを新しい起動で渡すとき（--from）だけ
      if (messageFile !== undefined && resume === undefined && !adding && from === undefined) {
        throw new HikyakuError(
          "初回の起動に --message を渡せるのは、architect の add と、--from を添えて答えを渡すときだけです",
          "gate で止まった子を再開するときは --resume で子の session-id を渡してください。",
        );
      }
      // 再開の --message が答えか否かを監督に明示させる（答えなら出どころを子の記録に縛る）
      if (messageFile !== undefined && resume !== undefined && from === undefined && !notice) {
        throw new HikyakuError(
          "再開の --message には --from user|supervisor か --notice を添えてください",
          "答えを渡すなら --from（ユーザーの答えは --from user --closes <ID>、監督の答えは --from supervisor --ask <id>）、答えではない知らせなら --notice です。",
        );
      }
    }

    let message: string | undefined;
    if (messageFile !== undefined) {
      if (!existsSync(messageFile)) throw new HikyakuError(`--message のファイルがありません: ${messageFile}`);
      message = readFileSync(messageFile, "utf8").trim();
      if (message === "") throw new HikyakuError(`--message のファイルが空です: ${messageFile}`);
    }

    // 子に渡す答えの環境変数。子の中の ledger decide / object は、この値で書ける決定を縛られる（US-19.7）
    const answerEnv: [string, string][] = [];
    let answerToken: string | null = null;
    if (escalate) {
      if (!ASK_IDS.includes(ask as string)) {
        throw new HikyakuError(`--ask の値が不正です: ${ask}`, "conductor の問いの ID（hikyaku conductor asks）を指定してください。");
      }
      message = escalateMessage(unit, context.name, ask as string);
    } else if (from === "user") {
      const closes = flagList(args, "closes") ?? [];
      if (closes.length === 0) {
        throw new HikyakuError(
          "--from user には --closes で、ユーザーの答えで閉じる待ちの事項の ID を渡してください",
          "待っている事項は hikyaku conductor waiting で確かめられます。",
        );
      }
      const ledger = readLedger(context.directory);
      const unclosable = closes.filter((id) => {
        const item = ledger.items.find((entry) => entry.open.id === id);
        return item === undefined || !isWaitingItem(item);
      });
      if (unclosable.length > 0) {
        throw new HikyakuError(
          `--closes に、ユーザーの答えを待つ未決の事項ではない ID があります: ${unclosable.join(", ")}`,
          "作業ツリーの記録に、その ID の question（who=user・when=now）が決定なしであることを確かめてください（待ちのビルドのブランチへ conductor ブランチを取り込んでから再開します）。",
        );
      }
      message = closesMessage(unit, context.name, closes, message as string);
      answerEnv.push([ANSWER_ENV.from, "user"], [ANSWER_ENV.items, closes.join(",")]);
      if (ask !== undefined) answerEnv.push([ANSWER_ENV.ask, ask]);
    } else if (from === "supervisor") {
      const checked = checkSupervisorAnswer(args, config, context, ask, resume);
      answerToken = randomUUID();
      answerEnv.push([ANSWER_ENV.from, "supervisor"], [ANSWER_ENV.ask, checked.ask]);
      if (checked.choice !== undefined) answerEnv.push([ANSWER_ENV.choice, checked.choice]);
      if (checked.risk !== undefined) answerEnv.push([ANSWER_ENV.risk, formatRiskDeclaration(checked.risk)]);
      answerEnv.push([ANSWER_ENV.token, answerToken]);
    }

    const sessionId = resume ?? randomUUID();
    const out = flagString(args, "out") ?? join(tmpdir(), `hikyaku-conductor-${sessionId}-${Date.now()}.json`);
    const protocol = join(pluginRoot(), "skills", "conductor", "references", "headless-protocol.md");
    const allowedTools = allowedToolsOf(config);
    const model = modelFor(config.conductor, phase);

    const argv = [
      "claude",
      "-p",
      resume === undefined ? (message === undefined ? prompt : `${prompt}\n\n${message}`) : (message as string),
      ...(resume === undefined ? ["--session-id", sessionId] : ["--resume", sessionId]),
      "--append-system-prompt-file",
      protocol,
      "--disallowedTools",
      ...DISALLOWED_TOOLS,
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
    const envPrefix = [["HIKYAKU_CONDUCTOR_CHILD", "1"], ...answerEnv].map(([key, value]) => `${key}=${shellQuote(value as string)}`).join(" ");
    const command = `${envPrefix} ${argv.map(shellQuote).join(" ")} < /dev/null > ${shellQuote(out)}`;

    emit(
      {
        phase,
        cycle: context.name,
        prompt,
        sessionId,
        answerFrom: from ?? null,
        answerEnv: Object.fromEntries(answerEnv),
        answerToken,
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
  usage: "hikyaku conductor parse <result.json> [<cycle>] --expect-digest <digest> [--expect-answer <token>] [--root <path>] [--json]",
  details: [
    "conductor launch が組み立てたコマンドの結果ファイルを読みます。",
    "",
    "  gate       問いで止まった。id と、監督・ユーザーのどちらが答えるか（ask）を返す",
    "  done       フェーズを終えた。next に子が案内した次のコマンド",
    "  blocked    子が続行できないと判断した。cycle status で次を決める。本文の行頭の waiting: <ID> が",
    "             作業ツリーの記録にある未決のユーザーの問い（question・who=user・when=now）を指せば、",
    "             答えを待つ blocked として waiting に ID を返し、行き詰まりの報告の検査を外す",
    "  violation  規約どおりのブロックが無い。監督は自由文から推測せず、人間に上げる",
    "  error      予算超過などで子が異常終了した",
    "",
    "gate / done / blocked では、子の手順の位置（step）も返します。子のセッション ID が入った",
    "progress.jsonl の記録から、子が最後に進めた作業単位を引き、step next と同じ判定で次の1手を",
    "出します。gate なら問いの ID とステップの指示ファイル（read）が入ります。監督は承認の観点と",
    "読む成果物を、指示ファイルから読みます。",
    "子のブロックと手順の位置が食い違えば、stepProblems に理由が入ります。",
    "",
    "  done なのに手順が終わっていない、または子の記録が見つからない",
    "  ゲートの ID（G8 など）で止まったのに、手順がそのゲートに居ない",
    "",
    "どの場合も sessionId と costUsd（その呼び出しの費用）を返します。再開しても",
    "session-id は変わらないので、次の conductor launch --resume にそのまま渡せます。",
    "問いの振り分けは conductor asks と同じ規則です。ただし、子の手順がそのゲートで止まっていれば、",
    "その回の承認の種類（step.approval）を優先します。同意なら escalate / delegate に関わらずユーザーに上げます",
    "（差し戻しからの再設計の回の G3 / G4 など）。",
    "gate の ask には、監督が選べる答えの表（safe）と、リスクの申告が要りうるか（declaresRisk）も入ります。",
    "",
    "--expect-answer には、監督の答えで再開したときの conductor launch の answerToken を渡します。",
    "その token を持つ監督の決定が作業ツリーの記録に無ければ、stepProblems に入れます。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const file = operands[0];
    if (file === undefined) throw new HikyakuError("結果ファイルを指定してください");
    if (!existsSync(file)) throw new HikyakuError(`結果ファイルがありません: ${file}`);

    const { config, context } = openCycle(args, operands[1]);
    requireDigest(args, config);
    // 答えを待つ blocked の waiting: <id> は、作業ツリーの記録で裏取りできるときだけ信じる。
    // 記録を読めなければ信じない（従来どおり行き詰まりの報告として検査する）
    let ledger: Ledger | undefined;
    try {
      ledger = readLedger(context.directory);
    } catch {
      ledger = undefined;
    }
    const parsed = parseResultJson(readFileSync(file, "utf8"), {
      isWaitingItem: (id) => {
        const item = ledger?.items.find((entry) => entry.open.id === id);
        return item !== undefined && isWaitingItem(item);
      },
    });
    const step = childStep(parsed, config, context, flagString(args, "root"));
    // 監督の答えで再開した子が、その答えを記録せずに進めていないか（launch の answerToken）
    const expectAnswer = flagString(args, "expect-answer");
    if (expectAnswer !== undefined) {
      const recorded = ledger !== undefined && [...ledger.items.flatMap((item) => item.decisions), ...ledger.orphans]
        .some((record) => record.by === "supervisor" && record.token === expectAnswer);
      if (!recorded) {
        step.problems.push(
          `監督の答え（answerToken ${expectAnswer}）を記録した決定（by: supervisor）が、作業ツリーのサイクルの記録にありません。子が監督の答えを記録せずに進めた可能性があります`,
        );
      }
    }
    // 子の手順がそのゲートで止まっていれば、その回の承認の種類（同意か確認か）で振り分ける
    const position = step.position;
    const confirmed =
      position !== null && position.kind === "gate" && position.ask === parsed.id && position.approval !== null
        ? position.approval
        : undefined;
    // 回によって同意になるゲートなのに手順の位置で確かめられなければ、同意の側に倒す（監督に答えさせない）
    const approval =
      confirmed ?? (parsed.id !== undefined && CONSENT_WHEN[parsed.id] !== undefined ? "consent" : undefined);
    const ask =
      parsed.outcome === "gate" && parsed.id !== undefined
        ? resolveAsk(parsed.id, config.conductor, config, approval)
        : undefined;

    emit({ cycle: context.name, ...parsed, ask: ask ?? null, step: step.position, stepProblems: step.problems }, () => {
      const lines = [`結果: ${parsed.outcome}`];
      if (ask !== undefined) {
        lines.push(
          `問い: ${ask.id}（${CATEGORY_LABELS[ask.category]}）→ ${ask.handler === "supervisor" ? "監督が答える" : "ユーザーに上げる"}`,
        );
      }
      if (ask?.safe) {
        lines.push(`監督が選べる答え: ${ask.safe.safe.join(" | ")}（既定: ${ask.safe.default}）`);
      }
      if (ask?.declaresRisk) lines.push("監督が答えるときは、リスクの申告（--harm と --premises か --no-risk）が要りうる");
      if (parsed.waiting) lines.push(`答えを待つ事項: ${parsed.waiting.join(", ")}（行き詰まりではない）`);
      if (parsed.next) lines.push(`次: ${parsed.next}`);
      if (parsed.reason) lines.push(`理由: ${parsed.reason}`);
      lines.push(`session-id: ${parsed.sessionId ?? "不明"}`);
      if (parsed.costUsd !== null) lines.push(`費用: $${parsed.costUsd.toFixed(2)}`);
      if (step.position !== null) {
        const p = step.position;
        lines.push(`手順: ${p.skill} ${p.unit}（${p.progress.complete}/${p.progress.total}）→ ${p.kind}${p.step === null ? "" : ` ${p.step}`}`);
      }
      for (const problem of step.problems) lines.push(`  ! ${problem}`);
      lines.push("", parsed.body);
      return lines.join("\n");
    });
  },
});

interface ChildStep {
  unit: string;
  skill: string;
  kind: Directive["kind"];
  step: string | null;
  title: string | null;
  /** gate なら問いの ID */
  ask: string | null;
  /** gate なら、その回の承認の種類 */
  approval: "confirm" | "consent" | null;
  /** 同意の理由（確認なら null） */
  approvalReason: string | null;
  /** そのステップの指示ファイル。監督は承認の観点と読む成果物をここから読む */
  read: string | null;
  directory: string;
  message: string | null;
  progress: { complete: number; total: number };
}

/**
 * 子が最後に進めた作業単位の、次の1手。子の progress.jsonl の記録（子のセッション ID）から引く。
 *
 * 子のブロックと手順の位置が食い違っていれば problems に入れる。監督は子の報告をそのまま
 * 信じず、done は手順を終えたこと、ゲートの gate はそのゲートで止まっていることを確かめる
 */
function childStep(
  parsed: ParsedResult,
  config: ResolvedConfig,
  context: CycleContext,
  root: string | undefined,
): { position: ChildStep | null; problems: string[] } {
  if (parsed.sessionId === null || (parsed.outcome !== "gate" && parsed.outcome !== "done" && parsed.outcome !== "blocked")) {
    return { position: null, problems: [] };
  }
  // 終えたサイクルも見る（close-cycle は cycle close のあとに pr を行う）
  const located = locateSession(config.hikyakuRoot, { records: [context.record], explicit: true }, parsed.sessionId);
  if (located === undefined) {
    const problems: string[] = [];
    if (parsed.outcome === "done") {
      problems.push("子は done を出しましたが、このサイクルに子のセッションの手順の記録がありません（hikyaku step where で確かめてください）");
    }
    // ゲートの ID（G8 など）は手順の位置で確かめる。記録が無いのにゲートで止まるのは早すぎる。ステップの途中の問いは照合しない
    if (parsed.outcome === "gate" && parsed.id !== undefined && /^G\d+$/.test(parsed.id)) {
      problems.push(`子は ${parsed.id} で止まりましたが、このサイクルに子のセッションの手順の記録がありません（まだ何も報告していません）`);
    }
    return { position: null, problems };
  }
  // 子と同じ条件で評価する（子は同意ゲートを手順に入れないので、親がそのまま評価すると位置が食い違う）
  const { directive } = asConductorChild(() => directiveOf(located.unit, root === undefined ? {} : { root }));
  const position: ChildStep = {
    unit: directive.unit,
    skill: directive.skill,
    kind: directive.kind,
    step: directive.step ?? null,
    title: directive.title ?? null,
    ask: directive.ask ?? null,
    approval: directive.approval ?? null,
    approvalReason: directive.approvalReason ?? null,
    read: directive.read ?? null,
    directory: located.unit.directory,
    message: directive.message ?? null,
    progress: directive.progress,
  };
  const problems: string[] = [];
  if (parsed.outcome === "done" && directive.kind !== "done") {
    problems.push(`子は done を出しましたが、手順は終わっていません（${directive.skill} ${directive.unit}: 次は ${directive.kind} ${directive.step ?? ""}）`);
  }
  // ゲートの ID（G8 など）は step のゲートと1対1。それ以外の ID はステップの途中の問いなので照合しない
  if (parsed.outcome === "gate" && parsed.id !== undefined && /^G\d+$/.test(parsed.id)) {
    if (directive.kind !== "gate" || directive.ask !== parsed.id) {
      problems.push(
        `子は ${parsed.id} で止まりましたが、手順の位置は ${directive.kind === "gate" ? `ゲート ${directive.ask}` : `${directive.kind} ${directive.step ?? ""}`} です`,
      );
    }
  }
  return { position, problems };
}

const ESCALATE_HINT = "監督は答えずに、conductor launch --resume <session-id> --escalate --ask <id> でユーザーに上げてください。";

/**
 * --from supervisor の答えの検査（US-15.1〜15.3・US-13.3）。監督は安全側にだけ倒せる:
 * handler が user の問い・safe に無い値・申告の無い受け入れ・上限を超える申告は拒み、ユーザーに上げさせる
 */
function checkSupervisorAnswer(
  args: ParsedArgs,
  config: ResolvedConfig,
  context: CycleContext,
  ask: string | undefined,
  resume: string | undefined,
): { ask: string; choice: string | undefined; risk: RiskDeclaration | undefined } {
  if (ask === undefined) throw new HikyakuError("--from supervisor には --ask で答える問いの ID を渡してください");

  // 1. 振り分け。子の手順がその問いのゲートで止まっていれば、その回の承認の種類で判定する（parse と同じ）。
  //    回によって同意になるゲートで位置を確かめられなければ、同意に倒す
  const position = resume === undefined
    ? undefined
    : locateSession(config.hikyakuRoot, { records: [context.record], explicit: true }, resume);
  let confirmed: Approval | undefined;
  if (position !== undefined) {
    const root = flagString(args, "root");
    const { directive } = asConductorChild(() => directiveOf(position.unit, root === undefined ? {} : { root }));
    if (directive.kind === "gate" && directive.ask === ask && directive.approval !== undefined) confirmed = directive.approval;
  }
  const approval = confirmed ?? (CONSENT_WHEN[ask] !== undefined ? "consent" : undefined);
  const resolved = resolveAsk(ask, config.conductor, config, approval);
  if (resolved.handler === "user") {
    throw new HikyakuError(
      `${ask} は${resolved.categoryLabel}${approval === "consent" && CONSENT_WHEN[ask] !== undefined ? "（この回は同意、または位置を確かめられない）" : ""}で、ユーザーが答える問いです。監督の答えは受け付けません`,
      ESCALATE_HINT,
    );
  }

  // 2. 監督が答えてよい値
  const choice = flagString(args, "choice");
  const safe = resolved.safe;
  if (safe !== null) {
    if (choice === undefined) {
      throw new HikyakuError(`${ask} の答えには --choice を渡してください`, `使用できる値: ${Object.keys(safe.choices).join(" | ")}（監督が選べるのは ${safe.safe.join(" | ")}）`);
    }
    if (safe.choices[choice] === undefined) {
      throw new HikyakuError(`--choice の値が不正です: ${choice}`, `使用できる値: ${Object.keys(safe.choices).join(" | ")}`);
    }
    if (!safe.safe.includes(choice)) {
      throw new HikyakuError(
        `${ask} の「${safe.choices[choice]}」（${choice}）は安全側の答えではないので、監督は選べません`,
        `監督が選べるのは ${safe.safe.join(" | ")} です。${ESCALATE_HINT}`,
      );
    }
  } else if (choice !== undefined) {
    throw new HikyakuError(`${ask} は自由文で答える問いなので、--choice は渡せません`);
  }

  // 3. リスクの申告。受け入れうる答えには必須（付け忘れで上げる向きと逆に倒れないため）
  const harm = flagString(args, "harm");
  const premisesRaw = flagString(args, "premises");
  const noRisk = flagBoolean(args, "no-risk");
  if (noRisk && (harm !== undefined || premisesRaw !== undefined)) {
    throw new HikyakuError("--no-risk と --harm / --premises は一緒に指定できません");
  }
  if (premisesRaw !== undefined && harm === undefined) throw new HikyakuError("--premises には --harm を添えてください");
  let risk: RiskDeclaration | undefined;
  if (harm !== undefined) {
    if (!HARMS.includes(harm as Harm)) throw new HikyakuError(`--harm の値が不正です: ${harm}`, `使用できる値: ${HARMS.join(" / ")}`);
    if (premisesRaw === undefined || premisesRaw.trim() === "") {
      throw new HikyakuError("--harm には --premises で拠り所にした前提の参照を添えてください");
    }
    risk = { kind: "declared", harm: harm as Harm, premises: parsePremises(premisesRaw) };
  } else if (noRisk) {
    risk = { kind: "none" };
  }
  if (risk === undefined && needsRiskDeclaration(ask, choice)) {
    throw new HikyakuError(
      `この答え（${ask}${choice === undefined ? "" : ` / ${choice}`}）はリスクを受け入れうるので、--harm 高|中 と --premises か、--no-risk を渡してください`,
      "受け入れるリスクが無いと判断したなら --no-risk です。申告は子の決定の記録に残り、最後の PR の本文に出ます。",
    );
  }

  // 4. 上限との比較。超える受け入れは、事後同意の有無に関わらず監督には答えさせない（build-19 まで）
  if (risk?.kind === "declared" && exceedsCeilingFor(effectiveDeclaration(config), risk.harm, risk.premises)) {
    throw new HikyakuError(
      `申告したリスク（害 ${risk.harm}・前提 ${risk.premises.join(", ")}）は AI に任せてよい上限を超えるので、監督は受け入れられません`,
      ESCALATE_HINT,
    );
  }
  return { ask, choice, risk };
}

/** --wait のとき、CI のチェックが1つも無くても none と判定せずに待つ時間（PR を作った直後の猶予） */
const CHECKS_GRACE_SECONDS = 60;

async function fetchPrView(cwd: string, pr: string): Promise<PrView> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      "gh",
      ["pr", "view", pr, "--json", PR_VIEW_FIELDS],
      { cwd, timeout: 30_000 },
    ));
  } catch (error) {
    throw new HikyakuError(
      `PR ${pr} の状態を gh pr view で取得できませんでした`,
      error instanceof Error ? error.message : String(error),
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new HikyakuError("gh pr view の応答を JSON として読めません", stdout.slice(0, 200));
  }
  const view = parsePrView(raw);
  // レビューの依頼は gh pr view に Bot（Copilot など）が現れないので、GraphQL から取る
  const graphql = await fetchPrGraphql(cwd, view.number);
  return { ...view, reviewRequests: graphql.reviewRequests, reviewThreads: graphql.threads };
}

register({
  name: "conductor check-pr",
  summary: "フェーズの PR を conductor ブランチに取り込んでよいか（マージ先・レビュー・CI）を検証する",
  usage:
    "hikyaku conductor check-pr <pr> [<cycle>] [--wait [--timeout <minutes>] [--interval <seconds>]] " +
    "[--root <path>] [--json]",
  details: [
    "<pr> は PR の番号か URL です。gh で PR の状態を読み、次を確かめます。",
    "",
    "  マージ先     PR の base が、このサイクルの conductor ブランチであること",
    "  状態         PR が開いていること（マージ済み・クローズ済みでないこと）",
    "  Draft        Draft でなく、Ready for Review になっていること",
    "  レビュー依頼 まだレビューしていないレビュアー（人・チーム・Copilot などの Bot）への依頼が残っていないこと",
    "               Bot への依頼は gh pr view にも REST にも現れないので、GraphQL から取得する",
    "  レビュー指摘 未解決のレビュースレッドが無いこと",
    "  CI           失敗しているチェックも、まだ終わっていないチェックも無いこと",
    "  承認         既定では不問。[conductor] require_approval = true のときは、1人以上の承認があり、",
    "               変更の要求が残っていないこと（レビュアーごとに、承認・変更の要求・取り下げの",
    "               うち最新のもので判定する。コメントだけのレビューは意見を上書きしない）",
    "",
    "結果の headSha は、検証した PR の head のコミットです。取り込むときはブランチ名ではなく",
    "このコミットを指定してください（検証のあとに push されたコミットや、push されていない",
    "ローカルのコミットを取り込まないため）。",
    "",
    "満たしていなければ終了コード 2 で、理由を problems に返します。gh の応答に必須の",
    "フィールドが無い、型が違うなど、状態を取得できなかったときは判定せず、終了コード 1 で",
    "止まります（取得できなかった状態を、CI なし・依頼なし・Ready として合格させないため）。",
    "",
    "監督は PR を GitHub の機能ではなく、ローカルの git merge と push で取り込みます。",
    "そのためブランチ保護の必須チェックが働きません。このコマンドがその代わりです。",
    "",
    "--wait を付けると、待てば解消しうる問題（CI の実行中、レビューの依頼が残っている）だけで",
    "止まっているあいだ、--interval 秒（既定 30。1 以上）ごとに確かめ直します。Draft・未解決の指摘・",
    "CI の失敗・マージ先の食い違いは待っても解消しないので、見つけた時点で返します。",
    "上限は --timeout 分（既定は [conductor] review_timeout。0 なら待たない）で、超えたら",
    "timedOut: true で返します。最大で数十分かかるので、バックグラウンドで実行してください。",
    "",
    "CI が1つも無い場合（paths フィルタで走らない、CI の無いリポジトリなど）は",
    "確かめるものが無いので失敗にせず、checks.status を none で返します。PR を作った直後は",
    `チェックがまだ登録されていないことがあるので、--wait のときは最初の ${CHECKS_GRACE_SECONDS} 秒`,
    "（上限がそれより短ければ上限まで）、チェックが現れるのを待ってから none と判定します。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const pr = operands[0];
    if (pr === undefined) throw new HikyakuError("PR の番号か URL を指定してください");
    const { config, context } = openCycle(args, operands[1]);
    const conductorBranch = branchName(config.branch, "conductor", context.name);

    const number = (name: string, fallback: number, min: number): number => {
      const raw = flagString(args, name);
      if (raw === undefined) return fallback;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < min) {
        throw new HikyakuError(`--${name} は ${min} 以上の数値で指定してください（現在: ${raw}）`);
      }
      return value;
    };
    const wait = flagBoolean(args, "wait");
    const timeoutMinutes = number("timeout", config.conductor.reviewTimeoutMinutes, 0);
    // 0 を許すと、gh の呼び出しを間を空けずに繰り返し、GitHub の rate limit に当たる
    const intervalSeconds = number("interval", 30, 1);

    const started = Date.now();
    const graceMs = Math.min(CHECKS_GRACE_SECONDS * 1000, timeoutMinutes * 60_000);
    const judge = (view: PrView): PrVerdict =>
      judgePr(view, conductorBranch, {
        requireApproval: config.conductor.requireApproval,
        awaitChecks: wait && Date.now() - started < graceMs,
      });
    let timedOut = false;
    let view = await fetchPrView(config.repoRoot, pr);
    let verdict = judge(view);
    while (wait && !verdict.ok && verdict.waiting) {
      if (Date.now() - started >= timeoutMinutes * 60_000) {
        timedOut = true;
        verdict = { ...verdict, problems: [...verdict.problems, `待機の上限（${timeoutMinutes} 分）を超えました`] };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
      view = await fetchPrView(config.repoRoot, pr);
      verdict = judge(view);
    }
    const waitedSeconds = Math.round((Date.now() - started) / 1000);

    emit(
      {
        cycle: context.name, pr: view.number, base: view.baseRefName, head: view.headRefName,
        headSha: view.headRefOid, conductorBranch, waitedSeconds, timedOut, ...verdict,
      },
      () =>
        [
          `PR #${view.number}（${view.headRefName} → ${view.baseRefName}）`,
          `head: ${view.headRefOid}`,
          `マージ先: ${verdict.baseOk ? "✓" : "✗"} ${conductorBranch}`,
          `状態: ${verdict.stateOk ? "✓" : "✗"} ${view.state}`,
          `Ready for Review: ${verdict.readyOk ? "✓" : "✗"}`,
          `レビューの依頼: ${verdict.requestsOk ? "✓ なし" : `✗ ${verdict.requested.join(", ")}`}`,
          `レビュー指摘: ${verdict.threads.ok ? "✓ 未解決なし" : `✗ 未解決 ${verdict.threads.unresolved.length} 件`}`,
          `承認: ${verdict.approval.required ? (verdict.approval.ok ? "✓" : "✗") : "不問"}${
            verdict.approval.approvedBy.length > 0 ? `（${verdict.approval.approvedBy.join(", ")}）` : ""
          }`,
          `CI: ${verdict.checks.status}（${verdict.checks.total} 件）`,
          ...(wait ? [`待機: ${waitedSeconds} 秒${timedOut ? "（上限に達した）" : ""}`] : []),
          ...verdict.problems.map((problem) => `  ! ${problem}`),
        ].join("\n"),
    );
    if (!verdict.ok) throw new ValidationError(verdict.problems);
  },
});

register({
  name: "conductor waiting",
  summary: "ユーザーの答えを待っている問いと、それを待っているビルドを導く（状態は保存しない）",
  usage: "hikyaku conductor waiting [<cycle>] [--root <path>] [--json]",
  details: [
    "作業ツリーと、architect・tasklist の各ビルドの origin のブランチにある decisions.jsonl から、",
    "決定の無いユーザーの問い（question・who=user・when=now）を集めます。同じ ID は1つに重ね、",
    "どれかの断面に決定があれば待ちにしません。",
    "",
    "待っているビルドは、問いを出したビルドと、依存グラフで推移的に依存するビルドです。",
    "ARCHITECT（architect・plan）の問いは全ビルドが待ちます。close-cycle の問いを待つビルドはありません。",
    "",
    "origin に無いブランチは読みません。読めない断面は unavailable に入れ、判定は続けます。",
    "監督は着手できるビルドが無くなったとき、これで待っている問いをまとめてユーザーに尋ねます。",
    "next --json の waiting も同じ導出です。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const { config, context } = openCycle(args, operands[0]);
    const waiting = await deriveWaiting(config, context, context.builds);
    emit({ cycle: context.name, ...waiting }, () => {
      const lines = waitingLines(waiting, context.builds);
      const body = lines.length === 0 ? [`サイクル ${context.name} に、ユーザーの答えを待っている問いはありません。`] : lines;
      return [...body, ...waiting.unavailable.map((reason) => `! 読めない断面: ${reason}`)].join("\n");
    });
  },
});

register({
  name: "conductor lint",
  summary: "スキルに付けた問いの ID と、conductor の ID の表が食い違っていないか検査する",
  usage: "hikyaku conductor lint [--json]",
  details: [
    "プラグイン本体の開発用です。CI（check-scripts）が実行します。",
    "",
    `対象は子として動くスキル（${CONDUCTED_SKILLS.join(" / ")}）の SKILL.md と references/・steps/ です。`,
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
      const markdownIn = (sub: string): string[] => {
        const path = join(directory, sub);
        return existsSync(path)
          ? readdirSync(path).filter((name) => name.endsWith(".md")).map((name) => join(path, name))
          : [];
      };
      const files = [join(directory, "SKILL.md"), ...markdownIn("references"), ...markdownIn("steps")];
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

  if (phase === "architect" && rawBuild === "add") return `/hikyaku:architect ${context.name} add`;
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
