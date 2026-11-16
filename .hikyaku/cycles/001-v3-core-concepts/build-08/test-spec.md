# Build 08: 差分の事実と、合意との突き合わせ（agreement-review） テストシナリオ

## diff-stats.mts（印の照合）

### findMarker: 識別子の文字で始まる印は、直前が識別子の文字でない位置だけ数える
- 対応: —
- Given: 印の一覧が既定の `DEFAULT_TEST_DECLARATIONS`、行が `  form.submit(data);`・`  const v = latest(items);`・`it("adds", () => {`・`  t.test("x", ...)` の 4 つ
- When: それぞれの行で `findMarker` を呼ぶ
- Then: 1 行目と 2 行目は `undefined`（`it(` の直前が `m`、`test(` の直前が `a` で、どちらも `[A-Za-z0-9_$]`）。3 行目は `it(`（行頭）、4 行目は `test(`（直前が `.`）を返す

### findMarker: 記号で始まる印は直前の文字を問わない単純な部分文字列
- 対応: —
- Given: 印の一覧が既定の `DEFAULT_SKIP_MARKERS`、行が `  it.skip("slow", () => {` と `  xit "sends mail" do`。別に、印の一覧が既定の `DEFAULT_TEST_DECLARATIONS` で行が `  xit "sends mail" do`
- When: それぞれの組み合わせで `findMarker` を呼ぶ
- Then: スキップの印では 1 行目が `.skip(`（直前の `t` を問わない）、2 行目が `xit "` を返す。宣言の印では `xit "sends mail"` は `undefined`（`it "` の直前が `x` なので当たらない）

## config.mts（`[diff]` の読み込み）

### readDiffPatterns: 印の3キーは既定に追加され、exclude と tests は置き換え
- 対応: US-2.1
- Given: `.hikyaku.config` に `[diff]` として `test_declarations = ["scenario("]`・`skip_markers = ["@Skip"]`・`assertion_markers = ["check("]`・`tests = ["checks/**"]`・`exclude = ["gen/**"]` を書く
- When: 設定を読み込む
- Then: `testDeclarations` は既定の全要素（`it(`・`def test_`・`#[test]` など）に `scenario(` が加わった配列、`skipMarkers` は既定＋`@Skip`、`assertionMarkers` は既定＋`check(` になる。一方 `tests` は `["checks/**"]`、`exclude` は `["gen/**"]` だけで、既定の `**/tests/**` などは含まれない

## diff-facts.mts: parseUnifiedDiff

### parseUnifiedDiff: -U0 の hunk から行番号付きの - 行と + 行を取り出す
- 対応: —
- Given: `tests/a.test.ts` の diff で hunk ヘッダが `@@ -10,2 +10,0 @@` と `@@ -20,0 +18,1 @@`、- 行が `it("a", ...)`・`  expect(x).toBe(1);`、+ 行が `  expect(x).toBe(2);`
- When: `parseUnifiedDiff` に渡す
- Then: 1 ファイルが返り、`lines` は `{side:"-",line:10}`・`{side:"-",line:11}`・`{side:"+",line:18}` の 3 行で、`text` は先頭の `-`/`+` を除いた文字列

### parseUnifiedDiff: リネームとバイナリと空の hunk
- 対応: —
- Given: `rename from tests/old.test.ts` / `rename to src/old.ts` で hunk の無いファイル、`Binary files a/img.png and b/img.png differ` のファイルを含む diff
- When: `parseUnifiedDiff` に渡す
- Then: リネームのファイルは `path: "src/old.ts"`・`from: "tests/old.test.ts"`・`lines: []`、バイナリのファイルは `lines: []` で返り、例外は出ない

### parseUnifiedDiff: 件数省略のヘッダ・改行なしの印・引用符付きパス
- 対応: —
- Given: `diff --git "a/tests/a b.test.ts" "b/tests/a b.test.ts"` に続き `+++ "b/tests/a b.test.ts"\t`（末尾にタブ）、hunk ヘッダ `@@ -10 +10 @@`、- 行 `  expect(x).toBe(1);`、`\ No newline at end of file`、+ 行 `  expect(x).toBe(2);`、`\ No newline at end of file`
- When: `parseUnifiedDiff` に渡す
- Then: `path` は `tests/a b.test.ts`（引用符と末尾のタブを外す）、`lines` は `{side:"-",line:10}` と `{side:"+",line:10}` の 2 行だけで、`\ No newline at end of file` は行として数えない

## diff-facts.mts: collectMarkerFacts（言語ごとのフィクスチャ）

### collectMarkerFacts: JS/TS の宣言の削除とスキップの追加
- 対応: US-2.1
- Given: `tests/user.test.ts` の - 行 12 が `  it("rejects empty name", () => {`、+ 行 30 が `  it.skip("slow path", async () => {`
- When: 既定の `DiffPatterns` で `collectMarkerFacts` を呼ぶ
- Then: `deletedTests` に `{ path: "tests/user.test.ts", line: 12, marker: "it(" }`、`addedSkips` に `{ path: "tests/user.test.ts", line: 30, marker: ".skip(" }` がそれぞれ1件並ぶ

### collectMarkerFacts: Python の宣言の削除とスキップの追加
- 対応: US-2.1
- Given: `tests/test_api.py` の - 行 5 が `def test_login_fails():`、+ 行 8 が `@pytest.mark.skip(reason="flaky")`
- When: `collectMarkerFacts` を呼ぶ
- Then: `deletedTests` に `marker: "def test_"`、`addedSkips` に `marker: "@pytest.mark.skip"` がそれぞれ1件並ぶ

### collectMarkerFacts: Go の宣言の削除とスキップの追加
- 対応: US-2.1
- Given: `pkg/user_test.go` の - 行 20 が `func TestCreateUser(t *testing.T) {`、+ 行 41 が `	t.Skip("TODO")`
- When: `collectMarkerFacts` を呼ぶ
- Then: `deletedTests` に `marker: "func Test"`、`addedSkips` に `marker: "t.Skip("` が並ぶ

### collectMarkerFacts: Ruby（RSpec）の宣言の削除とスキップの追加
- 対応: US-2.1
- Given: `spec/user_spec.rb` の - 行 3 が `  it "validates email" do`、+ 行 9 が `  xit "sends mail" do`
- When: `collectMarkerFacts` を呼ぶ
- Then: `deletedTests` に `marker: "it \""`、`addedSkips` に `marker: "xit \""` が並ぶ

### collectMarkerFacts: Java（JUnit）の宣言の削除とスキップの追加
- 対応: US-2.1
- Given: `src/test/java/UserTest.java` の - 行 14 が `    @Test`、+ 行 22 が `    @Disabled("broken")`
- When: `collectMarkerFacts` を呼ぶ
- Then: `deletedTests` に `marker: "@Test"`、`addedSkips` に `marker: "@Disabled"` が並ぶ

### collectMarkerFacts: Rust の宣言の削除とスキップの追加
- 対応: US-2.1
- Given: `tests/parse_test.rs` の - 行 7 が `#[test]`、+ 行 15 が `#[ignore = "slow"]`
- When: `collectMarkerFacts` を呼ぶ
- Then: `deletedTests` に `marker: "#[test]"`、`addedSkips` に `marker: "#[ignore"` が並ぶ

### collectMarkerFacts: アサーションの増減は「変更」として両側を並べる
- 対応: US-2.1
- Given: `tests/calc.test.ts` の - 行 10 が `  assert.equal(sum(1, 2), 3);`、+ 行 10 が `  assert.ok(sum(1, 2) > 0);`
- When: `collectMarkerFacts` を呼ぶ
- Then: `assertionChanges` に `side: "-"`（line 10）と `side: "+"`（line 10）の2件が並び、緩和かどうかの判定を表す項目は無い

### collectMarkerFacts: 同じファイルでの移動だけの行は事実に出さない
- 対応: US-2.1
- Given: `tests/user.test.ts` の - 行 12 と + 行 40 がどちらも `  it("rejects empty name", () => {`、- 行 13 と + 行 41 がどちらも `    expect(err).toBeTruthy();`、- 行 20 と + 行 50 がどちらも `  it.skip("slow path", async () => {`
- When: `collectMarkerFacts` を呼ぶ
- Then: `deletedTests`・`addedSkips`・`assertionChanges` はすべて空

### collectMarkerFacts: テストでないファイルの行は印を含んでも数えない
- 対応: —
- Given: `src/runner.ts`（`classifyPath` が `implementation`）の - 行 3 が `  test("x")`、+ 行 4 が `  foo.skip(1)`
- When: `collectMarkerFacts` を呼ぶ
- Then: `deletedTests`・`addedSkips`・`assertionChanges` はすべて空

### collectMarkerFacts: `[diff]` で足した印で拾える
- 対応: US-2.1
- Given: `[diff] test_declarations = ["scenario("]` を反映した `DiffPatterns`、`tests/flow.test.ts` の - 行 2 が `scenario("checkout", () => {`
- When: `collectMarkerFacts` を呼ぶ
- Then: `deletedTests` に `marker: "scenario("` が1件並ぶ

## diff-facts.mts: declarationConfigChanges

### declarationConfigChanges: `[app]` のキーの変更
- 対応: US-2.1
- Given: before が `[app]\nstage = "production"`、after が `[app]\nstage = "prototype"`
- When: `declarationConfigChanges(".hikyaku.config", before, after)` を呼ぶ
- Then: `{ file: ".hikyaku.config", ref: "app.stage", change: "changed" }` が1件返り、`detail` に `production` と `prototype` を含む

### declarationConfigChanges: `[[app.areas]]` の項目の削除
- 対応: US-2.1
- Given: before に `[[app.areas]] name = "billing"` と `name = "admin"` の2項目、after には `admin` だけ
- When: `declarationConfigChanges` を呼ぶ
- Then: `{ ref: "area:billing", change: "removed" }` が1件返り、`detail` は `項目を消した:` で始まる。`area:admin` は返らない

### declarationConfigChanges: `[[app.areas]]` の項目の追加
- 対応: US-2.1
- Given: before に `name = "admin"` の1項目、after に `admin` と `name = "billing"`・`paths = ["src/billing/**"]` の2項目
- When: `declarationConfigChanges` を呼ぶ
- Then: `{ ref: "area:billing", change: "added" }` が1件だけ返り、`detail` は `項目を足した:` で始まる

### declarationConfigChanges: `[[app.areas]]` の paths を狭め、別のパスを足す
- 対応: US-2.1
- Given: `name = "billing"` の `paths` が before で `["src/billing/**", "src/invoice/**"]`、after で `["src/billing/**", "src/tax/**"]`
- When: `declarationConfigChanges` を呼ぶ
- Then: `{ ref: "area:billing", change: "changed" }` が1件返り、`detail` は `paths: 外した: "src/invoice/**" / 足した: "src/tax/**"`

### declarationConfigChanges: `[[app.areas]]` の paths 以外のキーの変更
- 対応: US-2.1
- Given: `name = "billing"` の `data` が before で `"low"`、after で `"high"`（paths は同じ）
- When: `declarationConfigChanges` を呼ぶ
- Then: `{ ref: "area:billing", change: "changed" }` が1件返り、`detail` に `data: "low" → "high"` を含む

### declarationConfigChanges: `[boundaries]` と `[consent]` の追加・削除
- 対応: US-2.1
- Given: before に `[consent]\npost_merge = true` があり `[boundaries]` は無い、after は `[consent]` が無く `[boundaries]\nexternal = ["payments"]` がある
- When: `declarationConfigChanges` を呼ぶ
- Then: `{ ref: "consent.post_merge", change: "removed" }` と `{ ref: "boundaries.external", change: "added" }` がそれぞれ1件並ぶ

### declarationConfigChanges: 設定ファイルの新規作成（before が undefined）
- 対応: US-2.1
- Given: `file` がサイクルの `.hikyaku.config`、before が `undefined`、after が `[consent]\npost_merge = true`
- When: `declarationConfigChanges(file, undefined, after)` を呼ぶ
- Then: 例外を投げず `{ ref: "consent.post_merge", change: "added" }` が1件返る。before も after も `undefined` なら空配列

### declarationConfigChanges: TOML を読めなければ「読めない」を事実にする
- 対応: —
- Given: before は正しい TOML、after が `[app\nstage = ` の壊れた TOML
- When: `declarationConfigChanges` を呼ぶ
- Then: 例外を投げず、`detail` に読めなかったことを示す変更が1件返る

## diff-facts.mts: agreementReasons と renderFactsPr

### agreementReasons: 「## 返した理由」の箇条書きだけを取り出す
- 対応: US-2.6
- Given: agreement.md が `## 指摘\n- A を足した\n## 返した理由\n- A は issue.md のやることに含まれる\n- B は G8 で合意済み\n## 備考\n- 無関係`
- When: `agreementReasons` を呼ぶ
- Then: `["A は issue.md のやることに含まれる", "B は G8 で合意済み"]` を返す

### renderFactsPr: 事実と返した理由が並び、変更ファイルの一覧は写さない
- 対応: US-2.6
- Given: `deletedTests` 1件（`tests/user.test.ts:12`）、`files` に `src/a.ts` と `tests/user.test.ts`、agreement.md の返した理由が1件
- When: `renderFactsPr(facts, agreement)` を呼ぶ
- Then: 出力にテストの削除の項と `tests/user.test.ts:12`、返した理由の文が含まれ、`src/a.ts` を列挙した変更ファイルの一覧は含まれない。スキップ・設定など事実の無い項目の見出しは出ない

### renderFactsPr: 事実が全く無ければ「該当なし」
- 対応: US-2.6
- Given: すべての事実が空・`issueChanged: false`・`afterG8.files` が空、agreement.md の返した理由が空
- When: `renderFactsPr` を呼ぶ
- Then: 事実の部分は「該当なし」の1行だけになる

## hikyaku diff facts（一時 Git リポジトリでの CLI 結合）

### diff facts: 変更ファイルと種類を並べ、スコープの内外は判定しない
- 対応: US-2.3
- Given: base ブランチから切った build-08 のブランチで `src/a.ts` を変更（M）、`src/b.ts` を削除（D）、`tests/c.test.ts` をコミットし、`docs/x.md` を未追跡のまま追加
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `files` に `M src/a.ts`（implementation）・`D src/b.ts`・`A tests/c.test.ts`（test）・`A docs/x.md`（`untracked: true`）が並び、スコープを示す項目は無い。終了コードは 0

### diff facts: ビルドの正当な成果物は一覧から除き、issue.md とほかのビルドは残す
- 対応: US-2.3
- Given: 作業ツリーで `build-08/progress.jsonl`・`build-08/handoff.md`・`build-08/agreement.md`・`build-08/issue.md`・`build-07/plan.md` を変更
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `files` に `build-08/issue.md` と `build-07/plan.md` は並び、`progress.jsonl`・`handoff.md`・`agreement.md` は並ばない。`issueChanged` は `true`

### diff facts: 未追跡の新しいテストファイルのスキップを拾う
- 対応: US-2.1
- Given: `tests/new.test.ts` を未追跡のまま作り、その 3 行目が `test.skip("later", () => {})`
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `addedSkips` に `{ path: "tests/new.test.ts", line: 3, marker: ".skip(" }` が並び、実行後も `git diff --cached --name-only` は空のまま（index を変えない）

### diff facts: テストファイルの削除と、リネームでテストから外したもの
- 対応: US-2.1
- Given: `tests/a.test.ts` を `git rm` し、`tests/b.test.ts` を `src/b-helper.ts` へ `git mv`（中身は同じ）してコミット
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `deletedTestFiles` は `["tests/a.test.ts", "tests/b.test.ts"]` の2件

### diff facts: テストからテストへのリネームは削除に並べない
- 対応: US-2.1
- Given: `tests/b.test.ts` を `tests/unit/b.test.ts` へ `git mv`（中身は同じ）してコミット
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `files` に `R tests/unit/b.test.ts`（`from: "tests/b.test.ts"`）が並び、`deletedTestFiles` と `deletedTests` は空

### diff facts: ルートとサイクルの設定の宣言の変更を並べる
- 対応: US-2.1
- Given: merge-base のルート `.hikyaku.config` に `[[app.areas]] name = "billing"` があり、作業ツリーで削除。サイクルの `.hikyaku.config` に `[consent]` を追加
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `configChanges` に `file: ".hikyaku.config"` の `billing` の `removed` と、サイクルの設定ファイルの `[consent]` の `added` が並ぶ

### diff facts: G8 の承認後の test-spec.md の書き換え（コミットと未コミット）
- 対応: US-2.2
- Given: progress.jsonl に `builder`・`G8`・`approved` の記録（`at: 2026-11-16T10:00:00+09:00`）。その前に test-spec.md をコミット、承認後に test-spec.md を変更するコミット（`2026-11-16T11:00:00+09:00`）をし、さらに未コミットの変更を加える
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `afterG8.approvedAt` は `2026-11-16T10:00:00+09:00`、`afterG8.files` の test-spec.md に承認後のコミット1件だけが並び（承認前のコミットは並ばない）、`uncommitted: true`

### diff facts: G8 の承認後の plan.md の書き換えも並ぶ
- 対応: US-2.2
- Given: G8 の `approved`（`at: 2026-11-16T10:00:00+09:00`）の後、plan.md だけを変更するコミット（`2026-11-16T10:30:00+09:00`）をし、test-spec.md は変えない
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `afterG8.files` の plan.md にそのコミット1件が並び、`uncommitted: false`。test-spec.md の項目のコミットは0件

### diff facts: 基準は最後の G8 承認で、同じ秒のコミットは並ばない
- 対応: US-2.2
- Given: progress.jsonl に G8 の `approved` が2件（`at: 2026-11-16T10:00:00+09:00` と `2026-11-16T12:00:00+09:00`）。test-spec.md を変えるコミットが `11:00:00`・`12:00:00`・`12:00:01`（いずれも +09:00）に1件ずつ
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `afterG8.approvedAt` は `2026-11-16T12:00:00+09:00`、test-spec.md に並ぶのは `12:00:01` のコミット1件だけ（`11:00:00` は基準より前、`12:00:00` は同じ秒なので除く）

### diff facts: G8 の承認記録が無ければ書き換えを並べない
- 対応: US-2.2
- Given: progress.jsonl に G8 の `approved` が無く、test-spec.md に変更のコミットがある
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: `afterG8.approvedAt` は `undefined`、`afterG8.files` は空

### diff facts: 基準を解決できないときは notices に出して止めない
- 対応: —
- Given: `base_branch` に存在しないブランチ `nope` を設定したリポジトリ
- When: `hikyaku diff facts build-08 001 --format json --no-fetch` を実行
- Then: 終了コードは 0、`notices` に基準を解決できなかった理由が1件以上あり、`files` と印の事実は空

### diff facts --format pr: agreement.md の返した理由を PR の節に並べる
- 対応: US-2.6
- Given: テストの宣言を1件削除した差分と、`build-08/agreement.md` の「## 返した理由」に `- 重複したテストを統合した`
- When: `hikyaku diff facts build-08 001 --format pr --no-fetch` を実行
- Then: 標準出力に削除したテストの位置と `重複したテストを統合した` が含まれる

### diff facts --format pr: agreement.md が無ければその旨を出す
- 対応: US-2.6
- Given: テストの宣言を1件削除した差分があり、`build-08/agreement.md` が無い
- When: `hikyaku diff facts build-08 001 --format pr --no-fetch` を実行
- Then: 終了コードは 0 で、標準出力に削除したテストの位置と「agreement.md がありません」が含まれる

### diff facts --format text: 人とレビュアーが読む形
- 対応: US-2.3
- Given: `tests/new.test.ts` を未追跡のまま追加した差分
- When: `hikyaku diff facts build-08 001 --format text --no-fetch` を実行
- Then: 出力の1行目が `差分の事実: build-08` で、`## 変更ファイル` 節に `- 追加・テスト・未追跡: tests/new.test.ts` の行がある

### diff facts: build-NN でない phase はエラー
- 対応: —
- Given: サイクル 001 のある一時リポジトリ
- When: `hikyaku diff facts architect 001 --no-fetch` と `hikyaku diff facts build-8x 001 --no-fetch` を実行
- Then: どちらも終了コード 1 で、phase が `build-NN` でないことを示すエラーが出る

## review action doc（agreement の context）

### review action: agreement の指摘は max_rounds に関わらず1回で fix になり confirm にならない
- 対応: US-2.6
- Given: `[review] max_rounds = 3` の設定
- When: `hikyaku review action doc build-08 001 --context agreement --round 1 --has-findings --json` を実行
- Then: `action` は `"fix"`、`nextRound` は `null`（2 ラウンド目に進まない）で、`"confirm"` にはならない。終了コードは 0

### review action: agreement の不確かな指摘だけなら done で先送り、指摘なしも done
- 対応: US-2.6
- Given: `[review] max_rounds = 3` の設定
- When: `hikyaku review action doc build-08 001 --context agreement --round 1 --uncertain --json` と、フラグなしの `... --round 1 --json` を実行
- Then: 前者は `action: "done"`・`deferUncertain: true`、後者は `action: "done"`

### review action: agreement 以外の doc の context はエラーのまま
- 対応: —
- Given: 同じ設定
- When: `hikyaku review action doc build-08 001 --context foo --round 1 ...` を実行
- Then: 終了コードが 0 以外で、context が受け付けられないことを示すエラーが出る

## steps/builder.mts（agreement-review ステップ）

### step next: どのプロファイルでも verify の次は agreement-review
- 対応: US-2.4
- Given: express・economy・standard・thorough の各プロファイルのサイクルで、build-08 の verify まで完了した progress.jsonl
- When: 各サイクルで `hikyaku step next builder build-08 <cycle>` を実行
- Then: 4つとも次のステップが `agreement-review` で、review はその後に来る

### step done: agreement.md が無ければ agreement-review の完了を受け付けない
- 対応: US-2.4
- Given: verify まで完了し、`build-08/agreement.md` が無い
- When: `hikyaku step done builder build-08 001 agreement-review` を実行
- Then: 終了コードが 0 以外で `agreement.md` が無いことを示し、次の `step next` も `agreement-review` のまま。agreement.md を置いてから実行すると完了し、次は `review`

## skills/builder（指示文）

### review.md: スコープとデータ安全の自己確認が無い
- 対応: US-2.5
- Given: 変更後の `skills/builder/steps/review.md`
- When: 本文を読む
- Then: スコープ準拠とデータ安全の自己確認の項目が無く、`skills/builder/steps/agreement-review.md` と `agents/doc-reviewer.md` の `agreement` の context に、合意に無い変更・スコープ外の変更・データ安全の不備・テストの後退の合意なしの観点がある（`step lint` が通る）
