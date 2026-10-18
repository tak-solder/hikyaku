import assert from "node:assert/strict";
import { test } from "node:test";
import { HikyakuError } from "../scripts/lib/errors.mts";
import { blockedBuilds, graphEdges, nextBuildId, parseTasklist, readyBuilds, renderTasklistFile, validateGraph } from "../scripts/lib/tasklist.mts";
import { build } from "./helpers.mts";

test("tasklist: ビルド ID と依存 ID の接頭辞・ゼロ埋めを同じように正規化する", () => {
  const source = `| buildID | title | BP | dependencies | issue | PR |
| --- | --- | --- | --- | --- | --- |
| build-01 | 基盤 | 2 | — | - | — |
| BUILD-003 | API | — | build-01、 002 | [issue](./build-03/issue.md) | — |`;
  assert.deepEqual(parseTasklist(source), [
    build("1", { title: "基盤" }),
    build("3", { title: "API", bp: undefined, dependsOn: ["1", "2"], issue: "[issue](./build-03/issue.md)" }),
  ]);
});

test("tasklist: 想定テーブルが無いと解析失敗を報告する", () => {
  assert.throws(() => parseTasklist("# ビルド一覧\n"), HikyakuError);
});

test("tasklist: タイトル内の | が PR 列へずれず、生成後もデータを保持する", () => {
  const builds = [build("3", { title: "認証 | 認可", dependsOn: ["1"] }), build("1", { pr: "[#1](https://example.com/pull/1)" })];
  const source = renderTasklistFile("001-test", builds);
  assert.deepEqual(parseTasklist(source), [builds[1], builds[0]]);
  assert.match(source, /b01 --> b03/);
  assert.deepEqual(builds.map((b) => b.id), ["3", "1"]);
});

test("tasklist: 完了済みを除外し、すべての依存が完了したビルドだけ着手可能にする", () => {
  const builds = [
    build("1", { pr: "https://example.com/pull/1" }), build("2"),
    build("3", { dependsOn: ["1"] }), build("4", { dependsOn: ["1", "2"] }),
    build("5", { dependsOn: ["99"] }),
  ];
  assert.deepEqual(readyBuilds(builds).map((b) => b.id), ["2", "3"]);
  assert.deepEqual(blockedBuilds(builds).map((b) => b.id), ["4", "5"]);
});

test("tasklist: 存在しない依存と自己依存を検出する", () => {
  const problems = validateGraph([build("1", { dependsOn: ["1", "99"] })]);
  assert.ok(problems.some((p) => p.message.includes("自分自身")));
  assert.ok(problems.some((p) => p.message.includes("build-99 が存在しません")));
});

test("tasklist: 複数ビルドの循環を検出し、合流するだけのグラフは許可する", () => {
  const cyclic = [build("1", { dependsOn: ["2"] }), build("2", { dependsOn: ["3"] }), build("3", { dependsOn: ["1"] })];
  assert.ok(validateGraph(cyclic).some((p) => p.message.includes("循環")));
  assert.deepEqual(validateGraph([build("1"), build("2", { dependsOn: ["1"] }), build("3", { dependsOn: ["1", "2"] })]), []);
});

test("tasklist: 欠番を埋めず最大 ID の次を採番する", () => {
  assert.equal(nextBuildId([]), "1");
  assert.equal(nextBuildId([build("3"), build("1")]), "4");
});

test("tasklist: 依存グラフは推移的簡約をかけ、他の依存を経由して到達できる辺を描かない", () => {
  const builds = [
    build("1"),
    build("2", { dependsOn: ["1"] }),
    build("3", { dependsOn: ["1", "2"] }),
    build("4", { dependsOn: ["1", "3"] }),
    build("5", { dependsOn: ["2"] }),
    build("6", { dependsOn: ["3", "5", "4"] }),
  ];
  assert.deepEqual(graphEdges(builds), [["1", "2"], ["2", "3"], ["3", "4"], ["2", "5"], ["5", "6"], ["4", "6"]]);
  const graph = renderTasklistFile("001-test", builds);
  assert.doesNotMatch(graph, /b01 --> b03/);
  assert.doesNotMatch(graph, /b03 --> b06/);
  assert.match(graph, /b04 --> b06/);
  // dependencies 列は宣言のまま残す（着手可否と handoff の参照は直接依存で判定するため）
  assert.deepEqual(parseTasklist(graph).find((b) => b.id === "6")?.dependsOn, ["3", "5", "4"]);
});

test("tasklist: 経由する依存が無ければ辺を残し、重複した依存宣言は1本にまとめる", () => {
  const builds = [build("1"), build("2"), build("3", { dependsOn: ["1", "2", "1"] })];
  assert.deepEqual(graphEdges(builds), [["1", "3"], ["2", "3"]]);
});

test("tasklist: 循環があるあいだは簡約せず、宣言された辺をそのまま描く", () => {
  const builds = [build("1", { dependsOn: ["2"] }), build("2", { dependsOn: ["1"] }), build("3", { dependsOn: ["1", "2"] })];
  assert.deepEqual(graphEdges(builds), [["2", "1"], ["1", "2"], ["1", "3"], ["2", "3"]]);
});
