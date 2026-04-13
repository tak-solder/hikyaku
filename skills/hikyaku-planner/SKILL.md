---
name: hikyaku-planner
description: "Hikyaku 企画フェーズ: 既存の企画ドキュメントを読み込み、にユーザーストーリーとして構造化したドキュメントを出力する"
user-invocable: true
disable-model-invocation: true
argument-hint: "{DOC_ROOT}"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "0.4.2"
---

# Hikyaku Planner

`$ARGUMENTS[0]` に指定されたパスにワークフロードキュメントをセットアップし、企画フェーズを実行する。

## Hikyaku ワークフロー概要

Hikyakuは PLAN → ARCHITECT → BUILD の3フェーズで構成されるAIエージェント協働開発ワークフロー。

- 各フェーズは **別セッション（＝別のAI）** が担当する
  - フェーズごとに1セッション（20万トークン）が目安
- フェーズ間の情報引き継ぎはファイル（planning/, architecture/, handoff.md）で行う
- 各フェーズには反復的な質問ループがあり、目的が達成されるまで確認を繰り返す

### 全体フロー

```
/hikyaku-planner   → planning/ を生成 ← あなたはここ
      ↓ ユーザー承認
/hikyaku-architect → architecture/ + tasklist.md + build-{NN}/issue.md を生成
      ↓ ユーザー承認
/hikyaku-builder   → build-01/ を実装 → handoff.md → PR
/hikyaku-builder   → build-02/ を実装 → handoff.md → PR
  ...（ビルド数分繰り返し）
```

### ワークフローディレクトリ構造

```
$ARGUMENTS[0]/
├── tasklist.md               # ビルド一覧（ARCHITECT で作成、BUILD で PR列を更新）
├── planning/                  # 企画ドキュメント（PLAN で作成）
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

### あなたの役割（企画フェーズ）

あなたは企画フェーズを担当する。
ユーザーは既にある程度の企画・要件を持っている。あなたの仕事は、既存のドキュメントやユーザーの説明を読み込み、**次の設計フェーズ（ARCHITECT）が作業を開始できる形に構造化すること**。

**やらないこと:**
- 技術選定（言語、フレームワーク、ライブラリの選択）
- システム設計（DB設計、API設計、アーキテクチャ）
- ビルド分割・見積もり
- 実装方法の提案

## 作業ステップ

### Step 0: ファイルの読み込み

作業の開始前に必ず次のファイルを読み込む。

- [ ] `<SKILL_ROOT>/references/templates.md`: 各種成果物のテンプレート（必須）
- [ ] `$ARGUMENTS[0]/instruction.md`: ワークフロー独自のインストラクション（存在する場合のみ）

なお、インストラクションは次の優先順で適用する。上位の指示が下位と矛盾する場合は、上位を優先すること。

1. リポジトリ全体のインストラクション（AGENTS.md, CLAUDE.md 等）
2. ワークフロー独自のインストラクション
3. このスキルの説明（SKILL.md）

→ すべて読み込めたら Step 1 へ。必須ファイルが読み込めなかった場合はユーザーに報告して終了。

### Step 1: ワークフローディレクトリの作成

- [ ] `$ARGUMENTS[0]/planning/` ディレクトリが存在しなければ作成する

→ Step 2 へ。

### Step 2: インプットの読み込み

- [ ] ユーザーが指定したドキュメント（企画書、仕様メモ、Issue、Slack抜粋など）を読み込む
  - 指定がない場合はユーザーにインプットとなるドキュメントの場所を確認する。自分で探索しない

→ Step 3 へ。

### Step 3: 企画内容の確認と承認

**既存ドキュメントに書かれている内容を再度聞かない。** ドキュメントから読み取れない点、曖昧な点、矛盾する点のみを質問する。

- [ ] インプットを読み込んだ上で、ユーザーストーリーに構造化するために不足している情報を質問する
  - 1ラウンドの質問数に上限はない。聞くべきことは1回でまとめて聞く
  - インプットに明記されている内容は質問しない
  - 確認観点: **目的**, **対象ユーザー**, **コア機能**, **スコープ境界**, **優先度**, **制約条件**（納期、予算、運用体制など）
  - 質問ファイルのフォーマットは [templates.md](references/templates.md) を参照
- [ ] 構造化に必要な情報が揃うまで質問を繰り返す
- [ ] インプットと質問ループで得た情報を統合し、`$ARGUMENTS[0]/planning/user-stories.md` を作成する
  - フォーマットは [templates.md](references/templates.md) を参照
- [ ] planning/questions.md と planning/user-stories.md をユーザーに提示し、承認を得る

→ 承認を得たら Step 4 へ。フィードバックがあれば反映し、Step 3 の質問ループからやり直す。

### Step 4: 振り返り

- [ ] `/hikyaku-retrospective $ARGUMENTS[0] planning` を呼び出して振り返りを実施する
- [ ] 振り返り完了後（またはスキップ後）、以下を案内する

```
企画フェーズが完了しました。

設計フェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku-architect $ARGUMENTS[0]
```