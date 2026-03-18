# 飛脚 (Hikyaku)

Hikyaku は **PLAN → ARCHITECT → BUILD** の3フェーズで構成される、AI エージェント協働開発ワークフローです。

Claude Code のスキル（Slash Commands）だけで動作し、どのプロジェクトにも導入できます。

## 特徴

- **スタンドアロン** — `.claude/skills/` を配置するだけで既存プロジェクトに導入可能
- **セッション分離** — 各フェーズは別の AI セッションが担当し、コンテキストウィンドウを効率的に使う
- **ファイルベースの引き継ぎ** — セッション間の情報は `planning/`, `architecture/`, `handoff.md` 等のドキュメントで受け渡す
- **ユーザー承認ゲート** — 各フェーズで必ずユーザーの承認を取り、誤りの波及を防ぐ
- **振り返りによる自己改善** — 各フェーズ末に retrospective を作成し、スキル自体を継続的に改善する

## ワークフロー

```
/hikyaku-planner {path}        → planning/ を生成
      ↓ ユーザー承認
/hikyaku-architect {path}      → architecture/ + tasklist.md + issue.md を生成
      ↓ ユーザー承認
/hikyaku-builder {path} next   → build-01/ 実装 → handoff.md → PR
/hikyaku-builder {path} next   → build-02/ 実装 → handoff.md → PR
  ...（タスク数分、各回別セッションで繰り返し）
```

### Phase 1: `/hikyaku-planner` — 企画

既存の企画ドキュメントを読み込み、ユーザーストーリーとして構造化する。

- 不足・曖昧・矛盾する点を質問ループで解消
- MoSCoW 優先度付きのユーザーストーリーを作成
- **成果物**: `planning/questions.md`, `planning/user-stories.md`

### Phase 2: `/hikyaku-architect` — 設計

企画成果物と既存コードベースを入力に、技術設計とタスク分割を行う。

- 既存コードを Agent で調査し `codebase-survey.md` を作成
- 設計ドキュメント（tech-stack, db-schema, interfaces, conventions）を必要に応じて作成
- SP 見積もり付きでタスク分割（1タスク = 1セッションで完結する粒度）
- **成果物**: `architecture/`, `tasklist.md`, `build-{NN}/issue.md`

### Phase 3: `/hikyaku-builder` — 実装

1タスク = 1セッションでコード実装から PR 作成までを完結させる。

- 設計ドキュメントと先行タスクの `handoff.md` でコンテキストを復元
- 実装計画 → テストシナリオ → コード生成 → ローカル検証 → PR
- **成果物**: 実装コード, `plan.md`, `test-spec.md`, `handoff.md`, PR

## プロジェクトディレクトリ構造

```
{path}/
├── tasklist.md               # タスク一覧（ARCHITECT で作成、BUILD で更新）
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
│   ├── issue.md               # タスク定義（ARCHITECT で作成）
│   ├── plan.md                # 実装計画（BUILD で作成）
│   ├── test-spec.md           # テストシナリオ（BUILD で作成）
│   ├── handoff.md             # 申し送り（BUILD で作成）
│   └── retrospective.md
├── build-02/
│   └── ...
└── ...
```
