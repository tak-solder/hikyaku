/**
 * G4・G8 の提示（gate brief。build-12・US-12）— test-spec の「（解釈）」の読み取り、G8 の未対応の受け入れ基準、
 * 提示の描画、CLI。G4 の境界の照合と同意は step-risk-gates.test.mts（基準のブランチを用意するため）
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { g8Brief, renderG4Brief, renderG8Brief, type G4Brief, type G8Brief } from "../scripts/lib/gate-brief.mts";
import { INTERPRETED_MARK, testSpecScenarios } from "../scripts/lib/traceability.mts";
import { cli, succeeds, temporaryDirectory, workspace, write } from "./helpers.mts";

const FENCE = "```";

// ---------------------------------------------------------------------------
// testSpecScenarios

test("testSpecScenarios: ### 見出しごとに見出し・本文・対応の番号を読む", () => {
  const scenarios = testSpecScenarios([
    "# Build 03: x テストシナリオ",
    "",
    "## boundaryChanges",
    "",
    "### boundaryChanges: 外との境界に当たる",
    "- 対応: US-12.1",
    "- Given: a",
    "",
    "### g8Brief: 番号なし",
    "- 対応: US-12.2, US-12.4",
    "- Then: b",
    "",
  ].join("\n"));
  assert.equal(scenarios.length, 2);
  assert.equal(scenarios[0]?.heading, "boundaryChanges: 外との境界に当たる");
  assert.deepEqual(scenarios[0]?.criteria, ["US-12.1"]);
  assert.equal(scenarios[0]?.body, "- 対応: US-12.1\n- Given: a");
  assert.deepEqual(scenarios[1]?.criteria, ["US-12.2", "US-12.4"]);
});

test("testSpecScenarios: 見出しの末尾の「（解釈）」で interpreted が立つ", () => {
  const scenarios = testSpecScenarios("### render: 迷う形は外に倒す（解釈）\n- 対応: —\n\n### render: 要約を出す\n- 対応: —\n");
  assert.deepEqual(scenarios.map((scenario) => scenario.interpreted), [true, false]);
  assert.equal(INTERPRETED_MARK, "（解釈）");
});

test("testSpecScenarios: 印の無い既存の test-spec.md は解釈 0 件として読め、「- 対応: —」は番号を持たない", () => {
  const scenarios = testSpecScenarios("### a: 1\n- 対応: —\n\n### b: 2\n- 対応: US-1.1\n\n### c: 3\n- 対応: US-1.2\n");
  assert.equal(scenarios.length, 3);
  assert.ok(scenarios.every((scenario) => !scenario.interpreted));
  assert.deepEqual(scenarios[0]?.criteria, []);
});

test("testSpecScenarios: コードブロックの中の見出しと番号は読まない", () => {
  const scenarios = testSpecScenarios([
    "### a: 実在する",
    "- 対応: US-12.1",
    FENCE,
    "### {メソッド名}: {シナリオ名}（解釈）",
    "- 対応: US-1.1",
    FENCE,
    "",
  ].join("\n"));
  assert.equal(scenarios.length, 1);
  assert.deepEqual(scenarios[0]?.criteria, ["US-12.1"]);
  assert.equal(scenarios[0]?.interpreted, false);
});

// ---------------------------------------------------------------------------
// g8Brief

interface BuildFiles {
  stories?: string;
  issue?: string;
  testSpec?: string;
  plan?: string;
}

/** サイクルのディレクトリと build-03 を作る */
function buildDirectory(t: TestContext, files: BuildFiles): { cycle: string; build: string } {
  const cycle = temporaryDirectory(t);
  const build = join(cycle, "build-03");
  mkdirSync(join(cycle, "planning"), { recursive: true });
  mkdirSync(build, { recursive: true });
  if (files.stories !== undefined) writeFileSync(join(cycle, "planning", "user-stories.md"), files.stories);
  if (files.issue !== undefined) writeFileSync(join(build, "issue.md"), files.issue);
  if (files.testSpec !== undefined) writeFileSync(join(build, "test-spec.md"), files.testSpec);
  if (files.plan !== undefined) writeFileSync(join(build, "plan.md"), files.plan);
  return { cycle, build };
}

const STORIES = "# ストーリー\n\n- [ ] US-3.1: a\n- [ ] US-3.2: b\n- [ ] US-3.3: c\n";
const ISSUE = "# Build 03\n\n## 対応する受け入れ基準\n\n- US-3.1, US-3.2, US-3.3\n\n## 受け入れ基準\n\n- [ ] 基準の文\n";

test("g8Brief: 「（解釈）」のシナリオだけを見出しと本文で返す", (t) => {
  const { cycle, build } = buildDirectory(t, {
    stories: STORIES,
    issue: ISSUE,
    testSpec: [
      "### parse: 1\n- 対応: US-3.1\n",
      "### parse: 空行を区切りとみなす（解釈）\n- 対応: US-3.2\n- 解釈: 空行の扱いは基準に無いので区切りとした\n",
      "### parse: 3\n- 対応: US-3.3\n",
      "### parse: 4\n- 対応: —\n",
    ].join("\n"),
  });
  const brief = g8Brief(cycle, build);
  assert.equal(brief.testSpec, true);
  assert.equal(brief.interpreted.length, 1);
  assert.equal(brief.interpreted[0]?.heading, "parse: 空行を区切りとみなす（解釈）");
  assert.match(brief.interpreted[0]?.body ?? "", /- 解釈:/);
  assert.deepEqual(brief.uncovered, []);
});

test("g8Brief: どのシナリオの対応にも無い受け入れ基準を返す", (t) => {
  const { cycle, build } = buildDirectory(t, {
    stories: STORIES,
    issue: ISSUE,
    testSpec: "### a: 1\n- 対応: US-3.1\n\n### b: 2\n- 対応: US-3.3\n",
  });
  const brief = g8Brief(cycle, build);
  assert.deepEqual(brief.uncovered, ["US-3.2"]);
  assert.equal(brief.criteriaSection, undefined);
  assert.deepEqual(brief.interpreted, []);
});

test("g8Brief: user-stories.md に番号付きの基準が無ければ、受け入れ基準の節をそのまま返す", (t) => {
  const { cycle, build } = buildDirectory(t, {
    stories: "# ストーリー\n\n- [ ] ログインできる\n",
    issue: "# Build 03\n\n## 受け入れ基準\n\n- [ ] ログインできる\n\n## 参照する設計ドキュメント\n\n- x\n",
    testSpec: "### a: 1\n- 対応: —\n",
  });
  const brief = g8Brief(cycle, build);
  assert.equal(brief.uncovered, undefined);
  assert.equal(brief.criteriaSection, "- [ ] ログインできる");
});

test("g8Brief: issue.md に「対応する受け入れ基準」の節が無ければ追跡できない扱いにする", (t) => {
  const { cycle, build } = buildDirectory(t, {
    stories: STORIES,
    issue: "# Build 03\n\n## 受け入れ基準\n\n- [ ] 基準の文\n",
    testSpec: "### a: 1\n- 対応: US-3.1\n",
  });
  const brief = g8Brief(cycle, build);
  assert.equal(brief.uncovered, undefined);
  assert.equal(brief.criteriaSection, "- [ ] 基準の文");
});

test("g8Brief: test-spec.md が無ければ未対応として並べず、受け入れ基準の節を残す", (t) => {
  const { cycle, build } = buildDirectory(t, { stories: STORIES, issue: ISSUE, plan: "# plan\n" });
  const brief = g8Brief(cycle, build);
  assert.equal(brief.testSpec, false);
  assert.deepEqual(brief.interpreted, []);
  assert.equal(brief.uncovered, undefined);
  assert.equal(brief.criteriaSection, "- [ ] 基準の文");
});

// ---------------------------------------------------------------------------
// 描画

const NO_BOUNDARIES = { declared: false, external: [], internal: [], unverified: false, documents: [], notices: [] };

test("renderG4Brief: 要約は外と内の境界を分けて示し、全文を含めない", () => {
  const brief: G4Brief = {
    boundaries: {
      ...NO_BOUNDARIES,
      declared: true,
      external: [{ boundary: "api/public/**", touched: ["api/public/users.ts"] }],
      internal: [{ boundary: "src/core/**", touched: ["src/core/queue.ts"] }],
    },
    undeclaredAreas: [],
    verified: true,
  };
  const text = renderG4Brief(brief, undefined);
  const external = text.indexOf("外との境界の変更（同意が要る）");
  const internal = text.indexOf("内部の境界の変更（確かめる）");
  assert.ok(external !== -1 && internal > external);
  assert.ok(text.indexOf("api/public/users.ts") > external && text.indexOf("api/public/users.ts") < internal);
  assert.ok(text.indexOf("src/core/queue.ts") > internal);
  assert.doesNotMatch(text, /全文/);
});

test("renderG4Brief: 宣言が無ければ従来どおりの提示で、境界の節を出さない", () => {
  const text = renderG4Brief({ boundaries: NO_BOUNDARIES, undeclaredAreas: [], verified: true }, undefined);
  assert.doesNotMatch(text, /外との境界の変更/);
  assert.match(text, /従来どおり/);
});

test("renderG4Brief: 境界の変更と、重い領域の裏取りを並べて示す", () => {
  const text = renderG4Brief({
    boundaries: { ...NO_BOUNDARIES, declared: true, external: [{ boundary: "api/public/**", touched: ["api/public/users.ts"] }] },
    undeclaredAreas: [{ name: "billing", touched: ["src/billing/invoice.ts"] }],
    verified: true,
  }, undefined);
  assert.match(text, /外との境界の変更/);
  assert.match(text, /G3 の申告に無い重い領域/);
  assert.match(text, /billing: src\/billing\/invoice\.ts/);
});

test("renderG4Brief: 境界を照合できなかった・unverified・裏取りできない旨を出す", () => {
  const error = renderG4Brief({ boundaries: { error: "document-guide.md を読めません" }, undeclaredAreas: [], verified: true }, undefined);
  assert.match(error, /境界を照合できませんでした.*document-guide\.md を読めません/);
  const unverified = renderG4Brief({
    boundaries: { ...NO_BOUNDARIES, declared: true, unverified: true, notices: ["基準のブランチの [boundaries] を1つも読めないので、G4 を同意にしています"] },
    undeclaredAreas: [],
    verified: true,
  }, undefined);
  assert.match(unverified, /G4 を同意にしています/);
  const unverifiedAreas = renderG4Brief({ boundaries: NO_BOUNDARIES, undeclaredAreas: [], verified: false }, undefined);
  assert.match(unverifiedAreas, /裏取りできませんでした/);
});

test("renderG4Brief: --full では design-delta.md の全文を添える", () => {
  const body = "# 設計差分\n\n- `api/public/users.ts` を変える\n";
  const text = renderG4Brief({ boundaries: NO_BOUNDARIES, undeclaredAreas: [], verified: true }, body);
  assert.ok(text.includes(body.trimEnd()));
});

const G8_BASE: G8Brief = { testSpec: true, interpreted: [], uncovered: [], criteriaSection: undefined };

test("renderG8Brief: 解釈のシナリオと未対応の基準だけを示す", () => {
  const text = renderG8Brief({
    ...G8_BASE,
    interpreted: [{ heading: "parse: 空行を区切りとみなす（解釈）", body: "- 解釈: x" }],
    uncovered: ["US-3.2"],
  }, undefined);
  assert.match(text, /### parse: 空行を区切りとみなす（解釈）\n- 解釈: x/);
  assert.match(text, /- US-3\.2/);
});

test("renderG8Brief: 追跡できないときは受け入れ基準の節を出す", () => {
  const text = renderG8Brief({ ...G8_BASE, uncovered: undefined, criteriaSection: "- [ ] ログインできる" }, undefined);
  assert.match(text, /番号で追跡できない/);
  assert.match(text, /- \[ \] ログインできる/);
});

test("renderG8Brief: test-spec が無ければ plan.md を提示する旨を出し、未対応の一覧は出さない", () => {
  const text = renderG8Brief({ testSpec: false, interpreted: [], uncovered: undefined, criteriaSection: "- [ ] a" }, undefined);
  assert.match(text, /plan\.md を提示してください/);
  assert.doesNotMatch(text, /対応していない受け入れ基準/);
});

// ---------------------------------------------------------------------------
// CLI（G8 と引数の検査。G4 は step-risk-gates.test.mts）

const BUILD = "docs/hikyaku/cycles/001-test";

test("gate brief G8: 要約は解釈と未対応だけで、--full で plan.md と test-spec.md の全文が出る", (t) => {
  const directory = workspace(t, true);
  write(directory, `${BUILD}/planning/user-stories.md`, STORIES);
  write(directory, `${BUILD}/build-03/issue.md`, ISSUE);
  write(directory, `${BUILD}/build-03/plan.md`, "# plan 本文\n");
  write(directory, `${BUILD}/build-03/test-spec.md`, "### a: 印なし\n- 対応: US-3.1, US-3.3\n\n### b: 解釈した（解釈）\n- 対応: —\n- 解釈: y\n");
  const brief = succeeds(directory, "gate", "brief", "G8", "build-03", "001");
  assert.match(brief, /b: 解釈した（解釈）/);
  assert.match(brief, /- US-3\.2/);
  assert.doesNotMatch(brief, /a: 印なし/);
  const full = succeeds(directory, "gate", "brief", "G8", "build-03", "001", "--full");
  assert.match(full, /# plan 本文/);
  assert.match(full, /a: 印なし/);
  const json = JSON.parse(succeeds(directory, "gate", "brief", "G8", "build-03", "001", "--json")) as G8Brief;
  assert.deepEqual(json.uncovered, ["US-3.2"]);
});

test("gate brief G8: test-spec.md が未作成でも止めずに plan.md の提示に回す", (t) => {
  const directory = workspace(t, true);
  write(directory, `${BUILD}/build-05/issue.md`, ISSUE);
  write(directory, `${BUILD}/build-05/plan.md`, "# plan 本文\n");
  assert.match(succeeds(directory, "gate", "brief", "G8", "build-05", "001"), /test-spec\.md がありません/);
  const full = succeeds(directory, "gate", "brief", "G8", "build-05", "001", "--full");
  assert.match(full, /# plan 本文/);
  assert.match(full, /（test-spec\.md がありません）/);
});

test("gate brief: phase と G の組み合わせが違えばエラー", (t) => {
  const directory = workspace(t, true);
  const g4 = cli(directory, "gate", "brief", "G4", "build-03", "001");
  assert.notEqual(g4.status, 0);
  assert.match(g4.stderr, /G4 は architect/);
  const g8 = cli(directory, "gate", "brief", "G8", "architect", "001");
  assert.notEqual(g8.status, 0);
  assert.match(g8.stderr, /G8 はビルド/);
  const other = cli(directory, "gate", "brief", "G5", "architect", "001");
  assert.notEqual(other.status, 0);
});

test("gate brief G4: 宣言が無く design-delta.md が未作成でも止めずにその旨を出す", (t) => {
  const directory = workspace(t, true);
  const text = succeeds(directory, "gate", "brief", "G4", "architect", "001");
  assert.match(text, /従来どおり/);
  assert.match(text, /design-delta\.md がまだありません/);
});
