import assert from "node:assert/strict";
import { test } from "node:test";
import { HikyakuError } from "../scripts/lib/errors.mts";
import { blockedBuilds, nextBuildId, parseTasklist, readyBuilds, renderTasklistFile, validateGraph } from "../scripts/lib/tasklist.mts";
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
