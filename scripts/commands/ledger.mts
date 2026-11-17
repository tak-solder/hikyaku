/** ledger open / decide / object / list / show / consent-list / pr-section / answers / return-draft —未決事項と決定の記録（decisions.jsonl） */

import { flagString, type ParsedArgs } from "../lib/args.mts";
import { ASK_IDS } from "../lib/conductor.mts";
import { HikyakuError } from "../lib/errors.mts";
import { relative } from "node:path";
import {
  answerFields,
  answerProblem,
  assertDecider,
  childAnswer,
  consentDecided,
  consentItemsOf,
  cycleTimeline,
  decideItem,
  DECISIONS,
  findItem,
  formatWhen,
  gateIds,
  HARMS,
  isConsentItem,
  isHighObjection,
  itemJson,
  itemLine,
  ITEM_TYPES,
  ledgerPath,
  nextItemId,
  OBJECTION_DECISIONS,
  openItem,
  parsePremise,
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
import { consentGateSlot } from "../lib/steps/consent.mts";
import { deferredConsent } from "../lib/deferred-consent.mts";
import { effectiveDeclaration, exceedsCeilingFor, type Harm } from "../lib/risk.mts";
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
  // step next と同じ評価（positionOnly を付けない）。off と step を同じ評価から求め、位置だけの評価が安全側に入れた
  // 同意ゲートを、事項を記録したステップとして残さない（コードレビュー1回目の指摘）
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
  const { directive } = directiveOf(unit, { ...(root === undefined ? {} : { root }), positionOnly: false });
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
    const premises = premisesRaw === undefined || premisesRaw.trim() === "" ? [] : parsePremises(premisesRaw);
    let exceedsCeiling = false;
    if (type === "objection") {
      // マージの前の同意へ回す異議は ledger object --defer だけが書く（事後同意が有効か・上限を超えるか・置き場があるかを
      // 確かめずに同意ゲートへ積む経路、または同意ゲートに載らずにゲートの承認を素通りする経路を作らない）
      if (when.kind === "merge") {
        throw new HikyakuError("異議の「いつ」に merge は指定できません", "マージの前の同意へ回すなら hikyaku ledger object --defer を使います。");
      }
      exceedsCeiling = exceedsCeilingFor(effectiveDeclaration(opened.ctx.config), harm as Harm | undefined, premises);
    }
    // 高として扱う異議（害が高か、上限を超える）は受け入れるときに前提と結び付けて残す（US-1.5・US-13.3）。
    // 決定では前提を足せないので、記録するときに求める
    if (type === "objection" && (harm === "高" || exceedsCeiling) && premises.length === 0) {
      throw new HikyakuError(
        `${harm === "高" ? "害が高" : "上限を超える"}異議には --premises に拠り所にした前提の参照を添えてください`,
        "異議と決定を対で書くなら hikyaku ledger object を使います。",
      );
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
      ...(premises.length === 0 ? {} : { premises }),
      ...(loses === undefined ? {} : { loses }),
      ...(harm === undefined ? {} : { harm: harm as Harm }),
      ...(ask === undefined ? {} : { ask }),
      ...(exceedsCeiling ? { exceedsCeiling: true as const } : {}),
      ...meta(),
    };
    const warnings: string[] = [];
    if (exceedsCeiling) warnings.push("この異議は AI に任せてよい上限を超えます。受け入れるときは、ユーザーの言葉を ledger decide の --accepts に添えてください");
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
    "",
    "conductor の子（HIKYAKU_CONDUCTOR_CHILD=1）では、答えの出どころで書ける決定を縛ります（--dry-run でも同じ）:",
    "  --by user         ユーザーの答えで再開された子（HIKYAKU_ANSWER_FROM=user）が、launch の --closes で渡された",
    "                    ID（HIKYAKU_ANSWER_ITEMS）の事項にだけ書けます",
    "  --by supervisor   監督の答えで再開された子（HIKYAKU_ANSWER_FROM=supervisor）だけが書けます。問い・答えの値・",
    "                    リスクの申告・起動の印（ask・choice・risk・token）を環境変数から決定に必ず残します。",
    "                    リスクの申告が要る答え（questions、review-findings の proceed）で申告が無ければ拒みます",
    "答えの出どころ（from）も決定に残します。子でないセッションは検査せず、欄も足しません。",
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
    // conductor の子では、答えの出どころ（launch が置いた環境変数）で書ける決定を縛る（--dry-run でも同じ検査）
    const answer = childAnswer();
    const problem = answerProblem(by, id, answer);
    if (problem !== undefined) throw new HikyakuError(problem);
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
      ...answerFields(by, answer),
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
    "hikyaku ledger object <phase> [<cycle>] --summary <text> --basis <text> --loses <text> --harm 高|中 (--decision consented|decided --input <ユーザーの答え> [--accepts <text>] [--answers <id>] | --defer) [--premises <ref,...>] [--ask <id>] [--dry-run] [--json]",
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
    "  --answers   決定が閉じる、ユーザーの答えを待っていた事項の ID。conductor の子（HIKYAKU_CONDUCTOR_CHILD=1）の",
    "              決定つきの記録では必須で、ユーザーの答えで再開されたとき（launch の --from user --closes）に渡された",
    "              ID だけを受け付けます。子でなければ任意で、検査しません",
    "",
    "害が高で consented なら --accepts と --premises が必須です。害が中でも、AI に任せてよい上限（[app] の宣言）を",
    "超える異議は高と同じに扱い、consented には --accepts と --premises が要ります（事後同意が有効かに関わらず）。",
    "上限は宣言の軸と、--premises に挙げた area:<name> の重い領域で決まり、基準の宣言を読めない回は超えるとみなします。",
    "高として扱う異議が片づいていない（決定が無い、または受け入れの言葉の無い決定）ゲートは、step report で承認を",
    "受け付けません。中の異議は記録だけで進みます。",
    "",
    "  --defer     事後同意（[consent] deferred）が有効なサイクルで、上限を超える異議の同意をマージの前の同意ゲートへ回す。",
    "              --decision・--input・--accepts は渡さず、決定なしで when=merge@<phase> の事項を記録します。",
    "              --premises（app.* か area:* だけ）が必須。事後同意が無効、上限を超えない、今の回に同意ゲートが",
    "              現れない（plan / close / create、差し戻しからの再設計の回、この回で PR を作るステップを終えた後）なら拒みます",
    "",
    "記録したときのその作業単位の現在のステップを step に残すので、ゲートを提示している間に呼んでください。",
  ].join("\n"),
  writes: true,
  options: ["summary", "basis", "loses", "harm", "decision", "input", "accepts", "premises", "ask", "defer", "answers"],
  maxOperands: 2,
  run: ({ args, operands }) => {
    const opened = openUnit(args, operands[0], operands[1]);
    const summary = required(args, "summary").trim();
    const basis = required(args, "basis").trim();
    const loses = required(args, "loses").trim();
    const harm = required(args, "harm") as Harm;
    if (!HARMS.includes(harm)) throw new HikyakuError(`--harm の値が不正です: ${harm}`, `使用できる値: ${HARMS.join(" / ")}`);
    const defer = args.flags.get("defer") === true;
    const premisesRaw = flagString(args, "premises");
    const premises = premisesRaw === undefined || premisesRaw.trim() === "" ? [] : parsePremises(premisesRaw);
    const ask = flagString(args, "ask");
    if (ask !== undefined && !ASK_IDS.includes(ask) && !gateIds().includes(ask)) {
      throw new HikyakuError(`--ask の値が不正です: ${ask}`, "conductor の問いの ID（hikyaku conductor asks）か、ゲートの ID を指定してください。");
    }
    const exceedsCeiling = exceedsCeilingFor(effectiveDeclaration(opened.ctx.config), harm, premises);
    const answer = childAnswer();
    const answersId = flagString(args, "answers");

    let decision: Decision | undefined;
    let input: string | undefined;
    let accepts: string | undefined;
    if (defer) {
      for (const name of ["decision", "input", "accepts"]) {
        if (args.flags.has(name)) {
          throw new HikyakuError(`--defer と --${name} は一緒に渡せません`, "--defer は決定なしで記録し、ユーザーの決定はマージの前の同意ゲートで記録します。");
        }
      }
      assertDeferrable(opened, premises, exceedsCeiling);
    } else {
      decision = required(args, "decision") as Decision;
      if (!OBJECTION_DECISIONS.includes(decision)) {
        throw new HikyakuError(`--decision の値が不正です: ${decision}`, `使用できる値: ${OBJECTION_DECISIONS.join(" / ")}`);
      }
      input = required(args, "input");
      accepts = flagString(args, "accepts");
      // 異議の事項はその場で作るので ID が前もって無い。conductor の子では、ユーザーの答えで閉じる待ちの事項（--answers）を
      // 示させ、その ID がユーザーの答えた事項（HIKYAKU_ANSWER_ITEMS）にあるときだけ書ける
      if (answer !== undefined) {
        if (answersId === undefined || answersId.trim() === "") {
          throw new HikyakuError(
            "conductor の子では、決定つきの異議に --answers（ユーザーの答えで閉じる待ちの事項の ID）を添えてください",
            "ユーザーに上げる問いなら、ledger open で記録して blocked で終えてください。",
          );
        }
        const problem = answerProblem("user", answersId.trim(), answer);
        if (problem !== undefined) throw new HikyakuError(problem);
      }
      if ((harm === "高" || exceedsCeiling) && decision === "consented") {
        const what = harm === "高" ? "害が高" : "AI に任せてよい上限を超える";
        if (accepts === undefined || accepts.trim() === "") {
          throw new HikyakuError(
            `${what}異議を受け入れて進めるには、--accepts にユーザーが受け入れると書いた言葉を添えてください`,
            "ユーザーが何を受け入れるかを自分の言葉で書くまで、先へ進みません（AI が代わりに書かない）。",
          );
        }
        if (premises.length === 0) {
          throw new HikyakuError(`${what}異議を受け入れて進めるには、--premises に拠り所にした前提の参照を添えてください`);
        }
      }
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
      when: defer ? `merge@${opened.phase}` : "now",
      who: "user",
      ...(premises.length === 0 ? {} : { premises }),
      basis,
      loses,
      harm,
      ...(ask === undefined ? {} : { ask }),
      ...(exceedsCeiling ? { exceedsCeiling: true as const } : {}),
      ...meta(),
    };
    const decide: DecideRecord | undefined = decision === undefined ? undefined : {
      record: "decide",
      at,
      id: open.id,
      unit: opened.phase,
      decision,
      by: "user",
      ...(input === undefined ? {} : { input }),
      ...(accepts === undefined ? {} : { accepts }),
      ...(answersId === undefined || answersId.trim() === "" ? {} : { answers: answersId.trim() }),
      ...answerFields("user", answer),
      ...meta(),
    };
    const dryRun = args.flags.get("dry-run") === true;
    if (!dryRun) {
      openItem(opened.cycle.directory, open, ledger);
      if (decide !== undefined) {
        decideItem(opened.cycle.directory, decide, { items: [...ledger.items, { open, decisions: [], latest: undefined }], orphans: ledger.orphans });
      }
    }
    const path = relative(opened.ctx.config.repoRoot, ledgerPath(opened.cycle.directory, opened.phase));
    emit({ record: open, decision: decide ?? null, path, dryRun }, () =>
      [
        `${dryRun ? "記録します（--dry-run のため書き込みません）" : "記録しました"}: ${open.id}（異議・害 ${harm}）${decision ?? `マージの前の同意へ回す（${open.when}）`}`,
        `  要約      ${summary}`,
        `  根拠      ${basis}`,
        `  失うもの  ${loses}`,
        ...(accepts === undefined ? [] : [`  受け入れ  ${accepts}`]),
        ...(exceedsCeiling ? ["  上限      AI に任せてよい上限を超える（受け入れには言葉と前提が要る）"] : []),
        `  ステップ  ${step ?? "（なし）"}`,
        `  記録先    ${path}`,
      ].join("\n"),
    );
  },
});

/**
 * ledger object --defer を受け付けるか。事後同意が有効で、前提が宣言（app.*・area:*）だけで、上限を超え、
 * 今の回に同意ゲートの置き場があるときだけ。ADR deferred-consent: 上限を超える受け入れは、有効なときだけ積む
 */
function assertDeferrable(opened: Opened & { cycle: CycleContext }, premises: string[], exceedsCeiling: boolean): void {
  const judged = deferredConsent(opened.ctx.config, opened.cycle.directory);
  if (!judged.effective) {
    throw new HikyakuError(
      `事後同意が有効でないので、異議の同意をマージの前に回せません: ${judged.reason}`,
      "その場でユーザーの決定を聞き、--decision と --input（受け入れるなら --accepts と --premises）で記録してください。",
    );
  }
  if (premises.length === 0 || premises.some((premise) => !["app", "area"].includes(parsePremise(premise).kind))) {
    throw new HikyakuError(
      "--defer には、拠り所にした宣言の参照（app.* か area:*）だけを --premises に添えてください",
      "マージの前の同意へ回せるのは、宣言で決まる上限を超える受け入れだけです（宣言が変われば見直せるように）。",
    );
  }
  // 宣言に無い領域名を拠り所にすると、宣言を変える PR での見直し（premises）がその受け入れを拾えない
  const declared = effectiveDeclaration(opened.ctx.config).declaration?.areas.map((area) => area.name) ?? [];
  const unknown = premises.map(parsePremise).flatMap((premise) => (premise.kind === "area" && !declared.includes(premise.name) ? [premise.name] : []));
  if (unknown.length > 0) {
    throw new HikyakuError(
      `--premises の重い領域が宣言にありません: ${unknown.join(", ")}`,
      "[[app.areas]] に宣言した領域の名前を指定してください（hikyaku config で確かめられます）。",
    );
  }
  if (!exceedsCeiling) {
    throw new HikyakuError(
      "この異議は AI に任せてよい上限を超えないので、マージの前に回しません",
      "その場でユーザーの決定を聞き、--decision と --input で記録してください。",
    );
  }
  const problem = consentGateSlot(opened.skill, opened.ctx);
  if (problem !== undefined) {
    throw new HikyakuError(`${problem}。積んでも同意を取る場面がないので、--defer を受け付けません`, "その場でユーザーの決定を聞き、--decision と --input で記録してください。");
  }
}

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
  if (!consentDecided(item)) return "受け入れの言葉なし（害が高か、上限を超える異議）";
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
    exceedsCeiling: o.exceedsCeiling === true,
    needsAccepts: isHighObjection(item),
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
    "害が高か、上限を超える異議は受け入れの言葉の無い consented を数えません。そうした項目には、その旨の行を出します）。",
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
        // 同意に受け入れの言葉（--accepts）が要る項目は、--full でなくても示す（決定を記録し直させないため）
        if (isHighObjection(item)) lines.push(`  同意には受け入れの言葉（--accepts）が要る（${o.harm === "高" ? "害が高" : "上限を超える"}異議）`);
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
// 監督が答えた問い（build-07）

/** 監督の答えのリスクの申告の表示。申告の無い決定（このビルドより前の記録など）は何も示さない */
function riskText(record: DecideRecord): string | undefined {
  if (record.risk === undefined) return undefined;
  if (record.risk.kind === "none") return "リスクなしと申告";
  return `害 ${record.risk.harm}・前提 ${record.risk.premises.join(", ") || "（なし）"}`;
}

/** サイクル全体の監督の決定（by=supervisor）。事項がこのツリーに無い決定も含め、記録順 */
function supervisorAnswers(ledger: Ledger): { record: DecideRecord; summary: string | undefined }[] {
  const answers = [
    ...ledger.items.flatMap((item) => item.decisions.map((record) => ({ record, summary: item.open.summary as string | undefined }))),
    ...ledger.orphans.map((record) => ({ record, summary: undefined })),
  ].filter((entry) => entry.record.by === "supervisor");
  return answers.sort((a, b) => (a.record.at < b.record.at ? -1 : a.record.at > b.record.at ? 1 : 0));
}

function answersSection(answers: { record: DecideRecord; summary: string | undefined }[]): string {
  if (answers.length === 0) return "";
  const lines = answers.map(({ record, summary }) => {
    const asked = [record.ask, record.choice].filter((part) => part !== undefined).join(" / ");
    const parts = [
      `- ${record.id}${asked === "" ? "" : `（${asked}）`}: ${summary ?? "（事項がこのツリーにありません）"}`,
      ...(record.input === undefined ? [] : [`答え「${record.input}」`]),
      ...(riskText(record) === undefined ? [] : [riskText(record) as string]),
    ];
    return parts.join(" — ");
  });
  return ["## 監督が答えた問い", "", ...lines].join("\n");
}

register({
  name: "ledger answers",
  summary: "サイクル全体で監督が答えた問い（by=supervisor の決定）を、問いとリスクの申告つきで並べる",
  usage: "hikyaku ledger answers [<cycle>] [--format text|pr] [--json]",
  details: [
    "作業ツリーのサイクルの全 decisions.jsonl から、監督の決定を記録順に並べます。書き込みはしません。",
    "conductor の最後の PR の本文に貼る「監督が答えた問い」の節は、--format pr の出力をそのまま使います（監督が書き写さない）。",
    "",
    "リスクの申告は、子が監督の答えを記録したときに conductor launch の環境変数から決定に残したものです。",
    "--no-risk で答えた問いは「リスクなしと申告」、害と前提を申告した問いはその値を示します。",
    "申告の欄の無い決定（このビルドより前の記録など）は、申告を示さずにそのまま出します。",
  ].join("\n"),
  options: ["format"],
  maxOperands: 1,
  run: ({ args, operands }) => {
    const format = flagString(args, "format") ?? "text";
    if (format !== "text" && format !== "pr") throw new HikyakuError(`--format の値が不正です: ${format}`, "使用できる値: text / pr");
    const opened = openCycle(args, operands[0]);
    const answers = supervisorAnswers(readLedger(opened.context.directory));
    const section = answersSection(answers);
    emit(
      {
        cycle: opened.context.name,
        answers: answers.map(({ record, summary }) => ({ ...record, summary: summary ?? null })),
        ...(format === "pr" ? { section } : {}),
      },
      () => (format === "pr" ? section : section === "" ? `サイクル ${opened.context.name} に監督が答えた問いはありません。` : section),
    );
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
    "--items の事項は、<phase> の同意ゲートの項目（when=merge@<phase>・who=user の risk / objection）で、最新の決定が",
    "rejected で、記録した作業単位が <phase> と別（前のフェーズ）のものだけを受け付けます。",
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
    const ids = [...new Set(required(args, "items").split(",").map((id) => id.trim()).filter((id) => id !== ""))];
    if (ids.length === 0) throw new HikyakuError("--items に事項の ID を指定してください");
    const ledger = readLedger(opened.cycle.directory);
    const items = ids.map((id) => {
      const item = findItem(ledger, id);
      if (!isConsentItem(item, opened.phase)) {
        throw new HikyakuError(
          `${id} は ${opened.phase} の同意ゲートの項目ではありません`,
          `差し戻すのは、${opened.phase} の同意ゲートで退けた項目（when=merge@${opened.phase}・who=user の risk / objection）だけです。`,
        );
      }
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
