/** ledger open / decide / object / list / show / consent-list / pr-section / return-draft —未決事項と決定の記録（decisions.jsonl） */

import { flagString, type ParsedArgs } from "../lib/args.mts";
import { ASK_IDS } from "../lib/conductor.mts";
import { HikyakuError } from "../lib/errors.mts";
import { relative } from "node:path";
import {
  assertDecider,
  consentDecided,
  consentItemsOf,
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
  undecidedConsentItems,
  whoLabel,
  type Decision,
  type LedgerItem,
  type DecideRecord,
  type ItemType,
  type CycleTimeline,
  type Ledger,
  type OpenRecord,
} from "../lib/ledger.mts";
import { loadConfig } from "../lib/config.mts";
import { emit } from "../lib/output.mts";
import { premisesPrSection, premisesReview, reviewLines } from "../lib/premises.mts";
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
  name: "ledger premises",
  summary: "宣言（[app]・[[app.areas]]）の変更と、それを拠り所にした受け入れ（記録と ADR・constraints）を並べる",
  usage: "hikyaku ledger premises [--changed-from <ref>] [--format text|pr] [--root <path>] [--json]",
  details: [
    "ルートの .hikyaku.config の [app]・[[app.areas]] を、基準と HEAD で比べ、変わった参照（app.<key> / area:<name>）を出します。",
    "そのうえで、変わった参照を拠り所にした受け入れを並べます。対象は次の2つです:",
    "  - 作業ツリーにある全サイクルの decisions.jsonl: risk（退け・解決されていないもの。未決も含む）と、",
    "    ユーザーが受け入れた（consented）objection のうち、--premises を持つもの",
    "  - document-guide.md の decisions・constraints の「受け入れたこと」の行（`（拠り所: `<参照>`）` で終わる行）",
    "",
    "--changed-from を省くと、上限の判定と同じ基準（デフォルトブランチと base_branch との merge-base。",
    "origin/ とローカルの両方。Hikyaku のブランチは除く）を使います。基準を読めないときは、宣言されている",
    "参照をすべて変わったものとして扱います（見直しの対象を落とさないため）。",
    "",
    "「受け入れたこと」の節にあって読めない行（箇条書きでない、拠り所の書式が合わない）は警告に出します。",
    "--format pr は、PR 本文に貼る「宣言の変更」の節を出します（変更も警告も無ければ空）。",
    "警告があっても終了コードは 0 です。",
  ].join("\n"),
  options: ["changed-from", "format"],
  maxOperands: 0,
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const format = flagString(args, "format") ?? "text";
    if (format !== "text" && format !== "pr") throw new HikyakuError(`--format の値が不正です: ${format}`, "使用できる値: text / pr");
    const review = premisesReview(config, flagString(args, "changed-from"));
    if (format === "pr") {
      emit({ section: premisesPrSection(review) }, () => premisesPrSection(review));
      return;
    }
    const { changes } = review;
    emit(
      {
        bases: changes.bases,
        changed: changes.changed,
        uncertain: changes.uncertain,
        notices: changes.notices,
        ledger: review.ledger,
        documents: review.documents,
        warnings: review.warnings,
      },
      () => {
        const lines: string[] = [];
        if (changes.changed.length === 0) lines.push("宣言の変更はありません。");
        else {
          lines.push(`変わった宣言: ${changes.changed.join(", ")}（基準: ${changes.bases.map((base) => base.ref).join(", ") || "読めず"}）`);
          const targets = reviewLines(review);
          lines.push(targets.length === 0 ? "この宣言を拠り所にした受け入れはありません。" : "この宣言を拠り所にした受け入れ（見直しの対象）:", ...targets);
        }
        for (const notice of changes.notices) lines.push(`  ${notice}`);
        for (const warning of review.warnings) lines.push(`! ${warning}`);
        return lines.join("\n");
      },
    );
  },
});

// ---------------------------------------------------------------------------
// 事後同意（build-06）

/** 決定の状態の見出し */
function consentState(item: LedgerItem): string {
  const latest = item.latest;
  if (latest === undefined) return "決定なし";
  if (latest.by !== "user") return `ユーザーの決定なし（最新は ${whoLabel(latest.by)} の ${latest.decision}）`;
  if (latest.decision === "rejected") return "退け（rejected）";
  if (!consentDecided(item)) return "受け入れの言葉なし（害が高の異議）";
  return `決定あり（${latest.decision}）`;
}

function premisesText(item: LedgerItem): string {
  return item.open.premises === undefined || item.open.premises.length === 0 ? "（なし）" : item.open.premises.join(", ");
}

function decisionLine(d: DecideRecord): string {
  const parts = [`${d.at} ${d.decision}（${whoLabel(d.by)}・${d.unit}）`];
  if (d.input !== undefined) parts.push(`答え「${d.input}」`);
  if (d.accepts !== undefined) parts.push(`受け入れ「${d.accepts}」`);
  if (d.reason !== undefined) parts.push(`理由「${d.reason}」`);
  return parts.join(" ");
}

function consentJson(item: LedgerItem): Record<string, unknown> {
  const o = item.open;
  return {
    ...itemJson(item),
    premises: o.premises ?? [],
    loses: o.loses ?? null,
    basis: o.basis ?? null,
    harm: o.harm ?? null,
    decided: consentDecided(item),
    state: consentState(item),
    decisions: item.decisions,
  };
}

register({
  name: "ledger consent-list",
  summary: "PR を作る直前の同意ゲートで示す一覧（when=merge@<phase> の、ユーザーが決める risk・objection）を出す",
  usage: "hikyaku ledger consent-list <phase> [<cycle>] [--full] [--json]",
  details: [
    "対象は type が risk か objection で、who=user・when=merge@<phase> の事項です（記録した作業単位は問いません）。",
    "1項目を「受け入れたリスク / 拠り所の前提 / 失うもの」の3行で示し、見出しに ID と決定の状態を出します。",
    "--full で、根拠・害・いつ・記録した単位と、決定の記録まで出します。書き込みはしません。",
    "決定として数えるのは、最新の決定がユーザーの consented / decided / resolved のときだけです（rejected は数えず、",
    "害が高の異議は受け入れの言葉の無い consented を数えません）。",
  ].join("\n"),
  options: ["full"],
  maxOperands: 2,
  run: ({ args, operands }) => {
    const opened = openUnit(args, operands[0], operands[1]);
    const items = consentItemsOf(readLedger(opened.cycle.directory), opened.phase);
    const full = args.flags.get("full") === true;
    const pending = undecidedConsentItems(items);
    emit({ phase: opened.phase, cycle: opened.cycle.name, items: items.map(consentJson), undecided: pending.map((item) => item.open.id) }, () => {
      // 「決定が足りない項目」の行は必ず出す（PR を作る前の確認が、件数を比べずにこの行を読む）
      const pendingLine = `決定が足りない項目: ${pending.length === 0 ? "なし" : pending.map((item) => item.open.id).join(", ")}`;
      if (items.length === 0) return `${opened.phase} に、マージの前にユーザーが同意する項目はありません。\n${pendingLine}`;
      const lines = [`${opened.phase} のマージの前にユーザーが同意する項目: ${items.length} 件（決定が足りない ${pending.length} 件）`];
      for (const item of items) {
        const o = item.open;
        lines.push("", `${o.id}（${o.type === "risk" ? "受け入れたリスク" : "異議"}）[${consentState(item)}]`);
        lines.push(`  受け入れたリスク: ${o.summary}`, `  拠り所の前提: ${premisesText(item)}`, `  失うもの: ${o.loses ?? "（なし）"}`);
        if (!full) continue;
        if (o.basis !== undefined) lines.push(`  根拠: ${o.basis}`);
        if (o.harm !== undefined) lines.push(`  害の重さ: ${o.harm}`);
        lines.push(`  いつ: ${o.when}`, `  記録した単位: ${o.unit}${o.step === undefined ? "" : `（${o.step}）`}`);
        if (item.decisions.length === 0) lines.push("  決定: （まだ無い）");
        for (const d of item.decisions) lines.push(`  決定: ${decisionLine(d)}`);
      }
      if (!full) lines.push("", "全文は --full で出します。");
      lines.push("", pendingLine);
      return lines.join("\n");
    });
  },
});

/** PR 本文に貼る節。中身のある節だけを出し、どれも無ければ空 */
function prSection(ledger: Ledger, timeline: CycleTimeline, unit: string) {
  const consent = consentItemsOf(ledger, unit);
  const accepted = consent.filter(consentDecided);
  // 最新が rejected の項目は「未解決の退け」に出すので、ここでは重ねない
  const undecided = undecidedConsentItems(consent).filter((item) => item.latest?.decision !== "rejected");
  const rejected = ledger.items.filter((item) => item.latest?.decision === "rejected");
  const beforeMerge = ledger.items.filter(
    (item) => (item.open.type === "question" || item.open.type === "provisional") && item.open.when === `merge@${unit}` && item.latest === undefined,
  );
  const overdue = summarize(ledger, timeline).open.filter((item) => item.timing === "overdue");
  const line = (item: LedgerItem): string => `- ${item.open.id}: ${item.open.summary}`;
  const sections: string[] = [];
  if (accepted.length > 0 || undecided.length > 0) {
    const body: string[] = [];
    for (const item of accepted) {
      const latest = item.latest as DecideRecord;
      body.push(
        line(item),
        `  - 拠り所の前提: ${premisesText(item)} / 失うもの: ${item.open.loses ?? "（なし）"}`,
        `  - 決定: ${latest.decision}（${whoLabel(latest.by)}）${latest.accepts === undefined ? "" : ` 受け入れ「${latest.accepts}」`}`,
      );
    }
    if (accepted.length === 0) body.push("（ユーザーの決定のある項目はありません）");
    if (undecided.length > 0) {
      body.push("", "**同意の決定が無い項目**（受け入れたものとして扱いません）:", ...undecided.map((item) => `${line(item)}（${consentState(item)}）`));
    }
    sections.push(["## 受け入れたリスク（事後同意）", "", ...body].join("\n"));
  }
  if (rejected.length > 0) {
    sections.push(["## 未解決の退け", "", ...rejected.map((item) => `${line(item)}（${item.open.unit}。作り直したらユーザーが resolved を記録します）`)].join("\n"));
  }
  if (beforeMerge.length > 0) {
    sections.push(["## マージの前に決める事項", "", ...beforeMerge.map((item) => `${line(item)}（決める人: ${whoLabel(item.open.who)}）`)].join("\n"));
  }
  if (overdue.length > 0) {
    sections.push(["## 期限を過ぎた事項", "", ...overdue.map((item) => `${line(item)}（いつ: ${item.open.when}・決める人: ${whoLabel(item.open.who)}）`)].join("\n"));
  }
  return {
    markdown: sections.join("\n\n"),
    accepted: accepted.map((item) => item.open.id),
    undecided: undecided.map((item) => item.open.id),
    rejected: rejected.map((item) => item.open.id),
    beforeMerge: beforeMerge.map((item) => item.open.id),
    overdue: overdue.map((item) => item.open.id),
  };
}

register({
  name: "ledger pr-section",
  summary: "PR 本文に貼る「受け入れたリスク（事後同意）」「未解決の退け」「マージの前に決める事項」「期限を過ぎた事項」の節を出す",
  usage: "hikyaku ledger pr-section <phase> [<cycle>] [--json]",
  details: [
    "中身のある節だけを Markdown で出します。どれも無ければ空を出します。書き込みはしません。",
    "  受け入れたリスク（事後同意）  when=merge@<phase> の、ユーザーが決める risk・objection と決定。",
    "                                決定の無い項目は「同意の決定が無い項目」として分けて出します",
    "  未解決の退け                  サイクル全体で、最新の決定が rejected の事項",
    "  マージの前に決める事項        when=merge@<phase> の question・provisional で未決のもの",
    "  期限を過ぎた事項              サイクル全体の未決で、期限を過ぎたもの",
  ].join("\n"),
  options: [],
  maxOperands: 2,
  run: ({ args, operands }) => {
    const opened = openUnit(args, operands[0], operands[1]);
    const section = prSection(readLedger(opened.cycle.directory), cycleTimeline(opened.ctx.config, opened.cycle), opened.phase);
    const { markdown, ...ids } = section;
    emit({ phase: opened.phase, cycle: opened.cycle.name, section: markdown, ...ids }, () => markdown);
  },
});

// ---------------------------------------------------------------------------
// 退けからの差し戻しの下書き（build-17）

/** 退けからの差し戻しの return.md の下書き。選択肢と推奨は置き場所のまま（LLM が書く。下書きのままでは検査を通らない） */
export function returnDraft(phase: string, items: LedgerItem[]): string {
  const rejection = (item: LedgerItem) => item.latest as DecideRecord;
  return [
    `# 差し戻し: ${phase}`,
    "",
    "## 何が崩れたか",
    "",
    `同意ゲートで、前のフェーズで記録した判断をユーザーが退けました（下の「退けた項目」）。${phase} の中では作り直せないので、architect に差し戻します。`,
    "",
    "## 退けた項目",
    "",
    ...items.map((item) => `- ${item.open.id}: ${item.open.summary}（記録: ${item.open.unit}${item.open.step === undefined ? "" : `・${item.open.step}`}）`),
    "",
    "## 試したこと",
    "",
    ...items.map((item) => {
      const d = rejection(item);
      return `- ${item.open.id} の受け入れ「${item.open.summary}」を同意ゲートで示し、ユーザーが退けた（答え「${d.input ?? "記録なし"}」）。拠り所: ${premisesText(item)}。失うもの: ${item.open.loses ?? "（なし）"}`;
    }),
    "",
    "## 問題を変える選択肢",
    "",
    "- （退けた判断をどう決め直すか。スコープを削る・前提を変える・別の案を採る など） 失うもの: （この選択肢で失うもの）",
    "",
    "## 推奨",
    "",
    "（どの選択肢を勧めるかと理由）",
    "",
    "## このビルドの状態",
    "",
    "- 進んだところ: （plan.md / test-spec.md / 実装の有無。どこまでコミット済みか）",
    "- 作り直しが要るもの: handoff.md（完了の印として読まれるので削除する）、（ほかに再設計の後に捨てるべき成果物）",
    "",
  ].join("\n");
}

register({
  name: "ledger return-draft",
  summary: "同意ゲートで前のフェーズの判断を退けたときの return.md の下書きを出す（書き込まない）",
  usage: "hikyaku ledger return-draft <phase> [<cycle>] --items <id,...> [--json]",
  details: [
    "<phase> は build-NN だけです（return.md は builder が書きます）。",
    "--items の事項は、最新の決定が rejected で、記録した作業単位が <phase> と別（前のフェーズ）のものだけを受け付けます。",
    "同じ作業単位の事項は差し戻さず、同意ゲートの args.reworkFrom のステップを作り直します。",
    "下書きは「退けた項目」「試したこと」（退けた受け入れ・拠り所・失うもの・ユーザーの答え）をそろえ、",
    "「問題を変える選択肢」「推奨」は置き場所のままにします。下書きのままでは行き詰まりの報告の検査を通りません。",
  ].join("\n"),
  options: ["items"],
  maxOperands: 2,
  run: ({ args, operands }) => {
    const opened = openUnit(args, operands[0], operands[1]);
    if (!opened.phase.startsWith("build-")) {
      throw new HikyakuError(`${opened.phase} では差し戻しの下書きを出せません`, "return.md は builder（build-NN）が書きます。");
    }
    const ids = required(args, "items").split(",").map((id) => id.trim()).filter((id) => id !== "");
    if (ids.length === 0) throw new HikyakuError("--items に事項の ID を指定してください");
    const ledger = readLedger(opened.cycle.directory);
    const items = ids.map((id) => {
      const item = findItem(ledger, id);
      if (item.latest?.decision !== "rejected") {
        throw new HikyakuError(`${id} の最新の決定が rejected ではありません`, "差し戻すのは、同意ゲートで退けた項目だけです。");
      }
      if (item.open.unit === opened.phase) {
        throw new HikyakuError(
          `${id} は ${opened.phase} で記録した事項です`,
          "同じ作業単位の事項は差し戻さず、同意ゲートの args.reworkFrom のステップを作り直して done で報告し直してください。",
        );
      }
      return item;
    });
    const draft = returnDraft(opened.phase, items);
    emit({ phase: opened.phase, cycle: opened.cycle.name, items: ids, draft }, () => draft);
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
