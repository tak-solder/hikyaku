import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveState } from "../scripts/lib/phase.mts";
import { build, cycle, temporaryDirectory, write } from "./helpers.mts";

function designed(directory: string): void {
  for (const path of ["planning/user-stories.md", "design/design-delta.md", "tasklist.md"]) write(directory, path);
}

test("フェーズ: 任意成果物が無くても必須成果物から再開点を導出する", (t) => {
  const directory = temporaryDirectory(t);
  assert.equal(deriveState(directory, cycle(), []).resumeAt, "planning/user-stories.md");
  write(directory, "planning/user-stories.md");
  const state = deriveState(directory, cycle(), []);
  assert.equal(state.phase, "architecting");
  assert.equal(state.resumeAt, "design/design-delta.md");
});

test("フェーズ: 設計ファイルが揃ってもビルド未登録なら設計中とする", (t) => {
  const directory = temporaryDirectory(t);
  designed(directory);
  const state = deriveState(directory, cycle(), []);
  assert.equal(state.phase, "architecting");
  assert.match(state.resumeAt ?? "", /ビルドが1件も登録されていません/);
});

test("フェーズ: 着手中のビルドの最初の必須成果物から再開する", (t) => {
  const directory = temporaryDirectory(t);
  designed(directory);
  write(directory, "build-02/issue.md");
  const state = deriveState(directory, cycle(), [build("1", { pr: "https://example.com/pull/1" }), build("2")], new Set());
  assert.equal(state.phase, "building");
  assert.equal(state.resumeAt, "build-02/plan.md");
  assert.deepEqual(state.mergePending, ["1"]);
  write(directory, "build-02/plan.md");
  assert.equal(deriveState(directory, cycle(), [build("2")]).resumeAt, "build-02/handoff.md");
});

test("フェーズ: HEAD の PR 列が全件埋まっていてもマージ前は completed にしない", (t) => {
  const directory = temporaryDirectory(t);
  designed(directory);
  const builds = [build("1", { pr: "https://example.com/pull/1" })];
  const pending = deriveState(directory, cycle(), builds, new Set());
  assert.equal(pending.phase, "building");
  assert.equal(pending.resumeAt, undefined);
  assert.deepEqual(pending.mergePending, ["1"]);
  assert.equal(deriveState(directory, cycle(), builds).phase, "building");
  assert.equal(deriveState(directory, cycle(), builds, new Set(["1"])).phase, "completed");
});

for (const status of ["closed", "abandoned"] as const) {
  test(`フェーズ: ${status} は成果物が無くても維持する`, (t) => {
    const state = deriveState(temporaryDirectory(t), cycle("001", { status }), []);
    assert.equal(state.phase, status);
    assert.deepEqual(state.artifacts, []);
    assert.equal(state.resumeAt, undefined);
  });
}
