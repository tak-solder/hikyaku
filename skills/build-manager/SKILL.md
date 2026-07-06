---
name: build-manager
description: "Hikyaku ビルド管理: ビルドの追加・更新・分割・依存グラフ管理を行う内部スキル。hikyaku:architect / hikyaku:builder から呼び出される。"
user-invocable: false
disable-model-invocation: false
argument-hint: "{DOC_ROOT}"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "1.0.0"
---

# Hikyaku Build Manager

`$ARGUMENTS[0]` に指定されたパスの `tasklist.md` と、各ビルドの issue.md 相当（`issue_backend` に応じてファイル / GitHub issue / Asanaタスク）を管理する。

**このスキルは hikyaku:architect および hikyaku:builder からモデル呼び出しで使用される内部スキルです。**
ユーザーが直接呼び出すことは想定していません。hikyaku ワークフロー以外のコンテキストから呼び出された場合は、その旨をユーザーに伝えて終了してください。

## 操作

このスキルは以下の操作を行う:

- **ビルドの追加**: 新しいビルドを tasklist.md に追加し、issue.md 相当を作成する
- **ビルドの更新**: 既存ビルドのスコープ・依存関係・BPを変更する
- **ビルドの分割**: 既存ビルドを2つに分け、新ビルドを作成する
- **記録の永続化**: `issue_backend` が `file` 以外の場合、承認済みの plan.md / handoff.md の内容を対応する外部レコード（sub-issueコメント / Asana taskコメント）に書き込む（builder から呼ばれる）

1回の呼び出しで複数の操作を組み合わせてよい（例: ビルド分割 + 依存関係の更新）。

## 作業ステップ

### Step 0: ファイルの読み込み

- [ ] `<SKILL_ROOT>/references/templates.md`: 各種成果物のテンプレート（必須）
- [ ] `<SKILL_ROOT>/references/bp-guide.md`: BP見積もりガイド（必須）
- [ ] `<SKILL_ROOT>/references/backends.md`: バックエンド別のI/O手順（必須）
- [ ] リポジトリルートの `.hikyaku.config` を読み込む（存在する場合のみ）
- [ ] `$ARGUMENTS[0]/.hikyaku.config` が存在する場合は読み込み、`doc_root` を除くキーをリポジトリルートの設定にキー単位で上書きする（このワークフロー固有の設定）
  - `bp_max` の設定値を取得する（未設定の場合は `8`）
  - `issue_backend` の設定値を取得する（未設定の場合は `file`）
- [ ] `issue_backend` が `asana` の場合、Asana操作用のMCPツールが利用可能か確認する（ToolSearchで`asana`を検索するなど）
  - 見つからない場合: 「`issue_backend = "asana"` が設定されていますが、Asana操作用のMCPツールが見つかりません。Asana MCPサーバーを設定するか、`.hikyaku.config` の `issue_backend` を `file` または `github` に変更してください。」と報告して終了する
- [ ] `$ARGUMENTS[0]/tasklist.md` を読み込む（存在しない場合は新規作成モード）
- [ ] `$ARGUMENTS[0]/.gitignore` に `issue_backend` に応じたパターンが含まれているか確認し、無ければ追記する（既存内容は書き換えない）
  - `issue_backend` が `file` 以外の場合: `build-*/`（issue.md/plan.md/handoff.md含め、`build-{NN}/` 配下は丸ごとローカルキャッシュとなりコミット対象外になるため、個別ファイルではなくディレクトリ単位で除外する）
  - **`tasklist.md` はどのbackendでも除外しない**（依存関係判定の唯一の真実として全backend共通でコミット対象。詳細は [backends.md](references/backends.md)）

→ すべて読み込めたら Step 1 へ。必須ファイルが読み込めなかった場合はユーザーに報告して終了。

### Step 1: 変更内容の整理

- [ ] 呼び出し元のコンテキスト（会話履歴）に基づき、必要な変更を整理する

**ビルドの追加:**
- タイトル、スコープ（やること / やらないこと / 受け入れ基準）を定義
- 依存関係を特定（どのビルドの完了後に実行可能か）
- buildID は `max(既存buildID) + 1` を割り当てる

**ビルドの更新:**
- 対象ビルドの issue.md 相当を読み込む
- スコープ・依存関係・BPの変更内容を整理
- 完了済み（[backends.md](references/backends.md)の完了判定を参照）のビルドは更新しない

**ビルドの分割:**
- 対象ビルドの issue.md 相当を読み込む
- 元ビルドに残す範囲と新ビルドに移す範囲を定義
- 新ビルドの buildID は `max(既存buildID) + 1`
- 依存関係: 新ビルドは元ビルドに依存するのが一般的だが、スコープに応じて判断する
- 元ビルドの依存先だったビルドの dependencies を新ビルドに付け替える必要がないか確認する

→ Step 2 へ。

### Step 2: BP見積もり

- [ ] 追加・変更するビルドについて、[bp-guide.md](references/bp-guide.md) の手順に従いBP見積もりを行う
  - ビルドが関わるワークスペース（パッケージ）を特定する
  - ワークスペースごとに、主要指標（新規ファイル数、実装行数、API操作数、画面数、DBテーブル数）の最大値 + 加算要素でBPを算出する
  - 全ワークスペースのBPを合計する
  - 合計BPが (bp_max − 2) 以上の場合は分割を検討する（デフォルト: 6 以上）
- [ ] bp_max + 1 以上（デフォルト: 9 以上）の場合は分割が必須。(bp_max − 2) 以上 bp_max 以下（デフォルト: 6〜8）で以下のいずれかに該当する場合のみ許容する:
  - 分割したビルド間で同一ファイルの同一箇所を編集する必要があり、マージコンフリクトが避けられない
  - 分割の一方が BP 1 未満になり、ビルドとして成立しない

→ Step 3 へ。

### Step 3: ユーザー承認

**承認前にファイルへの書き込みは行わない。**

- [ ] 変更内容をユーザーに提示し、承認を得る
  - **tasklist.md の変更差分** — 追加・変更される行を明示（`issue_backend`が`file`以外の場合は`issue`/`task`列がまだ空である旨も明示。番号/gidは承認後の作成時に確定するため）
  - **issue.md 相当の内容** — 新規作成の場合は全文、更新の場合は変更箇所（`github`/`asana`の場合は作成予定のsub-issue本文/タスク説明として提示）
  - **依存グラフの変更** — 変更後の Mermaid グラフ

→ 承認を得たら Step 4 へ。フィードバックがあれば反映し、Step 1 からやり直す。

### Step 4: ファイル書き込み

- [ ] **tasklist.md** — テーブル行の追加・更新、依存グラフの再生成、ビルド要約の追加・更新
- [ ] **issue.md 相当の記録** — `issue_backend` に応じて [backends.md](references/backends.md) の手順に従う
  - `file`: `$ARGUMENTS[0]/build-{NN}/issue.md` を新規作成または更新し、tasklist.mdの`issue`列に `[issue](./build-{NN}/issue.md)` 形式の相対リンクを記録する
  - `github`: 親issue（初回のみ）と各buildのsub-issueを作成する。本文はissue.md相当の内容とし、末尾に依存ビルドへの参考リンク（「Depends on: #N」）を記載する。作成結果のURLを使い、tasklist.mdの`issue`列に `[#<番号>](<URL>)` 形式でリンクを記録する
  - `asana`: `.hikyaku.config`の`asana.project_gid`で指定されたプロジェクトにタスクを作成し、説明欄にissue.md相当の内容を書き込む。依存関係をAsana側にも設定する。作成結果の`permalink_url`を使い、tasklist.mdの`task`列に `[<gid>](<permalink_url>)` 形式でリンクを記録する
  - 各内容のフォーマットは [templates.md](references/templates.md) を参照
- [ ] **記録の永続化操作の場合**（builderから呼ばれた場合）: [backends.md](references/backends.md) の手順に従い、承認済みのplan.md/handoff.mdの内容を対応する外部レコードに書き込む（`file`の場合はローカルファイルへの書き込みのみ）

## 共通ルール

### buildID
- 作成順の連番: `max(既存buildID) + 1`
- 既存 buildID のリナンバリングは **行わない**
- ディレクトリ名はゼロ埋め2桁（例: buildID 3 → `build-03`）

### 依存グラフ
- tasklist.md の dependencies 列と Mermaid グラフは常に一致させる
- ビルドを追加・変更した後は **依存グラフ全体を再生成** する
- **循環依存の検証**: 依存グラフにサイクルがないことを確認する。サイクルが検出された場合はユーザーに報告し、依存関係を修正する

### ビルド要約
- ビルド要約セクションはビルドの推奨実行順（依存グラフのトポロジカル順）に並べる
- 新規ビルドは適切な位置に挿入する

### 完了済みビルドの扱い
- 完了済みビルド（完了判定は`issue_backend`により異なる。[backends.md](references/backends.md)を参照）はスコープの変更を行わない
- 完了済みビルドの依存関係の変更も行わない（依存グラフの整合性が崩れるため）
