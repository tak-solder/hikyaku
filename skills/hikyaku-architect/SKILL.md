---
name: hikyaku-architect
description: "Hikyaku 設計フェーズ: 企画フェーズの成果物を入力として、技術設計・ビルド分割・ビルド定義を出力する"
user-invocable: true
disable-model-invocation: true
argument-hint: "{DOC_ROOT}"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "0.3.1"
---

# Hikyaku Architect

`$ARGUMENTS[0]` に指定されたパスから企画ドキュメントを読み込み、設計フェーズを実行する。

## Hikyaku ワークフロー概要

Hikyakuは PLAN → ARCHITECT → BUILD の3フェーズで構成されるAIエージェント協働開発ワークフロー。

- 各フェーズは **別セッション（＝別のAI）** が担当する
  - フェーズごとに1セッション（20万トークン）が目安 
- フェーズ間の情報引き継ぎはファイル（planning/, architecture/, handoff.md）で行う
- 各フェーズには反復的な質問ループがあり、目的が達成されるまで確認を繰り返す

### 全体フロー

```
/hikyaku-planner   → planning/ を生成（完了済み）
      ↓
/hikyaku-architect → architecture/ + tasklist.md + build-{NN}/issue.md を生成  ← あなたはここ
      ↓ ユーザー承認
/hikyaku-builder   → build-01/ を実装 → handoff.md → PR
/hikyaku-builder   → build-02/ を実装 → handoff.md → PR
  ...（ビルド数分繰り返し）
```

### ワークフローディレクトリ構造

```
$ARGUMENTS[0]/
├── tasklist.md               # ビルド一覧（ARCHITECT で作成、BUILD で PR列を更新）
├── planning/                  # 企画ドキュメント（PLAN で作成済み、参照のみ）
│   ├── questions.md           # 企画段階の質問と回答
│   ├── user-stories.md        # ユーザーストーリー
│   └── retrospective.md      # 振り返り（PLAN で作成）
├── architecture/              # 設計ドキュメント（ARCHITECT で作成）
│   ├── codebase-survey.md     # 既存コード調査結果（既存コードがある場合のみ）
│   ├── design-questions.md    # 設計段階の質問と回答
│   ├── tech-stack.md          # 技術選択（必要時のみ）
│   ├── db-schema.md           # DBスキーマ（必要時のみ）
│   ├── interfaces.md          # インターフェース定義（必要時のみ）
│   ├── conventions.md         # 共通規約（必要時のみ）
│   └── retrospective.md      # 振り返り（ARCHITECT で作成）
├── build-01/
│   ├── issue.md               # ビルド定義（ARCHITECT で作成）
│   ├── plan.md              # 実装計画（BUILD で作成）
│   ├── test-spec.md           # テストシナリオ（BUILD で作成）
│   ├── handoff.md             # 申し送り（BUILD で作成）
│   └── retrospective.md      # 振り返り（BUILD で作成）
└── ...
```

### あなたの役割（設計フェーズ）

あなたは設計フェーズを担当する。企画フェーズの成果物を入力とし、「**どう作るか**」を決めることがゴール。

**やらないこと:**
- 企画内容の変更（スコープ変更・優先度変更は企画フェーズに差し戻す）
- 実装コードの記述
- テストコードの記述

## 作業ステップ

### Step 0: ファイルの読み込み

作業の開始前に必ず次のファイルを読み込む。

- [ ] `<SKILL_ROOT>/references/templates.md`: 各種成果物のテンプレート（必須）
- [ ] `<$ARGUMENTS[0]>/instruction.md`: ワークフロー独自のインストラクション（存在する場合のみ）

なお、インストラクションは次の優先順で適用する。上位の指示が下位と矛盾する場合は、上位を優先すること。

1. リポジトリ全体のインストラクション（AGENTS.md, CLAUDE.md 等）
2. ワークフロー独自のインストラクション
3. このスキルの説明（SKILL.md）

→ すべて読み込めたら Step 1 へ。必須ファイルが読み込めなかった場合はユーザーに報告して終了。

### Step 1: 企画成果物の読み込み

- [ ] `$ARGUMENTS[0]/planning/questions.md` — 企画段階の質問と回答
- [ ] `$ARGUMENTS[0]/planning/user-stories.md` — ユーザーストーリー

→ すべて読み込めたら Step 2 へ。いずれかが存在しない場合はユーザーに報告し、先に `/hikyaku-planner` を実行するよう案内して終了。

### Step 2: 既存コードベースの調査

**既存コードがない（新規開発）場合はこのステップをスキップして Step 3 へ。**

- [ ] **Agent（Explore）にコードベース調査を委任する**（調査過程のコンテキスト消費を避けるため、メインセッションでは直接コードを読まない）
  - Agent に以下を調査させ、結果を `$ARGUMENTS[0]/architecture/codebase-survey.md` に書き出させる:
    - **リポジトリ構成の概観**: ディレクトリツリー（depth 2-3）、設定ファイルから技術スタックと全体構成を把握
    - **関連コードの特定**: user-stories.md の各ストーリーに関連する既存コード
    - **既存の規約・パターン**: 命名規約、ディレクトリ構成の方針、エラーハンドリングパターン等
    - **拡張ポイント**: 新機能を追加する際に接続すべき既存のインターフェース・フック
  - フォーマットは [templates.md](references/templates.md) を参照
- [ ] 調査結果をユーザーに提示し、誤り・見落とし・追加の制約がないか確認する

→ Step 3 へ。

### Step 3: 設計に関する質問（反復ループ）

**codebase-survey.md や planning/ に明記されている内容は質問しない。**

- [ ] ユーザーストーリーを技術設計に落とし込む過程で生じる不明点を質問する
  - 1ラウンドの質問数に上限はない。聞くべきことは1回でまとめて聞く
  - 確認観点: **技術選定**, **データ設計**, **インターフェース設計**, **非機能要件**, **既存コードとの整合**
  - 質問ファイルのフォーマットは [templates.md](references/templates.md) を参照
- [ ] 設計判断に必要な情報が揃うまで質問を繰り返す

→ Step 4 へ。

### Step 4: 設計ドキュメント作成

**必要なものだけ作成する。不要なドキュメントは作らない。**

- [ ] `$ARGUMENTS[0]/architecture/` 配下に設計ドキュメントを作成する
  - tech-stack.md — 新規開発 or 技術選定が必要な場合
  - db-schema.md — DBを使う場合
  - interfaces.md — API or 複数コンポーネント間の連携がある場合
  - conventions.md — 新規開発 or 新しい規約が必要な場合
  - **含めないもの:** 実装例・メソッド内部のコード、詳細なProps定義・型定義
  - 各ドキュメントのフォーマットは [templates.md](references/templates.md) を参照

→ Step 5 へ。

### Step 5: ビルド作成と設計全体の承認

- [ ] 設計ドキュメントに基づいてビルドの論理的な単位を特定し、`/hikyaku-build-manager $ARGUMENTS[0]` を呼び出してビルドの作成を委任する
  - build-manager に伝える情報: 各ビルドのタイトル・スコープ・依存関係・設計ドキュメントの参照先
  - build-manager がBP見積もり、tasklist.md の作成、各 issue.md の作成、ユーザー承認までを行う
- [ ] 設計ドキュメント（architecture/）の全内容をユーザーに提示し、最終承認を得る
  - ビルドの承認は build-manager が取得済みのため、ここでは設計ドキュメントに集中する
  - **承認観点:** 技術選定は妥当か、設計方針に問題はないか

→ 承認を得たら Step 6 へ。フィードバックの内容に応じて対応が異なる:
- 設計ドキュメントへのフィードバック → Step 3 に戻る
- ビルドへのフィードバック → `/hikyaku-build-manager $ARGUMENTS[0]` を再度呼び出す

### Step 6: 振り返り

- [ ] `/hikyaku-retrospective $ARGUMENTS[0] architecture` を呼び出して振り返りを実施する
- [ ] 振り返り完了後（またはスキップ後）、以下を案内する

```
設計フェーズが完了しました。

BUILDフェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku-builder $ARGUMENTS[0]
```