import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideUnsafeSplit,
  matchesBranchPattern,
  readUnsafeSection,
  validateUnsafeSplits,
  type UnsafeSplitDecision,
} from "../scripts/lib/integrity.mts";
import type { BuildRecord } from "../scripts/lib/tasklist.mts";

test("データ整合性: glob の * は / をまたがず、** はまたぐ", () => {
  assert.equal(matchesBranchPattern("main", "main"), true);
  assert.equal(matchesBranchPattern("main", "main2"), false);
  assert.equal(matchesBranchPattern("release/*", "release/2.x"), true);
  assert.equal(matchesBranchPattern("release/*", "release/2.x/hotfix"), false);
  assert.equal(matchesBranchPattern("release/**", "release/2.x/hotfix"), true);
  assert.equal(matchesBranchPattern("v?.x", "v2.x"), true);
  assert.equal(matchesBranchPattern("v?.x", "v2-x"), false);
  // 正規表現の記号はそのまま比べる
  assert.equal(matchesBranchPattern("release.(old)", "release.(old)"), true);
  assert.equal(matchesBranchPattern("release.(old)", "releaseX(old)"), false);
});

test("データ整合性: 既定（allow_unsafe_split = false）では安全でない分割を許さない", () => {
  const decision = decideUnsafeSplit({ releaseBranches: [], allowUnsafeSplit: false }, "feature/x", "main");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "flag-off");
  assert.equal(decision.overridden, false);
});

test("データ整合性: リリースされないブランチ向きでフラグがあれば許す", () => {
  const decision = decideUnsafeSplit(
    { releaseBranches: ["release/*"], allowUnsafeSplit: true },
    "feature/x",
    "main",
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "allowed");
  assert.equal(decision.baseBranch, "feature/x");
});

test("データ整合性: デフォルトブランチは release_branches に書かなくても保護される", () => {
  for (const configured of ["main", undefined]) {
    const decision = decideUnsafeSplit({ releaseBranches: [], allowUnsafeSplit: true }, configured, "main");
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "release-branch");
    assert.equal(decision.matchedPattern, "(デフォルトブランチ)");
    assert.equal(decision.overridden, true);
  }
});

test("データ整合性: release_branches のパターンに一致すればフラグより優先する", () => {
  const decision = decideUnsafeSplit(
    { releaseBranches: ["release/*"], allowUnsafeSplit: true },
    "release/2.x",
    "main",
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.matchedPattern, "release/*");
  assert.match(decision.message, /allow_unsafe_split は効きません/);
});

test("データ整合性: デフォルトブランチが分からなければ許さない側に倒す", () => {
  for (const configured of ["feature/x", undefined]) {
    const decision = decideUnsafeSplit({ releaseBranches: [], allowUnsafeSplit: true }, configured, undefined);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "default-unknown");
  }
  // 判定できなくても、パターンに一致することは分かる
  const matched = decideUnsafeSplit({ releaseBranches: ["main"], allowUnsafeSplit: true }, "main", undefined);
  assert.equal(matched.reason, "release-branch");
});

const issueWith = (body: string): string =>
  ["# Build 01: 列の追加", "", "## やること", "", "- users に列を足す", "", body, ""].join("\n");

test("データ整合性: 「マージ時点で残る危険」から解消するビルドを読む", () => {
  assert.equal(readUnsafeSection(issueWith("")), undefined);
  const section = readUnsafeSection(
    issueWith(
      [
        "## マージ時点で残る危険",
        "",
        "- build-05 で使う旧カラムへの書き込みが残る",
        "- 解消するビルド: build-03, build-4",
        "",
        "## 参照する設計ドキュメント",
        "",
        "- 解消するビルド: build-09（別の節は数えない）",
      ].join("\n"),
    ),
  );
  assert.deepEqual(section, { resolvedBy: ["3", "4"], hasResolvedByLine: true });
});

const build = (id: string, dependsOn: string[] = []): BuildRecord => ({
  id,
  title: `build ${id}`,
  bp: 3,
  dependsOn,
  issue: "",
  pr: "",
});

const allowed: UnsafeSplitDecision = decideUnsafeSplit(
  { releaseBranches: [], allowUnsafeSplit: true },
  "feature/x",
  "main",
);

test("データ整合性: 解消するビルドが推移的に依存していれば問題なし", () => {
  const builds = [build("1"), build("2", ["1"]), build("3", ["2"])];
  const issues = [{ id: "1", text: issueWith("## マージ時点で残る危険\n\n- 解消するビルド: build-03") }];
  assert.deepEqual(validateUnsafeSplits(builds, issues, allowed), []);
});

test("データ整合性: 解消するビルドの欠落・不在・自己参照・依存なしを報告する", () => {
  const builds = [build("1"), build("2"), build("3", ["1"])];
  const problems = validateUnsafeSplits(
    builds,
    [
      { id: "1", text: issueWith("## マージ時点で残る危険\n\n- 旧カラムが残る") },
      { id: "2", text: issueWith("## マージ時点で残る危険\n\n- 解消するビルド: build-02, build-09, build-03") },
    ],
    allowed,
  );
  assert.deepEqual(
    problems.map((problem) => problem.build),
    ["1", "2", "2", "2"],
  );
  assert.match(problems[0]?.message ?? "", /解消するビルド: build-NN/);
  assert.match(problems[1]?.message ?? "", /自分自身/);
  assert.match(problems[2]?.message ?? "", /build-09 は tasklist.md にありません/);
  assert.match(problems[3]?.message ?? "", /build-03 がこのビルドに依存していない/);
});

test("データ整合性: 許されていないサイクルの記録は報告し、判定不能なら許可の検査だけ省く", () => {
  const builds = [build("1"), build("2", ["1"])];
  const issues = [{ id: "1", text: issueWith("## マージ時点で残る危険\n\n- 解消するビルド: build-02") }];
  const denied = decideUnsafeSplit({ releaseBranches: [], allowUnsafeSplit: false }, "feature/x", "main");
  const problems = validateUnsafeSplits(builds, issues, denied);
  assert.equal(problems.length, 1);
  assert.match(problems[0]?.message ?? "", /許されていません/);

  const unknown = decideUnsafeSplit({ releaseBranches: [], allowUnsafeSplit: true }, "feature/x", undefined);
  assert.deepEqual(validateUnsafeSplits(builds, issues, unknown), []);
});
