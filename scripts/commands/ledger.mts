/** ledger open / decide / object / list / show — 未決事項と決定の記録（decisions.jsonl） */

import { flagString, type ParsedArgs } from "../lib/args.mts";
import { ASK_IDS } from "../lib/conductor.mts";
import { HikyakuError } from "../lib/errors.mts";
import { relative } from "node:path";
import {
  assertDecider,
  cycleTimeline,
  decideItem,
  DECISIONS,
  findItem,
  formatWhen,
  gateIds,
  HARMS,
  itemJson,
  itemLine,
  ITEM_TYPES,
  ledgerPath,
  nextItemId,
  OBJECTION_DECISIONS,
  openItem,
  parsePremises,
  parseWhen,
  parseWho,
  readLedger,
  summarize,
  whoLabel,
  type Decision,
  type DecideRecord,
  type ItemType,
  type CycleTimeline,
  type Ledger,
  type OpenRecord,
} from "../lib/ledger.mts";
import { emit } from "../lib/output.mts";
import { pluginVersion } from "../lib/paths.mts";
import { register } from "../lib/registry.mts";
import { open, type Opened } from "../lib/steps/directive.mts";
import { evaluate } from "../lib/steps/engine.mts";
import { directiveOf, type FoundUnit } from "../lib/steps/locate.mts";
import type { Harm } from "../lib/risk.mts";
import { openCycle, type CycleContext } from "../lib/workspace.mts";

function required(args: ParsedArgs, name: string): string {
  const value = flagString(args, name);
  if (value === undefined || value.trim() === "") throw new HikyakuError(`--${name} を指定してください`);
  return value;
}

/** 作業単位を開く。サイクルに属さない patch は扱わない（スコープ外） */
function openUnit(args: ParsedArgs, phase: string | undefined, cycle: string | undefined): Opened & { cycle: CycleContext } {
  const opened = open(args, phase, cycle);
  if (opened.ctx.cycle === undefined) {
    throw new HikyakuError(
      `${opened.phase} はサイクルに属していません`,
      "未決事項の記録はサイクルの中だけで使えます（サイクルに属さない patch の未決事項は扱いません）。",
    );
  }
  return { ...opened, cycle: opened.ctx.cycle };
}

/**
 * その単位の現在のステップ。内部スキルを呼んでいる最中なら呼ばれた側のステップ（判定は Stop フック・
 * step where と同じ directiveOf に任せる）。外れたゲート（off）も返す
 */
function currentStep(args: ParsedArgs, opened: Opened & { cycle: CycleContext }): { step: string | undefined; off: Set<string> } {
  const evaluation = evaluate(opened.skill, opened.ctx);
  const off = new Set(evaluation.steps.filter((step) => step.status === "off").map((step) => step.definition.id));
  const unit: FoundUnit = {
    phase: opened.phase,
    cycle: opened.cycle.name,
    skill: opened.skill,
    directory: opened.ctx.unitDirectory,
    cycleRoot: opened.phase === "close" || opened.phase === "create",
    events: opened.ctx.events,
  };
  const root = flagString(args, "root");
  const { directive } = directiveOf(unit, root === undefined ? {} : { root });
  return { step: directive.step, off };
}

function meta(): { session?: string; hikyaku: string } {
  const session = process.env["CLAUDE_CODE_SESSION_ID"];
  return { ...(session === undefined || session === "" ? {} : { session }), hikyaku: pluginVersion() };
}

const WHEN_DETAILS = [
  "「いつ」（--when）はサイクルの中の出来事だけを受け付けます。日付や自由文は受け付けません。",
  "",
  "  now                        すぐ（決まるまで示し続ける）",
  "  phase:<フェーズ>           plan / architect / build-NN / close / patch-YYYYMM-slug が始まったとき",
  "  gate:<G?>[@<作業単位>]     そのゲートに来たとき。@ を省くと G1→plan、G2〜G4→architect、G10→close、",
  "                             それ以外（G6・G7・G8・P1・P2）は記録する作業単位",
  "  merge[@<作業単位>]         PR のマージの前（同意ゲートか PR の手前に来たとき）。@ を省くと記録する作業単位",
  "  close                      サイクルを締めるとき",
  "",
  "「誰が」（--who）は user / ai:<フェーズ> / supervisor です。",
];

register({
  name: "ledger open",
  summary: "未決事項・暫定の決定・異議・受け入れたリスクを、いつ・誰が決めるかとともに記録する",
  usage:
    "hikyaku ledger open <phase> [<cycle>] --type <type> --when <when> --who <who> --summary <text> [--premises <ref,...>] [--loses <text>] [--harm 高|中] [--ask <id>] [--dry-run] [--json]",
  details: [
    "記録はその作業単位の decisions.jsonl に1行追記します。ID は {作業単位}.{連番}-{4桁の16進}（例: build-03.1-a3f9）で、",
    "出力の ID をそのまま ledger decide / show に渡します（末尾の乱数は、別のブランチの採番と重ならないため）。",
    `--type: ${ITEM_TYPES.join(" / ")}`,
    "",
    ...WHEN_DETAILS,
    "",
    "--premises は拠り所にした外の前提の参照をカンマ区切りで渡します:",
    "  app.exposure | app.data | app.impact | app.merge_gate | area:<name> | constraints#<anchor> | adr:<file> | assumption:<短い文>",
    "--ask は conductor の問いの ID か、ゲートの ID です。",
    "",
    "記録したときのその作業単位の現在のステップを step に残します。",
  ].join("\n"),
  writes: true,
  options: ["type", "when", "who", "summary", "premises", "loses", "harm", "ask"],
  maxOperands: 2,
  run: ({ args, operands }) => {
    const opened = openUnit(args, operands[0], operands[1]);
    const type = required(args, "type") as ItemType;
    if (!ITEM_TYPES.includes(type)) throw new HikyakuError(`--type の値が不正です: ${type}`, `使用できる値: ${ITEM_TYPES.join(" / ")}`);
    const summary = required(args, "summary").trim();
    const who = parseWho(required(args, "who"));
    const when = parseWhen(required(args, "when"), {
      cycleDirectory: opened.cycle.directory,
      builds: opened.cycle.builds,
      opening: opened.phase,
    });
    const premisesRaw = flagString(args, "premises");
    const harm = flagString(args, "harm");
    if (harm !== undefined && !HARMS.includes(harm as Harm)) {
      throw new HikyakuError(`--harm の値が不正です: ${harm}`, `使用できる値: ${HARMS.join(" / ")}`);
    }
    const ask = flagString(args, "ask");
    if (ask !== undefined && !ASK_IDS.includes(ask) && !gateIds().includes(ask)) {
      throw new HikyakuError(`--ask の値が不正です: ${ask}`, "conductor の問いの ID（hikyaku conductor asks）か、ゲートの ID を指定してください。");
    }
    // 高の異議は受け入れるときに前提と結び付けて残す（US-1.5）。決定では前提を足せないので、記録するときに求める
    if (type === "objection" && harm === "高" && (premisesRaw === undefined || premisesRaw.trim() === "")) {
      throw new HikyakuError("害が高の異議には --premises に拠り所にした前提の参照を添えてください", "異議と決定を対で書くなら hikyaku ledger object を使います。");
    }
    const loses = flagString(args, "loses");

    const ledger = readLedger(opened.cycle.directory);
    const { step, off } = currentStep(args, opened);
    const record: OpenRecord = {
      record: "open",
      at: new Date().toISOString(),
      id: nextItemId(ledger, opened.phase),
      unit: opened.phase,
      ...(step === undefined ? {} : { step }),
      type,
      summary,
      when: formatWhen(when),
      who,
      ...(premisesRaw === undefined ? {} : { premises: parsePremises(premisesRaw) }),
      ...(loses === undefined ? {} : { loses }),
      ...(harm === undefined ? {} : { harm: harm as Harm }),
      ...(ask === undefined ? {} : { ask }),
      ...meta(),
    };
    const warnings: string[] = [];
    if (when.kind === "gate" && when.unit === opened.phase && off.has(when.gate)) {
      warnings.push(`${when.gate} は今の設定では現れないので、後ろのステップに進むと期限を過ぎた事項になります`);
    }
    const dryRun = args.flags.get("dry-run") === true;
    if (!dryRun) openItem(opened.cycle.directory, record, ledger);
    const path = relative(opened.ctx.config.repoRoot, ledgerPath(opened.cycle.directory, opened.phase));
    emit({ record, path, warnings, dryRun }, () =>
      [
        `${dryRun ? "記録します（--dry-run のため書き込みません）" : "記録しました"}: ${record.id}`,
        `  いつ    ${record.when}`,
        `  誰が    ${whoLabel(record.who)}`,
        `  要約    ${record.summary}`,
        `  記録先  ${path}`,
        ...warnings.map((warning) => `! ${warning}`),
      ].join("\n"),
    );
  },
});

register({
  name: "ledger decide",
  summary: "未決事項への決定を、決めた作業単位の記録に追記する",
  usage:
    "hikyaku ledger decide <phase> <id> [<cycle>] --decision <decision> --by <who> [--input <text>] [--accepts <text>] [--reason <text>] [--dry-run] [--json]",
  details: [
    "決定は事項のある作業単位ではなく、<phase>（決めた作業単位）の decisions.jsonl に書きます。",
    "並行するビルドが同じ事項にそれぞれ決定を足しても、マージで衝突しません。決まったかは最新の決定で導きます。",
    `--decision: ${DECISIONS.join(" / ")}（rejected は「未解決の退け」として、resolved を記録するまで示し続けます）`,
    "",
    "ユーザーが決める事項（who=user）は --by user でしか決められません。--by user には --input（ユーザーの答え）が必須です。",
    "AI・監督が決める事項は、who と同じ決め手（ai:<フェーズ> は同じフェーズ）か、ユーザーが決められます。",
    "--by ai:<フェーズ> は、決めた作業単位 <phase> と同じフェーズだけです。決める人を付け替える手順はありません。",
  ].join("\n"),
  writes: true,
  options: ["decision", "by", "input", "accepts", "reason"],
  maxOperands: 3,
  run: ({ args, operands }) => {
    const id = operands[1];
    if (id === undefined) throw new HikyakuError("事項の ID を指定してください", "hikyaku ledger list で確かめられます。");
    const opened = openUnit(args, operands[0], operands[2]);
    const decision = required(args, "decision") as Decision;
    if (!DECISIONS.includes(decision)) {
      throw new HikyakuError(`--decision の値が不正です: ${decision}`, `使用できる値: ${DECISIONS.join(" / ")}`);
    }
    const by = parseWho(required(args, "by"));
    if (by.startsWith("ai:") && by !== `ai:${opened.phase}`) {
      throw new HikyakuError(`--by ${by} は ${opened.phase} の記録には書けません`, `AI が決めるなら、決めた作業単位と同じ ai:${opened.phase} を指定してください。`);
    }
    const input = flagString(args, "input");
    const accepts = flagString(args, "accepts");
    const reason = flagString(args, "reason");
    const ledger = readLedger(opened.cycle.directory);
    const record: DecideRecord = {
      record: "decide",
      at: new Date().toISOString(),
      id,
      unit: opened.phase,
      decision,
      by,
      ...(input === undefined ? {} : { input }),
      ...(accepts === undefined ? {} : { accepts }),
      ...(reason === undefined ? {} : { reason }),
      ...meta(),
    };
    const dryRun = args.flags.get("dry-run") === true;
    if (dryRun) {
      // 書き込まずに decideItem と同じ検査を行う
      assertDecider(findItem(ledger, id).open, record.by, record.input);
    } else {
      decideItem(opened.cycle.directory, record, ledger);
    }
    const path = relative(opened.ctx.config.repoRoot, ledgerPath(opened.cycle.directory, opened.phase));
    emit({ record, path, dryRun }, () =>
      [
        `${dryRun ? "記録します（--dry-run のため書き込みません）" : "記録しました"}: ${id} ${decision}`,
        `  決めた人  ${whoLabel(by)}`,
        `  記録先    ${path}`,
      ].join("\n"),
    );
  },
});

register({
  name: "ledger object",
  summary: "ゲートや問いでの異議と、それへのユーザーの決定を対で記録する",
  usage:
    "hikyaku ledger object <phase> [<cycle>] --summary <text> --basis <text> --loses <text> --harm 高|中 --decision consented|decided --input <ユーザーの答え> [--accepts <text>] [--premises <ref,...>] [--ask <id>] [--dry-run] [--json]",
  details: [
    "ユーザーの選択が、その人自身の宣言・記録・前提と食い違うときに唱えた異議（objection）と、ユーザーの決定を",
    "その作業単位の decisions.jsonl に対で書きます。好みの違いには異を唱えません。",
    "",
    "  --basis     食い違う宣言・記録（例: [app] data = \"personal\"、build-02 の予測ピーク）",
    "  --loses     その選択で失うもの",
    "  --harm      害の重さ。高は害が成果物に残る、中はセッションのコスト（persistence.md の重要度）",
    "  --decision  consented（異議を聞いたうえで選択どおりに進める）/ decided（ユーザーが選択を改めた）",
    "  --input     ユーザーの答え（必須）",
    "  --accepts   ユーザーが受け入れると自分の言葉で書いたこと",
    "  --premises  拠り所にした外の前提の参照（ledger open と同じ書式）",
    "  --ask       問いの ID（ゲートの ID か conductor の問いの ID）",
    "",
    "害が高で consented なら --accepts と --premises が必須です。害が高の異議が片づいていない（決定が無い、",
    "または受け入れの言葉の無い決定）ゲートは、step report で承認を受け付けません。中の異議は記録だけで進みます。",
    "記録したときのその作業単位の現在のステップを step に残すので、ゲートを提示している間に呼んでください。",
  ].join("\n"),
  writes: true,
  options: ["summary", "basis", "loses", "harm", "decision", "input", "accepts", "premises", "ask"],
  maxOperands: 2,
  run: ({ args, operands }) => {
    const opened = openUnit(args, operands[0], operands[1]);
    const summary = required(args, "summary").trim();
    const basis = required(args, "basis").trim();
    const loses = required(args, "loses").trim();
    const harm = required(args, "harm") as Harm;
    if (!HARMS.includes(harm)) throw new HikyakuError(`--harm の値が不正です: ${harm}`, `使用できる値: ${HARMS.join(" / ")}`);
    const decision = required(args, "decision") as Decision;
    if (!OBJECTION_DECISIONS.includes(decision)) {
      throw new HikyakuError(`--decision の値が不正です: ${decision}`, `使用できる値: ${OBJECTION_DECISIONS.join(" / ")}`);
    }
    const input = required(args, "input");
    const accepts = flagString(args, "accepts");
    const premisesRaw = flagString(args, "premises");
    if (harm === "高" && decision === "consented") {
      if (accepts === undefined || accepts.trim() === "") {
        throw new HikyakuError(
          "害が高の異議を受け入れて進めるには、--accepts にユーザーが受け入れると書いた言葉を添えてください",
          "ユーザーが何を受け入れるかを自分の言葉で書くまで、先へ進みません（AI が代わりに書かない）。",
        );
      }
      if (premisesRaw === undefined || premisesRaw.trim() === "") {
        throw new HikyakuError("害が高の異議を受け入れて進めるには、--premises に拠り所にした前提の参照を添えてください");
      }
    }
    const ask = flagString(args, "ask");
    if (ask !== undefined && !ASK_IDS.includes(ask) && !gateIds().includes(ask)) {
      throw new HikyakuError(`--ask の値が不正です: ${ask}`, "conductor の問いの ID（hikyaku conductor asks）か、ゲートの ID を指定してください。");
    }

    const ledger = readLedger(opened.cycle.directory);
    const { step } = currentStep(args, opened);
    const at = new Date().toISOString();
    const open: OpenRecord = {
      record: "open",
      at,
      id: nextItemId(ledger, opened.phase),
      unit: opened.phase,
      ...(step === undefined ? {} : { step }),
      type: "objection",
      summary,
      when: "now",
      who: "user",
      ...(premisesRaw === undefined ? {} : { premises: parsePremises(premisesRaw) }),
      basis,
      loses,
      harm,
      ...(ask === undefined ? {} : { ask }),
      ...meta(),
    };
    const decide: DecideRecord = {
      record: "decide",
      at,
      id: open.id,
      unit: opened.phase,
      decision,
      by: "user",
      input,
      ...(accepts === undefined ? {} : { accepts }),
      ...meta(),
    };
    const dryRun = args.flags.get("dry-run") === true;
    if (!dryRun) {
      openItem(opened.cycle.directory, open, ledger);
      decideItem(opened.cycle.directory, decide, { items: [...ledger.items, { open, decisions: [], latest: undefined }], orphans: ledger.orphans });
    }
    const path = relative(opened.ctx.config.repoRoot, ledgerPath(opened.cycle.directory, opened.phase));
    emit({ record: open, decision: decide, path, dryRun }, () =>
      [
        `${dryRun ? "記録します（--dry-run のため書き込みません）" : "記録しました"}: ${open.id}（異議・害 ${harm}）${decision}`,
        `  要約      ${summary}`,
        `  根拠      ${basis}`,
        `  失うもの  ${loses}`,
        ...(accepts === undefined ? [] : [`  受け入れ  ${accepts}`]),
        `  ステップ  ${step ?? "（なし）"}`,
        `  記録先    ${path}`,
      ].join("\n"),
    );
  },
});

function loadCycleLedger(args: ParsedArgs, key: string | undefined): { context: CycleContext; ledger: Ledger; timeline: CycleTimeline } {
  const opened = openCycle(args, key);
  return {
    context: opened.context,
    ledger: readLedger(opened.context.directory),
    timeline: cycleTimeline(opened.config, opened.context),
  };
}

register({
  name: "ledger list",
  summary: "サイクルの未決事項（期限が来た・過ぎたもの）と未解決の退けを一覧する",
  usage: "hikyaku ledger list [<cycle>] [--json]",
  details: [
    "サイクルの全作業単位の decisions.jsonl を読み、事項と決定を ID で結びます。",
    "期限は progress.jsonl の記録から導きます。merge の事項は、同意ゲートか PR の手前に来たら「期限が来た」になり、",
    "ここではマージ済みかを導かないので、決まるまで「期限が来た」のままです（マージ済みのビルドで過ぎたとするのは cycle status）。",
    "別のブランチの事項は、マージまで見えません。",
  ].join("\n"),
  options: [],
  maxOperands: 1,
  run: ({ args, operands }) => {
    const { context, ledger, timeline } = loadCycleLedger(args, operands[0]);
    const summary = summarize(ledger, timeline);
    emit(
      {
        cycle: context.name,
        due: summary.due.map(itemJson),
        open: summary.open.map(itemJson),
        rejected: summary.rejected.map(itemJson),
        orphans: ledger.orphans,
      },
      () => {
        if (ledger.items.length === 0) return `サイクル ${context.name} に未決事項の記録はありません。`;
        const lines = [`サイクル ${context.name}: 未決 ${summary.open.length} 件（期限が来た・過ぎた ${summary.due.length} 件）`];
        for (const item of summary.open) lines.push(`  ${itemLine(item)}`);
        for (const item of summary.rejected) lines.push(`  未解決の退け ${item.open.id}: ${item.open.summary}`);
        if (ledger.orphans.length > 0) {
          lines.push(`  ! 事項がこのツリーに無い決定: ${ledger.orphans.map((record) => record.id).join(", ")}`);
        }
        return lines.join("\n");
      },
    );
  },
});

register({
  name: "ledger show",
  summary: "未決事項1件の全欄と、決定の記録を表示する",
  usage: "hikyaku ledger show <id> [<cycle>] [--json]",
  options: [],
  maxOperands: 2,
  run: ({ args, operands }) => {
    const id = operands[0];
    if (id === undefined) throw new HikyakuError("事項の ID を指定してください");
    const { ledger, timeline } = loadCycleLedger(args, operands[1]);
    const item = findItem(ledger, id);
    const timing = item.latest === undefined ? summarize({ items: [item], orphans: [] }, timeline).open[0]?.timing : undefined;
    emit({ open: item.open, decisions: item.decisions, latest: item.latest ?? null, timing: timing ?? null }, () => {
      const o = item.open;
      const lines = [
        `${o.id}（${o.type}）: ${o.summary}`,
        `  記録した単位  ${o.unit}${o.step === undefined ? "" : `（${o.step}）`}`,
        `  いつ          ${o.when}${timing === undefined ? "" : `（${timing === "overdue" ? "期限を過ぎた" : timing === "due" ? "期限が来た" : "まだ"}）`}`,
        `  誰が          ${whoLabel(o.who)}`,
      ];
      if (o.basis !== undefined) lines.push(`  根拠          ${o.basis}`);
      if (o.premises !== undefined) lines.push(`  拠り所        ${o.premises.join(", ")}`);
      if (o.loses !== undefined) lines.push(`  失うもの      ${o.loses}`);
      if (o.harm !== undefined) lines.push(`  害の重さ      ${o.harm}`);
      if (o.ask !== undefined) lines.push(`  問い          ${o.ask}`);
      if (item.decisions.length === 0) lines.push("  決定          （まだ無い）");
      for (const d of item.decisions) {
        lines.push(`  決定          ${d.at} ${d.decision}（${whoLabel(d.by)}・${d.unit}）`);
        if (d.input !== undefined) lines.push(`    答え        ${d.input}`);
        if (d.accepts !== undefined) lines.push(`    受け入れ    ${d.accepts}`);
        if (d.reason !== undefined) lines.push(`    理由        ${d.reason}`);
      }
      return lines.join("\n");
    });
  },
});
