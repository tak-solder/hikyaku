# Build 13: 中身を含まないフィードバックと、document-guide のアンカー テストシナリオ

## scripts/lib/feedback.mts

### progressFiles: サイクル・patch の下の progress.jsonl を再帰で集める
- 対応: US-16.1
- Given: HIKYAKU_ROOT の下に `cycles/001-secret-billing/build-03/progress.jsonl`・`cycles/001-secret-billing/progress.jsonl`・`patches/202611/fix-login/progress.jsonl` がある
- When: `progressFiles(hikyakuRoot)` を呼ぶ
- Then: 3 つのファイルの絶対パスがすべて返る

### progressFiles: feedback/ の下は集めない
- 対応: —
- Given: HIKYAKU_ROOT の下に `cycles/001-a/build-01/progress.jsonl` と `feedback/progress.jsonl` がある
- When: `progressFiles(hikyakuRoot)` を呼ぶ
- Then: `cycles/001-a/build-01/progress.jsonl` だけが返り、`feedback/progress.jsonl` は含まれない

### progressFiles: 記録が1件も無い
- 対応: —
- Given: HIKYAKU_ROOT に `cycles.md` だけがあり、progress.jsonl は1つも無い
- When: `progressFiles(hikyakuRoot)` を呼ぶ
- Then: 空の配列が返る（例外にならない）

### summarizeProgress: failed を skill・step ごとに数える
- 対応: US-16.1
- Given: ファイル A に `{skill:"builder", step:"test", result:"failed"}` が 2 件、ファイル B に `{skill:"builder", step:"test", result:"failed"}` が 1 件と `{skill:"architect", step:"plan-review", result:"failed"}` が 1 件
- When: `summarizeProgress([A, B])` を呼ぶ
- Then: `failed` に `{skill:"builder", step:"test", count:3}` と `{skill:"architect", step:"plan-review", count:1}` が入る

### summarizeProgress: failed 以外の結果は止まった手順に数えない
- 対応: US-16.1
- Given: `{skill:"builder", step:"test", result:"done"}`・`result:"skipped"`・`result:"rejected"` の記録が各 1 件
- When: `summarizeProgress` を呼ぶ
- Then: `failed` は空の配列

### summarizeProgress: ゲートの時間は直前の記録の at との差（分）
- 対応: US-16.1
- Given: 同じファイルに `{at:"2026-11-01T10:00:00Z", skill:"planner", step:"stories", result:"done"}` と `{at:"2026-11-01T10:30:00Z", skill:"planner", step:"g1", result:"approved"}` が並ぶ
- When: `summarizeProgress` を呼ぶ
- Then: `gates` に `{skill:"planner", step:"g1", count:1, medianMinutes:30}` が入る

### summarizeProgress: rejected もゲートの時間に数える
- 対応: US-16.1
- Given: `{at:"2026-11-01T09:00:00Z", step:"design", result:"done"}` の直後に `{at:"2026-11-01T09:12:00Z", skill:"architect", step:"g3", result:"rejected"}`
- When: `summarizeProgress` を呼ぶ
- Then: `gates` に `{skill:"architect", step:"g3", count:1, medianMinutes:12}` が入る

### summarizeProgress: 同じゲートの時間は中央値でまとめる
- 対応: US-16.1
- Given: `builder` の `g4` の承認が 3 回あり、直前の記録との差がそれぞれ 5 分・20 分・90 分
- When: `summarizeProgress` を呼ぶ
- Then: `{skill:"builder", step:"g4", count:3, medianMinutes:20}` が入る

### summarizeProgress: 件数が偶数のときの中央値（解釈）
- 対応: —
- Given: `builder` の `g4` の差が 10 分と 30 分の 2 回
- When: `summarizeProgress` を呼ぶ
- Then: `medianMinutes` は 20（中央の 2 つの平均）

### summarizeProgress: ファイルの先頭のゲートは数えない
- 対応: —
- Given: ファイルの最初の記録が `{at:"2026-11-01T10:00:00Z", skill:"planner", step:"g1", result:"approved"}`
- When: `summarizeProgress` を呼ぶ
- Then: `gates` に planner の g1 は入らない（直前の記録が無い）

### summarizeProgress: 直前の記録は同じファイルの中だけで探す
- 対応: —
- Given: ファイル A の最後が `at:"2026-11-01T10:00:00Z"` の done、ファイル B の最初が `at:"2026-11-01T10:05:00Z"` の approved
- When: `summarizeProgress([A, B])` を呼ぶ
- Then: B の approved は数えない（A の記録との差 5 分は使わない）

### summarizeProgress: restart の直後のゲートは数えない
- 対応: —
- Given: `{at:"…T10:00:00Z", result:"done"}`・`{at:"…T11:00:00Z", skill:"architect", step:"*", result:"restart", round:"return"}`・`{at:"…T11:40:00Z", skill:"architect", step:"g3", result:"approved"}` の順
- When: `summarizeProgress` を呼ぶ
- Then: `gates` に architect の g3 は入らない

### summarizeProgress: 差が負のゲートは数えない
- 対応: —
- Given: `{at:"2026-11-01T10:30:00Z", result:"done"}` の直後に `{at:"2026-11-01T10:00:00Z", skill:"planner", step:"g1", result:"approved"}`
- When: `summarizeProgress` を呼ぶ
- Then: `gates` に planner の g1 は入らない

### summarizeProgress: 読めない日時のゲートは数えない
- 対応: —
- Given: `{at:"not-a-date", result:"done"}` の直後に `{at:"2026-11-01T10:00:00Z", skill:"planner", step:"g1", result:"approved"}`
- When: `summarizeProgress` を呼ぶ
- Then: `gates` に planner の g1 は入らず、例外にもならない

### summarizeProgress: round は集計の単位に含めない
- 対応: US-16.1
- Given: architect の g3 の承認が 2 回あり、一方は `round:"return"`、他方は `round:"add"` の回に属する（どちらも restart の直後ではない）
- When: `summarizeProgress` を呼ぶ
- Then: `gates` の architect・g3 は 1 行にまとまり `count:2`。出力に `return`・`add` は現れない

### summarizeProgress: 記録された Hikyaku の版を集める
- 対応: US-16.1
- Given: 記録の `hikyaku` が `"3.0.0"`・`"3.0.0"`・`"3.1.0"`、1 件は `hikyaku` 欄が無い
- When: `summarizeProgress` を呼ぶ
- Then: `versions` は `["3.0.0", "3.1.0"]`（重複なし。欄の無い記録は加えない）

### summarizeProgress: 件数や最大値を返さない
- 対応: —
- Given: 3 ファイル・計 50 件の記録
- When: `summarizeProgress` を呼ぶ
- Then: 戻り値のキーは `failed`・`gates`・`versions` だけで、記録の総数・ファイル数・最大値を表す値を持たない

### upstreamItems: すべてのサイクルの upstream の本文だけを返す
- 対応: US-16.1
- Given: サイクル `001-secret-billing` の build-02 の handoff.md に `` - `upstream`: tasklist add --dry-run が相互依存を評価できない ``、サイクル `002-acme-portal` の retrospective.md に `` - `upstream`: step next が restart を二重に数える ``
- When: `upstreamItems(hikyakuRoot)` を呼ぶ
- Then: `["tasklist add --dry-run が相互依存を評価できない", "step next が restart を二重に数える"]` の 2 件が返り、`001-secret-billing`・`002-acme-portal`・`build-02` を含む値は返らない

### upstreamItems: upstream 以外の宛先は返さない
- 対応: US-16.1
- Given: handoff.md に `` - `constraints` [高]: 請求 API は 1 分あたり 100 件まで `` と `` - `upstream`: X が壊れる `` がある
- When: `upstreamItems(hikyakuRoot)` を呼ぶ
- Then: `["X が壊れる"]` だけが返る

### renderFeedback: 書き出しにサイクル名・ビルド番号・slug・答え・理由・PR を含まない
- 対応: US-16.1
- Given: フィクスチャの progress.jsonl が `cycles/001-secret-billing/build-07/` と `patches/202611/fix-acme-login/` にあり、記録に `input:"顧客 ACME の要件で承認"`・`reason:"請求テーブルの移行が失敗"`・`pr:"https://github.com/acme/secret/pull/42"`・`session:"sess-abc123"`・`round:"return"` を含む
- When: `progressFiles` → `readProgress` → `summarizeProgress` → `renderFeedback(summary, "20261117")` の順に通す
- Then: 出力に `secret-billing`・`001-`・`build-07`・`fix-acme-login`・`202611/`・`顧客 ACME`・`請求テーブルの移行`・`pull/42`・`sess-abc123`・`return` のいずれも現れない

### renderFeedback: 止まった手順とゲートの時間の節がある
- 対応: US-16.1
- Given: `failed: [{skill:"builder", step:"test", count:3}]`、`gates: [{skill:"planner", step:"g1", count:2, medianMinutes:30}]`
- When: `renderFeedback(summary, "20261117")` を呼ぶ
- Then: 「止まった手順」の節に `builder`・`test`・`3`、「ゲートにかかった時間」の節に `planner`・`g1`・`2`・`30` が現れる

### renderFeedback: upstream の節に本文と全文を読む注意がある
- 対応: US-16.3
- Given: `upstream: ["tasklist add --dry-run が相互依存を評価できない"]`
- When: `renderFeedback` を呼ぶ
- Then: upstream の節にその本文がそのまま現れ、自由文なので送る前に全文を読むよう求める注意が書かれている

### renderFeedback: 先頭の使い方に、送る前に全文を読み、送るかはユーザーが決めると書かれる
- 対応: US-16.3
- Given: 任意の `FeedbackSummary`
- When: `renderFeedback` を呼ぶ
- Then: 本文の最初の節が「使い方」で、送る前に全文を読むことと、送るかどうかはユーザーが決めることが書かれている

### renderFeedback: 起票の下書きの節がある
- 対応: US-16.3
- Given: `failed` に 1 件、`upstream` に 1 件ある `FeedbackSummary`
- When: `renderFeedback(summary, "20261117")` を呼ぶ
- Then: 「起票の下書き」の節があり、issue のタイトルの雛形と、上の集計の節を指す本文の枠が入っている

### renderFeedback: 起票はユーザーが行うと示し、送り先へのリンクや送る手順を含まない
- 対応: US-16.4
- Given: 任意の `FeedbackSummary`
- When: `renderFeedback` を呼ぶ
- Then: 起票はユーザーが行うことが示され、`gh issue create` などの送信を実行するコマンドは含まれない

### renderFeedback: 集計が空のときも節は欠けない（解釈）
- 対応: —
- Given: `failed: []`・`gates: []`・`versions: []`・`upstream: []`
- When: `renderFeedback` を呼ぶ
- Then: 使い方・止まった手順・ゲートにかかった時間・upstream・起票の下書きの各節が出て、空の節には「なし」と書かれる

### feedbackPath: 日付ごとのファイル名
- 対応: US-16.2
- Given: `hikyakuRoot = "/repo/.hikyaku"`、`date = "20261117"`
- When: `feedbackPath(hikyakuRoot, date)` を呼ぶ
- Then: `/repo/.hikyaku/feedback/20261117.md` が返る（利用者のリポジトリの中）

### isIgnored: feedback/ が .gitignore にあれば、まだ無いディレクトリでも追跡対象外と判定する
- 対応: US-16.2
- Given: 一時 Git リポジトリの `.hikyaku/.gitignore` に `feedback/` があり、`.hikyaku/feedback/` ディレクトリはまだ無い
- When: `isIgnored(repoRoot, ".hikyaku/feedback/20261117.md")` を呼ぶ
- Then: `true` が返る

### isIgnored: .gitignore に無ければ追跡対象と判定する
- 対応: US-16.2
- Given: 一時 Git リポジトリの `.hikyaku/.gitignore` は `.hikyaku.local` の1行だけ
- When: `isIgnored(repoRoot, ".hikyaku/feedback/20261117.md")` を呼ぶ
- Then: `false` が返る

### isIgnored: git リポジトリでなければ追跡対象外とみなさない
- 対応: —
- Given: `.git` の無い一時ディレクトリ
- When: `isIgnored(dir, "feedback/20261117.md")` を呼ぶ
- Then: `false` が返る（check-ignore の失敗を追跡対象外とみなさない）

## scripts/commands/feedback.mts

### feedback export: feedback/{YYYYMMDD}.md に書き出す
- 対応: US-16.1
- Given: 一時 Git リポジトリで init 済み（`.hikyaku/.gitignore` に `feedback/`）、`cycles/001-a/build-01/progress.jsonl` に failed が 1 件
- When: `hikyaku feedback export` を実行する
- Then: 終了コード 0 で `.hikyaku/feedback/{今日の YYYYMMDD}.md` が作られ、`git status --porcelain` にそのファイルが現れない

### feedback export: feedback/ が追跡対象なら書き出さずに止まる
- 対応: US-16.2
- Given: 一時 Git リポジトリの `.hikyaku/.gitignore` が `.hikyaku.local` の1行だけ
- When: `hikyaku feedback export` を実行する
- Then: 終了コードが 0 以外で、`.hikyaku/.gitignore` に `feedback/` を足すよう案内するエラーが出て、`.hikyaku/feedback/` は作られない

### feedback export: --dry-run は本文を表示して書かない
- 対応: US-16.3
- Given: 一時 Git リポジトリで init 済み、upstream が 1 件ある
- When: `hikyaku feedback export --dry-run` を実行する
- Then: 標準出力に「使い方」「起票の下書き」を含む本文全体が出て、`.hikyaku/feedback/` は作られない

### feedback export: --dry-run でも追跡対象なら止まる
- 対応: US-16.2
- Given: `.hikyaku/.gitignore` に `feedback/` が無い
- When: `hikyaku feedback export --dry-run` を実行する
- Then: 終了コードが 0 以外で、書き出さないときと同じエラーが出る

### feedback export: 壊れた progress.jsonl はエラーにする
- 対応: —
- Given: init 済みのリポジトリで `cycles/001-a/build-01/progress.jsonl` の 2 行目が `{"at":` で切れている
- When: `hikyaku feedback export` を実行する
- Then: 終了コードが 0 以外で、壊れたファイルを示すエラーになり、feedback ファイルは作られない（黙って読み飛ばさない）

### feedback export: 外部へ送る処理を持たない
- 対応: US-16.2
- Given: `PATH` に、呼ばれたら記録を残す偽の `gh` と `curl` を置いた一時 Git リポジトリ（init 済み）
- When: `hikyaku feedback export` を実行する
- Then: 偽の `gh`・`curl` は一度も呼ばれない

### feedback export: 書き出しの後、送るのはユーザーに委ねる
- 対応: US-16.4
- Given: init 済みのリポジトリ
- When: `hikyaku feedback export --json` を実行する
- Then: 結果は書き出したパスを返すだけで、送信済み・起票済みを表す値や issue の URL を含まない

## scripts/lib/docs.mts

### parseGuide: アンカー付きのパスを path と anchor に分ける
- 対応: US-17.1
- Given: document-guide.md の glossary 行のパスが `` `docs/concepts.md#用語` ``
- When: `parseGuide(source)` を呼ぶ
- Then: glossary の `path` は `"docs/concepts.md"`、`anchor` は `"用語"`

### parseGuide: パーセントエンコードされたアンカーをデコードする（解釈）
- 対応: US-17.1
- Given: パスが `` `docs/concepts.md#%E7%94%A8%E8%AA%9E` ``
- When: `parseGuide(source)` を呼ぶ
- Then: `path` は `"docs/concepts.md"`、`anchor` は `"用語"`

### parseGuide: アンカーが無ければ今と同じ値
- 対応: —
- Given: conventions 行のパスが `AGENTS.md`、decisions 行が `` `.hikyaku/decisions/` ``
- When: `parseGuide(source)` を呼ぶ
- Then: `path` はそれぞれ `"AGENTS.md"`・`".hikyaku/decisions/"`、`anchor` は `undefined`

### docRef: アンカーがあれば path#anchor を返す
- 対応: US-17.2
- Given: `{path:"docs/concepts.md", anchor:"用語"}` のエントリ
- When: `docRef(entry)` を呼ぶ
- Then: `"docs/concepts.md#用語"` が返る

### docRef: アンカーが無ければ path を、パスが無ければ undefined を返す
- 対応: —
- Given: `{path:"AGENTS.md", anchor:undefined}` と `{path:undefined, anchor:undefined}`（未作成）
- When: それぞれ `docRef` を呼ぶ
- Then: `"AGENTS.md"` と `undefined`

### githubAnchor: 英字は小文字にし、空白を - にする
- 対応: US-17.1
- Given: 見出し `"Getting Started"`
- When: `githubAnchor` を呼ぶ
- Then: `"getting-started"`

### githubAnchor: 日本語の文字は残す
- 対応: US-17.1
- Given: 見出し `"用語"` と `"設計の原則（v3）"`
- When: `githubAnchor` を呼ぶ
- Then: `"用語"` と `"設計の原則v3"`（全角括弧は除かれる）

### githubAnchor: 記号は除き、- と _ は残す
- 対応: —
- Given: 見出し `"API: v2.1 / snake_case-name!"`
- When: `githubAnchor` を呼ぶ
- Then: `"api-v21--snake_case-name"`

### markdownAnchors: 見出しからアンカーの集合を作る
- 対応: US-17.3
- Given: `"# 概念\n## 用語\n### Phase とは\n"`
- When: `markdownAnchors(source)` を呼ぶ
- Then: `{"概念", "用語", "phase-とは"}`

### markdownAnchors: 同じ見出しには -1・-2 を付ける
- 対応: —
- Given: `"## 例\n## 例\n## 例\n"`
- When: `markdownAnchors(source)` を呼ぶ
- Then: `{"例", "例-1", "例-2"}`

### markdownAnchors: コードブロックの中の # は見出しにしない
- 対応: —
- Given: `` "## 用語\n```bash\n# 用語集を再生成\n```\n" ``
- When: `markdownAnchors(source)` を呼ぶ
- Then: `{"用語"}` だけで、`"用語集を再生成"` は含まない

### validateGuide: 実在する節のアンカーは問題にしない
- 対応: US-17.1
- Given: `docs/concepts.md` に `## 用語` があり、glossary が `docs/concepts.md#用語`
- When: `validateGuide(entries, repoRoot)` を呼ぶ
- Then: glossary の問題は 0 件

### validateGuide: 節が消えたら「節が見つかりません」を報告する
- 対応: US-17.3
- Given: glossary が `docs/concepts.md#用語` で、`docs/concepts.md` の見出しが `## 用語集` に改名されている
- When: `validateGuide(entries, repoRoot)` を呼ぶ
- Then: glossary に「節が見つかりません」を含む問題が 1 件返る

### validateGuide: パスの存在はアンカーを除いて調べる
- 対応: US-17.3
- Given: glossary が `docs/missing.md#用語` で、`docs/missing.md` が存在しない
- When: `validateGuide` を呼ぶ
- Then: 「パスが存在しません: docs/missing.md」が返り、`#用語` を含むパスとしては報告しない

### validateGuide: ディレクトリにアンカーを付けたら問題にする
- 対応: —
- Given: decisions が `` `.hikyaku/decisions/#index` `` で、そのディレクトリは存在する
- When: `validateGuide` を呼ぶ
- Then: decisions に問題が 1 件返る（アンカーはファイルにしか付けられない）

### renderIndexBlock: 表示はアンカー付き
- 対応: US-17.1
- Given: glossary が `{ownership:"repo", path:"docs/concepts.md", anchor:"用語", summary:"用語集"}`
- When: `renderIndexBlock(entries)` を呼ぶ
- Then: 出力に `` - glossary: `docs/concepts.md#用語` — 用語集 `` の形の行が含まれる

### renderIndexBlock: 一覧に載せる判定はアンカーの有無で変わらない
- 対応: US-17.1
- Given: glossary が `{ownership:"repo", path:"docs/concepts.md", anchor:"用語"}`、overview が `{ownership:"未作成", path:undefined, anchor:undefined}`
- When: `renderIndexBlock(entries)` を呼ぶ
- Then: glossary の行は載り（アンカーを除いたパスがあるため）、overview の行は載らない。glossary の anchor を undefined にしても載る・載らないの結果は同じ

### renderIndexBlock: アンカーが無い既存の登録は出力が変わらない
- 対応: —
- Given: アンカーを持たない conventions（`AGENTS.md`）と decisions（`.hikyaku/decisions/`）だけのエントリ
- When: `renderIndexBlock(entries)` を呼ぶ
- Then: 変更前と同じ文字列が返る

## scripts/commands/context.mts

### context: アンカー付きのパスで候補を返す
- 対応: US-17.2
- Given: 一時 Git リポジトリで glossary を `docs/concepts.md#用語` と登録し、`docs/concepts.md` に `## 用語` がある
- When: glossary を読むフェーズ（例: `architect`）で `hikyaku context architect --json` を実行する
- Then: glossary の候補の `path` が `"docs/concepts.md#用語"` で、`missingDocs` に glossary が入らない（存在の検査はアンカーを除いたパスで行う）

### context: アンカー付きでもファイルが無ければ missing にする
- 対応: —
- Given: glossary が `docs/concepts.md#用語` で、`docs/concepts.md` が存在しない
- When: `hikyaku context architect --json` を実行する
- Then: glossary は候補に入らず `missing` に入る

### isAutoLoaded: アンカー付きの自動読み込み文書を候補から外す
- 対応: US-17.2
- Given: conventions が `AGENTS.md#スクリプトscripts` と登録されている
- When: `hikyaku context build-01 --json` を実行する
- Then: conventions は候補に現れない（アンカーを除いた `AGENTS.md` で自動読み込みと判定される）

## scripts/lib/steps/directive.mts

### 異議の照合先: 節を指したポインタで示す
- 対応: US-17.2
- Given: `tests/objection.test.mts` と同じ一時ワークスペースで、document-guide.md の constraints を `repo` / `docs/constraints.md#制約` と登録し、`docs/constraints.md` に `## 制約` がある
- When: 異議の案内が付くゲート（`objection.test.mts` が使う G3 など）で `hikyaku step next ... --json` を実行する
- Then: `objection.pointers` に `constraints: docs/constraints.md#制約` が含まれる（アンカーを落とさない）

## scripts/commands/docs.mts

### docs list: アンカー付きで表示する
- 対応: US-17.1
- Given: glossary が `docs/concepts.md#用語`
- When: `hikyaku docs list` を実行する
- Then: glossary の行に `docs/concepts.md#用語` が表示される

### docs validate: 節の消失で失敗する
- 対応: US-17.3
- Given: 一時 Git リポジトリで glossary が `docs/concepts.md#用語`、`docs/concepts.md` に `## 用語` が無い
- When: `hikyaku docs validate` を実行する
- Then: 終了コードが 0 以外で、glossary と「節が見つかりません」が出力される

## scripts/commands/init.mts

### planGitignore: 新規作成では 2 行を除外する
- 対応: US-16.2
- Given: `.hikyaku/.gitignore` が無い一時 Git リポジトリ
- When: `hikyaku init` を実行する
- Then: `.hikyaku/.gitignore` に `.hikyaku.local` と `feedback/` の行がある

### planGitignore: 無い行だけを追記する
- 対応: US-16.2
- Given: `.hikyaku/.gitignore` が `"node_modules\n.hikyaku.local\n"`
- When: `hikyaku init` を実行する
- Then: 追記されるのは `feedback/` だけで、`node_modules` と `.hikyaku.local` の行は 1 回ずつのまま並びも変わらない

### planGitignore: 2 行とも揃っていれば skip
- 対応: —
- Given: `.hikyaku/.gitignore` が `".hikyaku.local\nfeedback/\n"`
- When: `hikyaku init --dry-run` を実行する
- Then: `.gitignore` の計画は `skip` で、ファイルは変わらない

### planGitignore: 2 回実行しても重複しない
- 対応: —
- Given: `.hikyaku/.gitignore` が `"dist/"`（末尾の改行なし）
- When: `hikyaku init` を 2 回実行する
- Then: `dist/` の行は単独の行で残り（追記行とつながらない）、`.hikyaku.local` と `feedback/` はそれぞれ 1 行だけ

### planGitignore: 先頭に / の付いた既存行も揃っているとみなす（解釈）
- 対応: —
- Given: `.hikyaku/.gitignore` が `"/.hikyaku.local\n/feedback/\n"`
- When: `hikyaku init --dry-run` を実行する
- Then: `.gitignore` の計画は `skip`

### init: 追記の表示が 2 行の除外を説明する
- 対応: —
- Given: `.hikyaku/.gitignore` が `".hikyaku.local\n"`
- When: `hikyaku init --dry-run` を実行する
- Then: 表示に `feedback/` の除外を追記する旨が出る（`.hikyaku.local` だけの説明ではない）
