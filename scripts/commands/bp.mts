/**
 * bp guide / estimate / render / test / history / actual — BP の基準表・見積もり・実績。
 *
 * 基準表への当てはめはすべてここで行う。LLM が持つのは入力値の見積もり
 * （新規ファイル数はいくつか、影響ファイル数はいくつか）だけで、
 * 表を読んで BP にする作業は決定的にする。
 *
 * 基準表は {HIKYAKU_ROOT}/bp-guide/ にあり、無ければ既定値で動く。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { flagBoolean, flagString, type ParsedArgs } from "../lib/args.mts";
import {
  BP_CASES_FILE,
  BP_GUIDE_DIR,
  BP_README_FILE,
  BP_RULES_FILE,
  type BpInput,
  type BpRules,
  DEFAULT_BP_CASES,
  DEFAULT_BP_RULES,
  bpGuideDir,
  bpReadmePath,
  bpVerdict,
  describeAddition,
  describeVerdict,
  estimateBp,
  flagNameOf,
  inputKeys,
  inputKindOf,
  loadBpCases,
  loadBpRules,
  MEASURED_METRIC_KEYS,
  renderBreakdownMarkdown,
  renderBreakdownRows,
  renderRulesMarkdown,
  runBpCases,
  upsertReadmeBlock,
} from "../lib/bp.mts";
import {
  type BpRecord,
  collectBpRecords,
  GROUP_KEYS,
  type GroupKey,
  groupRecords,
  numericValue,
  summarizeGroup,
} from "../lib/bp-history.mts";
import { loadConfig, type ResolvedConfig } from "../lib/config.mts";
import { cycleDirName, loadCycles } from "../lib/cycles.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { summarizeDiff } from "../lib/bp-actual.mts";
import { branchName } from "../lib/branch.mts";
import { currentBranch, diffStats, mainWorktreeRoot, originUrl, worktreePaths } from "../lib/git.mts";
import { pluginVersion } from "../lib/paths.mts";
import {
  type Candidate,
  collectBranchSessions,
  describeMissingCurrent,
  formatTokens,
  HOST_LABELS,
  hostLabel,
  lookupCurrent,
  pickCurrent,
  readMeasure,
  renderSessionMarkdown,
  SELECTION_RULE,
  selectMain,
  type SessionHost,
  type SessionMeasure,
} from "../lib/session.mts";
import { emit, table } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { requirePhase, resolvePrBase, scopeFor } from "../lib/stack.mts";
import { openCycleIfAny } from "../lib/workspace.mts";

/** どのコマンドでも受け付けるオプション。基準表のキーはこれと衝突しない（bp.mts が弾く） */
const COMMON_FLAGS = new Set(["json", "root", "profile", "help", "version", "dry-run"]);

/** サイクルが決まれば bp_max はそのサイクルの設定から。無ければルート設定 */
function configFor(args: ParsedArgs, operand: string | undefined): ResolvedConfig {
  const opened = openCycleIfAny(args, operand);
  return opened ? opened.config : loadConfig({ root: flagString(args, "root") });
}

function sourceLabel(config: ResolvedConfig, rules: BpRules): string {
  return rules.source === undefined
    ? `既定値（${relative(config.repoRoot, bpGuideDir(config.hikyakuRoot))}/ が無いため）`
    : relative(config.repoRoot, rules.source);
}

function usageOf(rules: BpRules): string {
  return inputKeys(rules)
    .map((k) => (k.kind === "flag" ? `--${flagNameOf(k.key)}` : `--${flagNameOf(k.key)} <n>`))
    .join("  ");
}

/**
 * --<キー> を基準表の入力にする。
 *
 * 基準表に無いフラグはエラーにする。`--impactfiles` のようなタイプミスを黙って
 * 捨てると、加算要素の取りこぼしという、まさに防ぎたい過小見積もりになる。
 */
function readBpInput(args: ParsedArgs, rules: BpRules, extraFlags: Set<string>): BpInput {
  const keyByFlag = new Map(inputKeys(rules).map((k) => [flagNameOf(k.key), k.key]));
  const input: BpInput = {};
  for (const [flag, raw] of args.flags) {
    if (COMMON_FLAGS.has(flag) || extraFlags.has(flag)) continue;
    const key = keyByFlag.get(flag);
    if (key === undefined) {
      throw new HikyakuError(
        `--${flag} は基準表にありません`,
        [`使える入力: ${usageOf(rules)}`, `基準表: ${rules.source ?? `既定値（${BP_GUIDE_DIR}/ で変更できます）`}`].join("\n"),
      );
    }
    input[key] = inputKindOf(rules, key) === "flag" ? readSwitch(flag, raw) : readCount(flag, raw);
  }
  return input;
}

function readCount(flag: string, raw: string | boolean): number {
  if (typeof raw === "boolean") throw new HikyakuError(`--${flag} には値（0以上の整数）が必要です`);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== raw.trim() || parsed < 0) {
    throw new HikyakuError(`--${flag} は0以上の整数で指定してください（現在: ${raw}）`);
  }
  return parsed;
}

/**
 * フラグ型の加算要素。値は取らないが、直後に位置引数（サイクル名）を置くと
 * 引数解析がそれを値として食べてしまう。その場合は推測せずエラーで教える。
 */
function readSwitch(flag: string, raw: string | boolean): boolean {
  if (typeof raw === "boolean") return raw;
  const lowered = raw.trim().toLowerCase();
  if (["true", "yes", "1"].includes(lowered)) return true;
  if (["false", "no", "0"].includes(lowered)) return false;
  throw new HikyakuError(
    `--${flag} は値を取りません（受け取った値: ${raw}）`,
    `サイクル名はオプションより前に置くか、--${flag}=true の形で指定してください。`,
  );
}

register({
  name: "bp guide",
  summary: "現在有効な BP の基準表を表示する",
  usage: "hikyaku bp guide [<cycle>] [--markdown] [--root <path>] [--json]",
  details: [
    `基準表は {HIKYAKU_ROOT}/${BP_GUIDE_DIR}/${BP_RULES_FILE} が正で、無ければ Hikyaku の既定値を使います。`,
    "どちらを使っているかは出力の先頭に出ます。",
    "",
    "基準表はワークスペースの持ち物です。同じ規模の実装でも、フレームワークの定型量や",
    "既存コードの結合度で1セッションに収まる量が変わるため、Hikyaku 側で固定しません。",
    "調整は /hikyaku:bp-guide で行います（振り返りの実績を素材にする）。",
    "",
    "--markdown は doc-reviewer へ渡す表を Markdown で出します。",
    "指標・加算要素の名前と一緒に、bp estimate に渡すフラグ名も表示します。",
    "",
    `${BP_GUIDE_DIR}/ が無いワークスペースには hikyaku init --root <path> が既定値で生成します`,
    "（既存ファイルは上書きしません）。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = configFor(args, operands[0]);
    const rules = loadBpRules(config.hikyakuRoot);
    const markdown = flagBoolean(args, "markdown");

    emit(
      {
        source: rules.source === undefined ? null : relative(config.repoRoot, rules.source),
        levels: rules.levels,
        metrics: rules.metrics,
        additions: rules.additions,
        inputs: inputKeys(rules),
        bpMax: config.bpMax,
        markdown: renderRulesMarkdown(rules),
      },
      () => {
        const header = `基準表: ${sourceLabel(config, rules)}  bp_max: ${config.bpMax}`;
        if (markdown) return `${header}\n\n${renderRulesMarkdown(rules)}`;
        const last = rules.levels.length - 1;
        return [
          header,
          "",
          table(
            rules.metrics.map((m) => [
              m.label,
              `--${flagNameOf(m.key)} <n>`,
              `${m.upper.map((u, i) => `${rules.levels[i]}:≤${u}`).join(" ")} ${rules.levels[last]}:>${m.upper[last - 1]}`,
            ]),
            ["指標（ベースBP は最大値）", "入力", "BP:上限"],
          ),
          "",
          table(
            rules.additions.map((a) => [
              a.label,
              a.input !== a.key
                ? `--${flagNameOf(a.input)} の値`
                : a.kind === "flag"
                  ? `--${flagNameOf(a.key)}`
                  : `--${flagNameOf(a.key)} <n>`,
              describeAddition(a),
              a.examples ?? "",
            ]),
            ["加算要素", "入力", "加算", "例"],
          ),
        ].join("\n");
      },
    );
  },
});

register({
  name: "bp estimate",
  summary: "指標の値を基準表に当てて BP を算出する",
  usage:
    "hikyaku bp estimate [<cycle>] --new-files <n> --lines <n> [--<指標> <n>]... [--<加算要素>]... [--workspace <name>] [--markdown] [--json]",
  details: [
    "基準表（hikyaku bp guide）の指標と加算要素を --<キー> で渡すと、BP と内訳を返します。",
    "表への当てはめはこのコマンドが行うので、呼び出し元は値を見積もるだけです。",
    "",
    "  ベースBP  指定した指標それぞれの BP のうち最大値",
    "  加算BP    加算要素の合計。フラグ型は付ければ加算、段階型・単位型は値を渡す",
    "  BP        ベースBP + 加算BP。bp_max に対する判定も返す",
    "",
    "既定の基準表での例:",
    "  hikyaku bp estimate 002-billing --new-files 5 --lines 800 --impact-files 7 --setup",
    "",
    "見積もりだけでなく実績にも使います。振り返りでは bp actual が測った新規ファイル数と",
    "追加行数に、実装中に実際に発生した加算要素を添えて、同じ経路で実績 BP を出します。",
    "",
    "指標を省くとベースBPの候補に入りません。出力には「未指定」として残るので、",
    "考慮しなかった指標がレビューで見えます。基準表に無いフラグはエラーです",
    "（タイプミスで加算要素を落とすと、そのまま過小見積もりになるため）。",
    "",
    "複数ワークスペース（パッケージ）にまたがるビルドは、ワークスペースごとに実行して",
    "BP を合計してください。--workspace <name> は出力に名前を添えるだけです。",
    "",
    "--markdown は plan.md / issue.md / retrospective.md に貼る内訳表を Markdown で出します。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = configFor(args, operands[0]);
    const rules = loadBpRules(config.hikyakuRoot);
    const input = readBpInput(args, rules, new Set(["markdown", "workspace"]));

    if (!rules.metrics.some((m) => input[m.key] !== undefined)) {
      throw new HikyakuError(
        "指標が1つも指定されていません",
        `少なくとも1つの指標を渡してください: ${rules.metrics.map((m) => `--${flagNameOf(m.key)} <n>`).join("  ")}`,
      );
    }

    const breakdown = estimateBp(rules, input);
    const verdict = bpVerdict(breakdown.total, config.bpMax);
    const workspace = flagString(args, "workspace");

    emit(
      {
        bp: breakdown.total,
        baseBp: breakdown.baseBp,
        additionBp: breakdown.additionBp,
        verdict,
        bpMax: config.bpMax,
        workspace: workspace ?? null,
        metrics: breakdown.metrics,
        additions: breakdown.additions,
        input,
        source: rules.source === undefined ? null : relative(config.repoRoot, rules.source),
        markdown: renderBreakdownMarkdown(breakdown),
      },
      () => {
        const title = `${workspace === undefined ? "" : `[${workspace}] `}BP ${breakdown.total} = ベース ${breakdown.baseBp} + 加算 ${breakdown.additionBp}`;
        const lines = [title, `判定: ${describeVerdict(verdict, config.bpMax)}`, `基準表: ${sourceLabel(config, rules)}`, ""];
        lines.push(
          flagBoolean(args, "markdown")
            ? renderBreakdownMarkdown(breakdown)
            : table(renderBreakdownRows(breakdown), ["項目", "値", "BP"]),
        );
        return lines.join("\n");
      },
    );
  },
});

register({
  name: "bp render",
  summary: `${BP_GUIDE_DIR}/${BP_README_FILE} の基準表ブロックを ${BP_RULES_FILE} から再生成する`,
  usage: "hikyaku bp render [--root <path>] [--dry-run] [--json]",
  writes: true,
  details: [
    `${BP_README_FILE} のマーカーで囲んだ部分だけを書き換えます。外側の文章（BP の定義、`,
    "このリポジトリでの数え方の注意）は保持されます。",
    "",
    "  <!-- hikyaku:bp-guide:begin -->",
    "  ...生成される表...",
    "  <!-- hikyaku:bp-guide:end -->",
    "",
    `${BP_RULES_FILE} を編集したら実行してください。validate は README の表が古いことを検出します。`,
    `${BP_GUIDE_DIR}/ が無い場合はエラーです（生成先が無いため）。hikyaku init で作ってください。`,
  ].join("\n"),
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const rules = loadBpRules(config.hikyakuRoot);
    if (rules.source === undefined) {
      throw new HikyakuError(
        `${relative(config.repoRoot, bpGuideDir(config.hikyakuRoot))}/ がありません`,
        "hikyaku init --root <HIKYAKU_ROOT> を実行すると既定値で生成されます（既存ファイルは触りません）。",
      );
    }
    const target = bpReadmePath(config.hikyakuRoot);
    const before = existsSync(target) ? readFileSync(target, "utf8") : "";
    const { content, created } = upsertReadmeBlock(before, rules);
    const changed = content !== before;
    const dryRun = flagBoolean(args, "dry-run");
    const relPath = relative(config.repoRoot, target);

    emit({ file: relPath, changed, created, dryRun }, () => {
      if (!changed) return `${relPath} の基準表は最新です。変更はありません。`;
      const lines = [`${relPath}: 基準表ブロックを${created ? "追加" : "更新"}します`, "", renderRulesMarkdown(rules)];
      if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
      return lines.join("\n");
    });

    if (changed && !dryRun) writeFileSync(target, content, "utf8");
  },
});

register({
  name: "bp test",
  summary: `${BP_CASES_FILE} の期待値と基準表の算出結果を照合する`,
  usage: "hikyaku bp test [--builtin] [--root <path>] [--json]",
  details: [
    `${BP_GUIDE_DIR}/${BP_CASES_FILE} の全ケースについて、input を基準表に当てた BP が expect と`,
    "一致するかを確かめます。基準表を変えたときの回帰をここで止めます。",
    "",
    `${BP_GUIDE_DIR}/ が無ければ、Hikyaku 組み込みの既定ケースを既定値に対して実行します。`,
    "",
    "--builtin はワークスペースを見ず、組み込みの既定値と既定ケースだけを照合します。",
    "プラグイン自身の CI で、既定値の変更が既定ケースを壊していないかを確かめる用途です",
    "（.hikyaku.config が無い場所でも動きます）。",
    "",
    "1件でも一致しなければ終了コード 2 で終了します。validate からも呼ばれます。",
  ].join("\n"),
  run: ({ args }) => {
    const builtin = flagBoolean(args, "builtin");
    const config = loadConfig({ root: flagString(args, "root"), allowMissingRoot: builtin });
    const useBuiltin = builtin || config.hikyakuRoot === "";
    const rules = useBuiltin ? DEFAULT_BP_RULES : loadBpRules(config.hikyakuRoot);
    const { cases, source } = useBuiltin
      ? { cases: DEFAULT_BP_CASES, source: undefined }
      : loadBpCases(config.hikyakuRoot);
    const where = source === undefined ? "既定ケース" : relative(config.repoRoot, source);
    const results = runBpCases(rules, cases, where);
    const failed = results.filter((r) => !r.ok);

    emit(
      {
        ok: failed.length === 0,
        builtin: useBuiltin,
        rules: rules.source === undefined ? null : relative(config.repoRoot, rules.source),
        cases: source === undefined ? null : relative(config.repoRoot, source),
        results: results.map((r) => ({ name: r.name, expect: r.expect, actual: r.actual, ok: r.ok })),
      },
      () => {
        const lines = [
          `基準表: ${useBuiltin ? "組み込みの既定値（--builtin）" : sourceLabel(config, rules)}`,
          `ケース: ${where}`,
          "",
        ];
        for (const r of results) {
          const mark = r.ok ? "✓" : "✗";
          const detail = r.ok ? `${r.actual}` : `期待 ${r.expect} / 算出 ${r.actual}`;
          lines.push(`${mark} ${r.name}  ${detail}${r.description ? `  — ${r.description}` : ""}`);
        }
        lines.push(
          "",
          failed.length === 0 ? `${results.length} 件すべて一致しました。` : `${failed.length} / ${results.length} 件が一致しません。`,
        );
        return lines.join("\n");
      },
    );

    if (failed.length > 0) {
      throw new ValidationError(failed.map((r) => `${r.name}: 期待 ${r.expect} / 算出 ${r.actual}`));
    }
  },
});

function readGroupBy(args: ParsedArgs): GroupKey | undefined {
  const raw = flagString(args, "group-by");
  if (raw === undefined) return undefined;
  if (!(GROUP_KEYS as string[]).includes(raw)) {
    throw new HikyakuError(`--group-by は ${GROUP_KEYS.join(" | ")} のいずれかで指定してください（現在: ${raw}）`);
  }
  return raw as GroupKey;
}

/** 312400 → 312k。表の幅を抑えるため。正確な値は --json で見る */
function kiloTokens(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value / 1000)}k`;
}

register({
  name: "bp history",
  summary: "各ビルドの retrospective.md から BP の見積もり・実績とセッションの実測を集める",
  usage: "hikyaku bp history [<cycle>] [--group-by model|hikyaku|host] [--root <path>] [--json]",
  details: [
    "全サイクル（引数があればそのサイクル）の build-NN/retrospective.md から",
    "「BP見積もりの振り返り」を読み、見積もり（architect / builder 段階）・実績・",
    "セッションの完結状況・内訳の実測値と、セッションの実測（bp session の表）を並べます。",
    "",
    "基準表を調整するかどうかの素材です。入力値（新規ファイル数・実装行数）は",
    "合っていたのに実績 BP が大きい、あるいは1セッションに収まらなかったビルドが",
    "続くなら基準表の問題、入力値そのものが外れているなら数え方の問題です。",
    "",
    "セッションの実測は、BP がコンテキストの消費量を当てられているかを見る素材です。",
    "ピーク・開始時の固定分・呼び出し回数・コンパクション・モデル・Hikyaku の版を並べます。",
    "",
    "--group-by はモデル・Hikyaku の版・ホストごとに分けて並べ、各群の件数、実績 BP と",
    "ピークの平均、ピークの範囲、実績 1BP あたりのピークを添えます。モデルの世代や",
    "ホストが変わるとピークの出方が変わるので、混ぜたまま比べないためです。",
    "",
    "読めない項目は「—」で出します。推測で埋めません。セッションの実測表が無い",
    "（この項目を足す前の）retrospective.md も「—」で読みます。乖離の要因（文章）は",
    "ここでは読まないので、該当する retrospective.md を直接読んでください。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const groupBy = readGroupBy(args);
    const all = loadCycles(config.hikyakuRoot);
    const filter = operands[0];
    const cycles =
      filter === undefined
        ? all
        : all.filter((r) => filter === r.id || filter === r.slug || filter === cycleDirName(r));
    if (filter !== undefined && cycles.length === 0) {
      throw new HikyakuError(`サイクルが見つかりません: ${filter}`, "hikyaku cycle list で一覧を確認してください。");
    }

    const rules = loadBpRules(config.hikyakuRoot);
    const measuredLabels = Object.values(MEASURED_METRIC_KEYS)
      .map((key) => rules.metrics.find((m) => m.key === key)?.label)
      .filter((label): label is string => label !== undefined);

    const records = collectBpRecords(config.hikyakuRoot, cycles);
    const rowOf = (r: BpRecord) => {
      const deviation = r.actual !== undefined && r.builder !== undefined ? r.actual - r.builder : undefined;
      const inputs = measuredLabels.map((label) => ({
        label,
        estimated: numericValue(r.estimated[label]),
        measured: numericValue(r.measured[label]),
      }));
      return { ...r, deviation, inputs };
    };
    const rows = records.map(rowOf);
    const groups =
      groupBy === undefined
        ? undefined
        : groupRecords(records, groupBy).map((g) => ({ ...summarizeGroup(g.key, g.records), records: g.records.map(rowOf) }));

    emit({ records: rows, groupBy: groupBy ?? null, groups: groups ?? null }, () => {
      if (rows.length === 0) return "BP見積もりの振り返りを持つ retrospective.md はまだありません。";
      const fmt = (n: number | undefined): string => (n === undefined ? "—" : String(n));
      const signed = (n: number | undefined): string => (n === undefined ? "—" : n > 0 ? `+${n}` : String(n));
      const render = (subset: typeof rows): string =>
        table(
          subset.map((r) => [
            r.cycle,
            r.build,
            fmt(r.architect),
            fmt(r.builder),
            fmt(r.actual),
            signed(r.deviation),
            ...r.inputs.map((i) => `${fmt(i.estimated)} → ${fmt(i.measured)}`),
            kiloTokens(r.context.peak),
            kiloTokens(r.context.first),
            fmt(r.context.calls),
            fmt(r.context.compactions),
            r.context.model ?? "—",
            r.context.hikyaku ?? "—",
            r.context.host ?? "—",
            r.session ?? "—",
          ]),
          [
            "cycle",
            "build",
            "architect",
            "builder",
            "実績",
            "乖離",
            ...measuredLabels.map((l) => `${l}（見積→実測）`),
            "ピーク",
            "固定分",
            "呼び出し",
            "コンパクション",
            "モデル",
            "Hikyaku",
            "ホスト",
            "セッション",
          ],
        );

      const lines: string[] = [];
      if (groups === undefined) {
        lines.push(render(rows));
      } else {
        for (const group of groups) {
          const avg = (n: number | undefined, digits = 1): string => (n === undefined ? "—" : n.toFixed(digits));
          lines.push(
            `■ ${groupBy}: ${group.key}（${group.count} 件）`,
            `  実績 BP 平均 ${avg(group.meanActual)} / ピーク平均 ${kiloTokens(group.meanPeak)}（${kiloTokens(group.minPeak)}〜${kiloTokens(group.maxPeak)}）/ 実績 1BP あたりのピーク ${kiloTokens(group.peakPerBp)}（${group.paired} 件）`,
            render(group.records),
            "",
          );
        }
      }
      const known = rows.filter((r) => r.deviation !== undefined);
      if (known.length > 0) {
        const meanDeviation = known.reduce((sum, r) => sum + (r.deviation as number), 0) / known.length;
        const under = known.filter((r) => (r.deviation as number) > 0).length;
        lines.push("", `乖離の平均 ${meanDeviation >= 0 ? "+" : ""}${meanDeviation.toFixed(1)}（${known.length} 件、過小見積もり ${under} 件）`);
      }
      lines.push("", "乖離の要因は各 retrospective.md の「乖離の要因」を読んでください。");
      return lines.join("\n");
    });
  },
});

register({
  name: "bp actual",
  summary: "PR の base からの差分を数え、BP 実績の指標を返す",
  usage: "hikyaku bp actual <phase> [<cycle>] [--base <ref>] [--no-fetch] [--root <path>] [--json]",
  details: [
    "振り返りで、見積もった BP と実績を突き合わせるために使います。返すのは実測値",
    "だけで、BP の値そのものは返しません。差分から機械的に数えられるのは新規ファイル数と",
    "追加行数だけで、API 操作数や影響ファイル数、加算要素の該当は実装したセッションが",
    "申告するしかないためです。",
    "",
    "  newFiles             新規追加されたファイル数（生成物を除く）  → bp estimate の --new-files",
    "  changedFiles         差分に現れたファイル数（生成物を除く。リネームは1件）",
    "  addedLines           追加行数（生成物を除く。実装 + テスト）   → bp estimate の --lines",
    "  deletedLines         削除行数（生成物を除く）",
    "  binaryFiles          行数を数えられないファイル数（addedLines には含まれません）",
    "  implementationLines  addedLines のうち実装の行数",
    "  testLines            addedLines のうちテストの行数",
    "  generatedFiles       数えなかった生成物のファイル数（generatedPaths に一覧）",
    "",
    "生成物（ロックファイル・スナップショット・生成コード）は書いた量ではないので数えません。",
    "どれを生成物とし、どれをテストとするかは [bp_actual] の exclude / tests（パスの glob）で",
    "決まり、既定値は hikyaku config --json の bpActual で確認できます。設定すると既定値を",
    "置き換えます。テストを分けて返すのは、既定の基準表の「実装行数（テスト含む）」とは別に、",
    "実装とテストの比率を振り返りの素材に残すためです（--lines に渡すのは従来どおり合計）。",
    "",
    "実績 BP は、この実測値に申告する値を添えて bp estimate に渡して求めます。",
    "見積もりと同じ経路を通るので比較が成立します。",
    "",
    "比較の起点は pr base と同じ導出です（スタックしていればスタック元）。",
    "PR に含まれる差分と、ここで測る差分を一致させるためで、基準がずれると",
    "先行ビルドの差分まで数えることになります。--base で明示もできます。",
    "",
    "起点は base の先端ではなく merge-base です。base 側が先に進んでいても、",
    "このブランチが加えた分だけを数えます。",
    "",
    "**ワークスペース（hikyaku_root）配下は数えません。** plan.md や handoff.md が",
    "実装行数に混ざると、見積もりの指標（実装コードの規模）と比較できなくなります。",
    "",
    "未コミットの変更は数えません。振り返りは成果物をコミットしたあとに走るため、",
    "作業ツリーを見ると「まだコミットしていない分だけ少ない」状態を測ってしまいます。",
    "",
    "base の ref を解決できない場合（Hikyaku の規則外のブランチで作業した等）は",
    "エラーになります。**推測値は返しません。** 実測できなかったことを、実測できた",
    "ことのように記録させないためです。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    const scope = scopeFor(args, phase, operands[1]);
    const { config, cycle } = scope;

    const override = flagString(args, "base");
    const resolved =
      override === undefined
        ? await resolvePrBase(scope, phase, { fetch: !flagBoolean(args, "no-fetch") })
        : undefined;
    const baseRef = override ?? resolved?.ref;

    if (baseRef === undefined) {
      throw new HikyakuError(
        `比較の起点を解決できません: ${resolved?.base ?? "?"}`,
        "git fetch でブランチを取得するか、--base <ref> で明示してください。",
      );
    }

    // hikyaku_root は絶対パスで解決済み。pathspec はリポジトリルートからの相対で渡す
    const excluded = relative(config.repoRoot, config.hikyakuRoot);
    const stats = await diffStats(config.repoRoot, baseRef, excluded === "" ? [] : [excluded]);

    if (stats === undefined) {
      throw new HikyakuError(
        `${baseRef} と HEAD の共通の祖先を見つけられません`,
        "履歴が浅い clone では git fetch --deepen が要ることがあります。",
      );
    }

    const counted = summarizeDiff(stats.files, config.bpActual);
    const estimateArgs = `--${flagNameOf(MEASURED_METRIC_KEYS.newFiles)} ${counted.newFiles} --${flagNameOf(MEASURED_METRIC_KEYS.lines)} ${counted.addedLines}`;

    emit(
      {
        mergeBase: stats.mergeBase,
        ...counted,
        estimateArgs,
        baseRef,
        base: resolved?.base ?? null,
        stackedOn: resolved?.stacked?.name ?? null,
        excluded: excluded === "" ? null : excluded,
        patterns: config.bpActual,
        phase,
        cycle,
      },
      () => {
        const lines = [
          `起点         ${baseRef}（merge-base ${stats.mergeBase.slice(0, 7)}）`,
          `除外         ${excluded === "" ? "(なし)" : excluded}`,
          "",
          `新規ファイル数  ${counted.newFiles}（実装 ${counted.implementationNewFiles} / テスト ${counted.testNewFiles}）`,
          `変更ファイル数  ${counted.changedFiles}（実装 ${counted.implementationFiles} / テスト ${counted.testFiles}）`,
          `追加行数        ${counted.addedLines}（実装 ${counted.implementationLines} / テスト ${counted.testLines}）`,
          `削除行数        ${counted.deletedLines}`,
        ];
        if (counted.binaryFiles > 0) {
          lines.push(`バイナリ        ${counted.binaryFiles}（行数は数えていません）`);
        }
        if (counted.generatedFiles > 0) {
          lines.push(
            `生成物          ${counted.generatedFiles} ファイル・${counted.generatedLines} 行（数えていません）`,
            ...counted.generatedPaths.map((path) => `  ${path}`),
          );
        }
        if (resolved?.stacked !== undefined) {
          lines.push("", `（${resolved.stacked.name} に積んでいます。この分だけを数えました）`);
        }
        lines.push(
          "",
          "実績 BP は、実装中に実際に発生した加算要素を添えて bp estimate で求めます:",
          `  hikyaku bp estimate ${cycle ?? ""} ${estimateArgs} [--<加算要素>]... --markdown`,
        );
        return lines.join("\n");
      },
    );
  },
});

function readHost(args: ParsedArgs): SessionHost | undefined {
  const raw = flagString(args, "host");
  if (raw === undefined) return undefined;
  if (raw === "claude" || raw === "claude-code") return "claude-code";
  if (raw === "codex") return "codex";
  throw new HikyakuError(`--host は claude か codex で指定してください（現在: ${raw}）`);
}

function sessionJson(measure: SessionMeasure): Record<string, unknown> {
  return {
    host: measure.host,
    hostVersion: measure.hostVersion ?? null,
    client: measure.client ?? null,
    path: measure.path,
    sessionId: measure.sessionId ?? null,
    kind: measure.kind,
    model: measure.model ?? null,
    models: measure.models,
    peak: measure.peak,
    first: measure.first,
    latest: measure.latest,
    calls: measure.calls,
    outputTokens: measure.outputTokens,
    compactions: measure.compactions,
    window: measure.window ?? null,
    callsByBranch: measure.callsByBranch,
    startedAt: measure.startedAt ?? null,
    endedAt: measure.endedAt ?? null,
  };
}

interface SessionResult {
  mode: "current" | "branch" | "transcript";
  branch: string | undefined;
  measure: SessionMeasure | undefined;
  reason: string | undefined;
  /** 本体をどう選んだか */
  selection: string | undefined;
  note: string | undefined;
  candidates: Candidate[];
  excluded: SessionMeasure[];
  /** 測ったのが現在のセッションか（Hikyaku の版を添えられるのはこのときだけ） */
  isCurrent: boolean;
}

async function measureSession(args: ParsedArgs, operands: string[]): Promise<SessionResult> {
  const env = process.env;
  const host = readHost(args);
  const transcript = flagString(args, "transcript");

  if (transcript !== undefined) {
    const base: SessionResult = {
      mode: "transcript", branch: undefined, measure: undefined, reason: undefined, selection: "--transcript で指定",
      note: undefined, candidates: [], excluded: [], isCurrent: false,
    };
    if (!existsSync(transcript)) return { ...base, reason: `ファイルがありません: ${transcript}` };
    const measure = readMeasure(transcript, host);
    if (measure === undefined) {
      return { ...base, reason: `API 呼び出しの記録を読み取れません: ${transcript}` };
    }
    const lookups = lookupCurrent(env, host);
    const isCurrent = lookups.some((lookup) => lookup.path !== undefined && resolve(lookup.path) === resolve(transcript));
    return { ...base, measure, note: "指定したファイル", isCurrent };
  }

  const lookups = lookupCurrent(env, host);
  const current = pickCurrent(lookups);
  const currentMeasure = current?.path === undefined ? undefined : readMeasure(current.path, current.host);

  if (operands[0] === undefined) {
    if (current === undefined) {
      return {
        mode: "current", branch: undefined, measure: undefined, reason: describeMissingCurrent(env, lookups),
        selection: undefined, note: undefined, candidates: [], excluded: [], isCurrent: true,
      };
    }
    return {
      mode: "current", branch: undefined, measure: currentMeasure,
      reason: currentMeasure === undefined ? `API 呼び出しの記録がまだありません: ${current.path}` : undefined,
      selection: `${current.variable} で特定した現在のセッション`, note: "現在のセッション",
      candidates: [], excluded: [], isCurrent: true,
    };
  }

  const phase = requirePhase(operands[0]);
  const { config, cycle } = scopeFor(args, phase, operands[1]);
  const branch = branchName(config.branch, phase, cycle);
  const mainRoot = (await mainWorktreeRoot(config.repoRoot)) ?? config.repoRoot;
  const roots = [...new Set([mainRoot, config.repoRoot, ...(await worktreePaths(config.repoRoot))])];
  const found = collectBranchSessions(env, { roots, originUrl: await originUrl(config.repoRoot) }, branch, host);

  const candidates: Candidate[] = found.measures.map((measure) => ({
    measure,
    branchCalls: measure.callsByBranch[branch] ?? 0,
    current: currentMeasure !== undefined && resolve(measure.path) === resolve(currentMeasure.path),
  }));
  // Codex はセッション開始時のブランチしか記録しない。ビルドのブランチをセッションの中で
  // 作った場合でも、いまそのブランチにいる現在のセッションは候補に入れる
  if (
    currentMeasure !== undefined &&
    currentMeasure.kind === "main" &&
    !candidates.some((c) => c.current) &&
    currentBranch(config.repoRoot) === branch
  ) {
    candidates.push({ measure: currentMeasure, branchCalls: currentMeasure.callsByBranch[branch] ?? currentMeasure.calls, current: true });
  }

  const selected = selectMain(candidates);
  if (selected === undefined) {
    const hints = [`ブランチ ${branch} のセッションが見つかりません`];
    if (lookups.length > 0 && current === undefined) hints.push(describeMissingCurrent(env, lookups));
    return {
      mode: "branch", branch, measure: undefined, reason: hints.join("。"), selection: SELECTION_RULE,
      note: undefined, candidates, excluded: found.excluded, isCurrent: false,
    };
  }
  const others = candidates.length - 1;
  return {
    mode: "branch", branch, measure: selected.measure, reason: undefined, selection: SELECTION_RULE,
    note: `${selected.current ? "現在のセッション。" : ""}本体${others > 0 ? `。ほか ${others} 件` : ""}`,
    candidates, excluded: found.excluded, isCurrent: selected.current,
  };
}

register({
  name: "bp session",
  summary: "セッションのコンテキストのピークを、ホストの記録から実測する",
  usage: "hikyaku bp session [<phase> [<cycle>]] [--transcript <path>] [--host claude|codex] [--markdown] [--json]",
  details: [
    "BP の妥当性を確かめるための目的変数（メインセッションのコンテキストの実測）を返します。",
    "見積もりの算出には使いません。",
    "",
    "  peak         API 呼び出しごとのコンテキストの最大値",
    "  first        最初の呼び出しのコンテキスト（開始時の固定分）",
    "  latest       最後の呼び出しのコンテキスト",
    "  calls        API 呼び出し回数",
    "  outputTokens 出力トークンの合計",
    "  compactions  コンパクションの回数",
    "  window       コンテキストウィンドウ（Codex のみ。Claude Code は記録しないので null）",
    "  model / host / hostVersion",
    "",
    "引数なしでは現在のセッションを測ります。Claude Code は CLAUDE_CODE_SESSION_ID、",
    "Codex は CODEX_THREAD_ID でトランスクリプト（rollout）を特定します。",
    "",
    "<phase> [<cycle>] を渡すと、そのフェーズのブランチに対応付くセッションを集めて",
    "本体を選びます（過去のビルドの集計や、PR レビュー対応で別のセッションから測るとき）。",
    "1ビルドには、レビュー用の別プロセスや中断後の再開など複数のセッションがあるので、",
    `「${SELECTION_RULE}」という規則で選び、`,
    "どれを採ったかと他の候補を出力に出します。現在のセッションがそのブランチにいれば候補に入ります。",
    "",
    "  Claude Code  各行の gitBranch で対応付けます。サブエージェントは数えません",
    "  Codex        session_meta の git.branch（開始時のブランチ）で対応付けます。",
    "               サブエージェントと guardian（codex-auto-review）は対象外です",
    "",
    "記録の場所は CLAUDE_CONFIG_DIR（既定 ~/.claude）と CODEX_HOME（既定 ~/.codex）から引きます。",
    "--transcript で記録のファイルを直接指定できます（形式は中身から判定し、--host で固定できます）。",
    "",
    "**読めない・見つからないときは推測せず「計測不可」とその理由を返します**（終了コードは 0）。",
    "Codex のクラウドでは rollout が保存されないため計測できません。",
    "",
    "--markdown は retrospective.md の「セッションの実測」に貼る表を出します。",
    "Hikyaku の版は、測ったのが現在のセッションのときだけ埋めます（過去のセッションの版は分からないため）。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const result = await measureSession(args, operands);
    const hikyakuVersion = result.isCurrent ? pluginVersion() : undefined;
    const markdown = renderSessionMarkdown({
      measure: result.measure,
      reason: result.reason,
      hikyakuVersion,
      note: result.note,
    });

    emit(
      {
        measured: result.measure !== undefined,
        reason: result.reason ?? null,
        mode: result.mode,
        branch: result.branch ?? null,
        selection: result.selection ?? null,
        session: result.measure === undefined ? null : sessionJson(result.measure),
        candidates: result.candidates.map((c) => ({
          path: c.measure.path,
          sessionId: c.measure.sessionId ?? null,
          host: c.measure.host,
          branchCalls: c.branchCalls,
          calls: c.measure.calls,
          peak: c.measure.peak,
          current: c.current,
          selected: c.measure === result.measure,
        })),
        excluded: result.excluded.map((m) => ({ path: m.path, sessionId: m.sessionId ?? null, kind: m.kind })),
        hikyakuVersion: hikyakuVersion ?? null,
        markdown,
      },
      () => {
        if (flagBoolean(args, "markdown")) return markdown;
        const lines: string[] = [];
        if (result.branch !== undefined) lines.push(`ブランチ     ${result.branch}`);
        if (result.measure === undefined) {
          lines.push(`計測不可: ${result.reason ?? "理由不明"}`);
          return lines.join("\n");
        }
        const m = result.measure;
        lines.push(
          `セッション   ${m.path}`,
          `選び方       ${result.selection ?? "—"}`,
          "",
          `ピーク          ${formatTokens(m.peak)}`,
          `開始時の固定分  ${formatTokens(m.first)}`,
          `最新            ${formatTokens(m.latest)}`,
          `呼び出し回数    ${m.calls}`,
          `出力トークン    ${formatTokens(m.outputTokens)}`,
          `コンパクション  ${m.compactions}`,
          `ウィンドウ      ${m.window === undefined ? "—（記録なし）" : formatTokens(m.window)}`,
          `モデル          ${m.models.length > 1 ? `${m.model}（ほか ${m.models.filter((x) => x !== m.model).join(", ")}）` : (m.model ?? "—")}`,
          `ホスト          ${hostLabel(m)}${m.client === undefined ? "" : `（${m.client}）`}`,
          `Hikyaku         ${hikyakuVersion ?? "—（現在のセッションではないため不明）"}`,
        );
        if (result.candidates.length > 1) {
          lines.push(
            "",
            table(
              result.candidates.map((c) => [
                c.measure === m ? "✓" : "",
                (c.measure.sessionId ?? basename(c.measure.path)).slice(0, 8),
                HOST_LABELS[c.measure.host],
                String(c.branchCalls),
                String(c.measure.calls),
                formatTokens(c.measure.peak),
                c.current ? "現在" : "",
              ]),
              ["本体", "セッション", "ホスト", "ブランチでの呼び出し", "総呼び出し", "ピーク", ""],
            ),
          );
        }
        if (result.excluded.length > 0) {
          lines.push("", `対象外: ${result.excluded.map((e) => `${(e.sessionId ?? basename(e.path)).slice(0, 8)}（${e.kind}）`).join(", ")}`);
        }
        return lines.join("\n");
      },
    );
  },
});
