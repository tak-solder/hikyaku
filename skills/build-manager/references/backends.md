# ビルド記録 I/O バックエンド

`issue_backend`（`.hikyaku.config`）に応じて、tasklist.md 以外のビルド記録（issue.md 相当・plan.md・handoff.md）をどこに書き込むかが変わる。

**tasklist.md の buildID・title・BP・dependencies は全バックエンド共通でファイル管理とし、依存関係判定の唯一の真実とする。** また、各ビルドの issue.md 相当を指す参照列（file: `issue`列、github: `issue`列、asana: `task`列）と `PR` 列も全バックエンド共通で tasklist.md に存在する。**参照列の値は全backendでMarkdownリンク形式**（file: 相対リンク、github: issue URLへのリンク、asana: Asana task URLへのリンク）とし、リンクテキストに番号/gidを表示する。backend によって変わるのは「参照列のリンク先」と「完了判定の方法」だけ。

## 共通ルール

- tasklist.md は常に `{DOC_ROOT}/tasklist.md` に存在し、コミット対象
- 依存関係グラフの真実は常に tasklist.md の dependencies 列（外部システム側の依存関係表示は人間可読の参考情報にすぎない）
- issue.md・plan.md・handoff.md の内容は、backend が `file` 以外の場合、対応する外部レコードのコメント/本文として記録するのが正であり、ローカルの `build-{NN}/` 配下にはキャッシュとしてのみ書き出す
- **backend が `file` 以外の場合、`build-{NN}/` 配下は丸ごとコミット対象外になる。** issue.md/plan.md/handoff.mdは外部レコードが正のため、test-spec.md/questions.md/retrospective.mdはbackendに関わらず常にコミット対象外のため（後述）、結果として`build-{NN}/`内に残るファイルは無い。`{DOC_ROOT}/.gitignore`に`build-*/`パターンを追加することでディレクトリごと除外する（`build-manager` Step 0が管理）

## backend: file（デフォルト）

- tasklist.md の列: `| buildID | title | BP | dependencies | issue | PR |`
  - `issue` 列: build-manager が作成時に `[issue](./build-{NN}/issue.md)` 形式の相対リンクを記録する（以後不変）
- 完了判定: tasklist.md の `PR` 列が非空
- issue.md / plan.md / handoff.md はすべてローカルファイルとして作成・コミットする

## backend: github

### tasklist.md の列

`| buildID | title | BP | dependencies | issue | PR |`

- `issue` 列: build-manager が一括作成時に `[#<sub-issue番号>](<issue URL>)` 形式のリンクを記録する（以後不変）。URLは `gh issue create` の実行結果から取得する
- `PR` 列: builder が Step 10 で記録する（可視化目的。完了判定には使わない）

### 親issue・sub-issueの作成（build-manager）

- 親issue: 対象リポジトリ（builderがPRを出すのと同じリポジトリ）に1つ作成する。タイトル例: `Hikyaku tasklist: {DOC_ROOT}`。本文にビルド一覧と依存グラフ（Mermaid）を転記する
- 各buildのsub-issue: 親issueのsub-issueとして作成する（`gh issue create` に加え、GitHubのsub-issue関連付けAPI/コマンドを利用する）。本文はissue.md相当の内容（やること/やらないこと/受け入れ基準）とし、末尾に「Depends on: #N, #M」を依存ビルドの参考情報として記載する（機械判定には使わない）

### plan.md/handoff.mdの記録

- 承認された内容を、対応するsub-issueへのコメントとして `gh issue comment <番号> --body-file <一時ファイル>` で追記する
- ローカルの `build-{NN}/plan.md` ・ `build-{NN}/handoff.md` はキャッシュとして書き出してよいが、`.gitignore` 対象とする

### 完了判定

- 依存ビルドの `issue` 列のリンクテキスト（`#<番号>`）から番号を抽出し、`gh issue view <番号> --json state` をライブ照会する。`state == "CLOSED"` なら完了とみなす
- builder は Step 10 で作成するPRの本文に `Closes #<対象ビルドのsub-issue番号>`（`issue`列から抽出した番号）を含める。PRマージ時にGitHubが自動でsub-issueをcloseするため、追加のAPI呼び出しは不要

### コンテキスト復元（builder Step 2）

- 対象ビルドのissue.md相当: `issue`列から抽出した番号で `gh issue view <番号>` を実行して取得する
- 依存ビルドのhandoff.md相当: 対応するsub-issueのコメント一覧を `gh issue view <番号> --json comments` で取得し、最新のhandoff投稿を読む

## backend: asana

前提: Asana操作用のMCPツールがユーザー側で設定されていること。build-manager Step 0 / builder Step 0 でこれを検出し、無ければユーザーに設定を促して終了する。

### tasklist.md の列

`| buildID | title | BP | dependencies | task | PR |`

- `task` 列: build-manager が一括作成時に `[<task gid>](<permalink_url>)` 形式のリンクを記録する（以後不変）。URLはAsana MCPツールがタスク作成時に返す `permalink_url` を使う
- `PR` 列: builder が Step 10 で記録する（可視化目的。完了判定には使わない）

### タスクの作成（build-manager）

- `.hikyaku.config` の `asana.project_gid` で指定されたプロジェクトに、各buildをタスクとして作成する
- タスクの説明欄にissue.md相当の内容を記載する
- タスク間の依存関係をAsana MCPツールで設定する（表示・並び順の便宜のため。機械判定はtasklist.mdのdependencies列を使う）

### plan.md/handoff.mdの記録

- 承認された内容を、対応するAsana taskのコメントとしてMCPツール経由で追記する
- ローカルの `build-{NN}/plan.md` ・ `build-{NN}/handoff.md` はキャッシュとして書き出してよいが、`.gitignore` 対象とする

### 完了判定

- 依存ビルドの `task` 列のリンクテキストからgidを抽出し、Asana MCPツールでタスク完了状態をライブ照会する

### コンテキスト復元（builder Step 2）

- 対象ビルドのissue.md相当・依存ビルドのhandoff.md相当は、`task`列のリンクテキストから抽出したgidを使い、対応するAsana taskの説明欄・コメントをMCPツール経由で取得する
