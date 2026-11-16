import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  agreementReasons,
  collectMarkerFacts,
  declarationConfigChanges,
  parseUnifiedDiff,
  renderFactsPr,
  type DiffFacts,
  type FileHunks,
} from "../scripts/lib/diff-facts.mts";
import {
  DEFAULT_ASSERTION_MARKERS,
  DEFAULT_DIFF_EXCLUDE,
  DEFAULT_DIFF_TESTS,
  DEFAULT_SKIP_MARKERS,
  DEFAULT_TEST_DECLARATIONS,
  findMarker,
  type DiffPatterns,
} from "../scripts/lib/diff-stats.mts";
import { cli, succeeds, testEnvironment, workspace, write } from "./helpers.mts";

const PATTERNS: DiffPatterns = {
  exclude: DEFAULT_DIFF_EXCLUDE,
  tests: DEFAULT_DIFF_TESTS,
  testDeclarations: DEFAULT_TEST_DECLARATIONS,
  skipMarkers: DEFAULT_SKIP_MARKERS,
  assertionMarkers: DEFAULT_ASSERTION_MARKERS,
};

function hunks(path: string, lines: [side: "-" | "+", line: number, text: string][]): FileHunks[] {
  return [{ path, lines: lines.map(([side, line, text]) => ({ side, line, text })) }];
}

// ---------------------------------------------------------------------------
// 印の照合

test("findMarker: 識別子の文字で始まる印は、直前が識別子の文字でない位置だけ数える", () => {
  assert.equal(findMarker(DEFAULT_TEST_DECLARATIONS, "  form.submit(data);"), undefined);
  assert.equal(findMarker(DEFAULT_TEST_DECLARATIONS, "  const v = latest(items);"), undefined);
  assert.equal(findMarker(DEFAULT_TEST_DECLARATIONS, 'it("adds", () => {'), "it(");
  assert.equal(findMarker(DEFAULT_TEST_DECLARATIONS, '  t.test("x", ...)'), "test(");
});

test("findMarker: 記号で始まる印は直前の文字を問わない部分文字列", () => {
  assert.equal(findMarker(DEFAULT_SKIP_MARKERS, '  it.skip("slow", () => {'), ".skip(");
  assert.equal(findMarker(DEFAULT_SKIP_MARKERS, '  xit "sends mail" do'), 'xit "');
  assert.equal(findMarker(DEFAULT_TEST_DECLARATIONS, '  xit "sends mail" do'), undefined);
});

test("readDiffPatterns: 印の3キーは既定に追加され、exclude と tests は置き換え", (t) => {
  const directory = workspace(t);
  const path = join(directory, ".hikyaku.config");
  writeFileSync(
    path,
    `${readFileSync(path, "utf8")}\n[diff]\ntest_declarations = ["scenario("]\nskip_markers = ["@Skip"]\nassertion_markers = ["check("]\ntests = ["checks/**"]\nexclude = ["gen/**"]\n`,
  );
  const { diff } = JSON.parse(succeeds(directory, "config", "--json")) as { diff: DiffPatterns };
  assert.deepEqual(diff.testDeclarations, [...DEFAULT_TEST_DECLARATIONS, "scenario("]);
  assert.deepEqual(diff.skipMarkers, [...DEFAULT_SKIP_MARKERS, "@Skip"]);
  assert.deepEqual(diff.assertionMarkers, [...DEFAULT_ASSERTION_MARKERS, "check("]);
  assert.deepEqual(diff.tests, ["checks/**"]);
  assert.deepEqual(diff.exclude, ["gen/**"]);
});

// ---------------------------------------------------------------------------
// parseUnifiedDiff

test("parseUnifiedDiff: -U0 の hunk から行番号付きの - 行と + 行を取り出す", () => {
  const diff = [
    "diff --git a/tests/a.test.ts b/tests/a.test.ts",
    "index 1..2 100644",
    "--- a/tests/a.test.ts",
    "+++ b/tests/a.test.ts",
    "@@ -10,2 +10,0 @@ describe",
    '-it("a", ...)',
    "-  expect(x).toBe(1);",
    "@@ -20,0 +18,1 @@",
    "+  expect(x).toBe(2);",
    "",
  ].join("\n");
  const [file] = parseUnifiedDiff(diff);
  assert.equal(file?.path, "tests/a.test.ts");
  assert.deepEqual(file?.lines.map((line) => [line.side, line.line, line.text]), [
    ["-", 10, 'it("a", ...)'],
    ["-", 11, "  expect(x).toBe(1);"],
    ["+", 18, "  expect(x).toBe(2);"],
  ]);
});

test("parseUnifiedDiff: リネームとバイナリと空の hunk", () => {
  const diff = [
    "diff --git a/tests/old.test.ts b/src/old.ts",
    "similarity index 100%",
    "rename from tests/old.test.ts",
    "rename to src/old.ts",
    "diff --git a/img.png b/img.png",
    "index 1..2 100644",
    "Binary files a/img.png and b/img.png differ",
    "",
  ].join("\n");
  const files = parseUnifiedDiff(diff);
  assert.deepEqual(files[0], { path: "src/old.ts", from: "tests/old.test.ts", lines: [] });
  assert.equal(files.length, 1, "パスの取れないバイナリは一覧から外れても印の照合には影響しない");
});

test("parseUnifiedDiff: 件数省略のヘッダ・改行なしの印・引用符付きパス", () => {
  const diff = [
    'diff --git "a/tests/a b.test.ts" "b/tests/a b.test.ts"',
    '--- "a/tests/a b.test.ts"\t',
    '+++ "b/tests/a b.test.ts"\t',
    "@@ -10 +10 @@",
    "-  expect(x).toBe(1);",
    "\\ No newline at end of file",
    "+  expect(x).toBe(2);",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  const [file] = parseUnifiedDiff(diff);
  assert.equal(file?.path, "tests/a b.test.ts");
  assert.deepEqual(file?.lines.map((line) => [line.side, line.line]), [["-", 10], ["+", 10]]);
});

test("parseUnifiedDiff: hunk の中の `--- ` で始まる削除行を見出しと取り違えない", () => {
  const diff = ["diff --git a/x.md b/x.md", "--- a/x.md", "+++ b/x.md", "@@ -3 +2,0 @@", "--- 区切り", ""].join("\n");
  const [file] = parseUnifiedDiff(diff);
  assert.deepEqual(file?.lines, [{ side: "-", line: 3, text: "-- 区切り" }]);
});

// ---------------------------------------------------------------------------
// collectMarkerFacts

const LANGUAGES: [name: string, path: string, removed: string, added: string, declaration: string, skip: string][] = [
  ["JS/TS", "tests/user.test.ts", '  it("rejects empty name", () => {', '  it.skip("slow path", async () => {', "it(", ".skip("],
  ["Python", "tests/test_api.py", "def test_login_fails():", '@pytest.mark.skip(reason="flaky")', "def test_", "@pytest.mark.skip"],
  ["Go", "pkg/user_test.go", "func TestCreateUser(t *testing.T) {", '\tt.Skip("TODO")', "func Test", "t.Skip("],
  ["Ruby", "spec/user_spec.rb", '  it "validates email" do', '  xit "sends mail" do', 'it "', 'xit "'],
  ["Java", "src/test/java/UserTest.java", "    @Test", '    @Disabled("broken")', "@Test", "@Disabled"],
  ["Rust", "tests/parse_test.rs", "#[test]", '#[ignore = "slow"]', "#[test]", "#[ignore"],
];

for (const [name, path, removed, added, declaration, skip] of LANGUAGES) {
  test(`collectMarkerFacts: ${name} の宣言の削除とスキップの追加`, () => {
    const facts = collectMarkerFacts(hunks(path, [["-", 12, removed], ["+", 30, added]]), PATTERNS);
    assert.deepEqual(facts.deletedTests.map((fact) => [fact.path, fact.line, fact.marker]), [[path, 12, declaration]]);
    assert.deepEqual(facts.addedSkips.map((fact) => [fact.path, fact.line, fact.marker]), [[path, 30, skip]]);
  });
}

test("collectMarkerFacts: アサーションの増減は「変更」として両側を並べる", () => {
  const facts = collectMarkerFacts(
    hunks("tests/calc.test.ts", [["-", 10, "  assert.equal(sum(1, 2), 3);"], ["+", 10, "  assert.ok(sum(1, 2) > 0);"]]),
    PATTERNS,
  );
  assert.deepEqual(facts.assertionChanges.map((fact) => [fact.side, fact.line]), [["-", 10], ["+", 10]]);
  assert.deepEqual(Object.keys(facts.assertionChanges[0] ?? {}).sort(), ["line", "marker", "path", "side", "text"]);
});

test("collectMarkerFacts: 同じファイルでの移動だけの行は事実に出さない", () => {
  const facts = collectMarkerFacts(
    hunks("tests/user.test.ts", [
      ["-", 12, '  it("rejects empty name", () => {'],
      ["-", 13, "    expect(err).toBeTruthy();"],
      ["-", 20, '  it.skip("slow path", async () => {'],
      ["+", 40, '  it("rejects empty name", () => {'],
      ["+", 41, "      expect(err).toBeTruthy();"],
      ["+", 50, '  it.skip("slow path", async () => {'],
    ]),
    PATTERNS,
  );
  assert.deepEqual(facts, { deletedTests: [], addedSkips: [], assertionChanges: [] });
});

test("collectMarkerFacts: テストでないファイルの行は印を含んでも数えない", () => {
  const facts = collectMarkerFacts(hunks("src/runner.ts", [["-", 3, '  test("x")'], ["+", 4, "  foo.skip(1)"]]), PATTERNS);
  assert.deepEqual(facts, { deletedTests: [], addedSkips: [], assertionChanges: [] });
});

test("collectMarkerFacts: [diff] で足した印で拾える", () => {
  const patterns = { ...PATTERNS, testDeclarations: [...PATTERNS.testDeclarations, "scenario("] };
  const facts = collectMarkerFacts(hunks("tests/flow.test.ts", [["-", 2, 'scenario("checkout", () => {']]), patterns);
  assert.deepEqual(facts.deletedTests.map((fact) => fact.marker), ["scenario("]);
});

// ---------------------------------------------------------------------------
// declarationConfigChanges

const ROOT = ".hikyaku.config";

test("declarationConfigChanges: [app] のキーの変更", () => {
  const changes = declarationConfigChanges(ROOT, '[app]\nstage = "production"\n', '[app]\nstage = "prototype"\n');
  assert.equal(changes.length, 1);
  assert.deepEqual([changes[0]?.ref, changes[0]?.change], ["app.stage", "changed"]);
  assert.match(changes[0]?.detail ?? "", /production.*prototype/);
});

test("declarationConfigChanges: [[app.areas]] の項目の削除と追加", () => {
  const two = '[[app.areas]]\nname = "billing"\npaths = ["src/billing/**"]\n\n[[app.areas]]\nname = "admin"\npaths = ["src/admin/**"]\n';
  const one = '[[app.areas]]\nname = "admin"\npaths = ["src/admin/**"]\n';
  const removed = declarationConfigChanges(ROOT, two, one);
  assert.deepEqual(removed.map((change) => [change.ref, change.change]), [["area:billing", "removed"]]);
  assert.match(removed[0]?.detail ?? "", /^項目を消した:/);
  const added = declarationConfigChanges(ROOT, one, two);
  assert.deepEqual(added.map((change) => [change.ref, change.change]), [["area:billing", "added"]]);
  assert.match(added[0]?.detail ?? "", /^項目を足した:/);
});

test("declarationConfigChanges: [[app.areas]] の paths を狭め、別のパスを足す", () => {
  const before = '[[app.areas]]\nname = "billing"\npaths = ["src/billing/**", "src/invoice/**"]\n';
  const after = '[[app.areas]]\nname = "billing"\npaths = ["src/billing/**", "src/tax/**"]\n';
  const changes = declarationConfigChanges(ROOT, before, after);
  assert.deepEqual(changes, [
    { file: ROOT, ref: "area:billing", change: "changed", detail: 'paths: 外した: "src/invoice/**" / 足した: "src/tax/**"' },
  ]);
});

test("declarationConfigChanges: [[app.areas]] の paths 以外のキーの変更", () => {
  const area = (data: string) => `[[app.areas]]\nname = "billing"\npaths = ["src/billing/**"]\ndata = "${data}"\n`;
  const changes = declarationConfigChanges(ROOT, area("low"), area("high"));
  assert.deepEqual(changes.map((change) => [change.ref, change.change]), [["area:billing", "changed"]]);
  assert.match(changes[0]?.detail ?? "", /data: "low" → "high"/);
});

test("declarationConfigChanges: [boundaries] と [consent] の追加・削除", () => {
  const changes = declarationConfigChanges(ROOT, "[consent]\npost_merge = true\n", '[boundaries]\nexternal = ["payments"]\n');
  assert.deepEqual(changes.map((change) => [change.ref, change.change]).sort(), [
    ["boundaries.external", "added"],
    ["consent.post_merge", "removed"],
  ]);
});

test("declarationConfigChanges: 設定ファイルの新規作成（before が undefined）", () => {
  const file = "docs/hikyaku/cycles/001-test/.hikyaku.config";
  assert.deepEqual(declarationConfigChanges(file, undefined, "[consent]\npost_merge = true\n").map((change) => [change.ref, change.change]), [
    ["consent.post_merge", "added"],
  ]);
  assert.deepEqual(declarationConfigChanges(file, undefined, undefined), []);
});

test("declarationConfigChanges: TOML を読めなければ「読めない」を事実にする", () => {
  const changes = declarationConfigChanges(ROOT, '[app]\nstage = "x"\n', "[app\nstage = ");
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.change, "unreadable");
  assert.match(changes[0]?.detail ?? "", /読めません/);
});

// ---------------------------------------------------------------------------
// agreementReasons と renderFactsPr

test("agreementReasons: 「## 返した理由」の箇条書きだけを取り出す", () => {
  const markdown = "## 指摘\n- A を足した\n## 返した理由\n- A は issue.md のやることに含まれる\n- B は G8 で合意済み\n## 備考\n- 無関係\n";
  assert.deepEqual(agreementReasons(markdown), ["A は issue.md のやることに含まれる", "B は G8 で合意済み"]);
  assert.deepEqual(agreementReasons("## 返した理由\n\n- なし\n"), []);
});

function emptyFacts(overrides: Partial<DiffFacts> = {}): DiffFacts {
  return {
    phase: "build-01",
    complete: true,
    base: { name: "main", ref: "main", mergeBase: "0123456789" },
    files: [],
    deletedTests: [],
    addedSkips: [],
    assertionChanges: [],
    deletedTestFiles: [],
    configChanges: [],
    issueChanged: false,
    afterG8: { approvedAt: undefined, files: [] },
    notices: [],
    ...overrides,
  };
}

test("renderFactsPr: 事実と返した理由が並び、変更ファイルの一覧は写さない", () => {
  const facts = emptyFacts({
    files: [
      { status: "M", path: "src/a.ts", kind: "implementation" },
      { status: "M", path: "tests/user.test.ts", kind: "test" },
    ],
    deletedTests: [{ path: "tests/user.test.ts", line: 12, text: 'it("x", () => {', marker: "it(" }],
  });
  const out = renderFactsPr(facts, "## 返した理由\n\n- 重複したテストを統合した\n");
  assert.match(out, /### 削除されたテストの宣言/);
  assert.match(out, /tests\/user\.test\.ts:12/);
  assert.match(out, /- 重複したテストを統合した/);
  assert.doesNotMatch(out, /src\/a\.ts/);
  assert.doesNotMatch(out, /追加されたスキップ|設定の宣言の変更/);
});

test("renderFactsPr: 事実が全く無ければ「該当なし」", () => {
  const out = renderFactsPr(emptyFacts(), "## 返した理由\n\nなし\n");
  assert.match(out, /該当なし/);
  assert.doesNotMatch(out, /^### (?!合意に無い)/m);
});

test("renderFactsPr: 調べきれなかったときは「該当なし」と書かず、調べられなかったことを示す", () => {
  const out = renderFactsPr(emptyFacts({ complete: false, notices: ["HEAD と main の merge-base を求められません"] }), undefined);
  assert.doesNotMatch(out, /該当なし/);
  assert.match(out, /最後まで調べられませんでした/);
  assert.match(out, /merge-base を求められません/);
});

// ---------------------------------------------------------------------------
// hikyaku diff facts（一時リポジトリ）

const CYCLE = "docs/hikyaku/cycles/001-test";
const BUILD = `${CYCLE}/build-01`;

function git(directory: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: { ...testEnvironment(), ...env }, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function commitAll(directory: string, message: string, at?: string): void {
  git(directory, ["add", "-A"]);
  git(directory, ["commit", "-q", "-m", message], at === undefined ? {} : { GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at });
}

/** main に基準のコミットを置き、build-01 のブランチへ切り替えた状態 */
function branched(t: TestContext, setup: (directory: string) => void = () => {}): string {
  const directory = workspace(t, true);
  const config = join(directory, ".hikyaku.config");
  writeFileSync(config, `base_branch = "main"\n${readFileSync(config, "utf8")}`);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
  write(directory, `${BUILD}/issue.md`);
  write(directory, "src/a.ts", "export const a = 1;\n");
  write(directory, "src/b.ts", "export const b = 1;\n");
  write(directory, "tests/keep.test.ts", 'it("keeps", () => {\n  assert.equal(1, 1);\n});\n');
  setup(directory);
  commitAll(directory, "base");
  git(directory, ["switch", "-q", "-c", "hikyaku/001-test/build-01"]);
  return directory;
}

function facts(directory: string): DiffFacts & { afterG8: { approvedAt?: string } } {
  return JSON.parse(succeeds(directory, "diff", "facts", "build-01", "001", "--format", "json", "--no-fetch")) as DiffFacts;
}

/** G8 の承認を progress.jsonl に追記する（コミットは呼び出し元が行う） */
function approveG8(directory: string, at: string): void {
  const path = join(directory, BUILD, "progress.jsonl");
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  write(directory, `${BUILD}/progress.jsonl`, `${before}${JSON.stringify({ at, skill: "builder", step: "G8", result: "approved" })}\n`);
}

test("diff facts: 変更ファイルと種類を並べ、スコープの内外は判定しない", (t) => {
  const directory = branched(t);
  write(directory, "src/a.ts", "export const a = 2;\n");
  rmSync(join(directory, "src/b.ts"));
  write(directory, "tests/c.test.ts", 'it("c", () => {});\n');
  commitAll(directory, "work");
  write(directory, "docs/x.md", "# x\n");
  const result = facts(directory);
  const listed = result.files.map((file) => [file.status, file.path, file.kind, file.untracked ?? false]);
  assert.deepEqual(listed.sort(), [
    ["A", "docs/x.md", "implementation", true],
    ["A", "tests/c.test.ts", "test", false],
    ["D", "src/b.ts", "implementation", false],
    ["M", "src/a.ts", "implementation", false],
  ]);
  assert.equal("scope" in result, false);
});

test("diff facts: ビルドの正当な成果物は一覧から除き、issue.md とほかのビルドは残す", (t) => {
  const directory = branched(t, (d) => write(d, `${CYCLE}/build-02/plan.md`));
  for (const name of ["progress.jsonl", "handoff.md", "agreement.md"]) write(directory, `${BUILD}/${name}`, "x\n");
  write(directory, `${BUILD}/issue.md`, "# 書き換えた\n");
  write(directory, `${CYCLE}/build-02/plan.md`, "# 書き換えた\n");
  const result = facts(directory);
  const paths = result.files.map((file) => file.path);
  assert.ok(paths.includes(`${BUILD}/issue.md`));
  assert.ok(paths.includes(`${CYCLE}/build-02/plan.md`));
  for (const name of ["progress.jsonl", "handoff.md", "agreement.md"]) assert.ok(!paths.includes(`${BUILD}/${name}`), name);
  assert.equal(result.issueChanged, true);
});

test("diff facts: 未追跡の新しいテストファイルのスキップを拾い、index を変えない", (t) => {
  const directory = branched(t);
  write(directory, "tests/new.test.ts", 'import { test } from "node:test";\n\ntest.skip("later", () => {});\n');
  const result = facts(directory);
  assert.deepEqual(result.addedSkips.map((fact) => [fact.path, fact.line, fact.marker]), [["tests/new.test.ts", 3, ".skip("]]);
  assert.equal(git(directory, ["diff", "--cached", "--name-only"]), "");
});

test("diff facts: テストファイルの削除と、リネームでテストから外したもの", (t) => {
  const directory = branched(t, (d) => {
    write(d, "tests/a.test.ts", 'it("a", () => {});\n');
    write(d, "tests/b.test.ts", 'it("b", () => {});\nit("b2", () => {});\n');
  });
  git(directory, ["rm", "-q", "tests/a.test.ts"]);
  git(directory, ["mv", "tests/b.test.ts", "src/b-helper.ts"]);
  commitAll(directory, "work");
  const result = facts(directory);
  assert.deepEqual(result.deletedTestFiles.map((file) => file.path).sort(), ["tests/a.test.ts", "tests/b.test.ts"]);
  assert.equal(result.deletedTestFiles.find((file) => file.path === "tests/b.test.ts")?.to, "src/b-helper.ts");
});

test("diff facts: テストからテストへのリネームは削除に並べない", (t) => {
  const directory = branched(t, (d) => write(d, "tests/b.test.ts", 'it("b", () => {});\nit("b2", () => {});\n'));
  git(directory, ["mv", "tests/b.test.ts", "tests/unit-b.test.ts"]);
  commitAll(directory, "work");
  const result = facts(directory);
  assert.deepEqual(result.files.map((file) => [file.status, file.path, file.from]), [["R", "tests/unit-b.test.ts", "tests/b.test.ts"]]);
  assert.deepEqual(result.deletedTestFiles, []);
  assert.deepEqual(result.deletedTests, []);
});

test("diff facts: ルートとサイクルの設定の宣言の変更を並べる", (t) => {
  const area = '\n[[app.areas]]\nname = "billing"\npaths = ["src/billing/**"]\n';
  let original = "";
  const directory = branched(t, (d) => {
    const path = join(d, ".hikyaku.config");
    original = readFileSync(path, "utf8");
    writeFileSync(path, `${original}${area}`);
  });
  writeFileSync(join(directory, ".hikyaku.config"), original);
  const cycleConfig = join(directory, CYCLE, ".hikyaku.config");
  writeFileSync(cycleConfig, `${existsSync(cycleConfig) ? readFileSync(cycleConfig, "utf8") : ""}\n[consent]\ndeferred = true\n`);
  const result = facts(directory);
  assert.deepEqual(result.configChanges.map((change) => [change.file, change.ref, change.change]), [
    [".hikyaku.config", "area:billing", "removed"],
    [`${CYCLE}/.hikyaku.config`, "consent.deferred", "added"],
  ]);
});

test("diff facts: G8 の承認後の test-spec.md と plan.md の書き換え（コミットと未コミット）", (t) => {
  const directory = branched(t);
  write(directory, `${BUILD}/test-spec.md`, "# v1\n");
  write(directory, `${BUILD}/plan.md`, "# v1\n");
  commitAll(directory, "before");
  approveG8(directory, "2026-11-16T10:00:00+09:00");
  commitAll(directory, "record G8");
  write(directory, `${BUILD}/test-spec.md`, "# v2\n");
  commitAll(directory, "rewrite test-spec");
  write(directory, `${BUILD}/plan.md`, "# v2\n");
  commitAll(directory, "rewrite plan");
  write(directory, `${BUILD}/test-spec.md`, "# v3\n");
  const result = facts(directory);
  assert.equal(result.complete, true);
  assert.equal(result.afterG8.approvedAt, "2026-11-16T10:00:00+09:00");
  const spec = result.afterG8.files.find((file) => file.path === `${BUILD}/test-spec.md`);
  assert.deepEqual(spec?.commits.map((commit) => commit.subject), ["rewrite test-spec"]);
  assert.equal(spec?.uncommitted, true);
  const plan = result.afterG8.files.find((file) => file.path === `${BUILD}/plan.md`);
  assert.deepEqual(plan?.commits.map((commit) => commit.subject), ["rewrite plan"]);
  assert.equal(plan?.uncommitted, false);
});

test("diff facts: 承認の記録と同じコミットに入った書き換え（G8 の差し戻しで直したもの）は並べない", (t) => {
  const directory = branched(t);
  write(directory, `${BUILD}/plan.md`, "# v1\n");
  commitAll(directory, "plan");
  write(directory, `${BUILD}/plan.md`, "# 差し戻しで直した\n");
  approveG8(directory, "2026-11-16T10:00:00+09:00");
  commitAll(directory, "G8 approved with fix");
  assert.deepEqual(facts(directory).afterG8.files, []);
});

test("diff facts: 基準は最後の G8 承認で、日時ではなく履歴の前後で決める（rebase で日時が変わっても前を後と数えない）", (t) => {
  const directory = branched(t);
  approveG8(directory, "2026-11-16T10:00:00+09:00");
  commitAll(directory, "first G8");
  write(directory, `${BUILD}/test-spec.md`, "# before second\n");
  // 2回目の承認より前のコミットだが、コミット日時は後（rebase で書き換わった状態）
  commitAll(directory, "between", "2030-01-01T00:00:00+09:00");
  approveG8(directory, "2026-11-16T12:00:00+09:00");
  commitAll(directory, "second G8", "2030-01-01T00:00:01+09:00");
  write(directory, `${BUILD}/test-spec.md`, "# after\n");
  commitAll(directory, "after", "2020-01-01T00:00:00+09:00");
  const result = facts(directory);
  assert.equal(result.afterG8.approvedAt, "2026-11-16T12:00:00+09:00");
  assert.deepEqual(result.afterG8.files[0]?.commits.map((commit) => commit.subject), ["after"]);
});

test("diff facts: G8 の承認の記録が未コミットなら、判定できないことを注意に出す", (t) => {
  const directory = branched(t);
  approveG8(directory, "2026-11-16T10:00:00+09:00");
  write(directory, `${BUILD}/plan.md`, "# 直した\n");
  const result = facts(directory);
  assert.deepEqual(result.afterG8.files, []);
  assert.equal(result.complete, false);
  assert.match(result.notices.join("\n"), /まだコミットされていない/);
});

test("diff facts: 利用者の diff.mnemonicPrefix に左右されずにパスを読む", (t) => {
  const directory = branched(t);
  git(directory, ["config", "diff.mnemonicPrefix", "true"]);
  git(directory, ["config", "diff.noprefix", "true"]);
  write(directory, "tests/keep.test.ts", 'it.skip("keeps", () => {\n  assert.equal(1, 1);\n});\n');
  const result = facts(directory);
  assert.deepEqual(result.addedSkips.map((fact) => fact.path), ["tests/keep.test.ts"]);
});

test("diff facts: G8 の承認記録が無ければ書き換えを並べない", (t) => {
  const directory = branched(t);
  write(directory, `${BUILD}/test-spec.md`, "# v2\n");
  commitAll(directory, "rewrite");
  const result = facts(directory);
  assert.equal(result.afterG8.approvedAt, undefined);
  assert.deepEqual(result.afterG8.files, []);
});

test("diff facts: 基準を解決できないときは notices に出して止めない", (t) => {
  const directory = branched(t);
  const config = join(directory, ".hikyaku.config");
  writeFileSync(config, readFileSync(config, "utf8").replace('base_branch = "main"', 'base_branch = "nope"'));
  write(directory, "src/a.ts", "export const a = 2;\n");
  const result = facts(directory);
  assert.ok(result.notices.length >= 1);
  assert.equal(result.complete, false);
  assert.deepEqual([result.files, result.deletedTests, result.addedSkips], [[], [], []]);
});

test("diff facts: マージ先を決められないリポジトリでも終了コード 0 で、注意に理由を出す", (t) => {
  const directory = branched(t);
  const config = join(directory, ".hikyaku.config");
  writeFileSync(config, readFileSync(config, "utf8").replace('base_branch = "main"\n', ""));
  const result = facts(directory);
  assert.equal(result.complete, false);
  assert.match(result.notices.join("\n"), /マージ先|基準/);
});

test("diff facts --format pr: agreement.md の返した理由を並べ、無ければその旨を出す", (t) => {
  const directory = branched(t);
  write(directory, "tests/keep.test.ts", "// 統合した\n");
  const missing = cli(directory, "diff", "facts", "build-01", "001", "--format", "pr", "--no-fetch");
  assert.equal(missing.status, 0, missing.stderr);
  assert.match(missing.stdout, /tests\/keep\.test\.ts/);
  assert.match(missing.stdout, /agreement\.md がありません/);
  write(directory, `${BUILD}/agreement.md`, "# 突き合わせ\n\n## 返した理由\n\n- 重複したテストを統合した\n");
  const out = succeeds(directory, "diff", "facts", "build-01", "001", "--format", "pr", "--no-fetch");
  assert.match(out, /tests\/keep\.test\.ts:1/);
  assert.match(out, /- 重複したテストを統合した/);
});

test("diff facts --format text: 人とレビュアーが読む形", (t) => {
  const directory = branched(t);
  write(directory, "tests/new.test.ts", 'it("n", () => {});\n');
  const out = succeeds(directory, "diff", "facts", "build-01", "001", "--format", "text", "--no-fetch");
  assert.equal(out.split("\n")[0], "差分の事実: build-01");
  assert.match(out, /## 変更ファイル\n\n- 追加・テスト・未追跡: tests\/new\.test\.ts/);
});

test("diff facts: build-NN でない phase はエラー", (t) => {
  const directory = branched(t);
  for (const phase of ["architect", "build-8x"]) {
    const result = cli(directory, "diff", "facts", phase, "001", "--no-fetch");
    assert.equal(result.status, 1, phase);
  }
});

// ---------------------------------------------------------------------------
// review action doc --context agreement

test("review action: agreement は max_rounds に関わらず1回で終え、confirm にならない", (t) => {
  const directory = workspace(t, true);
  const config = join(directory, ".hikyaku.config");
  writeFileSync(config, `${readFileSync(config, "utf8")}\n[review]\nmax_rounds = 3\n`);
  const action = (...flags: string[]) =>
    JSON.parse(succeeds(directory, "review", "action", "doc", "build-01", "001", "--context", "agreement", "--round", "1", ...flags, "--json")) as {
      action: string; nextRound: number | null; deferUncertain: boolean;
    };
  assert.deepEqual(action("--has-findings"), { action: "fix", nextRound: null, deferUncertain: false });
  assert.deepEqual(action("--uncertain"), { action: "done", nextRound: null, deferUncertain: true });
  assert.equal(action().action, "done");
  const other = cli(directory, "review", "action", "doc", "build-01", "001", "--context", "foo", "--round", "1");
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /--context agreement/);
});

// ---------------------------------------------------------------------------
// builder の agreement-review

test("step: どのプロファイルでも verify の次は agreement-review で、agreement.md が無ければ完了にならない", (t) => {
  for (const profile of ["express", "economy", "standard", "thorough"]) {
    const directory = workspace(t);
    succeeds(directory, "cycle", "new", "test", "--profile", profile);
    succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
    write(directory, `${BUILD}/issue.md`);
    // verify まで終えた記録を置く（手前の手順はプロファイルで異なるので、記録から導かせる）
    let directive = JSON.parse(succeeds(directory, "step", "next", "build-01", "001", "--json")).directive as { kind: string; step?: string };
    for (let guard = 0; directive.step !== "agreement-review" && guard < 20; guard += 1) {
      const step = directive.step as string;
      assert.notEqual(step, "review", `${profile}: agreement-review より先に review が来た`);
      if (step === "plan") write(directory, `${BUILD}/plan.md`);
      if (step === "test-spec") write(directory, `${BUILD}/test-spec.md`);
      const result = directive.kind === "gate" ? "approved" : "done";
      const extra = step === "plan" ? ["--peak", "350k"] : [];
      directive = JSON.parse(succeeds(directory, "step", "report", "build-01", step, "001", "--result", result, ...extra, "--json")).directive;
    }
    assert.equal(directive.step, "agreement-review", profile);
    const refused = cli(directory, "step", "report", "build-01", "agreement-review", "001", "--result", "done");
    assert.notEqual(refused.status, 0, `${profile}: agreement.md が無いのに完了した`);
    assert.match(refused.stderr, /agreement\.md/);
    write(directory, `${BUILD}/agreement.md`);
    const after = JSON.parse(succeeds(directory, "step", "report", "build-01", "agreement-review", "001", "--result", "done", "--json")).directive;
    assert.equal(after.step, "review", profile);
  }
});

test("review.md: スコープとデータ安全の自己確認が agreement-review に移っている", () => {
  const root = join(import.meta.dirname, "..");
  const review = readFileSync(join(root, "skills/builder/steps/review.md"), "utf8");
  assert.doesNotMatch(review, /スコープ準拠を自分で確認する|マージ時点のデータ安全を自分で確認する/);
  const agent = readFileSync(join(root, "agents/doc-reviewer.md"), "utf8");
  for (const label of ["合意に無いテストの後退", "スコープ外の変更", "マージ時点のデータ安全の不備"]) {
    assert.match(agent.split("### context: agreement で報告する")[1] ?? "", new RegExp(label));
  }
  assert.match(readFileSync(join(root, "skills/builder/steps/pr.md"), "utf8"), /diff facts build-\{NN\} \{cycle\} --format pr/);
});
