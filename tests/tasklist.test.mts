import assert from "node:assert/strict";
import { test } from "node:test";
import { HikyakuError } from "../scripts/lib/errors.mts";
import { type BuildRecord, blockedBuilds, graphEdges, isLegacyTasklist, nextBuildId, parseTasklist, readyBuilds, renderGraph, renderTasklistFile, validateGraph } from "../scripts/lib/tasklist.mts";
import { build } from "./helpers.mts";

test("tasklist: ビルド ID と依存 ID の接頭辞・ゼロ埋めを同じように正規化する", () => {
  const source = `| buildID | title | 予測ピーク | dependencies | PR |
| --- | --- | --- | --- | --- |
| build-01 | 基盤 | 350k | — | — |
| BUILD-003 | API | — | build-01、 002 | — |`;
  assert.deepEqual(parseTasklist(source), [
    build("1", { title: "基盤" }),
    build("3", { title: "API", peak: undefined, dependsOn: ["1", "2"] }),
  ]);
});

test("tasklist: issue 列のある見出し（v3 のベータ版）を読み、書き戻すと列を落とす", () => {
  const source = `| buildID | title | 予測ピーク | dependencies | issue | PR |
| --- | --- | --- | --- | --- | --- |
| 1 | 基盤 | 350k | — | [#12](https://example.com/issues/12) | [#3](https://example.com/pull/3) |
| 2 | API | 300k | 1 | [issue](./build-02/issue.md) | — |`;
  assert.equal(isLegacyTasklist(source), false);
  const builds = parseTasklist(source);
  assert.deepEqual(builds, [
    build("1", { title: "基盤", pr: "[#3](https://example.com/pull/3)" }),
    build("2", { title: "API", peak: 300_000, dependsOn: ["1"] }),
  ]);
  const rendered = renderTasklistFile("001-test", builds);
  assert.doesNotMatch(rendered, /\| issue \|/);
  assert.deepEqual(parseTasklist(rendered), builds);
});

test("tasklist: v2 の見出し（BP 列）は読めるが、BP は予測ピークとして読まない", () => {
  const source = `| buildID | title | BP | dependencies | issue | PR |
| --- | --- | --- | --- | --- | --- |
| 1 | 基盤 | 3 | — | - | [#5](https://example.com/pull/5) |`;
  assert.equal(isLegacyTasklist(source), true);
  assert.deepEqual(parseTasklist(source), [build("1", { title: "基盤", peak: undefined, pr: "[#5](https://example.com/pull/5)" })]);
  assert.equal(isLegacyTasklist(renderTasklistFile("001-test", [build("1")])), false);
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
  assert.doesNotMatch(graph, /b01 -(-|\.)-?> b03/);
  assert.doesNotMatch(graph, /b03 -(-|\.)-?> b06/);
  assert.match(graph, /b04 -\.-> b06/);
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

test("tasklist: グラフのノードを完了・着手可能・待機中で色分けし、先行が未完了の依存線を点線にする", () => {
  const builds = [
    build("1", { pr: "[#1](https://example.com/pull/1)" }),
    build("2", { dependsOn: ["1"] }),
    build("3", { dependsOn: ["2"] }),
    build("4", { dependsOn: ["1"] }),
  ];
  const lines = renderGraph(builds).split("\n");
  // 完了は自分のノードの行に付く。先行が完了している線は実線
  assert.ok(lines.includes('  b01["build-01: ビルド 1"]:::merged'));
  assert.ok(lines.includes("  b01 --> b02"));
  assert.ok(lines.includes("  b01 --> b04"));
  // 着手可能（2・4）は何も付かず、既定の色になる。待機中（3）は未完了の先行ビルドの線が付ける
  assert.ok(lines.includes('  b02["build-02: ビルド 2"]'));
  assert.ok(lines.includes('  b04["build-04: ビルド 4"]'));
  assert.ok(lines.includes("  b02 -.-> b03:::blocked"));
  assert.ok(lines.some((line) => line.startsWith("  classDef default fill:#dafbe1")));
  for (const state of ["merged", "blocked"]) {
    assert.ok(lines.some((line) => line.startsWith(`  classDef ${state} `)));
  }
});

test("tasklist: 複数のビルドの状態を1行にまとめない（class の列挙と linkStyle を書かない）", () => {
  const graph = renderGraph([build("1", { pr: "[#1](https://example.com/pull/1)" }), build("2"), build("3", { dependsOn: ["1", "2"] })]);
  assert.doesNotMatch(graph, /linkStyle|^\s*class /m);
});

test("tasklist: 全ビルドが完了していれば点線と待機中の指定を出さない", () => {
  const done = "[#1](https://example.com/pull/1)";
  const graph = renderGraph([build("1", { pr: done }), build("2", { dependsOn: ["1"], pr: done })]);
  assert.doesNotMatch(graph, /-\.->|:::blocked/);
  assert.match(graph, /b01\[.*\]:::merged/);
  assert.match(graph, /b02\[.*\]:::merged/);
});

test("tasklist: 存在しない依存先を持つビルドは待機中として描く", () => {
  const graph = renderGraph([build("2", { dependsOn: ["9"] })]);
  assert.match(graph, /b09 -\.-> b02:::blocked/);
});

/** Git の3方向マージを行単位で真似る。両側が同じ行か隣り合う行を変えていたらコンフリクト */
function mergeLines(base: string[], ours: string[], theirs: string[]): string[] | "conflict" {
  if (ours.length !== base.length || theirs.length !== base.length) return "conflict";
  const changed = (side: string[]): number[] => side.flatMap((line, i) => (line === base[i] ? [] : [i]));
  const mine = changed(ours);
  for (const i of changed(theirs)) {
    if (mine.some((j) => Math.abs(i - j) <= 1)) return "conflict";
  }
  return base.map((line, i) => (ours[i] === line ? theirs[i]! : ours[i]!));
}

test("tasklist: 並行するビルドの done はコンフリクトせず、マージ結果が両方完了の図になる", () => {
  const pr = (n: string): string => `[#${n}](https://example.com/owner/repo/pull/${n})`;
  const builds = [
    build("1"), build("2"), build("3"),
    build("4", { dependsOn: ["1", "2"] }), build("5", { dependsOn: ["4", "3"] }),
  ];
  const done = (...ids: string[]): BuildRecord[] => builds.map((b) => (ids.includes(b.id) ? { ...b, pr: pr(b.id) } : b));

  // 図: buildID が隣でも（1 と 2）、同じ後続（4）を持っていてもマージできる。
  // どちらの PR も 4 を「着手可能」とは書かないが、両方の線が実線になると 4 は既定の色（着手可能）になる
  const graph = (list: BuildRecord[]): string[] => renderGraph(list).split("\n");
  const merged = mergeLines(graph(builds), graph(done("1")), graph(done("2")));
  assert.deepEqual(merged, graph(done("1", "2")));
  assert.ok((merged as string[]).every((line) => !/b04:::blocked/.test(line)));

  // tasklist.md 全体: PR 列の幅が変わっても、自分の行と自分のブロックしか変わらない
  const file = (list: BuildRecord[]): string[] => renderTasklistFile("001-test", list).split("\n");
  assert.deepEqual(mergeLines(file(builds), file(done("1")), file(done("3"))), file(done("1", "3")));
});

test("tasklist: tasklist.md に色の凡例を載せる", () => {
  assert.match(renderTasklistFile("001-test", [build("1")]), /紫: 完了（merged）/);
});
