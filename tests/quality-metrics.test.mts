/**
 * 基準を試しに消す候補と、消した PR のマージ前後の指標の比較（build-11、US-9.2〜9.5）
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ResolvedConfig } from "../scripts/lib/config.mts";
import { renderCyclesFile, type CycleRecord } from "../scripts/lib/cycles.mts";
import {
  compareAround,
  cycleMetrics,
  localDay,
  metricsComparison,
  prNumber,
  subjectMentionsPr,
  type CycleMetrics,
} from "../scripts/lib/quality-metrics.mts";
import { measureRules, parseRule, removalCandidates, type RuleFile } from "../scripts/lib/rules.mts";
import { cli, cycle, succeeds, testEnvironment, workspace, write } from "./helpers.mts";

const ROOT = "docs/hikyaku";

// ---------------------------------------------------------------------------
// 消す候補

function rule(path: string, frontmatter: string): RuleFile {
  const parsed = parseRule(`---\n${frontmatter}\n---\n\n本文\n`);
  return { path, paths: parsed.paths, characters: 2, reasons: parsed.reasons, problems: parsed.problems };
}

test("removalCandidates: 一致しない rule・理由の欠けた rule・役に立たなかった記述を並べ、重要度が高は入れない", () => {
  const rules = [
    rule(".claude/rules/legacy.md", "paths: src/legacy/**\nprevents: 古い API\nbasis: legacy の構成\nimportance: 中"),
    rule(".claude/rules/bare.md", "paths: src/**"),
    rule(".claude/rules/high.md", "paths: src/gone/**\nimportance: 高"),
    rule(".claude/rules/fine.md", "paths: src/**\nprevents: p\nbasis: b\nimportance: 中"),
    // importance を読めない rule は、高かもしれないので候補にしない
    rule(".claude/rules/unreadable.md", "paths: src/gone/**\nimportance: high"),
  ];
  const { measures } = measureRules(rules, ["src/a.ts"], []);
  const documents: Record<string, string> = {
    conventions: [
      "## 規約の見出し（テストは日本語）",
      "- 関数は短く書く",
      "- テストは日本語で書く（防ぐ: 読めない / 立つ: 読み手 / 重要度: 中）",
      "- 移行は1ファイル（防ぐ: 壊れる / 立つ: DB / 重要度: 高）",
      "- 鍵は回す（防ぐ: 漏れる / 重要度: 高）",
    ].join("\n"),
  };
  const unhelpful = [
    { location: "rule:.claude/rules/fine.md", quote: "本文", reason: "自明", source: "build-01/retrospective.md" },
    { location: "rule:./.claude/rules/legacy.md", quote: "本文", reason: "古い", source: "build-02/retrospective.md" },
    { location: "rule:.claude/rules/high.md", quote: "本文", reason: "自明", source: "build-02/retrospective.md" },
    { location: "conventions", quote: "テストは日本語", reason: "自明", source: "build-03/retrospective.md" },
    { location: "conventions", quote: "移行は1ファイル", reason: "自明", source: "build-03/retrospective.md" },
    // 理由の欄が崩れた行（立つが無い）は、重要度を読めないので候補にしない
    { location: "conventions", quote: "鍵は回す", reason: "自明", source: "build-03/retrospective.md" },
    { location: "rule:.claude/rules/unreadable.md", quote: "本文", reason: "自明", source: "build-03/retrospective.md" },
    { location: "conventions", quote: "存在しない記述", reason: "古い", source: "build-03/retrospective.md" },
    // 見出しだけに当たる引用は、消す行が決まらないので候補にしない
    { location: "conventions", quote: "規約の見出し", reason: "無関係", source: "build-04/retrospective.md" },
  ];
  const found = removalCandidates({ measures, unhelpful, readDocument: (location) => documents[location] });
  const summary = found.map((c) => [c.line === undefined ? c.location : `${c.location}:${c.quote}`, c.kinds]);
  assert.deepEqual(summary, [
    [".claude/rules/legacy.md", ["stale", "unhelpful"]],
    [".claude/rules/bare.md", ["unreasoned"]],
    [".claude/rules/fine.md", ["unhelpful"]],
    ["conventions:テストは日本語", ["unhelpful"]],
  ]);
  assert.ok(!found.some((c) => c.location === ".claude/rules/high.md" || c.line?.includes("移行は1ファイル")), "重要度が高は候補にしない");
  assert.ok(!found.some((c) => c.line?.includes("関数は短く")), "理由の欠けた文書の行は、挙がらなければ候補にしない");
  assert.deepEqual(found[0]?.sources, ["build-02/retrospective.md（古い）"]);
});

test("rules candidates: 消す候補を JSON の removals に並べる", (t) => {
  const directory = workspace(t, true);
  write(directory, "src/a.ts", "export {};\n");
  write(directory, ".claude/rules/gone.md", "---\npaths: legacy/**\nprevents: p\nbasis: b\nimportance: 中\n---\n\n古い\n");
  write(directory, ".claude/rules/high.md", "---\npaths: legacy/**\nimportance: 高\n---\n\n守る\n");
  spawnSync("git", ["add", "-A"], { cwd: directory, env: testEnvironment() });
  const json = JSON.parse(succeeds(directory, "rules", "candidates", "001", "--json"));
  assert.deepEqual(json.removals.map((r: { location: string }) => r.location), [".claude/rules/gone.md"]);
  assert.match(succeeds(directory, "rules", "candidates", "001"), /試しに消す候補/);
});

// ---------------------------------------------------------------------------
// 指標の比較（関数）

test("localDay: ISO の日時をこの環境のローカルの日付にする", () => {
  const date = new Date(2026, 10, 17, 23, 30);
  assert.equal(localDay(date.toISOString()), "2026-11-17");
  assert.equal(localDay("not-a-date"), "not-a-date".slice(0, 10));
});

test("prNumber と subjectMentionsPr: URL と番号を読み、#12 と #123 を取り違えない", () => {
  assert.equal(prNumber("https://github.com/o/r/pull/12"), 12);
  assert.equal(prNumber("12"), 12);
  assert.equal(prNumber("#12"), 12);
  assert.equal(prNumber("abc"), undefined);
  assert.equal(subjectMentionsPr("Merge pull request #12 from x/y", 12), true);
  assert.equal(subjectMentionsPr("基準を消す (#12)", 12), true);
  assert.equal(subjectMentionsPr("Merge pull request #123 from x/y", 12), false);
  assert.equal(subjectMentionsPr("Merge pull request #112 from x/y", 12), false);
  assert.equal(subjectMentionsPr("Prepare config for #12", 12), false, "PR 番号に触れただけのコミット");
  assert.equal(subjectMentionsPr("follow-up to #12", 12), false);
  assert.equal(subjectMentionsPr("基準を消す (#123)", 12), false);
});

function metrics(cycleName: string, values: [number, number, number, number]): CycleMetrics {
  const [returns, rejected, highPitfalls, heavyFindings] = values;
  return { cycle: cycleName, returns, rejected, highPitfalls, heavyFindings };
}

test("compareAround: 前は完了 < マージの日、後は開始 ≥ マージの日。揃わなければ比較できない", () => {
  const cycles: CycleRecord[] = [
    cycle("001", { slug: "p", status: "closed", started: "2026-07-01", finished: "2026-08-01" }),
    cycle("002", { slug: "q", status: "closed", started: "2026-08-02", finished: "2026-09-05" }),
    cycle("003", { slug: "same", status: "closed", started: "2026-09-01", finished: "2026-09-10" }),
    cycle("004", { slug: "r", status: "closed", started: "2026-09-10", finished: "2026-09-20" }),
    cycle("005", { slug: "s", status: "closed", started: "2026-09-21", finished: "2026-10-01" }),
    cycle("006", { slug: "t", status: "active", started: "2026-10-02", finished: "" }),
  ];
  const values: Record<string, [number, number, number, number]> = {
    "001-p": [0, 0, 1, 1], "002-q": [1, 0, 0, 1], "004-r": [0, 1, 0, 2], "005-s": [0, 0, 1, 1],
  };
  const metricsOf = (r: CycleRecord) => metrics(`${r.id}-${r.slug}`, values[`${r.id}-${r.slug}`] ?? [9, 9, 9, 9]);
  const result = compareAround({ mergedDay: "2026-09-10", cycles, window: 2, metricsOf });
  assert.equal(result.comparable, true);
  assert.deepEqual(result.before, { cycles: ["001-p", "002-q"], totals: { returns: 1, rejected: 0, highPitfalls: 1, heavyFindings: 2 } });
  assert.deepEqual(result.after, { cycles: ["004-r", "005-s"], totals: { returns: 0, rejected: 1, highPitfalls: 1, heavyFindings: 3 } });
  assert.deepEqual(result.worse, ["rejected", "heavyFindings"]);

  const short = compareAround({ mergedDay: "2026-09-10", cycles, window: 3, metricsOf });
  assert.equal(short.comparable, false);
  assert.match(short.reason ?? "", /前 2 件・後 2 件/);
  assert.equal(compareAround({ mergedDay: "2026-09-10", cycles, window: 2, metricsOf: () => "壊れている" }).comparable, false);
});

// ---------------------------------------------------------------------------
// 一時リポジトリの結合テスト

function git(directory: string, env: NodeJS.ProcessEnv, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", env: { ...testEnvironment(), ...env } });
  assert.equal(result.status, 0, result.stderr);
}

function commitAt(directory: string, date: string, message: string): void {
  git(directory, {}, "add", "-A");
  const env = { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
  git(directory, env, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", message);
}

function handoff(high: number, heavy: number): string {
  return [
    "# 申し送り",
    "## 永続化すること",
    ...Array.from({ length: high }, (_, i) => `- \`conventions\` [高]: 落とし穴 ${i}`),
    "- `conventions` [中]: 中の知見",
    "## レビューの記録",
    ...Array.from({ length: heavy }, (_, i) => `- [重] \`-\`: 重い指摘 ${i}`),
    "- [軽] `-`: 軽い指摘",
    "",
  ].join("\n");
}

function rejectedLedger(unit: string): string {
  const at = "2026-09-01T00:00:00.000Z";
  return [
    JSON.stringify({ record: "open", at, id: `${unit}.1-abcd`, unit, type: "question", summary: "s", when: "close", who: "user" }),
    JSON.stringify({ record: "decide", at, id: `${unit}.1-abcd`, unit, decision: "rejected", by: "user", input: "退ける" }),
    "",
  ].join("\n");
}

function metricsRepository(t: TestContext): { directory: string; config: ResolvedConfig } {
  const directory = workspace(t);
  const records = [
    cycle("001", { slug: "p", status: "closed", started: "2026-07-01", finished: "2026-08-01" }),
    cycle("002", { slug: "q", status: "closed", started: "2026-08-02", finished: "2026-09-05" }),
    cycle("003", { slug: "r", status: "closed", started: "2026-09-12", finished: "2026-09-30" }),
    cycle("004", { slug: "s", status: "closed", started: "2026-10-01", finished: "2026-10-20" }),
  ];
  write(directory, `${ROOT}/cycles.md`, renderCyclesFile(records));
  const dir = (name: string) => `${ROOT}/cycles/${name}`;
  write(directory, `${dir("001-p")}/build-01/handoff.md`, handoff(1, 1));
  write(directory, `${dir("002-q")}/build-01/handoff.md`, handoff(0, 1));
  write(
    directory,
    `${dir("002-q")}/design/progress.jsonl`,
    `${JSON.stringify({ at: "2026-08-10T00:00:00.000Z", skill: "architect", step: "*", result: "restart", round: "return" })}\n`,
  );
  write(
    directory,
    `${dir("002-q")}/progress.jsonl`,
    `${JSON.stringify({ at: "2026-09-05T00:00:00.000Z", skill: "close-cycle", step: "followups", result: "done", pr: "https://github.com/o/r/pull/12" })}\n`,
  );
  write(directory, `${dir("003-r")}/build-01/handoff.md`, handoff(0, 2));
  write(directory, `${dir("003-r")}/design/decisions.jsonl`, rejectedLedger("architect"));
  write(directory, `${dir("004-s")}/build-01/handoff.md`, handoff(1, 1));
  write(directory, ".claude/rules/legacy.md", "---\npaths: src/legacy/**\n---\n\n古い\n");
  write(directory, "AGENTS.md", "# 規約\n\n- 古い基準を守る\n\n本文\n\n- 残す基準\n");
  const guide = join(directory, ROOT, "document-guide.md");
  writeFileSync(guide, readFileSync(guide, "utf8").replace(/^\| *conventions *\|.*$/m, "| conventions | repo | AGENTS.md | 取り決め |"));
  commitAt(directory, "2026-09-01T00:00:00+00:00", "準備");

  rmSync(join(directory, ".claude/rules/legacy.md"));
  // 書き換えただけの箇条書き（残す基準）は、消した基準に数えない
  write(directory, "AGENTS.md", "# 規約\n\n本文\n\n- 残す基準（直した）\n");
  // 正午（UTC）にしておけば、ローカルの日付に直しても多くのタイムゾーンで同じ日になる
  commitAt(directory, "2026-09-10T12:00:00+00:00", "Merge pull request #12 from x/q-close-criteria");
  commitAt(directory, "2026-09-11T12:00:00+00:00", "Merge pull request #123 from x/other");
  // PR を参照する後のコミット（revert）をマージとみなさない
  commitAt(directory, "2026-09-20T12:00:00+00:00", 'Revert "Merge pull request #12 from x/q-close-criteria" (#15)');
  commitAt(directory, "2026-09-21T12:00:00+00:00", "follow-up to #12");

  const config = {
    repoRoot: directory,
    hikyakuRoot: join(directory, ROOT),
    baseBranch: "main",
    metrics: { window: 2 },
  } as ResolvedConfig;
  return { directory, config };
}

test("cycleMetrics: 差し戻し・rejected・高の落とし穴・重い指摘を数え、記録が無いものは 0", (t) => {
  const { config } = metricsRepository(t);
  const q = cycleMetrics(config.hikyakuRoot, cycle("002", { slug: "q" }));
  assert.deepEqual(q, { cycle: "002-q", returns: 1, rejected: 0, highPitfalls: 0, heavyFindings: 1 });
  const r = cycleMetrics(config.hikyakuRoot, cycle("003", { slug: "r" }));
  assert.deepEqual(r, { cycle: "003-r", returns: 0, rejected: 1, highPitfalls: 0, heavyFindings: 2 });
  const empty = cycleMetrics(config.hikyakuRoot, cycle("009", { slug: "none" }));
  assert.deepEqual(empty, { cycle: "009-none", returns: 0, rejected: 0, highPitfalls: 0, heavyFindings: 0 });
});

test("metricsComparison: 消した PR のマージを first-parent の履歴から導き、前後2サイクルの指標を比べる", (t) => {
  const { config } = metricsRepository(t);
  const [comparison] = metricsComparison(config);
  assert.equal(comparison?.cycle, "002-q");
  assert.equal(comparison?.comparable, true);
  assert.equal(comparison?.mergedAt?.slice(0, 10), "2026-09-10");
  assert.deepEqual(comparison?.removed, [".claude/rules/legacy.md", "AGENTS.md: - 古い基準を守る"]);
  assert.deepEqual(comparison?.before?.totals, { returns: 1, rejected: 0, highPitfalls: 1, heavyFindings: 2 });
  assert.deepEqual(comparison?.after?.totals, { returns: 0, rejected: 1, highPitfalls: 1, heavyFindings: 3 });
  assert.deepEqual(comparison?.worse, ["rejected", "heavyFindings"]);
});

test("metricsComparison: window に満たなければ比較できない、マージが無ければ未マージ", (t) => {
  const { config } = metricsRepository(t);
  const [wide] = metricsComparison({ ...config, metrics: { window: 3 } });
  assert.equal(wide?.comparable, false);
  assert.match(wide?.reason ?? "", /比較|件/);

  const path = join(config.hikyakuRoot, "cycles/002-q/progress.jsonl");
  writeFileSync(path, readFileSync(path, "utf8").replace("pull/12", "pull/99"));
  const [unmerged] = metricsComparison(config);
  assert.equal(unmerged?.comparable, false);
  assert.match(unmerged?.reason ?? "", /未マージ/);

  const [noBase] = metricsComparison({ ...config, baseBranch: "no-such-branch" });
  assert.equal(noBase?.comparable, false);
});

test("config: promotion_gate は express だけ false、[metrics] window は既定 2 で正の整数", (t) => {
  const directory = workspace(t, true);
  const configPath = join(directory, ".hikyaku.config");
  const original = readFileSync(configPath, "utf8");
  for (const [profile, expected] of [["express", false], ["economy", true], ["standard", true], ["thorough", true]] as const) {
    writeFileSync(configPath, `profile = "${profile}"\n${original}`);
    assert.equal(JSON.parse(succeeds(directory, "config", "--json")).gates.promotion, expected, profile);
  }
  writeFileSync(configPath, `profile = "standard"\npromotion_gate = false\n${original}`);
  assert.equal(JSON.parse(succeeds(directory, "config", "--json")).gates.promotion, false);

  writeFileSync(configPath, original);
  assert.deepEqual(JSON.parse(succeeds(directory, "config", "--json")).metrics, { window: 2 });
  write(directory, `${ROOT}/cycles/001-test/.hikyaku.config`, "[metrics]\nwindow = 3\n");
  assert.equal(JSON.parse(succeeds(directory, "config", "001", "--json")).metrics.window, 3);
  write(directory, `${ROOT}/cycles/001-test/.hikyaku.config`, "");
  for (const value of ["0", "-1", "1.5", '"2"']) {
    writeFileSync(configPath, `${original}\n[metrics]\nwindow = ${value}\n`);
    const result = cli(directory, "config", "--json");
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, /window/);
  }
  writeFileSync(configPath, `${original}\n[metrics]\nwindow = 1\n`);
  assert.equal(JSON.parse(succeeds(directory, "config", "--json")).metrics.window, 1);
});
