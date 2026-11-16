/**
 * 宣言の変更と、それを拠り所にした受け入れ（premises.mts・ledger premises・validate の警告）
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { readAppDeclaration, type ResolvedConfig } from "../scripts/lib/config.mts";
import {
  assertRef,
  declarationArgs,
  declarationChanges,
  idRanges,
  parseAcceptedSection,
} from "../scripts/lib/premises.mts";
import type { StepContext } from "../scripts/lib/steps/engine.mts";
import { parseToml, type TomlTable } from "../scripts/lib/toml.mts";
import { cli, repository, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";

// ---------------------------------------------------------------------------
// 「受け入れたこと」の節

const ADR = [
  "---",
  "status: accepted",
  "---",
  "",
  "# 上限の表",
  "",
  "- **決定**: 表で決める",
  "- **受け入れたこと**:",
  "  - 問いが増える（拠り所: `app.exposure`, `app.data`, `app.impact`）",
  "  - 3段に収まらない事情は表せない（拠り所: `assumption:3段で足りる`）",
  "  - 宣言を緩めてもマージまで効かない",
  "- **トレードオフ**: 問いが多い",
  "",
].join("\n");

test("parseAcceptedSection: 太字の箇条書きの形を読み、拠り所を参照ごとに分ける", () => {
  const { lines, problems } = parseAcceptedSection(ADR, "adr.md");
  assert.deepEqual(problems, []);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], { source: "adr.md", line: 9, text: "問いが増える", premises: ["app.exposure", "app.data", "app.impact"] });
  assert.deepEqual(lines[1]?.premises, ["assumption:3段で足りる"]);
  assert.deepEqual(lines[2]?.premises, [], "拠り所の無い行は照合の対象にしない");
  assert.equal(lines.some((line) => line.text.includes("問いが多い")), false, "次の太字の項目で節が終わる");
});

test("parseAcceptedSection: 見出しの形を読み、次の見出しで節が終わる", () => {
  const source = ["# 制約", "", "## 受け入れたこと", "", "- 外部に送らない（拠り所: `app.data`）", "", "## 再評価条件", "", "- 公開したとき", ""].join("\n");
  const { lines, problems } = parseAcceptedSection(source, "constraints.md");
  assert.deepEqual(problems, []);
  assert.deepEqual(lines.map((line) => [line.line, line.text, line.premises]), [[5, "外部に送らない", ["app.data"]]]);
});

test("parseAcceptedSection: 実例の ADR（risk-ceiling-table）を警告なしで読む", () => {
  const source = readFileSync(join(import.meta.dirname, "..", ".hikyaku", "decisions", "20261116-risk-ceiling-table.md"), "utf8");
  const { lines, problems } = parseAcceptedSection(source, "x.md");
  assert.deepEqual(problems, []);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0]?.premises, ["app.exposure", "app.data", "app.impact"]);
});

test("parseAcceptedSection: 箇条書きでない行は警告に出し、読み飛ばさない", () => {
  const source = ["## 受け入れたこと", "", "- 1件目（拠り所: `app.data`）", "箇条書きでない説明の行", ""].join("\n");
  const { lines, problems } = parseAcceptedSection(source, "c.md");
  assert.equal(lines.length, 1);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.line, 4);
  assert.match(problems[0]?.message ?? "", /箇条書きでない/);
});

test("parseAcceptedSection: 参照の書式に合わない拠り所は警告に出す", () => {
  const source = ["- **受け入れたこと**:", "  - 地域を限る（拠り所: `app.region`）", "  - 囲んでいない（拠り所: app.data）", ""].join("\n");
  const { lines, problems } = parseAcceptedSection(source, "a.md");
  assert.equal(lines.length, 2);
  assert.deepEqual(problems.map((problem) => problem.line), [2, 3]);
  assert.match(problems[0]?.message ?? "", /app\.region/);
});

test("parseAcceptedSection: 拠り所が行末に無い行は警告に出す", () => {
  const source = ["- **受け入れたこと**:", "  - 問いが増える（拠り所: `app.data`）ことを受け入れる", ""].join("\n");
  const { problems } = parseAcceptedSection(source, "a.md");
  assert.equal(problems.length, 1);
  assert.match(problems[0]?.message ?? "", /行末/);
});

test("parseAcceptedSection: 太字の項目と同じ行に本文を書いた形は警告に出す", () => {
  const { problems } = parseAcceptedSection("- **受け入れたこと**: 問いが増える\n", "a.md");
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.line, 1);
});

test("parseAcceptedSection: 項目より深い字下げの行は前の項目の続き。同じ字下げの地の文は警告", () => {
  const source = [
    "- **受け入れたこと**:",
    "  - 対話で答えたのが本人かは確かめない",
    "    既存の --input と同じ扱い（拠り所: `assumption:利用者は自分で答える`）",
    "  地の文",
    "",
  ].join("\n");
  const { lines, problems } = parseAcceptedSection(source, "a.md");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.text, "対話で答えたのが本人かは確かめない 既存の --input と同じ扱い");
  assert.deepEqual(lines[0]?.premises, ["assumption:利用者は自分で答える"]);
  assert.deepEqual(problems.map((problem) => problem.line), [4]);
});

test("parseAcceptedSection: コードブロックの中の節は読まない（テンプレートの例）", () => {
  const source = ["```markdown", "- **受け入れたこと**:", "  - 例（拠り所: `app.bogus`）", "```", ""].join("\n");
  assert.deepEqual(parseAcceptedSection(source, "t.md"), { lines: [], problems: [] });
});

// ---------------------------------------------------------------------------
// ID の範囲

test("idRanges: AD-1〜AD-5 と US-15.1〜15.3 を拾い、単独の ID は拾わない", () => {
  const found = idRanges(["決定は AD-1〜AD-5 を参照", "US-15.1〜15.3 の受け入れ基準", "US-6.1 と US-6.2"].join("\n"));
  assert.deepEqual(found, [{ line: 1, text: "AD-1〜AD-5" }, { line: 2, text: "US-15.1〜15.3" }]);
});

test("idRanges: コードブロックとインラインコードの中は拾わない", () => {
  const source = ["```", "AD-1〜AD-5", "```", "書式は `X-1〜X-5` の形"].join("\n");
  assert.deepEqual(idRanges(source), []);
});

// ---------------------------------------------------------------------------
// 宣言の差分（一時リポジトリ）

function git(directory: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function commit(directory: string, message: string): void {
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "--allow-empty", "-m", message);
}

function configOf(directory: string, baseBranch?: string): ResolvedConfig {
  const source = readFileSync(join(directory, ".hikyaku.config"), "utf8");
  return {
    repoRoot: directory,
    hikyakuRoot: join(directory, "docs/hikyaku"),
    baseBranch,
    branch: { prefix: "hikyaku", separator: "/" },
    app: readAppDeclaration(parseToml(source)["app"] as TomlTable | undefined),
  } as unknown as ResolvedConfig;
}

const app = (body: string) => `hikyaku_root = "docs/hikyaku"\n[app]\n${body}`;
const AREA = `[[app.areas]]\nname = "billing"\npaths = ["src/billing/**"]\n`;

function branchFrom(t: TestContext, main: string, feature: string): string {
  const directory = repository(t);
  write(directory, ".hikyaku.config", main);
  commit(directory, "main");
  git(directory, "checkout", "-q", "-b", "feature");
  write(directory, ".hikyaku.config", feature);
  commit(directory, "feature");
  return directory;
}

test("declarationChanges: 変わった app のキーだけを返す", (t) => {
  const directory = branchFrom(t, app(`exposure = "internal"\ndata = "none"\nimpact = "low"\n`), app(`exposure = "public"\ndata = "none"\nimpact = "low"\n`));
  const changes = declarationChanges(configOf(directory), "main");
  assert.deepEqual(changes.changed, ["app.exposure"]);
  assert.equal(changes.uncertain, false);
  assert.deepEqual(changes.bases.map((base) => base.ref), ["main"]);
});

test("declarationChanges: area の追加と変更を area:<name> で返す", (t) => {
  const base = `exposure = "internal"\ndata = "none"\nimpact = "low"\n`;
  const directory = branchFrom(t, app(base), app(base) + AREA);
  assert.deepEqual(declarationChanges(configOf(directory), "main").changed, ["area:billing"]);
});

test("declarationChanges: 宣言が同じなら changed は空", (t) => {
  const source = app(`exposure = "internal"\ndata = "none"\nimpact = "low"\n`);
  const directory = branchFrom(t, source, source);
  assert.deepEqual(declarationChanges(configOf(directory), "main").changed, []);
});

test("declarationChanges: from を省くと origin とローカルの両方の基準の差分の和を返す", (t) => {
  const directory = repository(t);
  write(directory, ".hikyaku.config", app(`exposure = "internal"\ndata = "internal"\nimpact = "low"\n`));
  commit(directory, "main");
  const remote = temporaryDirectory(t);
  git(remote, "init", "--quiet", "--bare");
  git(directory, "remote", "add", "origin", remote);
  git(directory, "push", "-q", "origin", "main");
  git(directory, "remote", "set-head", "origin", "main");
  // ローカルの main だけを進める（PR を経ないコミット）: data を none に
  write(directory, ".hikyaku.config", app(`exposure = "internal"\ndata = "none"\nimpact = "low"\n`));
  commit(directory, "local main");
  git(directory, "checkout", "-q", "-b", "feature");
  write(directory, ".hikyaku.config", app(`exposure = "internal"\ndata = "internal"\nimpact = "medium"\n`));
  commit(directory, "feature");
  const changes = declarationChanges(configOf(directory));
  assert.deepEqual(changes.bases.map((base) => base.ref), ["origin/main", "main"]);
  assert.deepEqual(changes.changed, ["app.data", "app.impact"], "origin/main との差分（impact）とローカルの main との差分（data・impact）の和");
});

test("declarationChanges: 基準を1つも読めないときは宣言された参照をすべて変わったものとする", (t) => {
  const directory = repository(t);
  write(directory, ".hikyaku.config", app(`exposure = "public"\ndata = "none"\nimpact = "low"\n`) + AREA);
  commit(directory, "only");
  git(directory, "checkout", "-q", "-b", "hikyaku/001-x/build-01");
  const changes = declarationChanges(configOf(directory, "hikyaku/001-x/conductor"));
  assert.equal(changes.uncertain, true);
  assert.deepEqual(changes.changed, ["app.data", "app.exposure", "app.impact", "area:billing"]);
  assert.ok(changes.notices.length > 0);
});

test("declarationChanges: 基準を読めず、宣言がどこにも無ければ changed は空", (t) => {
  const directory = repository(t);
  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"\n`);
  commit(directory, "only");
  const changes = declarationChanges(configOf(directory), "nowhere");
  assert.deepEqual(changes.changed, []);
});

test("declarationChanges: 基準の宣言を読めないときも上げる向きに倒す", (t) => {
  const directory = branchFrom(t, `hikyaku_root = "docs/hikyaku"\n[app\n`, app(`exposure = "personal"\ndata = "none"\nimpact = "high"\n`));
  const changes = declarationChanges(configOf(directory), "main");
  assert.equal(changes.uncertain, true);
  assert.ok(changes.changed.includes("app.impact"));
  assert.ok(changes.notices.some((notice) => /読めません/.test(notice)));
});

test("declarationArgs: 宣言が変わったら参照をカンマ区切りで、変わらなければ false", (t) => {
  const base = `exposure = "internal"\ndata = "none"\nimpact = "low"\n`;
  const changed = branchFrom(t, app(base), app(`exposure = "internal"\ndata = "internal"\nimpact = "low"\n`) + AREA);
  assert.deepEqual(declarationArgs({ config: configOf(changed, "main") } as unknown as StepContext), { declarationChanged: "app.data,area:billing" });
  const same = branchFrom(t, app(base), app(base));
  assert.deepEqual(declarationArgs({ config: configOf(same, "main") } as unknown as StepContext), { declarationChanged: false });
});

test("assertRef: - で始まる ref を拒む", () => {
  assert.throws(() => assertRef("--output=/tmp/x"), /基準の ref が不正/);
  assert.throws(() => declarationChanges({ repoRoot: "/nonexistent" } as unknown as ResolvedConfig, "--output=/tmp/x"), /基準の ref が不正/);
});

// ---------------------------------------------------------------------------
// ledger premises と validate（CLI の結合）

const GUIDE = [
  "# ドキュメントガイド",
  "",
  "| 論理名 | 管理 | パス | 概要 |",
  "| --- | --- | --- | --- |",
  "| overview | 未作成 | — | x |",
  "| decisions | hikyaku | `docs/decisions/` | ADR |",
  "| constraints | hikyaku | `docs/constraints.md` | 制約 |",
  "| conventions | 未作成 | — | x |",
  "| glossary | repo | `docs/glossary.md` | 用語 |",
  "",
].join("\n");

function risk(id: string, premises: string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    record: "open", at: "2026-11-16T00:00:00.000Z", id, unit: "architect", type: "risk",
    summary: `受け入れ ${id}`, when: "merge@architect", who: "user", premises, ...extra,
  });
}

/** main に exposure = internal の宣言・ADR・記録を置き、feature で exposure を public に変えたワークスペース */
function declaredWorkspace(t: TestContext): string {
  const directory = workspace(t, true);
  appendFileSync(join(directory, ".hikyaku.config"), `\n[app]\nexposure = "internal"\ndata = "none"\nimpact = "low"\n`);
  write(directory, "docs/hikyaku/document-guide.md", GUIDE);
  write(directory, "docs/decisions/20261116-a.md", [
    "# A", "", "- **受け入れたこと**:", "  - 問いが増える（拠り所: `app.exposure`）", "  - 速さを落とす（拠り所: `app.impact`）", "",
  ].join("\n"));
  write(directory, "docs/constraints.md", "# 制約\n\n## 受け入れたこと\n\n- 個人情報は外部に送らない（拠り所: `app.data`）\n");
  write(directory, "docs/glossary.md", "# 用語\n\n例: AD-1〜AD-5\n");
  write(directory, "docs/hikyaku/cycles/001-test/design/decisions.jsonl", [
    risk("architect.1-aaaa", ["app.exposure"]),
    risk("architect.2-bbbb", ["app.impact"]),
    risk("architect.3-cccc", ["app.exposure"]),
    risk("architect.4-dddd", ["app.exposure"]),
    "",
  ].join("\n"));
  commit(directory, "main");
  git(directory, "checkout", "-q", "-b", "feature");
  const config = readFileSync(join(directory, ".hikyaku.config"), "utf8").replace(`exposure = "internal"`, `exposure = "public"`);
  write(directory, ".hikyaku.config", config);
  commit(directory, "feature");
  return directory;
}

test("ledger premises: 宣言を変えたブランチで、拠り所にした受け入れ（記録と ADR）を並べる", (t) => {
  const directory = declaredWorkspace(t);
  const result = cli(directory, "ledger", "premises", "--changed-from", "main", "--json");
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.deepEqual(data.changed, ["app.exposure"]);
  assert.deepEqual(data.ledger.map((item: { id: string }) => item.id), ["architect.1-aaaa", "architect.3-cccc", "architect.4-dddd"]);
  assert.deepEqual(data.ledger[0].cycle, "001-test");
  assert.deepEqual(data.documents.map((line: { source: string; line: number }) => `${line.source}:${line.line}`), ["docs/decisions/20261116-a.md:4"]);
  assert.deepEqual(data.warnings, []);
});

test("ledger premises: 受け入れの定義に合う記録だけを並べる（退け・解決した risk と、改めた異議は除く）", (t) => {
  const directory = declaredWorkspace(t);
  const decide = (id: string, decision: string) => JSON.stringify({ record: "decide", at: "2026-11-16T01:00:00.000Z", id, unit: "architect", decision, by: "user", input: "x" });
  const objection = (id: string) => JSON.stringify({
    record: "open", at: "2026-11-16T00:00:00.000Z", id, unit: "architect", type: "objection", summary: id, when: "now", who: "user", premises: ["app.exposure"], harm: "高",
  });
  appendFileSync(join(directory, "docs/hikyaku/cycles/001-test/design/decisions.jsonl"), [
    decide("architect.1-aaaa", "consented"),
    decide("architect.3-cccc", "rejected"),
    decide("architect.4-dddd", "resolved"),
    objection("architect.5-eeee"), decide("architect.5-eeee", "consented"),
    objection("architect.6-ffff"), decide("architect.6-ffff", "decided"),
    "",
  ].join("\n"));
  const data = JSON.parse(cli(directory, "ledger", "premises", "--changed-from", "main", "--json").stdout);
  assert.deepEqual(data.ledger.map((item: { id: string; decision: string | null }) => [item.id, item.decision]), [
    ["architect.1-aaaa", "consented"],
    ["architect.5-eeee", "consented"],
  ]);
});

test("ledger premises: 読めない記録と読めない行を警告に出し、終了コードは 0", (t) => {
  const directory = declaredWorkspace(t);
  appendFileSync(join(directory, "docs/decisions/20261116-a.md"), "- **受け入れたこと**:\n  - 地域を限る（拠り所: `app.region`）\n");
  write(directory, "docs/hikyaku/cycles/001-test/planning/decisions.jsonl", "{壊れた行\n");
  const result = cli(directory, "ledger", "premises", "--changed-from", "main");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /docs\/decisions\/20261116-a\.md:7: 拠り所の参照の書式に合いません/);
  assert.match(result.stdout, /001-test: 未決事項の記録を読めません/);
});

test("ledger premises: --format pr は ID とファイル:行を個別に並べ、件数や範囲に畳まない", (t) => {
  const directory = declaredWorkspace(t);
  const result = cli(directory, "ledger", "premises", "--changed-from", "main", "--format", "pr");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^## 宣言の変更/m);
  for (const id of ["architect.1-aaaa", "architect.3-cccc", "architect.4-dddd"]) assert.match(result.stdout, new RegExp(`^- 001-test の ${id}`, "m"));
  assert.match(result.stdout, /`docs\/decisions\/20261116-a\.md:4`/);
  assert.doesNotMatch(result.stdout, /〜|\d+ ?件/);
});

test("ledger premises: 宣言が変わっていなければ、--format pr は何も出さない", (t) => {
  const directory = declaredWorkspace(t);
  git(directory, "checkout", "-q", "main");
  const result = cli(directory, "ledger", "premises", "--changed-from", "main", "--format", "pr");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "");
});

test("validate: ID の範囲を警告し、終了コードは 0。glossary と閉じたサイクルは見ない", (t) => {
  const directory = declaredWorkspace(t);
  write(directory, "docs/hikyaku/cycles/001-test/design/design-delta.md", "# 設計差分\n\n- 対応: US-15.1〜15.3\n");
  appendFileSync(join(directory, "docs/decisions/20261116-a.md"), "\n参照: AD-1〜AD-5\n");
  const result = cli(directory, "validate", "--json");
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, true);
  const scopes = data.warnings.map((warning: { scope: string }) => warning.scope);
  assert.ok(scopes.includes("docs/hikyaku/cycles/001-test/design/design-delta.md:3"), scopes.join(","));
  assert.ok(scopes.some((scope: string) => scope.startsWith("docs/decisions/20261116-a.md:")));
  assert.equal(scopes.some((scope: string) => scope.startsWith("docs/glossary.md")), false);
});

test("validate: 受け入れたことの読めない行を警告に出す", (t) => {
  const directory = declaredWorkspace(t);
  appendFileSync(join(directory, "docs/constraints.md"), "説明の地の文\n");
  const result = cli(directory, "validate", "--json");
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.ok(data.warnings.some((warning: { scope: string; message: string }) => warning.scope === "docs/constraints.md:6" && /箇条書きでない/.test(warning.message)));
});

test("validate --base: 変わった宣言と拠り所にした受け入れを警告し、終了コードは 0", (t) => {
  const directory = declaredWorkspace(t);
  const result = cli(directory, "validate", "--base", "main");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /! 宣言の変更: 変わった宣言: app\.exposure/);
  assert.match(result.stdout, /001-test の architect\.1-aaaa/);
  assert.match(result.stdout, /docs\/decisions\/20261116-a\.md:4/);
});

test("validate: problems があれば警告があっても終了コード 2", (t) => {
  const directory = declaredWorkspace(t);
  write(directory, "docs/hikyaku/cycles/001-test/design/design-delta.md", "- US-1〜US-3\n");
  // 旧名のファイル（instruction.md）は problems
  write(directory, "docs/hikyaku/instruction.md", "# 旧名\n");
  const result = cli(directory, "validate", "--json");
  assert.equal(result.status, 2, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, false);
  assert.ok(data.warnings.length > 0);
});

test("validate --base: - で始まる ref を拒む", (t) => {
  const directory = declaredWorkspace(t);
  const result = cli(directory, "validate", "--base", "-x");
  assert.notEqual(result.status, 0);
});
