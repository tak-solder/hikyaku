/**
 * step — フェーズの中の手順を、設定と状態から1手ずつ返す（#50）。
 *
 *   step next    次の1手（directive）を返す。何度呼んでも同じ状態なら同じものを返す
 *   step report  1手の結果を progress.jsonl に追記し、次の1手を返す
 *   step status  手順の一覧と、それぞれの状態を表示する
 *   step lint    ステップの定義と指示ファイルの対応を検査する（CI 用）
 *   step where   サイクルのうち、手順が途中の作業単位を一覧する（navigator 用）
 *   step hook    Claude Code のフックから呼ばれる（stop: 手順の途中で止まるのを1回だけ引き止める）
 *
 * 判定は scripts/lib/steps/ にある。ここは引数の解釈と出力だけを行う。
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { flagBoolean, flagString, type ParsedArgs } from "../lib/args.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { emit, table } from "../lib/output.mts";
import { pluginRoot, pluginVersion } from "../lib/paths.mts";
import {
  appendProgress,
  RESTART,
  RESTART_STEP,
  STEP_RESULTS,
  type ProgressEvent,
  type StepResult,
} from "../lib/progress.mts";
import { register } from "../lib/registry.mts";
import { openCycle } from "../lib/workspace.mts";
import { formatTokens, measureCurrent } from "../lib/session.mts";
import {
  allowedResults,
  currentHashes,
  evaluate,
  hasEvidence,
  missingRequirement,
  type EvaluatedStep,
  type Evaluation,
} from "../lib/steps/engine.mts";
import { checkpointsOf, CHECKPOINT_STEPS } from "../lib/steps/checkpoints.mts";
import {
  buildDirective,
  legacyCycleMessage,
  nextCommand,
  open,
  renderDirective,
  type Directive,
  type Opened,
} from "../lib/steps/directive.mts";
import { stopReason, type StopInput } from "../lib/steps/hook.mts";
import { directiveOf, findUnits } from "../lib/steps/locate.mts";
import { instructionPath, SKILL_STEPS, stepsOf } from "../lib/steps/index.mts";

function emitDirective(directive: Directive, extra: Record<string, unknown> = {}, prefix = ""): void {
  emit({ ...extra, directive }, () => `${prefix}${renderDirective(directive)}`);
}

// ---------------------------------------------------------------------------
// コマンド

register({
  name: "step next",
  summary: "フェーズの中の次の1手を、設定と進捗から決めて返す",
  usage: "hikyaku step next <phase> [<cycle>] [--skill <内部スキル>] [--json]",
  details: [
    "スキルの転送ループが呼びます。返った1手（directive）を行い、step report で結果を返します。",
    "状態は保存せず、作業単位のディレクトリの progress.jsonl と成果物から毎回導出します。",
    "同じ状態なら何度呼んでも同じものを返すので、迷ったら呼び直してください。",
    "",
    "  run    ステップを行う。指示ファイル（read）を読み、終えたら report のコマンドで返す",
    "  gate   ユーザーに承認を求める。承認は結びつくファイル（binds）のハッシュと一緒に記録され、",
    "         承認後にファイルが変わると無効になる",
    "  call   内部スキル（call）を呼ぶ。終えたら呼び出し元が report で返す",
    "  done   手順をすべて終えた",
    "  stop   止まる。message をユーザーに伝えて終了する",
    "",
    "内部スキル（build-manager / retrospective）は --skill で指定し、呼び出し元のフェーズの",
    "作業単位で進めます。記録は呼び出し元と同じ progress.jsonl に入り、呼び出し元が最後に",
    "報告したあとの記録だけが今回の呼び出しの分として数えられます。",
    "",
    "区切り（G8・実装開始前・レビュー前）では、現在のセッションのコンテキストを測り、",
    "[context] の目安と比べます（context）。超えていても止めません。",
    "",
    `いま step に移っているスキル: ${SKILL_STEPS.map((entry) => entry.skill).join(" / ")}`,
  ].join("\n"),
  run: ({ args, operands }) => {
    const opened = open(args, operands[0], operands[1]);
    emitDirective(buildDirective(opened, evaluate(opened.skill, opened.ctx)));
  },
});

register({
  name: "step report",
  summary: "1手の結果を進捗に記録し、次の1手を返す",
  usage:
    "hikyaku step report <phase> <step> [<cycle>] [--skill <内部スキル>] --result done|skipped|approved|rejected|failed [--reason <理由>] [--input <答え>] [--bp <N>] [--dry-run] [--json]",
  writes: true,
  details: [
    "作業単位のディレクトリの progress.jsonl に1行追記します。報告できるのは現在地のステップと、",
    "完了したステップの done の報告し直し（成果物を作り直したとき）です。報告し直すと、",
    "そこから後ろのステップはやり直しになります（承認も取り直し）。",
    "",
    "  done      ステップを終えた。成果物が要るステップは、成果物が無ければ受け付けない",
    "  skipped   スキップした。--reason が必須。スキップできるステップだけ",
    "  approved  ゲートの承認。結びつくファイルのハッシュを記録する",
    "  rejected  ゲートの差し戻し。--input にユーザーの答えが必須",
    "  failed    失敗した。--reason が必須。現在地は動かない",
    "",
    "--bp は plan / plan-review で、再算出した BP を添えるときに使います（分割の検討の判定に使う）。",
    "記録には、報告した時点のコンテキスト・セッション ID・Hikyaku の版が入ります（#68）。",
    "progress.jsonl は成果物と一緒にコミットしてください。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const opened = open(args, operands[0], operands[2]);
    const stepId = operands[1];
    if (stepId === undefined) throw new HikyakuError("ステップを指定してください");
    const evaluation = evaluate(opened.skill, opened.ctx);
    const evaluated = evaluation.steps.find((step) => step.definition.id === stepId);
    if (evaluated === undefined) {
      throw new HikyakuError(
        `${opened.skill.skill} にステップ ${stepId} はありません`,
        `ステップ: ${opened.skill.steps.map((step) => step.id).join(" / ")}`,
      );
    }
    const event = buildEvent(opened, evaluation, evaluated, args);

    if (flagBoolean(args, "dry-run")) {
      emit({ dryRun: true, event }, () => `（dry-run）次の1行を追記します:\n${JSON.stringify(event)}`);
      return;
    }
    appendProgress(opened.ctx.unitDirectory, event);
    const after: Opened = { ...opened, ctx: { ...opened.ctx, events: [...opened.ctx.events, event] } };
    emitDirective(buildDirective(after, evaluate(after.skill, after.ctx)), { recorded: event }, `記録しました: ${stepId} ${event.result}\n\n`);
  },
});

function buildEvent(opened: Opened, evaluation: Evaluation, evaluated: EvaluatedStep, args: ParsedArgs): ProgressEvent {
  const definition = evaluated.definition;
  const resultRaw = flagString(args, "result");
  if (resultRaw === undefined || !STEP_RESULTS.includes(resultRaw as StepResult)) {
    throw new HikyakuError(`--result は ${STEP_RESULTS.join(" | ")} のどれかで指定してください`);
  }
  const result = resultRaw as StepResult;

  const legacy = legacyCycleMessage(opened.ctx.cycle);
  if (legacy !== undefined) throw new HikyakuError(legacy);
  if (evaluated.status === "off") {
    throw new HikyakuError(`${definition.id} は、このサイクルの設定では行わないステップです`);
  }
  // 現在地のほか、完了したステップを done で報告し直せる（成果物を作り直したとき）。
  // そこから後ろはやり直しになる。現在地より後ろへは進めない
  const redo = (evaluated.status === "complete" || evaluated.status === "skipped") && result === "done";
  if (evaluation.current !== evaluated && !redo) {
    const current = evaluation.current?.definition.id;
    throw new HikyakuError(
      current === undefined
        ? "手順はすべて終わっています。作り直したステップを done で報告し直す以外に、報告するものはありません"
        : `報告できるのは現在地のステップ（${current}）か、完了したステップの報告し直しだけです`,
      "step next で現在地を確認してください。",
    );
  }
  if (!allowedResults(definition).includes(result)) {
    throw new HikyakuError(
      `${definition.id} に ${result} は報告できません`,
      `報告できる結果: ${allowedResults(definition).join(" | ")}${definition.kind !== "gate" && result === "skipped" ? "（このステップはスキップできません）" : ""}`,
    );
  }
  const reason = flagString(args, "reason");
  const input = flagString(args, "input");
  if ((result === "skipped" || result === "failed") && (reason === undefined || reason.trim() === "")) {
    throw new HikyakuError(`${result} には --reason で理由を添えてください`);
  }
  if (result === "rejected" && (input === undefined || input.trim() === "")) {
    throw new HikyakuError("rejected には --input でユーザーの答えを添えてください");
  }
  if (result === "done" && !hasEvidence(definition, opened.ctx)) {
    const missing = missingRequirement(definition, opened.ctx);
    throw new HikyakuError(
      missing === undefined ? `${definition.id} の成果物がまだありません` : `${definition.id} の完了の条件を満たしていません: ${missing}`,
      definition.produces === undefined ? "完了の条件を満たしてから報告してください。" : `必要な成果物: ${definition.produces.join(", ")}`,
    );
  }

  const event: ProgressEvent = { at: new Date().toISOString(), skill: opened.skill.skill, step: definition.id, result };
  if (reason !== undefined) event.reason = reason;
  if (input !== undefined) event.input = input;
  if (result === "approved") event.hashes = currentHashes(definition, opened.ctx);

  const bpRaw = flagString(args, "bp");
  if (bpRaw !== undefined) {
    if (definition.reportsBp !== true) throw new HikyakuError(`${definition.id} には --bp を添えられません`);
    const bp = Number(bpRaw);
    if (!Number.isInteger(bp) || bp < 0) throw new HikyakuError(`--bp は0以上の整数で指定してください（現在: ${bpRaw}）`);
    event.bp = bp;
  }

  const measured = measureCurrent(process.env);
  if (measured.tokens !== undefined) event.context = measured.tokens;
  else if (measured.reason !== undefined) event.contextUnavailable = measured.reason;
  if (measured.sessionId !== undefined) event.session = measured.sessionId;
  event.hikyaku = pluginVersion();
  return event;
}

register({
  name: "step restart",
  summary: "同じ作業単位で、スキルの手順を最初から回し直す区切りを記録する",
  usage: "hikyaku step restart <phase> [<cycle>] [--skill <内部スキル>] [--round <回の種類>] --reason <理由> [--dry-run] [--json]",
  writes: true,
  details: [
    "progress.jsonl に区切りを1行追記し、次の1手を返します。これより前の記録は現在地の導出に使いません。",
    "古い記録は消さずに残るので、区切りでのコンテキストなどは後から読めます。",
    "",
    "  architect の追加設計   設計を終えた design/ で、もう一度手順を回すとき",
    "  内部スキルの呼び直し   呼び出し元が報告しないまま、build-manager などをもう一度呼ぶとき",
    "",
    "--round は回の種類です（architect の return / add など）。スキルの定義がこの値で手順を変えます。",
    "使える値はスキルが決め、知らない値はエラーになります。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const opened = open(args, operands[0], operands[1]);
    const reason = flagString(args, "reason");
    if (reason === undefined || reason.trim() === "") throw new HikyakuError("--reason で理由を添えてください");
    const event: ProgressEvent = {
      at: new Date().toISOString(), skill: opened.skill.skill, step: RESTART_STEP, result: RESTART, reason, hikyaku: pluginVersion(),
    };
    const round = flagString(args, "round");
    if (round !== undefined) {
      const rounds = opened.skill.rounds ?? [];
      if (!rounds.includes(round)) {
        throw new HikyakuError(
          `--round に ${round} は指定できません`,
          rounds.length === 0 ? `${opened.skill.skill} には回の種類がありません` : `使える値: ${rounds.join(" | ")}`,
        );
      }
      event.round = round;
    }
    const measured = measureCurrent(process.env);
    if (measured.sessionId !== undefined) event.session = measured.sessionId;
    if (flagBoolean(args, "dry-run")) {
      emit({ dryRun: true, event }, () => `（dry-run）次の1行を追記します:\n${JSON.stringify(event)}`);
      return;
    }
    appendProgress(opened.ctx.unitDirectory, event);
    const after: Opened = { ...opened, ctx: { ...opened.ctx, events: [...opened.ctx.events, event] } };
    emitDirective(buildDirective(after, evaluate(after.skill, after.ctx)), { recorded: event }, `記録しました: ${opened.skill.skill} の手順を最初から回し直します（${reason}）\n\n`);
  },
});

const STATUS_LABELS: Record<EvaluatedStep["status"], string> = {
  complete: "完了",
  skipped: "スキップ",
  pending: "未完了",
  off: "対象外",
};

register({
  name: "step status",
  summary: "フェーズの手順の一覧と、それぞれの状態を表示する",
  usage: "hikyaku step status <phase> [<cycle>] [--skill <内部スキル>] [--json]",
  run: ({ args, operands }) => {
    const opened = open(args, operands[0], operands[1]);
    const evaluation = evaluate(opened.skill, opened.ctx);
    const checkpoints = checkpointsOf(opened.ctx.events, opened.ctx.config.context);
    emit(
      {
        skill: opened.skill.skill,
        cycle: opened.ctx.cycle?.name ?? null,
        unit: opened.phase,
        current: evaluation.current?.definition.id ?? null,
        steps: evaluation.steps.map((step) => ({
          id: step.definition.id,
          kind: step.definition.kind,
          title: step.definition.title,
          status: step.status,
          at: step.event?.at ?? null,
          note: step.note ?? null,
        })),
        checkpoints,
      },
      () => {
        const lines = [
          `${opened.skill.skill} ${opened.phase}${opened.ctx.cycle === undefined ? "" : `（${opened.ctx.cycle.name}）`}`,
          "",
          table(
            evaluation.steps.map((step) => [
              step === evaluation.current ? "→" : "",
              step.definition.id,
              STATUS_LABELS[step.status],
              step.definition.title,
              step.event?.reason ?? step.note ?? "",
            ]),
            ["", "ステップ", "状態", "内容", "補足"],
          ),
        ];
        if (checkpoints.length > 0) {
          lines.push(
            "",
            "区切りでのコンテキスト:",
            ...checkpoints.map(
              (entry) => `  ${entry.label}: ${formatTokens(entry.tokens)} / 目安 ${formatTokens(entry.budget)}${entry.over ? "（超過）" : ""}`,
            ),
          );
        }
        return lines.join("\n");
      },
    );
  },
});

register({
  name: "step lint",
  summary: "ステップの定義と、スキルの指示ファイルの対応を検査する",
  usage: "hikyaku step lint [--json]",
  details: [
    "プラグイン本体の開発用です。CI（check-scripts）が実行します。",
    "",
    "scripts/lib/steps/ の各ステップに skills/<skill>/steps/<id>.md があるか、",
    "定義に無い指示ファイルが残っていないかを検査します。",
    `区切りの定義（${Object.keys(CHECKPOINT_STEPS).join(" / ")}）が実在するステップを指しているかも見ます。`,
  ].join("\n"),
  run: () => {
    const problems: string[] = [];
    for (const skill of SKILL_STEPS) {
      const directory = join(pluginRoot(), "skills", skill.skill, "steps");
      const ids = skill.steps.map((step) => step.id);
      const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
      for (const id of new Set(duplicated)) problems.push(`${skill.skill}: ステップ ${id} が重複しています`);
      for (const id of ids) {
        if (!existsSync(instructionPath(skill.skill, id))) problems.push(`skills/${skill.skill}/steps/${id}.md がありません`);
      }
      const files = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".md")) : [];
      for (const file of files) {
        if (!ids.includes(file.replace(/\.md$/, ""))) {
          problems.push(`skills/${skill.skill}/steps/${file} に対応するステップが scripts/lib/steps/${skill.skill}.mts にありません`);
        }
      }
    }
    for (const [checkpoint, { skill, step }] of Object.entries(CHECKPOINT_STEPS)) {
      if (!stepsOf(skill)?.steps.some((definition) => definition.id === step)) {
        problems.push(`区切り ${checkpoint} が指す ${skill} の ${step} がありません`);
      }
    }
    if (problems.length > 0) throw new ValidationError(problems);
    const count = SKILL_STEPS.reduce((sum, skill) => sum + skill.steps.length, 0);
    emit({ ok: true, skills: SKILL_STEPS.map((skill) => skill.skill) }, () => `✓ ${SKILL_STEPS.length} スキル・${count} ステップの指示ファイルが揃っています`);
  },
});


register({
  name: "step where",
  summary: "サイクルのうち、手順の記録がある作業単位と、それぞれの次の1手を一覧する",
  usage: "hikyaku step where [<cycle>] [--root <path>] [--json]",
  details: [
    "navigator が、どこから再開すればよいかを示すために呼びます。",
    "",
    "このチェックアウトの作業ツリーにある progress.jsonl（サイクルのディレクトリ直下・planning/・",
    "design/・build-NN/）を読み、作業単位ごとに step next と同じ判定で次の1手を返します。",
    "区切りでのコンテキストは測りません。内部スキルを呼んでいる最中なら、呼ばれたスキルの1手を返します。",
    "",
    "記録はそのフェーズのブランチにコミットされるので、別のブランチで進めた作業単位は見えません。",
    "記録の無い作業単位（まだ着手していないビルドなど）は並びません。",
    "v2 で作成したサイクルなら、作業単位を読まずに legacy に案内を返します。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const { config, context } = openCycle(args, operands[0]);
    const root = flagString(args, "root");
    const legacy = legacyCycleMessage(context);
    const units = legacy !== undefined ? [] : findUnits(config.hikyakuRoot, [context.record]).map((unit) => {
      const { opened, directive } = directiveOf(unit, root === undefined ? {} : { root });
      return { directive, next: nextCommand(opened) };
    });
    emit({ cycle: context.name, legacy: legacy ?? null, units }, () => {
      if (legacy !== undefined) return `cycle ${context.name}\n\nstop: ${legacy}`;
      if (units.length === 0) return `cycle ${context.name}: このチェックアウトには手順の記録がありません`;
      return [
        `cycle ${context.name}`,
        "",
        table(
          units.map(({ directive }) => [
            directive.unit,
            directive.skill,
            `${directive.progress.complete}/${directive.progress.total}`,
            directive.kind,
            directive.kind === "stop" ? (directive.message ?? "").split("\n")[0] ?? "" : `${directive.step ?? ""}${directive.title === undefined ? "" : `（${directive.title}）`}`,
          ]),
          ["作業単位", "スキル", "進み", "次", "内容"],
        ),
      ].join("\n");
    });
  },
});

register({
  name: "step hook",
  summary: "Claude Code のフックから呼ばれる。stop: 手順の途中で止まろうとしたら、1回だけ続きを促す",
  usage: "hikyaku step hook stop",
  details: [
    "プラグインの hooks/hooks.json が Stop フックとして呼びます。手で実行するものではありません。",
    "標準入力で Claude Code のフックの入力（JSON）を受け取ります。",
    "",
    "次のすべてに当たるときだけ、{\"decision\": \"block\"} を返してセッションを続けさせます。",
    "",
    "  - このセッションが Hikyaku の手順を進めている（進行中のサイクルなどの progress.jsonl に",
    "    このセッションの ID がある）",
    "  - その作業単位の次の1手が run か call（gate・done・stop なら止まってよい）。内部スキルを",
    "    呼んでいる最中なら、呼ばれたスキルの1手で判定する",
    "  - 同じターンでまだ止めていない（stop_hook_active が true なら止めない）",
    "  - 最後の出力が、conductor の非対話規約のブロック（gate / done / blocked）で終わっていない",
    "",
    "判定できないとき（Hikyaku を使っていないリポジトリ、壊れた記録など）は止めません。",
    "エラーは標準エラーに書き、終了コードは 0 のままにします。",
  ].join("\n"),
  run: async ({ operands }) => {
    if (operands[0] !== "stop") {
      throw new HikyakuError(
        operands[0] === undefined ? "フックの種類を指定してください" : `フックの種類が不正です: ${operands[0]}`,
        "使用できる値: stop",
      );
    }
    let reason: string | undefined;
    try {
      const raw = await readStdin();
      reason = raw.trim() === "" ? undefined : stopReason(JSON.parse(raw) as StopInput);
    } catch (error) {
      process.stderr.write(`hikyaku step hook stop: ${error instanceof Error ? error.message : String(error)}\n`);
      return;
    }
    if (reason !== undefined) process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
  },
});

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY === true) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
