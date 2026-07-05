# Hikyaku (飛脚)

Hikyaku は **PLAN → ARCHITECT → BUILD の3フェーズ**で構成される、AIエージェント協働開発ワークフローです。Claude Code のプラグインとして配布され、Agent Skills の仕様に準拠しています。


## 特徴

- **プラグイン形式** — `claude plugin install` で導入可能。ワークフロー用ファイルの保存先ディレクトリも指定可能
- **セッション分離** — 各フェーズは別の AI セッションが担当し、コンテキストウィンドウを効率的に使う
- **ファイルベースの引き継ぎ** — セッション間の情報は `planning/`, `architecture/`, `handoff.md` 等のドキュメントで受け渡す
- **ユーザー承認ゲート** — 各フェーズで必ずユーザーの承認を取り、誤りの波及を防ぐ
- **振り返りによる自己改善** — 各フェーズ末に retrospective を作成し、スキル自体を継続的に改善する

## インストール

Claude Code の `/plugin` インターフェースまたは CLI から、本リポジトリのマーケットプレイスを追加してプラグインをインストールします。

```bash
# マーケットプレイスを追加
claude plugin marketplace add tak-solder/hikyaku

# プラグインをインストール
claude plugin install hikyaku@hikyaku
```

ローカルチェックアウトから試す場合は `--plugin-dir` で読み込むこともできます:

```bash
claude --plugin-dir /path/to/hikyaku
```

インストール後はスキルが `/hikyaku:planner` のように **`hikyaku:` 名前空間付き**で呼び出せるようになります。

## ワークフロー

### スキル変数
- **DOC_ROOT**: ワークフローのドキュメント（企画・設計・ビルド定義など）を保存するディレクトリ。リポジトリ内の任意のパスを指定できます。

```
/hikyaku:planner {DOC_ROOT}              → {DOC_ROOT}/planning/ を生成
      ↓ ユーザー承認
/hikyaku:architect {DOC_ROOT}            → {DOC_ROOT}/architecture/ + {DOC_ROOT}/tasklist.md + {DOC_ROOT}/build-{NN}/issue.md を生成
      ↓ ユーザー承認                        （build-manager でビルド管理）
/hikyaku:builder {DOC_ROOT}              → {DOC_ROOT}/build-01/ を生成し、実装 → PR
/hikyaku:builder {DOC_ROOT}              → {DOC_ROOT}/build-02/ を生成し、実装 → PR
  ...（ビルド数分、各回別セッションで繰り返し）
      　                                    （必要に応じて build-manager でビルド追加・分割）
```

`/hikyaku:builder` は buildID を指定して特定ビルドを実行することもできます（例: `/hikyaku:builder {DOC_ROOT} 3`）。省略時は次のビルドを自動選択します。

### Phase 1: `/hikyaku:planner` — 企画

既存の企画ドキュメントを読み込み、ユーザーストーリーとして構造化する。

- 不足・曖昧・矛盾する点を質問ループで解消
- MoSCoW 優先度付きのユーザーストーリーを作成
- **成果物**: `planning/questions.md`, `planning/user-stories.md`

### Phase 2: `/hikyaku:architect` — 設計

企画成果物と既存コードベースを入力に、技術設計とビルド分割を行う。

- 既存コードを Agent で調査し `codebase-survey.md` を作成
- 設計ドキュメント（tech-stack, db-schema, interfaces, conventions）を必要に応じて作成
- 分岐評価で trade-off が非自明な判断は `decisions.md`（ADR）に採用理由・トレードオフを記録
- `build-manager` を使い、BP 見積もり付きでビルド分割（1ビルド = 1セッションで完結する粒度）
- **成果物**: `architecture/`, `tasklist.md`, `build-{NN}/issue.md`

### Phase 3: `/hikyaku:builder` — 実装

1ビルド = 1セッションでコード実装から PR 作成までを完結させる。

- 設計ドキュメントと先行ビルドの `handoff.md` でコンテキストを復元
- 実装計画 → テストシナリオ → コード生成 → ローカル検証 → PR
- 実装中にスコープ超過や追加タスクが判明した場合、`build-manager` でビルドの追加・分割が可能
- **成果物**: 実装コード, `plan.md`, `test-spec.md`, `handoff.md`, PR

## ワークフローディレクトリ構造

```
{DOC_ROOT}/
├── .gitignore                 # PLAN 初回実行時に自動生成（retrospective.md / test-spec.md / questions.md / design-questions.md を除外）
├── .hikyaku.config             # このワークフロー固有の設定上書き（任意、PLAN 初回実行時に雛形生成）
├── instruction.md             # ワークフロー固有のインストラクション（任意）
├── tasklist.md               # ビルド一覧（ARCHITECT で作成、BUILD で更新）
├── planning/                  # 企画ドキュメント
│   ├── questions.md
│   ├── user-stories.md
│   └── retrospective.md
├── architecture/              # 設計ドキュメント
│   ├── codebase-survey.md     # 既存コード調査（既存コードがある場合）
│   ├── design-questions.md
│   ├── decisions.md           # 設計判断ログ（ADR、分岐評価のあった判断のみ）
│   ├── tech-stack.md          # 必要時のみ
│   ├── db-schema.md           # 必要時のみ
│   ├── interfaces.md          # 必要時のみ
│   ├── conventions.md         # 必要時のみ
│   └── retrospective.md
├── build-01/
│   ├── issue.md               # ビルド定義（ARCHITECT で作成）
│   ├── plan.md                # 実装計画（BUILD で作成）
│   ├── test-spec.md           # テストシナリオ（BUILD で作成）
│   ├── questions.md           # 実装時の質問と回答（BUILD で作成、必要時のみ）
│   ├── handoff.md             # 申し送り（BUILD で作成）
│   └── retrospective.md      # 振り返り（BUILD で作成）
├── build-02/
│   └── ...
└── ...
```

上記は `issue_backend = "file"`（デフォルト）の場合の構成です。`github`/`asana` を選択した場合、**`build-{NN}/` 配下は丸ごと `.gitignore` 対象になり、コミットされません**（`issue.md`/`plan.md`/`handoff.md`は対応する外部レコード（GitHub sub-issue / Asana task）が正となり、`test-spec.md`/`questions.md`/`retrospective.md`はbackendによらず元々コミット対象外のため）。`github` の場合はさらに `tasklist.md` も対象外になります（tasklist相当の親issueが正になるため）。詳細は `skills/build-manager/references/backends.md` を参照してください。

## 内部スキル

以下のスキルはユーザーが直接呼び出すものではなく、各フェーズのスキルが必要に応じて自動的に呼び出します（プラグイン名前空間は `hikyaku:`）。

### `build-manager` — ビルド管理

architect と builder から呼び出される内部スキル。ビルドの追加・更新・分割と依存グラフ管理、および issue/plan/handoff の永続化（`issue_backend` に応じてファイル / GitHub issue / Asanaタスク）を一元的に行う。

- BP見積もり、tasklist.md の管理、issue.md 相当の作成・更新、plan.md/handoff.md の外部記録
- 変更時はユーザー承認を必須とする
- バックエンド別の手順は `skills/build-manager/references/backends.md` を参照

### `retrospective` — 振り返り

各フェーズから呼び出される内部スキル。セッション中のスキル外指示を分析し、改善提案を分類・記録する。

- 振り返り実施前にユーザーに確認し、不要ならスキップ可能
- 改善提案の対象を判断フローに基づいて分類（`skill:` / `repo:` / `workflow:` / `記録のみ`）
- PRレビュー対応後の追記モードにも対応

## インストラクションの優先順位

Hikyaku は以下の優先順位でインストラクションを適用します:

1. **リポジトリ全体のインストラクション**（AGENTS.md, CLAUDE.md 等）
2. **ワークフロー用インストラクション**（`{DOC_ROOT}/instruction.md`）
3. **スキルの説明**（各 SKILL.md）

`{DOC_ROOT}/instruction.md` はワークフロー固有のルールや制約を記述するためのファイルです。大きなリポジトリやモノレポの一部で Hikyaku を使う場合に、リポジトリ全体の規約とは別にワークフロー固有の指示を定義できます。このファイルは任意で、存在しなければスキップされます。

## 設定ファイル（`.hikyaku.config`）

`.hikyaku.config`（TOML形式）を配置することで、スキル呼び出し時の引数省略や動作のカスタマイズができます。すべての項目はオプションです。設定は2階層あり、**DOC_ROOT側の設定がリポジトリルート側の設定をキー単位で上書き**します（`doc_root` を除く）。

```
リポジトリルート/.hikyaku.config   ← ベース設定（全ワークフロー共通）
{DOC_ROOT}/.hikyaku.config         ← このワークフロー固有の上書き（任意）
```

```toml
# ワークフロードキュメントのルートパス
# 設定すると /hikyaku:planner, /hikyaku:architect, /hikyaku:builder の引数を省略できます
# リポジトリルートの設定でのみ有効（DOC_ROOT側では指定できません）
# doc_root = "docs/hikyaku"

# PRのベースブランチ（未設定時はリポジトリのデフォルトブランチを自動検出）
# base_branch = "main"

# 振り返りのデフォルト動作: prompt（デフォルト）| auto | skip
# retrospective = "prompt"

# ビルド分割のBP上限（デフォルト: 8）
# bp_max = 8

# コードレビュー・セキュリティレビューの有効化（デフォルト: true）
# code_review = true
# security_review = true

# test-spec.md 作成後の承認ゲートの有効化（デフォルト: true）
# test_spec_review = true

# 中間成果物レビュー（doc-reviewer）の有効化（デフォルト: true）
# user_stories_review = true
# architecture_review = true
# plan_review = true

# issue・plan・handoffの保存先: file（デフォルト）| github | asana
# issue_backend = "file"

# [github]
# # repo = "owner/repo"  # 省略時はカレントリポジトリ（issue_backend = "github" の場合のみ参照）

# [asana]
# project_gid = "..."    # issue_backend = "asana" の場合は必須。認証はユーザー設定済みのAsana MCPツールに委ねる
```

`doc_root` を設定した場合、各スキルの引数を省略して呼び出せます:

```
/hikyaku:planner      # doc_root で指定したパスを自動使用
/hikyaku:architect
/hikyaku:builder
```

`/hikyaku:planner` の初回実行時、DOC_ROOT配下に以下が自動生成されます（既に存在する場合は変更しません）:

- **`{DOC_ROOT}/.gitignore`** — `retrospective.md` / `test-spec.md` など、セッションローカルでコミット対象外にすべき成果物のパターン
- **`{DOC_ROOT}/.hikyaku.config`** — 全項目コメントアウト済みの雛形（このワークフロー固有の上書き用）

## ビルドポイント（BP）

ビルドポイント（BP）は、AIエージェントとの1セッション（20万トークン目安）で実装が完了するかどうかを判断するための定量指標です。ARCHITECT フェーズでビルド分割する際の基準として使用します。

| BP | 判定 |
|----|------|
| 1〜5 | 1セッションで完結見込み |
| 6〜8 | 分割推奨（分割コストが大きい場合のみ許容） |
| 9〜 | 分割必須 |

BP は以下の指標から算出します:

- **ベースBP** — 新規ファイル数・実装行数・API操作数・画面数・DBテーブル数のうち最大値
- **加算BP** — 基盤セットアップ、外部API連携、大規模リファクタ、影響ファイル数の多さなど

合計 BP が 9 以上の場合は、ワークスペース・画面・ドメイン等の軸でビルドを分割し、各ビルドが BP 8 以下になるようにします。詳細な見積もり手順は `skills/build-manager/references/bp-guide.md` を参照してください。

## プラグイン構成

```
./
├── .claude-plugin/
│   ├── plugin.json            # プラグインマニフェスト
│   └── marketplace.json       # マーケットプレイス定義（リポジトリ自身を1プラグイン構成のマーケットプレイスとして配布）
├── agents/                    # スキルから委任されるサブエージェント定義
│   ├── code-explorer.md       # architect Step 2 で起動。既存コード調査と Key Files リストを返す
│   ├── code-architect.md      # architect Step 4 で起動。指定観点の単一設計案を返す
│   ├── code-reviewer.md       # builder Step 8 で security-reviewer と並列起動。スコープ・規約・バグ・冗長性を証拠ベースで報告
│   ├── security-reviewer.md   # builder Step 8 で code-reviewer と並列起動。OWASP 系セキュリティ指摘を返す
│   └── doc-reviewer.md        # planner/architect/builder の各承認前に起動。中間成果物の整合性・網羅性を証拠ベースで報告
└── skills/
    ├── planner/               # /hikyaku:planner
    ├── architect/             # /hikyaku:architect
    ├── builder/               # /hikyaku:builder
    ├── build-manager/         # 内部スキル（model-invocable）。references/backends.md にバックエンド別I/O手順
    └── retrospective/         # 内部スキル（model-invocable）
```
