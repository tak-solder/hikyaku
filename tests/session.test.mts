import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { classifyPath, DEFAULT_DIFF_EXCLUDE, DEFAULT_DIFF_TESTS, matchesPathPattern, parseSplitCount, renderDiffMarkdown, summarizeDiff } from "../scripts/lib/diff-stats.mts";
import { deviationOf, groupRecords, groupValue, parsePeakRecord, ratioOf, summarizeGroup } from "../scripts/lib/tokens-history.mts";
import {
  codexKind,
  encodeProjectPath,
  parseClaudeTranscript,
  parseCodexRollout,
  renderSessionMarkdown,
  selectMain,
  type SessionMeasure,
} from "../scripts/lib/session.mts";
import { cliWith, succeeds, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";

const jsonl = (lines: unknown[]): string => `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;

function assistant(id: string, context: number, options: { output?: number; branch?: string; sidechain?: boolean; model?: string } = {}) {
  return {
    type: "assistant",
    sessionId: "s-main",
    cwd: "/repo",
    version: "2.1.300",
    entrypoint: "cli",
    gitBranch: options.branch ?? "hikyaku/001-test/build-01",
    isSidechain: options.sidechain ?? false,
    timestamp: `2026-10-18T00:00:${String(context % 60).padStart(2, "0")}Z`,
    message: {
      id,
      model: options.model ?? "claude-opus-5-5",
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: context - 1010,
        cache_read_input_tokens: 1000,
        output_tokens: options.output ?? 100,
      },
    },
  };
}

function codexToken(input: number, total: number, output = 50) {
  return {
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { input_tokens: total, output_tokens: total / 10 },
        last_token_usage: { input_tokens: input, output_tokens: output },
        model_context_window: 258_400,
      },
    },
  };
}

function codexMeta(branch: string, cwd: string, extra: Record<string, unknown> = {}) {
  return {
    type: "session_meta",
    payload: { id: "thread-1", cli_version: "0.163.0", originator: "codex_exec", source: "exec", thread_source: "user", cwd, git: { branch }, ...extra },
  };
}

test("session: Claude Code は message.id で重複を除き、サイドチェーンと合成メッセージを数えない", () => {
  const text = jsonl([
    { type: "user", sessionId: "s-main", cwd: "/repo", gitBranch: "main" },
    assistant("m1", 45_000, { branch: "main", output: 10 }),
    assistant("m1", 45_000, { branch: "main", output: 30 }),
    assistant("side", 900_000, { sidechain: true }),
    { ...assistant("synthetic", 0), message: { id: "x", model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } } },
    assistant("m2", 120_000),
    { type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "manual", preTokens: 120_000 } },
    { type: "user", isCompactSummary: true, message: { content: "要約" } },
    assistant("m3", 60_000, { model: "claude-sonnet-5-5" }),
    "not json",
  ]).replace('"not json"', "{壊れた行");
  const measure = parseClaudeTranscript(text, "/tmp/s-main.jsonl");
  assert.ok(measure);
  assert.equal(measure.calls, 3);
  assert.equal(measure.peak, 120_000);
  assert.equal(measure.first, 45_000);
  assert.equal(measure.latest, 60_000);
  assert.equal(measure.outputTokens, 30 + 100 + 100);
  assert.equal(measure.compactions, 1);
  assert.equal(measure.model, "claude-opus-5-5");
  assert.deepEqual(measure.models, ["claude-opus-5-5", "claude-sonnet-5-5"]);
  assert.deepEqual(measure.callsByBranch, { main: 1, "hikyaku/001-test/build-01": 2 });
  assert.equal(measure.hostVersion, "2.1.300");
  assert.equal(measure.window, undefined);
  assert.equal(parseClaudeTranscript(jsonl([{ type: "user" }]), "/tmp/empty.jsonl"), undefined);
});

test("session: Codex は同じ累計の token_count をまとめ、コンパクション直後の 0 を除く", () => {
  const text = jsonl([
    codexMeta("hikyaku/001-test/build-01", "/repo"),
    { type: "turn_context", payload: { model: "gpt-6-luna" } },
    { type: "event_msg", payload: { type: "token_count", info: null } },
    codexToken(30_000, 30_000),
    codexToken(30_000, 30_000),
    codexToken(200_000, 230_000),
    { type: "compacted", payload: { window_number: 2 } },
    codexToken(0, 230_000 + 1),
    codexToken(40_000, 270_000),
  ]);
  const measure = parseCodexRollout(text, "/tmp/rollout-x-thread-1.jsonl");
  assert.ok(measure);
  assert.equal(measure.calls, 3);
  assert.equal(measure.peak, 200_000);
  assert.equal(measure.first, 30_000);
  assert.equal(measure.latest, 40_000);
  assert.equal(measure.outputTokens, 150);
  assert.equal(measure.compactions, 1);
  assert.equal(measure.window, 258_400);
  assert.equal(measure.model, "gpt-6-luna");
  assert.equal(measure.kind, "main");
  assert.deepEqual(measure.callsByBranch, { "hikyaku/001-test/build-01": 3 });

  assert.equal(codexKind({ source: { subagent: { other: "guardian" } }, thread_source: "guardian_review" }), "guardian");
  assert.equal(codexKind({ originator: "codex-auto-review" }), "guardian");
  assert.equal(codexKind({ source: { subagent: "review" }, thread_source: "subagent" }), "subagent");
  assert.equal(codexKind({ source: "exec", thread_source: "user" }), "main");
});

test("session: 本体はそのブランチでの呼び出しが最も多いセッション。表は計測不可も同じ形で出す", () => {
  const base = parseClaudeTranscript(jsonl([assistant("a", 50_000)]), "/tmp/a.jsonl") as SessionMeasure;
  const candidates = [
    { measure: { ...base, path: "/tmp/conductor.jsonl", calls: 500 }, branchCalls: 3, current: false },
    { measure: { ...base, path: "/tmp/builder.jsonl", calls: 120 }, branchCalls: 110, current: false },
    { measure: { ...base, path: "/tmp/review.jsonl", calls: 20 }, branchCalls: 20, current: true },
  ];
  assert.equal(selectMain(candidates)?.measure.path, "/tmp/builder.jsonl");
  assert.equal(selectMain([]), undefined);

  const measured = renderSessionMarkdown({ measure: { ...base, peak: 312_400 }, reason: undefined, hikyakuVersion: "2.9.0", note: "本体" });
  assert.match(measured, /^\| 計測項目 \| 値 \|/);
  assert.match(measured, /\| ピーク \| 312,400 \|/);
  assert.match(measured, /\| Hikyaku \| 2\.9\.0 \|/);
  const missing = renderSessionMarkdown({ measure: undefined, reason: "rollout が無い", hikyakuVersion: undefined, note: undefined });
  assert.match(missing, /\| ピーク \| 計測不可（rollout が無い） \|/);
  assert.equal(missing.split("\n").length, measured.split("\n").length);
});

test("diff: 生成物を除き、テストのパスで実装とテストを分ける", () => {
  const patterns = { exclude: DEFAULT_DIFF_EXCLUDE, tests: DEFAULT_DIFF_TESTS };
  assert.equal(classifyPath(patterns, "package-lock.json"), "generated");
  assert.equal(classifyPath(patterns, "apps/web/yarn.lock"), "generated");
  assert.equal(classifyPath(patterns, "src/__snapshots__/view.test.ts.snap"), "generated");
  assert.equal(classifyPath(patterns, "api/user.pb.go"), "generated");
  assert.equal(classifyPath(patterns, "tests/cli.test.mts"), "test");
  assert.equal(classifyPath(patterns, "pkg/user_test.go"), "test");
  assert.equal(classifyPath(patterns, "src/view.spec.tsx"), "test");
  assert.equal(classifyPath(patterns, "src/latest.ts"), "implementation");
  assert.equal(classifyPath(patterns, "src/contest/index.ts"), "implementation");
  assert.ok(matchesPathPattern("src/**/*.ts", "src/a/b/c.ts"));
  assert.ok(matchesPathPattern("src/**/*.ts", "src/c.ts"));
  assert.ok(!matchesPathPattern("src/*.ts", "src/a/c.ts"));

  const stats = summarizeDiff(
    [
      { path: "src/a.ts", added: 100, deleted: 5, isNew: true },
      { path: "src/b.ts", added: 20, deleted: 10, isNew: false },
      { path: "tests/a.test.ts", added: 60, deleted: 0, isNew: true },
      { path: "pnpm-lock.yaml", added: 4000, deleted: 300, isNew: false },
      { path: "assets/logo.png", added: undefined, deleted: undefined, isNew: true },
    ],
    patterns,
  );
  assert.equal(stats.addedLines, 180);
  assert.equal(stats.implementationLines, 120);
  assert.equal(stats.testLines, 60);
  assert.equal(stats.newFiles, 3);
  assert.equal(stats.implementationNewFiles, 2);
  assert.equal(stats.testNewFiles, 1);
  assert.equal(stats.changedFiles, 4);
  assert.equal(stats.deletedLines, 15);
  assert.equal(stats.binaryFiles, 1);
  assert.deepEqual(stats.generatedPaths, ["pnpm-lock.yaml"]);
  assert.equal(stats.generatedLines, 4000);

  const markdown = renderDiffMarkdown(stats);
  assert.match(markdown, /\| 追加行数 \| 180（実装 120 \/ テスト 60） \|/);
  assert.deepEqual(parseSplitCount("1,180（実装 1,120 / テスト 60）"), { total: 1180, implementation: 1120, tests: 60 });
  assert.match(renderDiffMarkdown(undefined, "起点が無い"), /計測不可（起点が無い）/);
});

const retrospectiveWithSession = (peak: string, model: string, hikyaku: string, guide = "標準 v1"): string => `# Build 01 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 350k | issue.md |
| builderフェーズ段階 | 400k | plan.md |

**セッション**: 1セッションで完結

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測の固定分 |
| 読み込み | 120k | — |
| 実装 | 100k | — |
| テスト | 60k | — |
| 未知の領域 | 30k | — |
| **予測ピーク** | **400k** | 狙いの帯（300k〜450k） |
| ガイド | ${guide} | 6871828b |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | ${peak} |
| 開始時の固定分 | 45,100 |
| 呼び出し回数 | 210 |
| 出力トークン | 52,300 |
| コンパクション | 0 |
| ウィンドウ | — |
| モデル | ${model} |
| ホスト | Claude Code 2.1.300 |
| Hikyaku | ${hikyaku} |
| セッション | 07d76005（本体） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 5（実装 3 / テスト 2） |
| 変更ファイル数 | 9（実装 6 / テスト 3） |
| 追加行数 | 820（実装 600 / テスト 220） |
| 削除行数 | 40 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## 改善提案

なし
`;

test("tokens history: 予測・内訳・セッションの実測・差分の集計を読み、無い表は欠けとして読む", () => {
  const meta = { cycle: "001-test", build: "build-01", path: "x" };
  const record = parsePeakRecord(retrospectiveWithSession("312,400", "claude-opus-5-5", "2.9.0"), meta);
  assert.ok(record);
  assert.equal(record.architect, 350_000);
  assert.equal(record.builder, 400_000);
  assert.deepEqual(record.components, { fixed: 90_000, reading: 120_000, implementation: 100_000, tests: 60_000, unknown: 30_000 });
  assert.equal(record.guide, "標準 v1");
  assert.equal(record.guideHash, "6871828b");
  assert.deepEqual(record.diff, { newFiles: 5, addedLines: 820, implementationLines: 600, testLines: 220 });
  assert.equal(record.session, "1セッションで完結");
  assert.equal(deviationOf(record), 312_400 - 400_000);
  assert.equal(ratioOf(record), 312_400 / 400_000);
  assert.equal(record.context.peak, 312_400);
  assert.equal(record.context.first, 45_100);
  assert.equal(record.context.calls, 210);
  assert.equal(record.context.compactions, 0);
  assert.equal(record.context.window, undefined);
  assert.equal(record.context.model, "claude-opus-5-5");
  assert.equal(record.context.hikyaku, "2.9.0");
  assert.equal(groupValue(record, "host"), "Claude Code");

  const unmeasured = parsePeakRecord(retrospectiveWithSession("計測不可（rollout が無い）", "—", "—"), meta);
  assert.equal(unmeasured?.context.peak, undefined);
  assert.equal(unmeasured?.context.model, undefined);
  assert.equal(unmeasured && deviationOf(unmeasured), undefined);

  // v2 の「BP見積もりの振り返り」は読まない
  assert.equal(parsePeakRecord("# 振り返り\n\n## BP見積もりの振り返り\n\n| 段階 | BP |\n|---|---|\n| **実績** | 3BP |\n", meta), undefined);
  const bare = parsePeakRecord("# 振り返り\n\n## 予測ピークの振り返り\n\n| 段階 | 予測ピーク |\n|---|---|\n| builderフェーズ段階 | 300k |\n", meta);
  assert.equal(bare?.builder, 300_000);
  assert.equal(bare?.context.peak, undefined);
  assert.equal(bare && groupValue(bare, "model"), "—");
  assert.equal(bare && groupValue(bare, "guide"), "—");

  const groups = groupRecords([record, bare as NonNullable<typeof bare>], "model");
  assert.deepEqual(groups.map((g) => g.key), ["claude-opus-5-5", "—"]);
  const summary = summarizeGroup("claude-opus-5-5", [record]);
  assert.equal(summary.meanMeasured, 312_400);
  assert.equal(summary.meanPredicted, 400_000);
  assert.equal(summary.meanDeviation, 312_400 - 400_000);
  assert.equal(summary.paired, 1);
});

function git(directory: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("CLI: tokens history build-NN は生成物を数えず、実装とテストの行数を分けて返す。[diff] で置き換えられる", (t) => {
  const directory = workspace(t, true);
  git(directory, "add", "-A");
  git(directory, "commit", "--quiet", "-m", "init");
  git(directory, "switch", "--quiet", "-c", "hikyaku/001-test/build-01");
  write(directory, "src/app.ts", "a\nb\nc\n");
  write(directory, "src/app.test.ts", "t\nt\n");
  write(directory, "checks/app.check.ts", "c\nc\nc\nc\n");
  write(directory, "package-lock.json", `${"x\n".repeat(50)}`);
  write(directory, "docs/hikyaku/cycles/001-test/build-01/plan.md", "# plan\n");
  git(directory, "add", "-A");
  git(directory, "commit", "--quiet", "-m", "build");

  const result = JSON.parse(succeeds(directory, "tokens", "history", "build-01", "001", "--base", "main", "--json"));
  assert.equal(result.measured, true);
  const actual = result.diff;
  assert.equal(actual.addedLines, 9);
  assert.equal(actual.implementationLines, 7);
  assert.equal(actual.testLines, 2);
  assert.equal(actual.newFiles, 3);
  assert.deepEqual(actual.generatedPaths, ["package-lock.json"]);
  assert.match(result.markdown, /\| 追加行数 \| 9（実装 7 \/ テスト 2） \|/);

  // 起点を解決できなければ、推測せず計測不可と理由を返す（終了コード 0）
  const missing = JSON.parse(succeeds(directory, "tokens", "history", "build-01", "001", "--base", "no-such-ref", "--json"));
  assert.equal(missing.measured, false);
  assert.match(missing.markdown, /計測不可/);

  write(directory, ".hikyaku.config", `${readFileSync(join(directory, ".hikyaku.config"), "utf8")}\n[diff]\nexclude = []\ntests = ["checks/**"]\n`);
  const overridden = JSON.parse(succeeds(directory, "tokens", "history", "build-01", "001", "--base", "main", "--json")).diff;
  assert.equal(overridden.addedLines, 59);
  assert.equal(overridden.testLines, 4);
  assert.equal(overridden.generatedFiles, 0);
});

test("CLI: tokens session は現在のセッションを測り、見つからなければ計測不可とその理由を返す", (t) => {
  const directory = workspace(t, true);
  const home = temporaryDirectory(t);
  const claudeDir = join(home, "claude");
  const codexDir = join(home, "codex");
  const env = { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir };
  write(claudeDir, `projects/${encodeProjectPath(directory)}/s-main.jsonl`, jsonl([assistant("m1", 45_000), assistant("m2", 90_000)]));

  const current = JSON.parse(cliWith(directory, { ...env, CLAUDE_CODE_SESSION_ID: "s-main" }, "tokens", "session", "--json").stdout);
  assert.equal(current.measured, true);
  assert.equal(current.mode, "current");
  assert.equal(current.session.peak, 90_000);
  assert.equal(current.session.first, 45_000);
  assert.equal(current.session.calls, 2);
  assert.equal(current.hikyakuVersion !== null, true);

  const none = cliWith(directory, env, "tokens", "session", "--json");
  assert.equal(none.status, 0);
  assert.equal(JSON.parse(none.stdout).measured, false);
  assert.match(JSON.parse(none.stdout).reason, /CLAUDE_CODE_SESSION_ID/);

  const cloud = JSON.parse(cliWith(directory, { ...env, CODEX_THREAD_ID: "t-1", CODEX_ENVIRONMENT_ID: "env" }, "tokens", "session", "--json").stdout);
  assert.equal(cloud.measured, false);
  assert.match(cloud.reason, /Codex のクラウド/);
  assert.match(cloud.markdown, /計測不可（Codex のクラウド/);

  // ID の一部だけ一致するファイルは採らない
  write(codexDir, "sessions/2026/10/18/rollout-2026-10-18T00-00-00-xt-1.jsonl", jsonl([codexMeta("main", directory), codexToken(10, 10)]));
  assert.equal(JSON.parse(cliWith(directory, { ...env, CODEX_THREAD_ID: "t-1" }, "tokens", "session", "--json").stdout).measured, false);

  const explicit = JSON.parse(
    cliWith(directory, env, "tokens", "session", "--transcript", join(codexDir, "sessions/2026/10/18/rollout-2026-10-18T00-00-00-xt-1.jsonl"), "--json").stdout,
  );
  assert.equal(explicit.session.host, "codex");
  assert.equal(explicit.hikyakuVersion, null);
});

test("CLI: tokens session <phase> はブランチのセッションから本体を選び、サブエージェントと guardian を除く", (t) => {
  const directory = workspace(t, true);
  const home = temporaryDirectory(t);
  const claudeDir = join(home, "claude");
  const codexDir = join(home, "codex");
  const env = { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir };
  const branch = "hikyaku/001-test/build-01";

  const empty = JSON.parse(cliWith(directory, env, "tokens", "session", "build-01", "001", "--json").stdout);
  assert.equal(empty.branch, branch);
  assert.equal(empty.measured, false);
  assert.match(empty.reason, /セッションが見つかりません/);

  const project = `projects/${encodeProjectPath(directory)}`;
  const withCwd = (line: ReturnType<typeof assistant>) => ({ ...line, cwd: directory });
  write(claudeDir, `${project}/builder.jsonl`, jsonl([
    withCwd(assistant("b0", 44_000, { branch: "main" })),
    ...[1, 2, 3, 4].map((n) => withCwd(assistant(`b${n}`, 100_000 * n))),
  ]).replaceAll('"s-main"', '"builder"'));
  write(claudeDir, `${project}/review.jsonl`, jsonl([1, 2].map((n) => withCwd(assistant(`r${n}`, 30_000 * n)))).replaceAll('"s-main"', '"review"'));
  // worktree（メインの作業ツリーの配下）のディレクトリも拾う
  write(claudeDir, `${project}--claude-worktrees-x/other.jsonl`, jsonl([withCwd({ ...assistant("o1", 10_000), cwd: `${directory}/.claude/worktrees/x` })]).replaceAll('"s-main"', '"other"'));
  // 別のリポジトリの同名ブランチは数えない
  write(claudeDir, "projects/-elsewhere/foreign.jsonl", jsonl([1, 2, 3, 4, 5, 6].map((n) => ({ ...assistant(`f${n}`, 10_000), cwd: "/elsewhere" }))));
  write(codexDir, "sessions/2026/10/18/rollout-2026-10-18T00-00-00-g-1.jsonl", jsonl([
    codexMeta(branch, directory, { id: "g-1", source: { subagent: { other: "guardian" } }, thread_source: "guardian_review" }),
    codexToken(258_000, 258_000),
  ]));

  const result = JSON.parse(cliWith(directory, env, "tokens", "session", "build-01", "001", "--json").stdout);
  assert.equal(result.measured, true);
  assert.equal(result.mode, "branch");
  assert.equal(result.session.sessionId, "builder");
  assert.equal(result.session.peak, 400_000);
  assert.equal(result.session.first, 44_000);
  assert.equal(result.session.calls, 5);
  assert.deepEqual(result.candidates.map((c: { sessionId: string }) => c.sessionId).sort(), ["builder", "other", "review"]);
  assert.deepEqual(result.excluded.map((e: { kind: string }) => e.kind), ["guardian"]);
  assert.equal(result.hikyakuVersion, null);
  assert.match(result.markdown, /本体。ほか 2 件/);
});

test("CLI: tokens history は予測と実測を並べ、--group-by でモデル・ガイドの版ごとに分ける", (t) => {
  const directory = workspace(t, true);
  const cycleDirectory = "docs/hikyaku/cycles/001-test";
  write(directory, `${cycleDirectory}/build-01/retrospective.md`, retrospectiveWithSession("312,400", "claude-opus-5-5", "2.9.0"));
  write(directory, `${cycleDirectory}/build-02/retrospective.md`, retrospectiveWithSession("150,000", "claude-sonnet-5-5", "2.9.0", "プロジェクト v2"));
  write(directory, `${cycleDirectory}/build-03/retrospective.md`, "# 振り返り\n\n## 予測ピークの振り返り\n\n| 段階 | 予測ピーク |\n|---|---|\n| builderフェーズ段階 | 300k |\n");
  write(directory, `${cycleDirectory}/build-04/retrospective.md`, "# 振り返り\n\n## BP見積もりの振り返り\n\n| 段階 | BP |\n|---|---|\n| **実績** | 3BP |\n");
  write(directory, `${cycleDirectory}/build-01/progress.jsonl`, jsonl([
    { at: "2026-10-23T00:00:00Z", skill: "builder", step: "G8", result: "rejected", input: "直して", context: 240_000 },
    { at: "2026-10-23T00:10:00Z", skill: "builder", step: "G8", result: "approved", context: 280_000 },
    { at: "2026-10-23T01:00:00Z", skill: "builder", step: "verify", result: "done", context: 390_000 },
  ]));

  const text = succeeds(directory, "tokens", "history");
  assert.match(text, /312k/);
  assert.match(text, /-88k/);
  assert.match(text, /0\.78/);
  const grouped = JSON.parse(succeeds(directory, "tokens", "history", "--group-by", "model", "--json"));
  assert.deepEqual(grouped.groups.map((g: { key: string; count: number }) => [g.key, g.count]), [
    ["claude-opus-5-5", 1],
    ["claude-sonnet-5-5", 1],
    ["—", 1],
  ]);
  assert.equal(grouped.records.length, 3, "v2 の振り返りは並ばない");
  assert.equal(grouped.records[2].context.peak, undefined);
  assert.equal(grouped.records[0].deviation, 312_400 - 400_000);
  assert.deepEqual(grouped.records[0].checkpoints, { approval: 240_000, implement: 280_000, review: 390_000 });
  assert.deepEqual(grouped.records[2].checkpoints, {});
  const byGuide = JSON.parse(succeeds(directory, "tokens", "history", "--group-by", "guide", "--json"));
  assert.deepEqual(byGuide.groups.map((g: { key: string }) => g.key), ["標準 v1", "プロジェクト v2", "—"]);
  assert.equal(cliWith(directory, {}, "tokens", "history", "--group-by", "branch").status, 1);
});

test("CLI: tokens session <phase> は、別のブランチで始めた Codex の現在のセッションも、いまそのブランチにいれば候補に入れる", (t) => {
  const directory = workspace(t, true);
  const home = temporaryDirectory(t);
  const env = { CLAUDE_CONFIG_DIR: join(home, "claude"), CODEX_HOME: join(home, "codex"), CODEX_THREAD_ID: "t-9" };
  write(env.CODEX_HOME, "sessions/2026/10/18/rollout-2026-10-18T00-00-00-t-9.jsonl", jsonl([
    codexMeta("main", directory, { id: "t-9" }),
    codexToken(40_000, 40_000),
    codexToken(220_000, 260_000),
  ]));

  const elsewhere = JSON.parse(cliWith(directory, env, "tokens", "session", "build-01", "001", "--json").stdout);
  assert.equal(elsewhere.measured, false);

  git(directory, "switch", "--quiet", "-c", "hikyaku/001-test/build-01");
  const onBranch = JSON.parse(cliWith(directory, env, "tokens", "session", "build-01", "001", "--json").stdout);
  assert.equal(onBranch.measured, true);
  assert.equal(onBranch.session.peak, 220_000);
  assert.equal(onBranch.candidates[0].current, true);
  assert.notEqual(onBranch.hikyakuVersion, null);
});
