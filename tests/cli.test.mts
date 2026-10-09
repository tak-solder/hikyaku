import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pluginVersion } from "../scripts/lib/paths.mts";
import { cli, repository, snapshot, succeeds, workspace, write } from "./helpers.mts";

const tasklist = "docs/hikyaku/cycles/001-test/tasklist.md";

test("CLI: version・help は成功し、引数なし・不明なコマンドは終了コード 1", (t) => {
  const directory = repository(t);
  assert.equal(succeeds(directory, "version").trim(), pluginVersion());
  assert.equal(succeeds(directory, "--version").trim(), pluginVersion());
  assert.match(succeeds(directory, "--help"), /Hikyaku/);
  assert.match(succeeds(directory, "tasklist", "add", "--help"), /--title/);
  const missing = cli(directory);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /Hikyaku/);
  assert.equal(cli(directory, "unknown-command").status, 1);
});

test("CLI: init の dry-run は生成予定を JSON で返し、ファイルを作らない", (t) => {
  const directory = repository(t);
  const before = snapshot(directory);
  const output = JSON.parse(succeeds(directory, "init", "--root", "docs/hikyaku", "--dry-run", "--json"));
  assert.equal(output.dryRun, true);
  assert.equal(output.files.length, 7);
  assert.ok(output.files.every((file: { status: string }) => file.status === "create"));
  assert.deepEqual(snapshot(directory), before);
  assert.equal(existsSync(join(directory, "docs/hikyaku")), false);
});

test("CLI: init を再実行しても既存文書を上書きせず、gitignore の追記を重複させない", (t) => {
  const directory = workspace(t);
  write(directory, "docs/hikyaku/.gitignore", "custom-entry");
  write(directory, "docs/hikyaku/document-guide.md", "# 手書きのガイド\n");
  succeeds(directory, "init", "--root", "docs/hikyaku");
  const before = snapshot(directory);
  succeeds(directory, "init", "--root", "docs/hikyaku");
  assert.deepEqual(snapshot(directory), before);
  assert.equal(readFileSync(join(directory, "docs/hikyaku/document-guide.md"), "utf8"), "# 手書きのガイド\n");
  assert.match(readFileSync(join(directory, "docs/hikyaku/.gitignore"), "utf8"), /^custom-entry\n/);
  assert.equal(readFileSync(join(directory, "docs/hikyaku/.gitignore"), "utf8").split("\n").filter((line) => line === ".hikyaku.local").length, 1);
});

test("CLI: 正規化するとリポジトリルートになる init のパスを拒否する", (t) => {
  const directory = repository(t);
  for (const root of [".", "sub/..", `${directory}/.`]) {
    const result = cli(directory, "init", "--root", root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /リポジトリルート自身/);
  }
  assert.deepEqual(snapshot(directory), {});
});

test("CLI: cycle new の dry-run は索引とサイクル設定を書き込まない", (t) => {
  const directory = workspace(t);
  const before = snapshot(directory);
  const output = JSON.parse(succeeds(directory, "cycle", "new", "User Auth", "--profile", "standard", "--branch-prefix", "work", "--dry-run", "--json"));
  assert.equal(output.cycle.id, "001");
  assert.equal(output.cycle.slug, "user-auth");
  assert.equal(output.dryRun, true);
  assert.ok(output.cycleConfig);
  assert.deepEqual(snapshot(directory), before);
  assert.equal(existsSync(output.directory), false);
});

test("CLI: tasklist の dry-run とグラフ検証失敗はいずれも既存データを書き換えない", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--bp", "2");
  const before = snapshot(directory);
  const output = JSON.parse(succeeds(directory, "tasklist", "add", "001", "--title", "API", "--deps", "build-01", "--dry-run", "--json"));
  assert.equal(output.dryRun, true);
  assert.deepEqual(snapshot(directory), before);
  const invalid = cli(directory, "tasklist", "add", "001", "--title", "不正", "--deps", "99", "--json");
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stderr).ok, false);
  assert.match(invalid.stderr, /build-99/);
  assert.deepEqual(snapshot(directory), before);
});

test("CLI: tasklist done は URL を検証し、PR を記録すると完了済みの更新を拒否する", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤");
  const before = snapshot(directory);
  assert.equal(cli(directory, "tasklist", "done", "001", "--id", "1", "--pr", "typo").status, 1);
  assert.deepEqual(snapshot(directory), before);
  succeeds(directory, "tasklist", "done", "001", "--id", "build-01", "--pr", "https://example.com/pull/42", "--dry-run");
  assert.deepEqual(snapshot(directory), before);
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", "https://example.com/pull/42");
  const output = JSON.parse(succeeds(directory, "tasklist", "read", "001", "--json"));
  assert.equal(output.builds[0].pr, "[#42](https://example.com/pull/42)");
  const completed = snapshot(directory);
  assert.equal(cli(directory, "tasklist", "update", "001", "--id", "1", "--title", "変更").status, 1);
  assert.deepEqual(snapshot(directory), completed);
});

test("CLI: validate は正常時 0、不整合は JSON と終了コード 2、対象の誤指定は 1", (t) => {
  const directory = workspace(t, true);
  assert.equal(JSON.parse(succeeds(directory, "validate", "--json")).ok, true);
  assert.equal(cli(directory, "validate", "missing", "--json").status, 1);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤");
  const invalid = cli(directory, "validate", "--json");
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).ok, false);
  assert.match(invalid.stderr, /issue.md がありません/);
  write(directory, "docs/hikyaku/cycles/001-test/build-01/issue.md");
  assert.equal(JSON.parse(succeeds(directory, "validate", "--json")).ok, true);
  assert.ok(readFileSync(join(directory, tasklist), "utf8").includes("基盤"));
});

test("CLI: validate は番号付きの受け入れ基準がビルドに割り当てられているかを検査する", (t) => {
  const directory = workspace(t, true);
  const cycle = "docs/hikyaku/cycles/001-test";
  write(directory, `${cycle}/planning/user-stories.md`, "## US-1: 認証\n- [ ] US-1.1: ログインできる\n- [ ] US-1.2: ログアウトできる\n");
  // ビルド分割の前は割り当てが無くて当然なので通る
  assert.equal(JSON.parse(succeeds(directory, "validate", "--json")).ok, true);

  succeeds(directory, "tasklist", "add", "001", "--title", "認証");
  write(directory, `${cycle}/build-01/issue.md`, "# Build 01: 認証\n\n## 対応する受け入れ基準\n\n- US-1.1\n");
  const result = cli(directory, "validate", "--json");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /割り当てられていない受け入れ基準があります: US-1\.2/);

  write(directory, `${cycle}/build-01/issue.md`, "# Build 01: 認証\n\n## 対応する受け入れ基準\n\n- US-1.1, US-1.2\n");
  assert.equal(JSON.parse(succeeds(directory, "validate", "--json")).ok, true);
});

test("CLI: validate は手編集されたサイクル間の循環依存を検出する", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "cycle", "new", "second", "--profile", "standard", "--depends", "001");
  const path = join(directory, "docs/hikyaku/cycles.md");
  // 001 の依存を 002 にして、002 → 001 → 002 の循環を作る。
  const lines = readFileSync(path, "utf8").split("\n");
  const index = lines.findIndex((line) => /^\| 001\s*\|/.test(line));
  assert.ok(index >= 0);
  const cells = (lines[index] as string).split("|");
  cells[8] = " 002 ";
  lines[index] = cells.join("|");
  write(directory, "docs/hikyaku/cycles.md", lines.join("\n"));
  const result = cli(directory, "validate", "--json");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /サイクル間の依存に循環/);
});

test("CLI: validate は BP ガイドの表が古い場合と期待値の不一致を検出する", (t) => {
  const directory = workspace(t);
  write(directory, "docs/hikyaku/bp-guide/README.md", "# 古い説明\n");
  let result = cli(directory, "validate", "--json");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /食い違っています/);
  succeeds(directory, "bp", "render");
  write(directory, "docs/hikyaku/bp-guide/cases.toml", `[cases.mismatch]\nexpect = 999\n[cases.mismatch.input]\nnew_files = 1\n`);
  result = cli(directory, "validate", "--json");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /期待 999/);
  rmSync(join(directory, "docs/hikyaku/bp-guide/cases.toml"));
  assert.equal(JSON.parse(succeeds(directory, "validate", "--json")).ok, true);
});

test("CLI: return.md があれば cycle status・next・cycle list が差し戻し中として扱う", (t) => {
  const directory = workspace(t, true);
  const cycleDirectory = "docs/hikyaku/cycles/001-test";
  write(directory, `${cycleDirectory}/planning/user-stories.md`);
  write(directory, `${cycleDirectory}/design/design-delta.md`);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤");
  succeeds(directory, "tasklist", "add", "001", "--title", "API");

  const normal = JSON.parse(succeeds(directory, "next", "001", "--no-fetch", "--json"));
  assert.equal(normal.returned, null);
  assert.deepEqual(normal.available, ["1", "2"]);

  write(directory, `${cycleDirectory}/return.md`, "# 差し戻し: build-01\n\n## 何が崩れたか\n");

  const status = JSON.parse(succeeds(directory, "cycle", "status", "001", "--no-fetch", "--json"));
  assert.equal(status.phase, "building");
  assert.deepEqual(status.returned, { buildId: "1" });
  assert.equal(status.suggestion, "/hikyaku:architect 001-test build-01");
  const text = succeeds(directory, "cycle", "status", "001", "--no-fetch");
  assert.match(text, /^cycle 001-test: building（差し戻し中: build-01）/);
  assert.match(text, /再開: \/hikyaku:architect 001-test build-01/);

  const next = JSON.parse(succeeds(directory, "next", "001", "--no-fetch", "--json"));
  assert.deepEqual(next.returned, { buildId: "1" });
  assert.deepEqual(next.available, []);
  assert.match(succeeds(directory, "next", "001", "--no-fetch"), /どのビルドにも着手できません/);

  const list = JSON.parse(succeeds(directory, "cycle", "list", "--json"));
  assert.equal(list.cycles[0].phase, "building");
  assert.deepEqual(list.cycles[0].returned, { buildId: "1" });
  assert.match(succeeds(directory, "cycle", "list"), /building（差し戻し中: build-01）/);

  // architect が再設計の最後に return.md を消すと、通常の再開に戻る
  rmSync(join(directory, cycleDirectory, "return.md"));
  const resumed = JSON.parse(succeeds(directory, "cycle", "status", "001", "--no-fetch", "--json"));
  assert.equal(resumed.returned, null);
  assert.equal(resumed.suggestion, "/hikyaku:builder 001-test");
});
