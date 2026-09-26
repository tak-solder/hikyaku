---
name: build-manager
description: "Hikyaku ビルド管理: ビルドの追加・更新・分割と依存グラフ管理を行う内部スキル。hikyaku:architect / hikyaku:builder から呼び出される。"
user-invocable: false
disable-model-invocation: false
argument-hint: "[{cycle}]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "2.1.0"
---

# Hikyaku Build Manager

対象サイクルの `tasklist.md` と各ビルドの `issue.md` を管理する。

**このスキルは hikyaku:architect および hikyaku:builder からモデル呼び出しで使用される内部スキルです。**
ユーザーが直接呼び出すことは想定していません。hikyaku ワークフロー以外のコンテキストから呼び出された場合は、その旨をユーザーに伝えて終了してください。

## あなたの責務

BP見積もりと分割単位の判断、issue.md の内容の作成、レビュー、ユーザー承認を行う。

`tasklist.md` の行の更新・依存グラフの再生成・循環依存の検証はスクリプトが行う。
自分で `tasklist.md` を書き換えてはいけない。

> スクリプト = 計算・解析・整形・検証
> LLM        = 判断・生成・対話

## 操作

- **ビルドの追加**: 新しいビルドを追加し、issue.md を作成する
- **ビルドの更新**: 既存ビルドのスコープ・依存関係・BPを変更する
- **ビルドの分割**: 「元ビルドの update + 新ビルドの add」で表現する（専用の操作は無い）

1回の呼び出しで複数の操作を組み合わせてよい。

## 作業ステップ

### Step 0: 読み込みと設定の解決

- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/templates.md`: 各種テンプレート（必須）
- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/bp-guide.md`: BP見積もりガイド（必須）
- [ ] `{HIKYAKU_ROOT}/bp-guide/README.md`: このリポジトリの BP 基準表と数え方の注意（存在する場合）
- [ ] 設定を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

`bp_max`（未設定なら 8）を取得する。サイクル固有の `.hikyaku.config` があれば
その値が優先される。HIKYAKU_ROOT は引数では受け取らない（設定から解決される）。

- [ ] 現在有効な BP の基準表を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp guide {cycle}
```

「入力」列が `bp estimate` に渡すフラグ。基準表はワークスペースの持ち物
（`{HIKYAKU_ROOT}/bp-guide/rules.toml`）で、無ければ既定値が出る。

- [ ] 対象サイクルの現状を取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist read {cycle}
```

→ Step 1 へ。

### Step 1: 変更内容の整理

呼び出し元のコンテキスト（会話履歴）に基づき、必要な変更を整理する。

**ビルドの追加:**
- タイトル、スコープ（やること / やらないこと / 受け入れ基準）を定義する
- 依存関係を特定する（どのビルドの完了後に実行可能か）
- buildID の採番はスクリプトが行う（`max(既存) + 1`）

**ビルドの更新:**
- 対象ビルドの `issue.md` を読み込む
- スコープ・依存関係・BPの変更内容を整理する
- **完了済み（`PR` 列が非空）のビルドは更新しない。** スクリプトも拒否する

**ビルドの分割:**
- 元ビルドに残す範囲と新ビルドに移す範囲を定義する
- 新ビルドは元ビルドに依存するのが一般的だが、スコープに応じて判断する
- 元ビルドに依存していたビルドの依存を、新ビルドに付け替える必要がないか確認する

→ Step 2 へ。

### Step 2: BP見積もり

- [ ] [bp-guide.md](references/bp-guide.md) の手順に従い、**入力値を見積もってコマンドに渡す**
  - ビルドが関わるワークスペース（パッケージ）を特定する
  - ワークスペースごとに、指標（新規ファイル数、実装行数、API操作数、画面数、DBテーブル数）と
    加算要素（影響ファイル数、基盤セットアップ、外部API連携、大規模リファクタ、基準表にあれば
    リポジトリ固有の要素）の値を issue.md のスコープ記述から見積もる
  - 新規ファイル数は、作成するファイルを名前で列挙してから数える

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp estimate {cycle} \
  --new-files 5 --lines 800 --impact-files 7 --setup --markdown
```

  - 表への当てはめはコマンドが行う。**自分で表を読んで BP にしない**
  - 複数ワークスペースにまたがるなら、ワークスペースごとに実行して BP を合計する
  - 出力の内訳表（`--markdown`）を issue.md の「BP見積もり」に**そのまま貼る**。
    転記しないのは、レビューが入力値を検証するときに算出の根拠が要るため
- [ ] 合計BPが `bp_max + 1` 以上（デフォルト: 9 以上）の場合は分割が必須
- [ ] `bp_max − 2` 以上 `bp_max` 以下（デフォルト: 6〜8）は、以下のいずれかに該当する場合のみ分割せずに許容する:
  - 分割したビルド間で同一ファイルの同一箇所を編集する必要があり、マージコンフリクトが避けられない
  - 分割の一方が BP 1 未満になり、ビルドとして成立しない

→ Step 3 へ。

### Step 3: 差分の取得・レビューとユーザー承認（G6）

**承認前に書き込みを行わない。** `--dry-run` で差分だけを取得する。

- [ ] スクリプトに `--dry-run` を付けて実行し、変更後の一覧と依存グラフを取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist add {cycle} \
  --title "..." --bp 3 --deps 1,2 --dry-run
```

- [ ] **`tasklist_review` が有効な場合**（express / standard / thorough）、`doc-reviewer` を起動する（`context: tasklist`）
  - **この時点ではまだファイルに書き込まれていない。** `--dry-run` の出力（変更後の一覧・依存グラフ）と issue.md の本文をプロンプトに直接含めて渡す
  - 参照として渡す: `cycles/{cycle}/design/design-delta.md`（存在する場合）,
    `{HIKYAKU_ROOT}/bp-guide/README.md`（存在する場合。無ければ `bp guide --markdown` の出力を
    プロンプトに含める）
  - **BP のレビュー対象は入力値**（列挙したファイル数がスコープと合っているか、加算要素の
    取りこぼしが無いか）。表への当てはめはコマンドが行っているので、そこは見ない
  - 明確な不整合・入力値の乖離は反映する（主観的な指摘は無視してよい）。
    反映が必要な場合は Step 1 からやり直し、`bp estimate` を再実行する

- [ ] 以下をユーザーに提示して承認を得る
  - **tasklist の変更差分** — スクリプトが返した一覧
  - **依存グラフの変更** — スクリプトが返した Mermaid グラフ
  - **issue.md の内容** — 新規作成なら全文、更新なら変更箇所
  - **（doc-reviewer を起動した場合）レビュー結果とその対応**

この承認（G6）は profile の管轄外で、どのプロファイルでも省略しない。
`tasklist_review` の有無に関わらず、この承認自体は必ず行う。

→ 承認を得たら Step 4 へ。フィードバックがあれば反映して Step 1 からやり直す。

### Step 4: 書き込み

- [ ] `--dry-run` を外して同じコマンドを実行する
  - 循環依存や存在しない依存があればスクリプトが終了コード 2 で拒否する。その場合は書き込まれていないので、依存関係を修正して Step 1 に戻る
- [ ] `issue.md` を作成・更新する（テンプレートは [templates.md](references/templates.md) を参照）
- [ ] 成果物をコミット & push する

**成果物を1つ作るごとにコミット & push すること。** コミットされていなければ、
中断時に他セッションから進捗が見えず、再開点を検出できない。

## 共通ルール

### buildID
- 採番はスクリプトが行う（`max(既存) + 1`）
- 既存 buildID のリナンバリングは **行わない**
- ディレクトリ名はゼロ埋め2桁（buildID 3 → `build-03`）

### 依存グラフ
- `tasklist.md` の dependencies 列と Mermaid グラフはスクリプトが常に一致させる
- 循環依存の検証もスクリプトが行う。検出された場合は書き込まれない

### 完了済みビルドの扱い
- 完了判定は `PR` 列が非空かどうかの一点
- 完了済みビルドのスコープ・依存関係は変更しない（依存グラフの整合性が崩れるため）

### 外部システムへの投影

`[external] target` が `none` 以外の場合、書き込み後に投影を試みる。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
```

**投影の単位は「サイクルに1つの親 issue」と「各ビルドの子 issue」。**
親が無ければスクリプトが先に作る。親には tasklist へのリンクとビルド一覧が入る。

**投影は片方向で、マスターは常にファイル側。** 失敗してもワークフローは止めず、
警告だけ出して続行する。読み取りと完了判定に外部システムを使うことは無い。

**gh CLI が無い環境では、スクリプトは投影内容だけを返す**（`applied: false` /
`reason: "gh-not-found"`）。その場合は GitHub MCP ツールで適用する。

1. 親（サイクル）→ 子（各ビルド）の順に作成・更新する
2. 可能であれば子を親の sub-issue として紐づける
3. 参照を記録する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle link {cycle} --external {親issueのURL}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist link {cycle} --id {buildID} --issue {子issueのURL}
```

Asana も同じ形で、反映は Asana MCP ツールを持つスキル側が行う。

