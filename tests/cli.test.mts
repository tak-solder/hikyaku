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
  assert.equal(output.files.length, 4, "bp-guide/ も token-guide/ も生成しない");
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
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
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

test("CLI: tokens stamp は標準からガイドを作り、本文を変えたら版を上げる。版を上げ忘れると validate が止める", (t) => {
  const directory = workspace(t);
  const guide = "docs/hikyaku/token-guide/guide.md";
  const shown = JSON.parse(succeeds(directory, "tokens", "guide", "--json"));
  assert.equal(shown.kind, "standard");
  assert.match(shown.label, /^標準 v\d+$/);

  const dry = JSON.parse(succeeds(directory, "tokens", "stamp", "--dry-run", "--json"));
  assert.equal(dry.created, true);
  assert.equal(existsSync(join(directory, guide)), false);

  const created = JSON.parse(succeeds(directory, "tokens", "stamp", "--json"));
  assert.equal(created.version, 1);
  assert.equal(created.basedOn, shown.label);
  const project = JSON.parse(succeeds(directory, "tokens", "guide", "--json"));
  assert.equal(project.kind, "project");
  assert.equal(project.label, "プロジェクト v1");
  assert.equal(JSON.parse(succeeds(directory, "validate", "--json")).ok, true);
  assert.equal(JSON.parse(succeeds(directory, "tokens", "stamp", "--json")).changed, false);

  write(directory, guide, `${readFileSync(join(directory, guide), "utf8")}\n- 補正: docker の環境に触れるビルドは未知の領域に 100k\n`);
  const stale = cli(directory, "validate", "--json");
  assert.equal(stale.status, 2);
  assert.match(stale.stderr, /tokens stamp/);

  const bumped = JSON.parse(succeeds(directory, "tokens", "stamp", "--json"));
  assert.equal(bumped.previous, 1);
  assert.equal(bumped.version, 2);
  assert.match(readFileSync(join(directory, guide), "utf8"), /^---\nversion: 2\nbased_on: 標準 v\d+\nhash: [0-9a-f]{8}\n---\n/);
  assert.equal(JSON.parse(succeeds(directory, "validate", "--json")).ok, true);
});

test("CLI: tokens estimate は5成分を必須にして合計し、帯で判定してガイドの版を表に残す", (t) => {
  const directory = workspace(t, true);
  const all = ["--fixed", "90k", "--reading", "120k", "--implementation", "100k", "--tests", "60k", "--unknown", "30k"];
  const result = JSON.parse(succeeds(directory, "tokens", "estimate", "001", ...all, "--reading-basis", "design-delta.md", "--json"));
  assert.equal(result.peak, 400_000);
  assert.equal(result.verdict, "target");
  assert.equal(result.guide.kind, "standard");
  assert.match(result.markdown, /\| 読み込み \| 120k \| design-delta.md \|/);
  assert.match(result.markdown, /\| ガイド \| 標準 v\d+ \| [0-9a-f]{8} \|$/);

  const split = JSON.parse(succeeds(directory, "tokens", "estimate", "001", ...all.slice(0, -1), "200k", "--json"));
  assert.equal(split.verdict, "split");
  const merge = JSON.parse(succeeds(directory, "tokens", "estimate", "001", "--fixed", "90k", "--reading", "50k", "--implementation", "50k", "--tests", "20k", "--unknown", "0", "--json"));
  assert.equal(merge.verdict, "merge");

  const missing = cli(directory, "tokens", "estimate", "001", ...all.slice(0, -2));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--unknown/);
  assert.match(missing.stderr, /0 を渡します/);
  const typo = cli(directory, "tokens", "estimate", "001", ...all, "--readng-basis", "x");
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /--readng-basis は使えません/);
  const invalid = cli(directory, "tokens", "estimate", "001", ...all.slice(0, -1), "many");
  assert.equal(invalid.status, 1);

  write(directory, ".hikyaku.config", `${readFileSync(join(directory, ".hikyaku.config"), "utf8")}\n[context]\nsplit_above = "350k"\n`);
  assert.equal(JSON.parse(succeeds(directory, "tokens", "estimate", "001", ...all, "--json")).verdict, "split", "帯は設定に従う");
});

test("CLI: tasklist は予測ピークを --peak で受け取り、--bp と v2 の tasklist.md への書き込みは止める", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "380k");
  const read = JSON.parse(succeeds(directory, "tasklist", "read", "001", "--json"));
  assert.equal(read.builds[0].peak, 380_000);
  assert.match(readFileSync(join(directory, "docs/hikyaku/cycles/001-test/tasklist.md"), "utf8"), /\| 予測ピーク \|[\s\S]*\| 380k +\|/);
  const retired = cli(directory, "tasklist", "add", "001", "--title", "API", "--bp", "3");
  assert.equal(retired.status, 1);
  assert.match(retired.stderr, /--bp は廃止/);

  write(directory, "docs/hikyaku/cycles/001-test/tasklist.md", "| buildID | title | BP | dependencies | issue | PR |\n| --- | --- | --- | --- | --- | --- |\n| 1 | 基盤 | 3 | — | — | — |\n");
  assert.equal(JSON.parse(succeeds(directory, "tasklist", "read", "001", "--json")).builds[0].peak, undefined);
  const legacy = cli(directory, "tasklist", "add", "001", "--title", "API");
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /v2 の形式/);
});

test("CLI: doctor は v2 の bp-guide/ が残っていることを知らせる", (t) => {
  const directory = workspace(t);
  const before = JSON.parse(cli(directory, "doctor", "--json").stdout);
  assert.ok(!before.checks.some((c: { name: string }) => c.name === "bp-guide/"));
  write(directory, "docs/hikyaku/bp-guide/rules.toml", "levels = [1]\n");
  const after = JSON.parse(cli(directory, "doctor", "--json").stdout);
  const check = after.checks.find((c: { name: string }) => c.name === "bp-guide/");
  assert.equal(check?.status, "warn");
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
