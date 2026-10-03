import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveState, phaseLabel, readReturn, RETURN_FILE, suggestFor } from "../scripts/lib/phase.mts";
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

test("差し戻し: return.md が無ければ readReturn は undefined で、状態にも載らない", (t) => {
  const directory = temporaryDirectory(t);
  designed(directory);
  assert.equal(readReturn(directory), undefined);
  const state = deriveState(directory, cycle(), [build("1")]);
  assert.equal(state.returned, undefined);
  assert.equal(phaseLabel(state), "building");
  assert.equal(suggestFor(state, "001-test"), "/hikyaku:builder 001-test");
});

test("差し戻し: return.md があれば building のまま差し戻し元のビルドと architect を案内する", (t) => {
  const directory = temporaryDirectory(t);
  designed(directory);
  write(directory, "build-01/issue.md");
  write(directory, "build-01/questions.md");
  write(directory, RETURN_FILE, "# 差し戻し: build-01\n\n## 何が崩れたか\n");
  const state = deriveState(directory, cycle(), [build("1"), build("2")]);
  assert.equal(state.phase, "building");
  assert.deepEqual(state.returned, { buildId: "1" });
  assert.equal(state.resumeAt, undefined);
  assert.deepEqual(
    state.artifacts.filter((artifact) => artifact.present).map((artifact) => artifact.path),
    ["build-01/issue.md", "build-01/questions.md"],
  );
  assert.equal(phaseLabel(state), "building（差し戻し中: build-01）");
  assert.equal(suggestFor(state, "001-test"), "/hikyaku:architect 001-test build-01");
});

test("差し戻し: 見出しの全角コロンとゼロ埋めを正規化して読む", (t) => {
  const directory = temporaryDirectory(t);
  write(directory, RETURN_FILE, "#差し戻し：build-012\n");
  assert.deepEqual(readReturn(directory), { buildId: "12" });
});

test("差し戻し: 見出しから差し戻し元を読めなければビルドを付けずに案内する", (t) => {
  const directory = temporaryDirectory(t);
  designed(directory);
  write(directory, RETURN_FILE, "# 差し戻し\n\nbuild-01 の本文中の言及は読まない\n");
  const state = deriveState(directory, cycle(), [build("1")]);
  assert.deepEqual(state.returned, { buildId: undefined });
  assert.deepEqual(state.artifacts, []);
  assert.equal(phaseLabel(state), "building（差し戻し中）");
  assert.equal(suggestFor(state, "001-test"), "/hikyaku:architect 001-test");
});

test("差し戻し: 全ビルドがマージ済みでも return.md があれば completed より優先する", (t) => {
  const directory = temporaryDirectory(t);
  designed(directory);
  write(directory, RETURN_FILE, "# 差し戻し: build-01\n");
  const builds = [build("1", { pr: "https://example.com/pull/1" })];
  const state = deriveState(directory, cycle(), builds, new Set(["1"]));
  assert.equal(state.phase, "building");
  assert.deepEqual(state.returned, { buildId: "1" });
});

test("差し戻し: 設計成果物がそろう前の return.md はフェーズの導出に影響しない", (t) => {
  const directory = temporaryDirectory(t);
  write(directory, "planning/user-stories.md");
  write(directory, RETURN_FILE, "# 差し戻し: build-01\n");
  const state = deriveState(directory, cycle(), []);
  assert.equal(state.phase, "architecting");
  assert.equal(state.returned, undefined);
});

for (const status of ["closed", "abandoned"] as const) {
  test(`差し戻し: ${status} のサイクルでは return.md を見ない`, (t) => {
    const directory = temporaryDirectory(t);
    write(directory, RETURN_FILE, "# 差し戻し: build-01\n");
    const state = deriveState(directory, cycle("001", { status }), [build("1")]);
    assert.equal(state.phase, status);
    assert.equal(state.returned, undefined);
  });
}
