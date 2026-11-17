/** rules check — パス指定の rule の広さと大きさを測る */

import { flagString } from "../lib/args.mts";
import { loadConfig } from "../lib/config.mts";
import { loadCycles } from "../lib/cycles.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { emit, table } from "../lib/output.mts";
import { REVIEW_RECORD_HEADING } from "../lib/promotions.mts";
import { register } from "../lib/registry.mts";
import { collectReviewRecords, ruleHits } from "../lib/review-records.mts";
import {
  RULES_DIR,
  RULE_LOAD_WARNING,
  collectRemovalCandidates,
  listRuleFiles,
  measureRules,
  ruleCandidates,
  rulesLastTouched,
  trackedFiles,
  type RemovalCandidate,
  type RuleCandidate,
} from "../lib/rules.mts";
import { openCycleIfAny } from "../lib/workspace.mts";

const REMOVAL_LABELS: Record<RemovalCandidate["kinds"][number], string> = {
  stale: "一致しない",
  unreasoned: "理由（prevents・basis）が無い",
  unhelpful: "役に立たなかった記述に挙がった",
};

const KIND_LABELS: Record<RuleCandidate["kind"], string> = {
  move: "移す候補（閾値以上引かれた）",
  stale: "一致しない",
  missing: "記録にあるが無い",
};

register({
  name: "rules candidates",
  summary: "レビューの記録で引かれた回数が閾値以上の rule と、一致しない rule を、最終変更からの日数とともに並べる",
  usage: "hikyaku rules candidates [<cycle>] [--no-cycle] [--root <path>] [--json]",
  options: ["root", "no-cycle"],
  maxOperands: 1,
  details: [
    `全サイクル（closed を含む）の build-NN/handoff.md の「${REVIEW_RECORD_HEADING}」から、rule が引かれた回数を数えます。`,
    "回数はサイクルをまたいで数えます。サイクルを指定する（省略時は現在のブランチ・.hikyaku.local から選ぶ）と、",
    "閾値だけそのサイクル設定の値を使います（数える記録は絞りません）。",
    "",
    "  移す候補           [rules] hit_threshold（既定 3）以上引かれた rule。機械の検査やリファクタへ移すきっかけ",
    "  一致しない         paths がどのファイルにも一致しない rule（rules check と同じ判定）",
    "  記録にあるが無い   レビューの記録に挙がったが .claude/rules/ に無い rule（パスの書き間違いか、消された rule）",
    "",
    "各行に、最終変更からの日数（paths に当たる追跡ファイルの最終コミット。paths が無い・一致しない rule は",
    "rule ファイル自身）と、frontmatter の理由（prevents / basis / importance）を添えます。",
    "",
    "試しに消す候補（JSON は removals）も並べます。一致しない rule、frontmatter の理由（prevents・basis）が",
    "欠けた rule、サイクルの「役に立たなかった記述」に挙がった記述（rule か文書の行）です。重要度が高の基準は",
    "含めません。文書の行で理由の欄が欠けたものは、役に立たなかった記述に挙がらない限り候補にしません。",
    "",
    "候補を並べるだけで、移すか消すかは決めません。判断は LLM とユーザーが行います。終了コードは常に 0 です。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const opened = openCycleIfAny(args, operands[0]);
    const config = opened?.config ?? loadConfig({ root: flagString(args, "root") });
    const files = trackedFiles(config.repoRoot);
    const notices: string[] = [];
    if (files === undefined) notices.push("追跡ファイルの一覧を取得できないので、一致の判定と日数を省きました（Git リポジトリの中で実行してください）");
    const rules = listRuleFiles(config.repoRoot);
    const { measures } = measureRules(rules, files ?? [], config.diff.exclude);
    // 一覧を取れないときは、一致しない rule と誤って並べない
    if (files === undefined) for (const m of measures) m.stale = false;
    const { records, unparsed } = collectReviewRecords(config.hikyakuRoot, loadCycles(config.hikyakuRoot));
    const input = { measures, hits: ruleHits(records), threshold: config.rules.hitThreshold, now: new Date() };
    // 日数は候補になった rule の分だけ git から引く（rule ごとに履歴をたどるので、全 rule では重い）
    const selected = new Set(ruleCandidates({ ...input, lastTouched: new Map() }).map((c) => c.path));
    const touched =
      files === undefined
        ? new Map()
        : await rulesLastTouched(config.repoRoot, rules.filter((rule) => selected.has(rule.path)), files, config.diff.exclude);
    const candidates = ruleCandidates({ ...input, lastTouched: touched });
    const problems = rules.flatMap((rule) => (rule.problems ?? []).map((problem) => `${rule.path}: ${problem}`));
    const removals = collectRemovalCandidates(config, opened?.context.directory, measures);

    emit({ threshold: config.rules.hitThreshold, records: records.length, candidates, removals, unparsed, problems, notices }, () => {
      const lines: string[] = [];
      if (removals.length > 0) {
        lines.push(
          "試しに消す候補（重要度が高の基準は含めない。消すなら close-cycle の followups で別の PR にする）",
          table(
            removals.map((r) => [
              r.line === undefined ? r.location : `${r.location}「${r.quote ?? ""}」`,
              r.kinds.map((k) => REMOVAL_LABELS[k]).join("・"),
              r.sources.join(", "),
            ]),
            ["基準", "理由", "出どころ"],
          ),
          "",
        );
      }
      if (candidates.length === 0) {
        lines.push(`候補はありません（閾値 ${config.rules.hitThreshold}、レビューの記録 ${records.length} 件）。`);
      } else {
        lines.push(
          table(
            candidates.map((c) => [
              c.path,
              KIND_LABELS[c.kind],
              c.hits === undefined ? "" : `${c.hits}（重 ${c.heavy ?? 0}）`,
              c.lastTouchedDays === undefined ? "不明" : `${c.lastTouchedDays} 日`,
              [
                c.reasons.prevents === undefined ? undefined : `防ぐ: ${c.reasons.prevents}`,
                c.reasons.basis === undefined ? undefined : `立つ: ${c.reasons.basis}`,
                c.reasons.importance === undefined ? undefined : `重要度: ${c.reasons.importance}`,
              ].filter((v) => v !== undefined).join(" / ") || "（理由なし）",
            ]),
            ["rule", "分類", "引かれた回数", "最終変更から", "理由"],
          ),
          "",
          `閾値: ${config.rules.hitThreshold}（[rules] hit_threshold）。レビューの記録 ${records.length} 件から数えました。`,
        );
      }
      for (const item of unparsed) lines.push(`? ${item.source}「${item.heading}」: ${item.line}  → ${item.problem}`);
      for (const problem of problems) lines.push(`? ${problem}`);
      for (const notice of notices) lines.push(`! ${notice}`);
      return lines.join("\n");
    });
  },
});

register({
  name: "rules check",
  summary: "パス指定の rule（.claude/rules/）の広さと大きさを測り、効かなくなった rule を見つける",
  usage: "hikyaku rules check [--root <path>] [--json]",
  details: [
    "rule ごとに、paths の glob に一致する追跡ファイルの数・一致率・本文の文字数と、",
    "掛け合わせた読み込み量（一致率 × 文字数）を返します。",
    "",
    "rule は一致するファイルを読み書きしたときに読み込まれます。glob が広くて本文が長いと、",
    "関係のない作業でも毎回読み込まれます。広いが短い rule、長いが狭い rule は問題にしません。",
    "",
    `  読み込み量が ${RULE_LOAD_WARNING} を超える   知らせます。glob を狭めるか、狭い glob のファイルに分けてください`,
    "  paths が無い                  起動時に常に読み込まれます（一致率 100% として数えます）",
    "  どのファイルにも一致しない    もう読み込まれません。パスの移動に追従させるか、削除してください",
    "",
    "生成物（[diff] exclude の glob に当たるファイル）は、触って読むファイルではないので分母から除きます。",
    "",
    "どのファイルにも一致しない rule があれば、終了コード 2 で終了します。",
  ].join("\n"),
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const rules = listRuleFiles(config.repoRoot);
    const files = trackedFiles(config.repoRoot);
    if (files === undefined) {
      throw new HikyakuError("追跡ファイルの一覧を取得できません", "Git リポジトリの中で実行してください。");
    }
    const { measures, total } = measureRules(rules, files, config.diff.exclude);
    const stale = measures.filter((m) => m.stale);
    const heavy = measures.filter((m) => m.heavy);

    emit({ directory: RULES_DIR, total, warningAbove: RULE_LOAD_WARNING, rules: measures }, () => {
      if (measures.length === 0) return `${RULES_DIR}/ に rule はありません。`;
      const lines = [
        table(
          measures.map((m) => [
            m.path,
            m.paths === undefined ? "（常時）" : m.paths.join(", "),
            String(m.matched),
            `${(m.share * 100).toFixed(1)}%`,
            String(m.characters),
            String(m.load),
            m.stale ? "一致なし" : m.heavy ? "広くて長い" : "",
          ]),
          ["rule", "paths", "一致", "一致率", "文字数", "読み込み量", ""],
        ),
        "",
        `分母: 追跡ファイル ${total} 件（生成物を除く）。読み込み量 = 一致率 × 文字数。`,
      ];
      for (const m of heavy) {
        lines.push(`! ${m.path}: 読み込み量 ${m.load} が目安（${RULE_LOAD_WARNING}）を超えています。glob を狭めるか、狭い glob のファイルに分けてください`);
      }
      for (const m of stale) {
        lines.push(`✗ ${m.path}: paths がどのファイルにも一致しません。もう読み込まれていません`);
      }
      for (const m of measures) {
        for (const problem of m.problems ?? []) lines.push(`? ${m.path}: ${problem}（理由の欄。persistence.md の「rule の書き方」）`);
      }
      return lines.join("\n");
    });

    if (stale.length > 0) {
      throw new ValidationError(stale.map((m) => `${m.path}: paths がどのファイルにも一致しません`));
    }
  },
});
