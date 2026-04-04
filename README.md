# Hikyaku (飛脚)

Hikyaku は Agent Skills の仕様に準拠した、**PLAN → ARCHITECT → BUILD の3フェーズ**で構成される、AIエージェント協働開発ワークフローです。   


## 特徴

- **スタンドアロン** — Agent Skillのみで動作。ワークフローで使用するファイルを保存するディレクトリも指定可能
- **セッション分離** — 各フェーズは別の AI セッションが担当し、コンテキストウィンドウを効率的に使う
- **ファイルベースの引き継ぎ** — セッション間の情報は `planning/`, `architecture/`, `handoff.md` 等のドキュメントで受け渡す
- **ユーザー承認ゲート** — 各フェーズで必ずユーザーの承認を取り、誤りの波及を防ぐ
- **振り返りによる自己改善** — 各フェーズ末に retrospective を作成し、スキル自体を継続的に改善する

## ワークフロー

### スキル変数
- **DOC_ROOT**: ワークフローのドキュメント（企画・設計・ビルド定義など）を保存するディレクトリ。リポジトリ内の任意のパスを指定できます。

```
/hikyaku-planner {DOC_ROOT}              → {DOC_ROOT}/planning/ を生成
      ↓ ユーザー承認
/hikyaku-architect {DOC_ROOT}            → {DOC_ROOT}/architecture/ + {DOC_ROOT}/tasklist.md + {DOC_ROOT}/build-{NN}/issue.md を生成
      ↓ ユーザー承認                        （build-manager でビルド管理）
/hikyaku-builder {DOC_ROOT}              → {DOC_ROOT}/build-01/ を生成し、実装 → PR
/hikyaku-builder {DOC_ROOT}              → {DOC_ROOT}/build-02/ を生成し、実装 → PR
  ...（ビルド数分、各回別セッションで繰り返し）
      　                                    （必要に応じて build-manager でビルド追加・分割）
```

`/hikyaku-builder` は buildID を指定して特定ビルドを実行することもできます（例: `/hikyaku-builder {DOC_ROOT} 3`）。省略時は次のビルドを自動選択します。

### Phase 1: `/hikyaku-planner` — 企画

既存の企画ドキュメントを読み込み、ユーザーストーリーとして構造化する。

- 不足・曖昧・矛盾する点を質問ループで解消
- MoSCoW 優先度付きのユーザーストーリーを作成
- **成果物**: `planning/questions.md`, `planning/user-stories.md`

### Phase 2: `/hikyaku-architect` — 設計

企画成果物と既存コードベースを入力に、技術設計とビルド分割を行う。

- 既存コードを Agent で調査し `codebase-survey.md` を作成
- 設計ドキュメント（tech-stack, db-schema, interfaces, conventions）を必要に応じて作成
- `hikyaku-build-manager` を使い、BP 見積もり付きでビルド分割（1ビルド = 1セッションで完結する粒度）
- **成果物**: `architecture/`, `tasklist.md`, `build-{NN}/issue.md`

### Phase 3: `/hikyaku-builder` — 実装

1ビルド = 1セッションでコード実装から PR 作成までを完結させる。

- 設計ドキュメントと先行ビルドの `handoff.md` でコンテキストを復元
- 実装計画 → テストシナリオ → コード生成 → ローカル検証 → PR
- 実装中にスコープ超過や追加タスクが判明した場合、`hikyaku-build-manager` でビルドの追加・分割が可能
- **成果物**: 実装コード, `plan.md`, `test-spec.md`, `handoff.md`, PR

### 内部スキル: `hikyaku-build-manager` — ビルド管理

architect と builder から呼び出される内部スキル。ビルドの追加・更新・分割と依存グラフ管理を一元的に行う。

- BP見積もり、tasklist.md の管理、issue.md の作成・更新
- 変更時はユーザー承認を必須とする
- **ユーザーが直接呼び出すスキルではない**（architect / builder が必要に応じて自動的に呼び出す）

## インストラクションの優先順位

Hikyaku は以下の優先順位でインストラクションを適用します:

1. **リポジトリ全体のインストラクション**（AGENTS.md, CLAUDE.md 等）
2. **ワークフロー用インストラクション**（`{DOC_ROOT}/instruction.md`）
3. **スキルの説明**（各 SKILL.md）

`{DOC_ROOT}/instruction.md` はワークフロー固有のルールや制約を記述するためのファイルです。大きなリポジトリやモノレポの一部で Hikyaku を使う場合に、リポジトリ全体の規約とは別にワークフロー固有の指示を定義できます。このファイルは任意で、存在しなければスキップされます。

## ワークフローディレクトリ構造

```
{DOC_ROOT}/
├── instruction.md             # ワークフロー固有のインストラクション（任意）
├── tasklist.md               # ビルド一覧（ARCHITECT で作成、BUILD で更新）
├── planning/                  # 企画ドキュメント
│   ├── questions.md
│   ├── user-stories.md
│   └── retrospective.md
├── architecture/              # 設計ドキュメント
│   ├── codebase-survey.md     # 既存コード調査（既存コードがある場合）
│   ├── design-questions.md
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
│   └── retrospective.md
├── build-02/
│   └── ...
└── ...
```
