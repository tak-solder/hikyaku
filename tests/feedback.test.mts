import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cli, cliWith, repository, succeeds, temporaryDirectory, workspace, write } from "./helpers.mts";
import {
  feedbackDate,
  feedbackPath,
  insideWorkTree,
  isIgnored,
  pickFeedbackFields,
  progressFiles,
  renderFeedback,
  summarizeProgress,
  upstreamItems,
  type FeedbackEvent,
  type FeedbackSummary,
} from "../scripts/lib/feedback.mts";
import { readProgress, type ProgressEvent } from "../scripts/lib/progress.mts";

const ROOT = "docs/hikyaku";

function jsonl(events: object[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function event(at: string, skill: string, step: string, result: FeedbackEvent["result"], extra: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return { at, skill, step, result, ...extra };
}

const EMPTY: FeedbackSummary = { failed: [], gates: [], versions: [], upstream: [] };

test("progressFiles: サイクル（中の patch を含む）を再帰で集め、feedback/ とサイクルに属さない patches/ は集めない", (t) => {
  const root = temporaryDirectory(t);
  write(root, "cycles/001-secret-billing/build-03/progress.jsonl", "");
  write(root, "cycles/001-secret-billing/design/progress.jsonl", "");
  write(root, "cycles/001-secret-billing/patches/202611/fix-login/progress.jsonl", "");
  write(root, "patches/202611/fix-other/progress.jsonl", "");
  write(root, "feedback/progress.jsonl", "");
  assert.deepEqual(progressFiles(root), [
    join(root, "cycles/001-secret-billing/build-03/progress.jsonl"),
    join(root, "cycles/001-secret-billing/design/progress.jsonl"),
    join(root, "cycles/001-secret-billing/patches/202611/fix-login/progress.jsonl"),
  ]);
});

test("progressFiles: 記録が1件も無ければ空", (t) => {
  const root = temporaryDirectory(t);
  write(root, "cycles.md", "# cycles\n");
  assert.deepEqual(progressFiles(root), []);
});

test("summarizeProgress: failed を skill・step ごとに数え、ほかの結果は数えない", () => {
  const a = [event("2026-11-01T10:00:00Z", "builder", "test", "failed"), event("2026-11-01T10:01:00Z", "builder", "test", "failed")];
  const b = [
    event("2026-11-01T10:00:00Z", "builder", "test", "failed"),
    event("2026-11-01T10:00:00Z", "architect", "plan-review", "failed"),
    event("2026-11-01T10:00:00Z", "builder", "verify", "done"),
    event("2026-11-01T10:00:00Z", "builder", "verify", "skipped"),
  ];
  assert.deepEqual(summarizeProgress([a, b]).failed, [
    { skill: "architect", step: "plan-review", count: 1 },
    { skill: "builder", step: "test", count: 3 },
  ]);
});

test("summarizeProgress: ゲートの時間は同じファイルの直前の記録との差（分）で、rejected も数える", () => {
  const summary = summarizeProgress([
    [event("2026-11-01T10:00:00Z", "planner", "stories", "done"), event("2026-11-01T10:30:00Z", "planner", "G1", "approved")],
    [event("2026-11-01T09:00:00Z", "architect", "design", "done"), event("2026-11-01T09:12:00Z", "architect", "G3", "rejected")],
  ]);
  assert.deepEqual(summary.gates, [
    { skill: "architect", step: "G3", count: 1, medianMinutes: 12 },
    { skill: "planner", step: "G1", count: 1, medianMinutes: 30 },
  ]);
});

test("summarizeProgress: 直前の記録が別のスキルなら数えない（内部スキルの作業をゲートの待ちに数えない）", () => {
  const summary = summarizeProgress([[
    event("2026-11-01T10:00:00Z", "builder", "test-spec-review", "done"),
    event("2026-11-01T10:05:00Z", "build-manager", "update", "done"),
    event("2026-11-01T10:45:00Z", "build-manager", "write", "done"),
    event("2026-11-01T10:50:00Z", "builder", "G8", "approved"),
  ]]);
  assert.deepEqual(summary.gates, []);
});

test("summarizeProgress: 同じゲートは中央値でまとめる（偶数なら中央の2つの平均）", () => {
  const gate = (start: string, minutes: number): FeedbackEvent[] => [
    event(start, "builder", "plan", "done"),
    event(new Date(Date.parse(start) + minutes * 60_000).toISOString(), "builder", "G8", "approved"),
  ];
  const odd = summarizeProgress([gate("2026-11-01T00:00:00Z", 5), gate("2026-11-02T00:00:00Z", 20), gate("2026-11-03T00:00:00Z", 90)]);
  assert.deepEqual(odd.gates, [{ skill: "builder", step: "G8", count: 3, medianMinutes: 20 }]);
  const even = summarizeProgress([gate("2026-11-01T00:00:00Z", 10), gate("2026-11-02T00:00:00Z", 30)]);
  assert.equal(even.gates[0]?.medianMinutes, 20);
});

test("summarizeProgress: 先頭・restart の直後・差が負・読めない日時のゲートと、ファイルをまたぐ差は数えない", () => {
  const summary = summarizeProgress([
    [event("2026-11-01T10:00:00Z", "planner", "G1", "approved")],
    [event("2026-11-01T10:00:00Z", "architect", "design", "done")],
    [event("2026-11-01T10:05:00Z", "architect", "G2", "approved")],
    [
      event("2026-11-01T10:00:00Z", "architect", "design", "done"),
      event("2026-11-01T11:00:00Z", "architect", "*", "restart"),
      event("2026-11-01T11:40:00Z", "architect", "G3", "approved"),
    ],
    [event("2026-11-01T10:30:00Z", "builder", "plan", "done"), event("2026-11-01T10:00:00Z", "builder", "G8", "approved")],
    [event("not-a-date", "builder", "plan", "done"), event("2026-11-01T10:00:00Z", "builder", "G9", "approved")],
  ]);
  assert.deepEqual(summary.gates, []);
});

test("summarizeProgress: 同じゲートの rejected の直後（手直しの時間）は数えない", () => {
  const summary = summarizeProgress([[
    event("2026-11-01T09:50:00Z", "builder", "test-spec-review", "done"),
    event("2026-11-01T10:00:00Z", "builder", "G8", "rejected"),
    event("2026-11-01T13:00:00Z", "builder", "G8", "approved"),
  ]]);
  assert.deepEqual(summary.gates, [{ skill: "builder", step: "G8", count: 1, medianMinutes: 10 }]);
});

test("summarizeProgress: round を読まずにまとめ、版を重複なしで集め、件数や最大値は返さない", () => {
  const withRound = (entry: FeedbackEvent, round: string): FeedbackEvent => pickFeedbackFields({ ...entry, round });
  const summary = summarizeProgress([
    [
      withRound(event("2026-11-01T10:00:00Z", "architect", "design", "done", { hikyaku: "3.0.0" }), "return"),
      withRound(event("2026-11-01T10:10:00Z", "architect", "G3", "approved", { hikyaku: "3.0.0" }), "return"),
    ],
    [
      withRound(event("2026-11-01T10:00:00Z", "architect", "design", "done", { hikyaku: "3.1.0" }), "add"),
      withRound(event("2026-11-01T10:20:00Z", "architect", "G3", "approved"), "add"),
    ],
  ]);
  assert.deepEqual(summary.gates, [{ skill: "architect", step: "G3", count: 2, medianMinutes: 15 }]);
  assert.deepEqual(summary.versions, ["3.0.0", "3.1.0"]);
  assert.deepEqual(Object.keys(summary).sort(), ["failed", "gates", "versions"]);
});

test("pickFeedbackFields: input・reason・pr・session・round を写さない", () => {
  const full: ProgressEvent = {
    at: "2026-11-01T10:00:00Z", skill: "builder", step: "G8", result: "approved", round: "return", hikyaku: "3.0.0",
    input: "顧客 ACME の要件で承認", reason: "理由", pr: "https://github.com/acme/secret/pull/42", session: "sess-abc123", peak: 300_000, context: 1,
  };
  assert.deepEqual(pickFeedbackFields(full), {
    at: "2026-11-01T10:00:00Z", skill: "builder", step: "G8", result: "approved", hikyaku: "3.0.0",
  });
});

test("upstreamItems: すべてのサイクルの upstream の本文だけを返し、どこから来たかを含めない", (t) => {
  const directory = workspace(t);
  succeeds(directory, "cycle", "new", "secret-billing", "--profile", "standard");
  succeeds(directory, "cycle", "new", "acme-portal", "--profile", "standard");
  write(directory, `${ROOT}/cycles/001-secret-billing/build-02/handoff.md`, [
    "## 永続化すること",
    "- `upstream`: tasklist add --dry-run が相互依存を評価できない",
    "- `constraints` [高]: 請求 API は 1 分あたり 100 件まで（防ぐ: 超過 / 立つ: 契約）",
    "",
  ].join("\n"));
  write(directory, `${ROOT}/cycles/002-acme-portal/build-01/retrospective.md`, "## 永続化すること\n- `upstream`: step next が restart を二重に数える\n");
  const items = upstreamItems(join(directory, ROOT));
  assert.deepEqual(items.sort(), ["step next が restart を二重に数える", "tasklist add --dry-run が相互依存を評価できない"]);
});

test("renderFeedback: 節がそろい、集計と注意と下書きの枠を書き、送る処理を含まない", () => {
  const text = renderFeedback({
    failed: [{ skill: "builder", step: "test", count: 3 }],
    gates: [{ skill: "planner", step: "G1", count: 2, medianMinutes: 30 }],
    versions: ["3.0.0"],
    upstream: ["tasklist add --dry-run が相互依存を評価できない"],
  }, "20261117");
  const headings = text.split("\n").filter((line) => line.startsWith("## "));
  assert.deepEqual(headings, ["## 使い方", "## 止まった手順", "## ゲートにかかった時間", "## upstream", "## 起票の下書き", "## 概要", "## 記録から"]);
  assert.match(text, /\| builder \| test \| 3 \|/);
  assert.match(text, /\| planner \| G1 \| 2 \| 30 \|/);
  assert.match(text, /- tasklist add --dry-run が相互依存を評価できない/);
  assert.match(text, /送る前に全文を読んでください/);
  assert.match(text, /ユーザーが決め/);
  assert.match(text, /起票はユーザーが行います/);
  assert.match(text, /タイトル: \[feedback\]/);
  assert.match(text, /Hikyaku の版: 3\.0\.0/);
  assert.doesNotMatch(text, /gh issue|curl|https?:\/\//);
});

test("renderFeedback: 集計が空でも節は欠けず「なし」と書く", () => {
  const text = renderFeedback(EMPTY, "20261117");
  for (const heading of ["## 使い方", "## 止まった手順", "## ゲートにかかった時間", "## upstream", "## 起票の下書き"]) {
    assert.ok(text.includes(heading), heading);
  }
  assert.equal(text.split("\n").filter((line) => line === "なし").length, 3);
});

test("feedbackPath・feedbackDate: HIKYAKU_ROOT の feedback/{YYYYMMDD}.md", () => {
  assert.equal(feedbackPath("/repo/.hikyaku", "20261117"), "/repo/.hikyaku/feedback/20261117.md");
  assert.equal(feedbackDate(new Date(2026, 10, 7)), "20261107");
});

test("isIgnored: まだ無い feedback/ でも書き出すファイルで判定し、無ければ・git でなければ false", (t) => {
  const directory = repository(t);
  write(directory, ".hikyaku/.gitignore", ".hikyaku.local\n");
  assert.equal(isIgnored(directory, join(directory, ".hikyaku/feedback/20261117.md")), false);
  write(directory, ".hikyaku/.gitignore", ".hikyaku.local\nfeedback/\n");
  assert.equal(isIgnored(directory, join(directory, ".hikyaku/feedback/20261117.md")), true);
  const plain = temporaryDirectory(t);
  assert.equal(isIgnored(plain, join(plain, "feedback/20261117.md")), false);
});

/** 中身になりうる値を散りばめたフィクスチャ */
function sensitiveWorkspace(t: Parameters<typeof workspace>[0]): string {
  const directory = workspace(t);
  succeeds(directory, "cycle", "new", "secret-billing", "--profile", "standard");
  const secret = { input: "顧客 ACME の要件で承認", reason: "請求テーブルの移行が失敗", pr: "https://github.com/acme/secret/pull/42", session: "sess-abc123" };
  write(directory, `${ROOT}/cycles/001-secret-billing/build-07/progress.jsonl`, jsonl([
    { at: "2026-11-01T10:00:00Z", skill: "builder", step: "plan", result: "done", ...secret },
    { at: "2026-11-01T10:20:00Z", skill: "builder", step: "G8", result: "approved", round: "return", ...secret },
    { at: "2026-11-01T10:30:00Z", skill: "builder", step: "verify", result: "failed", ...secret },
  ]));
  write(directory, `${ROOT}/cycles/001-secret-billing/patches/202611/fix-acme-login/progress.jsonl`, jsonl([
    { at: "2026-11-02T10:00:00Z", skill: "patch", step: "verify", result: "failed", ...secret },
  ]));
  return directory;
}

const LEAKS = ["secret-billing", "001-", "build-07", "fix-acme-login", "202611/", "顧客 ACME", "請求テーブルの移行", "pull/42", "sess-abc123", "return"];

test("feedback export: 中身を含まない書き出しを feedback/{YYYYMMDD}.md に作り、追跡対象にならない", (t) => {
  const directory = sensitiveWorkspace(t);
  const output = JSON.parse(succeeds(directory, "feedback", "export", "--json"));
  const path = join(directory, output.file);
  assert.equal(output.file, `${ROOT}/feedback/${feedbackDate()}.md`);
  const text = readFileSync(path, "utf8");
  for (const leak of LEAKS) assert.ok(!text.includes(leak), `${leak} が書き出しに含まれる`);
  assert.match(text, /\| builder \| verify \| 1 \|/);
  assert.match(text, /\| patch \| verify \| 1 \|/);
  assert.match(text, /\| builder \| G8 \| 1 \| 20 \|/);
  assert.deepEqual(Object.keys(output).sort(), ["content", "dryRun", "file"]);
  // git status に現れない（追跡対象外）
  assert.equal(isIgnored(directory, path), true);
});

test("feedback export: 同じ日の書き出しがあれば上書きせず、別の名前で書き出す", (t) => {
  const directory = sensitiveWorkspace(t);
  const first = JSON.parse(succeeds(directory, "feedback", "export", "--json")).file as string;
  write(directory, first, "# ユーザーが削った書き出し\n");
  const second = JSON.parse(succeeds(directory, "feedback", "export", "--json")).file as string;
  assert.equal(second, `${ROOT}/feedback/${feedbackDate()}-2.md`);
  assert.equal(readFileSync(join(directory, first), "utf8"), "# ユーザーが削った書き出し\n");
});

test("feedback export --dry-run: 本文を表示して書かない", (t) => {
  const directory = sensitiveWorkspace(t);
  const stdout = succeeds(directory, "feedback", "export", "--dry-run");
  assert.match(stdout, /## 使い方/);
  assert.match(stdout, /## 起票の下書き/);
  assert.match(stdout, /--dry-run/);
  assert.equal(existsSync(join(directory, ROOT, "feedback")), false);
});

test("feedback export: feedback/ が追跡対象なら（--dry-run でも）書き出さずに止まる", (t) => {
  const directory = workspace(t);
  write(directory, `${ROOT}/.gitignore`, ".hikyaku.local\n");
  for (const args of [[], ["--dry-run"]]) {
    const result = cli(directory, "feedback", "export", ...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /feedback\/ を足してください/);
  }
  assert.equal(existsSync(join(directory, ROOT, "feedback")), false);
});

test("insideWorkTree: git の作業ツリーの中だけ true", (t) => {
  assert.equal(insideWorkTree(repository(t)), true);
  assert.equal(insideWorkTree(temporaryDirectory(t)), false);
});

test("feedback export: 作業ツリーの外では「追跡対象」ではなく、確かめられないことを示して止まる", (t) => {
  const directory = workspace(t);
  rmSync(join(directory, ".git"), { recursive: true, force: true });
  const result = cli(directory, "feedback", "export");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /確かめられません/);
  assert.doesNotMatch(result.stderr, /追跡対象のため/);
  assert.equal(existsSync(join(directory, ROOT, "feedback")), false);
});

test("feedback export: 壊れた progress.jsonl はエラーにして書き出さない", (t) => {
  const directory = workspace(t);
  write(directory, `${ROOT}/cycles/001-a/build-01/progress.jsonl`, '{"at":"2026-11-01T10:00:00Z","skill":"builder","step":"plan","result":"done"}\n{"at":\n');
  const result = cli(directory, "feedback", "export");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /progress\.jsonl/);
  assert.equal(existsSync(join(directory, ROOT, "feedback")), false);
});

test("feedback export: gh・curl を呼ばない", (t) => {
  const directory = sensitiveWorkspace(t);
  const bin = mkdtempSync(join(tmpdir(), "hikyaku-fake-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const log = join(bin, "called.log");
  for (const name of ["gh", "curl"]) {
    write(bin, name, `#!/bin/sh\necho ${name} >> "${log}"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const result = cliWith(directory, { PATH: `${bin}:${process.env["PATH"] ?? ""}` }, "feedback", "export");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(log), false);
});

test("readProgress → pickFeedbackFields: フィクスチャの欄を絞れる", (t) => {
  const directory = sensitiveWorkspace(t);
  const events = readProgress(join(directory, ROOT, "cycles/001-secret-billing/build-07")).map(pickFeedbackFields);
  assert.ok(events.every((entry) => !("input" in entry) && !("reason" in entry) && !("pr" in entry) && !("session" in entry)));
});
