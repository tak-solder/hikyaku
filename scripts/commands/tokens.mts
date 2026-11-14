/**
 * tokens guide / stamp / estimate / history / session — 予測ピーク（メインセッションのコンテキストの
 * ピーク）の見積もり・実測・振り返り（#68）。
 *
 * 予測は LLM がガイドに沿って成分ごとに出す。ここでは合計・帯との比較・記録の形式だけを
 * 決定的に行う。実測はホストの記録（トランスクリプト・rollout）から読み、推測で埋めない。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { flagBoolean, flagString, type ParsedArgs } from "../lib/args.mts";
import { branchName } from "../lib/branch.mts";
import { assertCurrentConfig, loadConfig, type ResolvedConfig } from "../lib/config.mts";
import { cycleDirName, loadCycles } from "../lib/cycles.mts";
import { renderDiffMarkdown, summarizeDiff } from "../lib/diff-stats.mts";
import { HikyakuError } from "../lib/errors.mts";
import { currentBranch, diffStats, mainWorktreeRoot, originUrl, worktreePaths } from "../lib/git.mts";
import { emit, table } from "../lib/output.mts";
import { pluginVersion } from "../lib/paths.mts";
import { readProgress } from "../lib/progress.mts";
import { register } from "../lib/registry.mts";
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
import { requirePhase, resolvePrBase, scopeFor } from "../lib/stack.mts";
import { buildDirName, normalizeBuildId } from "../lib/tasklist.mts";
import { checkpointsOf } from "../lib/steps/checkpoints.mts";
import {
  COMPONENTS,
  type ComponentKey,
  describePeakVerdict,
  formatK,
  guideHeaderProblems,
  guideLabel,
  loadTokenGuide,
  parseTokenAmount,
  peakVerdict,
  planStamp,
  projectGuidePath,
  renderEstimateMarkdown,
  STANDARD_GUIDE,
  sumComponents,
  TOKEN_GUIDE_DIR,
  TOKEN_GUIDE_FILE,
} from "../lib/tokens.mts";
import {
  collectPeakRecords,
  guideReview,
  deviationOf,
  GROUP_KEYS,
  type GroupKey,
  groupRecords,
  type PeakRecord,
  ratioOf,
  summarizeGroup,
} from "../lib/tokens-history.mts";
import { openCycleIfAny } from "../lib/workspace.mts";

/** どのコマンドでも受け付けるオプション */
const COMMON_FLAGS = new Set(["json", "root", "profile", "help", "version", "dry-run"]);

/** サイクルが決まればそのサイクルの設定から。無ければルート設定 */
function configFor(args: ParsedArgs, operand: string | undefined): ResolvedConfig {
  const opened = openCycleIfAny(args, operand);
  return opened ? opened.config : loadConfig({ root: flagString(args, "root"), profileOverride: flagString(args, "profile") });
}

function guideSource(config: ResolvedConfig, kind: "project" | "standard", path: string): string {
  return kind === "project" ? relative(config.repoRoot, path) : `${STANDARD_GUIDE}、Hikyaku ${pluginVersion()}`;
}

register({
  name: "tokens guide",
  summary: "予測ピークの見積もりに使うガイド（プロジェクトか標準か）と、その版を示す",
  usage: "hikyaku tokens guide [<cycle>] [--root <path>] [--json]",
  details: [
    `{HIKYAKU_ROOT}/${TOKEN_GUIDE_DIR}/${TOKEN_GUIDE_FILE} があればそれが、無ければプラグインの標準のガイドが有効です。`,
    "プロジェクトのガイドは標準を置き換えます（足し合わせません）。見積もりの前に、ここで示したパスを読んでください。",
    "サイクルを省略した設定参照は、ブランチか栞で選択済みならそのサイクル、未選択ならルートです。",
    "サイクルを省略して --profile を指定すると、既存のサイクルを参照せずルート設定に当てます。",
    "",
    "ガイドは先頭に version（版）と hash（本文のハッシュ）を持ちます。本文を変えたら",
    "hikyaku tokens stamp で版を上げてください。hash が本文と合わなければ、ここと validate が知らせます。",
    "",
    "プロジェクトのガイドは close-cycle（昇格の承認後）か /hikyaku:token-guide が作ります。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = configFor(args, operands[0]);
    const guide = loadTokenGuide(config.hikyakuRoot);
    const problems = guide.kind === "project" ? guideHeaderProblems(guide) : [];
    emit(
      {
        kind: guide.kind,
        path: guide.path,
        label: guideLabel(guide),
        version: guide.version ?? null,
        basedOn: guide.basedOn ?? null,
        hash: guide.actualHash,
        problems,
        bands: config.peakBands,
      },
      () =>
        [
          `ガイド    ${guideLabel(guide)}（${guideSource(config, guide.kind, guide.path)}）`,
          `パス      ${guide.path}`,
          `ハッシュ  ${guide.actualHash}`,
          ...(guide.basedOn === undefined ? [] : [`元        ${guide.basedOn}`]),
          `判定の帯  統合を検討 < ${formatK(config.peakBands.mergeBelow)} ≦ 狙い ≦ ${formatK(config.peakBands.splitAbove)} < 分割を検討`,
          ...problems.map((p) => `問題      ${p}`),
        ].join("\n"),
    );
  },
});

register({
  name: "tokens stamp",
  summary: `${TOKEN_GUIDE_DIR}/${TOKEN_GUIDE_FILE} の版を上げる（無ければ標準のガイドから作る）`,
  usage: "hikyaku tokens stamp [--root <path>] [--dry-run] [--json]",
  writes: true,
  details: [
    `{HIKYAKU_ROOT}/${TOKEN_GUIDE_DIR}/${TOKEN_GUIDE_FILE} の先頭の version と hash を整えます。`,
    "",
    "  無いとき          標準のガイドの本文をコピーし、version 1・based_on（元にした標準の版）を付けて作る",
    "  本文を変えたとき  version を1つ上げ、hash を本文に合わせる",
    "  変えていないとき  何もしない",
    "",
    "予測の記録（tokens estimate の表）にはガイドの版とハッシュが残ります。ガイドを補正した前と後の",
    "予測を混ぜて比べないためです（tokens history --group-by guide）。",
  ].join("\n"),
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const plan = planStamp(config.hikyakuRoot);
    const target = projectGuidePath(config.hikyakuRoot);
    const relPath = relative(config.repoRoot, target);
    const dryRun = flagBoolean(args, "dry-run");
    const changed = plan.content !== undefined;
    emit(
      { file: relPath, changed, created: plan.created, version: plan.version, previous: plan.previous ?? null, basedOn: plan.basedOn ?? null, hash: plan.hash, dryRun },
      () => {
        if (!changed) return `${relPath} は v${plan.version} のまま変更はありません（本文は hash と一致しています）。`;
        const lines = [
          plan.created
            ? `${relPath} を ${plan.basedOn} から作ります（v1）`
            : plan.previous === plan.version
              ? `${relPath} の版の宣言を整えます（v${plan.version}）`
              : `${relPath} の版を上げます（v${plan.previous ?? "?"} → v${plan.version}）`,
          `hash: ${plan.hash}`,
        ];
        if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
        return lines.join("\n");
      },
    );
    if (changed && !dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, plan.content as string, "utf8");
    }
  },
});

const ESTIMATE_FLAGS = new Set([
  "markdown",
  "no-cycle",
  ...COMPONENTS.map((c) => c.key),
  ...COMPONENTS.map((c) => `${c.key}-basis`),
]);

function readComponentTokens(args: ParsedArgs, key: ComponentKey): number {
  const raw = args.flags.get(key);
  const usage = `--${key} <トークン数>（120000・120k・0 など）`;
  if (raw === undefined) {
    throw new HikyakuError(
      `--${key}（${COMPONENTS.find((c) => c.key === key)?.label}）がありません`,
      [
        "5つの成分はすべて渡してください。該当しないなら 0 を渡します。",
        "未指定と 0 は違います（未指定は「考えなかった」、0 は「考えて無いと判断した」）。",
        `使い方: ${COMPONENTS.map((c) => `--${c.key} <n>`).join(" ")}`,
      ].join("\n"),
    );
  }
  if (typeof raw === "boolean") throw new HikyakuError(`--${key} には値が必要です`, usage);
  const tokens = parseTokenAmount(raw);
  if (tokens === undefined) throw new HikyakuError(`--${key} をトークン数として読めません（現在: ${raw}）`, usage);
  return tokens;
}

register({
  name: "tokens estimate",
  summary: "成分ごとの予測を合計し、予測ピークと判定を返す",
  usage:
    "hikyaku tokens estimate [<cycle> | --no-cycle] --fixed <n> --reading <n> --implementation <n> --tests <n> --unknown <n> [--<成分>-basis <根拠>]... [--markdown] [--json]",
  details: [
    "ビルドのメインセッションのコンテキストが、どこまで膨らむか（予測ピーク）を返します。",
    "成分の値はガイド（hikyaku tokens guide）に沿って見積もり、このコマンドは合計と判定だけを行います。",
    "",
    ...COMPONENTS.map((c) => `  --${c.key.padEnd(15)} ${c.label}: ${c.description}`),
    "",
    "値は整数（120000・120,000）か、k / m の単位（120k・1.2m）で渡します。5つすべてが必須で、",
    "該当しない成分は 0 を渡します。--<成分>-basis で根拠を添えると、表の「根拠」列に入ります。",
    "",
    "判定は [context] の帯で決まります（hikyaku config --json の peakBands）。",
    "  merge_below 未満     統合を検討（推奨のみ）",
    "  merge_below〜split_above  狙いの帯",
    "  split_above 超       分割を検討（原則として分割する）",
    "",
    "--markdown は issue.md / plan.md に貼る内訳表を出します。表の最後の行に、見積もりに使った",
    "ガイドの版とハッシュが入ります（tokens history が読みます）。",
  ].join("\n"),
  run: ({ args, operands }) => {
    for (const flag of args.flags.keys()) {
      if (COMMON_FLAGS.has(flag) || ESTIMATE_FLAGS.has(flag)) continue;
      throw new HikyakuError(
        `--${flag} は使えません`,
        `使える入力: ${COMPONENTS.map((c) => `--${c.key} <n> [--${c.key}-basis <根拠>]`).join("  ")}`,
      );
    }
    const config = configFor(args, operands[0]);
    assertCurrentConfig(config);
    const guide = loadTokenGuide(config.hikyakuRoot);
    const values = Object.fromEntries(
      COMPONENTS.map((c) => [c.key, { tokens: readComponentTokens(args, c.key), basis: flagString(args, `${c.key}-basis`) }]),
    ) as Record<ComponentKey, { tokens: number; basis?: string }>;
    const estimate = sumComponents(values);
    const verdict = peakVerdict(estimate.total, config.peakBands);
    const markdown = renderEstimateMarkdown(estimate, verdict, config.peakBands, guide);
    // 版の宣言が本文と合わないガイドで見積もると、補正後の本文が古い版の名前で記録され、
    // tokens history --group-by guide で補正の前と後を分けられなくなる。先に tokens stamp させる
    const problems = guide.kind === "project" ? guideHeaderProblems(guide) : [];
    if (problems.length > 0) {
      throw new HikyakuError(
        `ガイド（${relative(config.repoRoot, guide.path)}）の版の宣言が本文と合いません: ${problems.join(" / ")}`,
        "hikyaku tokens stamp で版を整えてから見積もってください。",
      );
    }

    emit(
      {
        peak: estimate.total,
        verdict,
        bands: config.peakBands,
        components: estimate.components,
        guide: { kind: guide.kind, label: guideLabel(guide), version: guide.version ?? null, hash: guide.actualHash, path: guide.path },
        markdown,
      },
      () => {
        const lines = [
          `予測ピーク ${formatK(estimate.total)}`,
          `判定: ${describePeakVerdict(verdict, config.peakBands)}`,
          `ガイド: ${guideLabel(guide)}（${guide.actualHash}）`,
          "",
        ];
        lines.push(
          flagBoolean(args, "markdown")
            ? markdown
            : table(
                estimate.components.map((c) => [c.label, formatK(c.tokens), c.basis === "" ? "—" : c.basis]),
                ["成分", "予測", "根拠"],
              ),
        );
        return lines.join("\n");
      },
    );
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

function signedK(value: number | undefined): string {
  if (value === undefined) return "—";
  return value > 0 ? `+${formatK(value)}` : value < 0 ? `-${formatK(-value)}` : "0";
}

function ratio(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(2);
}

function count(value: number | undefined): string {
  return value === undefined ? "—" : String(value);
}

function renderRecords(records: PeakRecord[]): string {
  return table(
    records.map((r) => [
      r.cycle,
      r.build,
      formatK(r.architect),
      formatK(r.builder),
      formatK(r.context.peak),
      signedK(deviationOf(r)),
      ratio(ratioOf(r)),
      formatK(r.context.first),
      formatK(r.checkpoints.approval),
      formatK(r.checkpoints.implement),
      formatK(r.checkpoints.review),
      count(r.context.calls),
      count(r.context.compactions),
      r.diff.addedLines === undefined
        ? "—"
        : `${r.diff.addedLines}${r.diff.implementationLines === undefined ? "" : `（${r.diff.implementationLines}/${r.diff.testLines ?? "?"}）`}`,
      r.context.model ?? "—",
      r.guide ?? "—",
      r.context.hikyaku ?? "—",
      r.context.host ?? "—",
      r.session ?? "—",
    ]),
    [
      "cycle",
      "build",
      "architect",
      "builder",
      "実測",
      "乖離",
      "比率",
      "固定分",
      "G8",
      "実装前",
      "レビュー前",
      "呼び出し",
      "コンパクション",
      "追加行（実装/テスト）",
      "モデル",
      "ガイド",
      "Hikyaku",
      "ホスト",
      "セッション",
    ],
  );
}

function recordJson(r: PeakRecord): Record<string, unknown> {
  return { ...r, measured: r.context.peak ?? null, deviation: deviationOf(r) ?? null, ratio: ratioOf(r) ?? null };
}

async function buildHistory(args: ParsedArgs, operands: string[]): Promise<void> {
  const phase = requirePhase(operands[0]);
  const scope = scopeFor(args, phase, operands[1]);
  const { config, cycle } = scope;
  const buildDirectory = scope.context === undefined ? undefined : join(scope.context.directory, buildDirName(normalizeBuildId(phase)));

  const override = flagString(args, "base");
  const resolved = override === undefined ? await resolvePrBase(scope, phase, { fetch: !flagBoolean(args, "no-fetch") }) : undefined;
  const baseRef = override ?? resolved?.ref;

  // hikyaku_root は絶対パスで解決済み。pathspec はリポジトリルートからの相対で渡す
  const excluded = relative(config.repoRoot, config.hikyakuRoot);
  let reason: string | undefined;
  let stats: Awaited<ReturnType<typeof diffStats>>;
  if (baseRef === undefined) {
    reason = `比較の起点を解決できません: ${resolved?.base ?? "?"}（git fetch するか --base <ref> で明示してください）`;
  } else {
    stats = await diffStats(config.repoRoot, baseRef, excluded === "" ? [] : [excluded]);
    if (stats === undefined) reason = `${baseRef} と HEAD の共通の祖先を見つけられません（浅い clone では git fetch --deepen が要ることがあります）`;
  }
  const counted = stats === undefined ? undefined : summarizeDiff(stats.files, config.diff);
  const markdown = renderDiffMarkdown(counted, reason);
  const checkpoints = buildDirectory !== undefined && existsSync(buildDirectory) ? checkpointsOf(readProgress(buildDirectory), config.context) : [];

  emit(
    {
      phase,
      cycle,
      measured: counted !== undefined,
      reason: reason ?? null,
      mergeBase: stats?.mergeBase ?? null,
      baseRef: baseRef ?? null,
      base: resolved?.base ?? null,
      stackedOn: resolved?.stacked?.name ?? null,
      excluded: excluded === "" ? null : excluded,
      patterns: config.diff,
      diff: counted ?? null,
      checkpoints,
      markdown,
    },
    () => {
      if (flagBoolean(args, "markdown")) return markdown;
      const lines = [`ビルド       ${phase}（${cycle ?? "?"}）`];
      if (counted === undefined || stats === undefined) {
        lines.push(`差分の集計   計測不可: ${reason ?? "理由不明"}`);
      } else {
        lines.push(
          `起点         ${baseRef}（merge-base ${stats.mergeBase.slice(0, 7)}）`,
          `除外         ${excluded === "" ? "(なし)" : excluded}`,
          "",
          `新規ファイル数  ${counted.newFiles}（実装 ${counted.implementationNewFiles} / テスト ${counted.testNewFiles}）`,
          `変更ファイル数  ${counted.changedFiles}（実装 ${counted.implementationFiles} / テスト ${counted.testFiles}）`,
          `追加行数        ${counted.addedLines}（実装 ${counted.implementationLines} / テスト ${counted.testLines}）`,
          `削除行数        ${counted.deletedLines}`,
        );
        if (counted.binaryFiles > 0) lines.push(`バイナリ        ${counted.binaryFiles}（行数は数えていません）`);
        if (counted.generatedFiles > 0) {
          lines.push(
            `生成物          ${counted.generatedFiles} ファイル・${counted.generatedLines} 行（数えていません）`,
            ...counted.generatedPaths.map((path) => `  ${path}`),
          );
        }
        if (resolved?.stacked !== undefined) lines.push("", `（${resolved.stacked.name} に積んでいます。この分だけを数えました）`);
      }
      lines.push("", "区切りでのコンテキスト:");
      if (checkpoints.length === 0) lines.push("  （記録なし）");
      for (const c of checkpoints) lines.push(`  ${c.label}: ${formatTokens(c.tokens)} / 目安 ${formatTokens(c.budget)}${c.over ? " — 目安を超えていた" : ""}`);
      return lines.join("\n");
    },
  );
}

register({
  name: "tokens history",
  summary: "予測ピークと実測を各ビルドの retrospective.md から並べる。build-NN を渡すとそのビルドの差分を集計する",
  usage:
    "hikyaku tokens history [<cycle>] [--group-by model|hikyaku|host|guide] [--root <path>] [--json]\n" +
    "       hikyaku tokens history build-NN [<cycle>] [--base <ref>] [--no-fetch] [--markdown] [--json]",
  details: [
    "■ 一覧（引数なし、または <cycle>）",
    "全サイクル（引数があればそのサイクル）の build-NN/retrospective.md から「予測ピークの振り返り」を読み、",
    "予測（architect / builder 段階）・実測のピーク・乖離（実測 − builder 段階）・比率（実測 ÷ builder 段階）と、",
    "開始時の固定分・区切りでのコンテキスト（progress.jsonl から）・呼び出し回数・コンパクション・",
    "差分の追加行数・モデル・見積もりに使ったガイドの版・Hikyaku の版を並べます。",
    "",
    "ガイドを補正する素材です（/hikyaku:token-guide）。同じ成分を同じ向きに",
    "読み違え続けているなら、ガイドの見積もり方を直します。",
    "",
    "--group-by はモデル・Hikyaku の版・ホスト・ガイドの版ごとに分け、件数・予測と実測の平均・実測の範囲・",
    "乖離と比率の平均を添えます。モデルの世代やガイドの版が変わると予測の当たり方が変わるので、",
    "混ぜたまま比べないためです。",
    "",
    "読めない項目は「—」で出します。推測で埋めません。乖離の要因（文章）はここでは読まないので、",
    "該当する retrospective.md を直接読んでください。",
    "",
    "■ 1ビルド（build-NN）",
    "PR の base からの差分を数え、新規ファイル数・変更ファイル数・追加行数（実装とテストの内訳）・",
    "削除行数を返します。あわせて、そのビルドの区切りでのコンテキストを progress.jsonl から示します。",
    "retrospective が --markdown の表を「差分の集計」に貼ります。予測ピークの算出には使いません。",
    "",
    "生成物（ロックファイル・スナップショット・生成コード）は書いた量ではないので数えません。",
    "どれを生成物とし、どれをテストとするかは [diff] の exclude / tests（パスの glob）で決まり、",
    "既定値は hikyaku config --json の diff で確認できます。設定すると既定値を置き換えます。",
    "",
    "比較の起点は pr base と同じ導出です（スタックしていればスタック元）。--base で明示もできます。",
    "起点は base の先端ではなく merge-base で、ワークスペース（hikyaku_root）配下と未コミットの変更は数えません。",
    "起点を解決できないときは推測せず「計測不可」とその理由を返します（終了コードは 0）。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    if (operands[0] !== undefined && /^build-?\d+$/.test(operands[0])) {
      await buildHistory(args, operands);
      return;
    }
    const config = loadConfig({ root: flagString(args, "root") });
    const groupBy = readGroupBy(args);
    const all = loadCycles(config.hikyakuRoot);
    const filter = operands[0];
    const cycles =
      filter === undefined ? all : all.filter((r) => filter === r.id || filter === r.slug || filter === cycleDirName(r));
    if (filter !== undefined && cycles.length === 0) {
      throw new HikyakuError(`サイクルが見つかりません: ${filter}`, "hikyaku cycle list で一覧を確認してください。");
    }

    const records = collectPeakRecords(config.hikyakuRoot, cycles);
    const groups =
      groupBy === undefined
        ? undefined
        : groupRecords(records, groupBy).map((g) => ({ ...summarizeGroup(g.key, g.records), records: g.records.map(recordJson) }));

    // 見直しを勧めるかは、サイクルを指定したときだけ出す（close-cycle が読む。全サイクルを混ぜた判定は
    // token-guide の校正が自分で行う）
    const review = filter === undefined ? undefined : guideReview(records);

    emit({ records: records.map(recordJson), groupBy: groupBy ?? null, groups: groups ?? null, review: review ?? null }, () => {
      if (records.length === 0) return "予測ピークの振り返りを持つ retrospective.md はまだありません。";
      const lines: string[] = [];
      if (groupBy === undefined) {
        lines.push(renderRecords(records));
      } else {
        for (const group of groupRecords(records, groupBy)) {
          const s = summarizeGroup(group.key, group.records);
          lines.push(
            `■ ${groupBy}: ${s.key}（${s.count} 件）`,
            `  予測平均 ${formatK(s.meanPredicted)} / 実測平均 ${formatK(s.meanMeasured)}（${formatK(s.minMeasured)}〜${formatK(s.maxMeasured)}）/ 乖離の平均 ${signedK(s.meanDeviation)} / 比率の平均 ${ratio(s.meanRatio)}（${s.paired} 件）`,
            renderRecords(group.records),
            "",
          );
        }
      }
      const all = summarizeGroup("all", records);
      if (all.paired > 0) {
        const under = records.filter((r) => (deviationOf(r) ?? 0) > 0).length;
        lines.push("", `乖離の平均 ${signedK(all.meanDeviation)}・比率の平均 ${ratio(all.meanRatio)}（${all.paired} 件、過小見積もり ${under} 件）`);
      }
      if (review !== undefined) {
        lines.push("", `見積もりのガイドの見直し: ${review.needed ? "勧める" : "不要"}（${review.reason}）`);
      }
      lines.push("", "乖離の要因は各 retrospective.md の「乖離の要因」を読んでください。");
      return lines.join("\n");
    });
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
  name: "tokens session",
  summary: "セッションのコンテキストのピークを、ホストの記録から実測する",
  usage: "hikyaku tokens session [<phase> [<cycle>]] [--transcript <path>] [--host claude|codex] [--markdown] [--json]",
  details: [
    "予測ピークと突き合わせる実測（メインセッションのコンテキスト）を返します。",
    "予測の算出には使いません。",
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
