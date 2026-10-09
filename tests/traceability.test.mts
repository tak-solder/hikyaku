import assert from "node:assert/strict";
import { test } from "node:test";
import { definedCriteria, referencedCriteria, validateTraceability } from "../scripts/lib/traceability.mts";

const stories = [
  "# ユーザーストーリー",
  "",
  "## US-1: ログイン",
  "**受け入れ基準**:",
  "- [ ] US-1.1: メールアドレスでログインできる",
  "- [x] US-1.2: 失敗時にエラーを表示する",
  "",
  "本文中の US-9.9 は定義ではない",
  "",
  "```markdown",
  "- [ ] US-8.1: コードブロックの例は数えない",
  "```",
  "",
].join("\n");

const issue = (criteria: string | undefined): string =>
  ["# Build 01: 認証", "", "## やること", "- US-7.7 への言及は節の外", "",
    ...(criteria === undefined ? [] : ["## 対応する受け入れ基準", "", criteria, ""]),
    "## 受け入れ基準", "- [ ] 完了条件", ""].join("\n");

test("追跡: 定義はチェックボックス行の先頭の番号だけを拾い、コードブロックは無視する", () => {
  assert.deepEqual(definedCriteria(stories), ["US-1.1", "US-1.2"]);
});

test("追跡: issue.md の番号は「対応する受け入れ基準」節の中だけを拾い、節の有無を区別する", () => {
  assert.deepEqual(referencedCriteria(issue("- US-1.1, US-1.2")), ["US-1.1", "US-1.2"]);
  assert.deepEqual(referencedCriteria(issue("なし（基盤整備のみ）")), []);
  assert.equal(referencedCriteria(issue(undefined)), undefined);
});

test("追跡: 番号が定義されていないサイクルは検査しない", () => {
  assert.deepEqual(validateTraceability([], [{ id: "1", text: issue(undefined) }]), []);
});

test("追跡: ビルド分割の前は網羅を見ず、番号の重複だけを報告する", () => {
  const problems = validateTraceability(["US-1.1", "US-1.1"], []);
  assert.equal(problems.length, 1);
  assert.match(problems[0]?.message ?? "", /重複/);
});

test("追跡: 節の欠落・存在しない番号・未割り当てを報告し、全部割り当てれば問題なし", () => {
  const defined = ["US-1.1", "US-1.2", "US-2.1"];
  const problems = validateTraceability(defined, [
    { id: "1", text: issue("- US-1.1\n- US-3.1") },
    { id: "2", text: issue(undefined) },
  ]);
  assert.deepEqual(
    problems.map((p) => [p.build, p.message.replace(/:.*$/, "")]),
    [
      ["1", "user-stories.md に無い受け入れ基準を参照しています"],
      ["2", "issue.md に「対応する受け入れ基準」の節がありません"],
      [undefined, "どのビルドにも割り当てられていない受け入れ基準があります"],
    ],
  );
  assert.match(problems[2]?.message ?? "", /US-1\.2, US-2\.1$/);

  assert.deepEqual(
    validateTraceability(defined, [
      { id: "1", text: issue("- US-1.1, US-1.2") },
      { id: "2", text: issue("- US-2.1") },
    ]),
    [],
  );
});
