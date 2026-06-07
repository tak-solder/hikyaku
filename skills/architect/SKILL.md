---
name: architect
description: "Hikyaku 設計フェーズ: 企画フェーズの成果物を入力として、技術設計・ビルド分割・ビルド定義を出力する"
user-invocable: true
disable-model-invocation: true
argument-hint: "[{DOC_ROOT}]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "0.8.0"
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
/hikyaku:planner   → planning/ を生成（完了済み）
      ↓
/hikyaku:architect → architecture/ + tasklist.md + build-{NN}/issue.md を生成  ← あなたはここ
      ↓ ユーザー承認
/hikyaku:builder   → build-01/ を実装 → handoff.md → PR
/hikyaku:builder   → build-02/ を実装 → handoff.md → PR
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
│   ├── decisions.md           # 設計判断ログ（ADR、分岐評価のあった判断のみ）
│   ├── tech-stack.md          # 技術選択（必要時のみ）
│   ├── db-schema.md           # DBスキーマ（必要時のみ）
│   ├── interfaces.md          # インターフェース定義（必要時のみ）
│   ├── conventions.md         # 共通規約（必要時のみ）
│   └── retrospective.md      # 振り返り（ARCHITECT で作成）
├── build-01/
│   ├── issue.md               # ビルド定義（ARCHITECT で作成）
│   ├── plan.md                # 実装計画（BUILD で作成）
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

### Step 0: ファイルの読み込みと設定の解決

作業の開始前に必ず以下を実行する。

- [ ] `<SKILL_ROOT>/references/templates.md`: 各種成果物のテンプレート（必須）
- [ ] リポジトリルートの `.hikyaku.config` を読み込む（存在する場合のみ）
- [ ] **DOC_ROOT を決定する**
  - `$ARGUMENTS[0]` が指定されている場合 → その値を DOC_ROOT として使用する
  - `$ARGUMENTS[0]` が未指定で `.hikyaku.config` に `doc_root` が設定されている場合 → その値を DOC_ROOT として使用する
  - どちらも未設定の場合 → ユーザーに DOC_ROOT の指定を求めて終了する
- [ ] `{DOC_ROOT}/instruction.md`: ワークフロー独自のインストラクション（存在する場合のみ）

以降のステップでは DOC_ROOT を `$ARGUMENTS[0]` の代わりに使用する。

なお、インストラクションは次の優先順で適用する。上位の指示が下位と矛盾する場合は、上位を優先すること。

1. リポジトリ全体のインストラクション（AGENTS.md, CLAUDE.md 等）
2. ワークフロー独自のインストラクション
3. このスキルの説明（SKILL.md）

→ すべて読み込めたら Step 1 へ。必須ファイルが読み込めなかった場合はユーザーに報告して終了。

### Step 1: 企画成果物の読み込み

- [ ] `$ARGUMENTS[0]/planning/questions.md` — 企画段階の質問と回答
- [ ] `$ARGUMENTS[0]/planning/user-stories.md` — ユーザーストーリー

→ すべて読み込めたら Step 2 へ。いずれかが存在しない場合はユーザーに報告し、先に `/hikyaku:planner` を実行するよう案内して終了。

### Step 2: 既存コードベースの調査

**既存コードがない（新規開発）場合はこのステップをスキップして Step 3 へ。**

調査過程のコンテキスト消費を避けるため、コードベース全体の探索はサブエージェント（`code-explorer`）に委任する。ただし、本セッションが設計判断を下すために必要な **Key Files** は本セッション自身が読み込む。

- [ ] **調査範囲の判定**
  - user-stories.md が単一機能・小規模スコープ → **単一エージェント** で調査（モード: 単一起動）
  - user-stories.md が複数の独立した機能領域を含む、または既存コードベースが大規模 → **複数エージェントを観点別に並列起動**（2〜3つ。モード: 並列起動）

- [ ] **code-explorer エージェントを起動する**
  - サブエージェントは別コンテキストで起動されるため、委任プロンプトに **以下のファイル絶対パスを必ず明示する**:
    - ワークフロー DOC_ROOT: `$ARGUMENTS[0]`
    - 入力となる企画成果物: `$ARGUMENTS[0]/planning/user-stories.md`
    - 調査対象リポジトリのルート: 現在の作業ディレクトリ（通常はリポジトリルート）
  - **単一起動モード**の場合: 委任プロンプトに「モード: 単一起動。リポジトリ概要・ディレクトリ構成・関連コード・既存パターン・拡張ポイントを広くカバーすること」と明記する
  - **並列起動モード**の場合: 委任プロンプトに「モード: 並列起動。担当観点: ...」と明記する。観点例:
    - 「user-stories の `US-X` に類似する既存機能のトレース」
    - 「user-stories 全体に関連するアーキテクチャ層・抽象化の把握」
    - 「拡張ポイント（フック・インターフェース・抽象クラス）の特定」
  - 並列起動モードの場合、いずれか1エージェントに「**概観担当**」を追加で指示する（リポジトリ概要・ディレクトリ構成セクションを出力させる）
  - 各エージェントには以下を必ず返させる:
    - 担当観点の調査結果
    - **Key Files**: その観点で本セッションが直接読むべき5〜10ファイルのパスと役割
  - 出力フォーマットは `agents/code-explorer.md` を参照

- [ ] **Key Files をメインセッションで直接読む**
  - 各エージェントが返した Key Files の重複を排除する
  - Read tool で実ファイルを直接読み、設計判断の一次情報を本セッションに取り込む
  - **このステップを省略しない**（エージェントの要約だけで後段の設計を進めると、規約・インターフェースの解像度が落ちる）

- [ ] **`codebase-survey.md` の作成**
  - 単一起動・並列起動のどちらの場合も、**メインセッションが [templates.md](references/templates.md) の `codebase-survey.md` フォーマットに整形** して `$ARGUMENTS[0]/architecture/codebase-survey.md` を作成する
  - エージェントの出力（担当観点 / 調査結果 / Key Files）はテンプレートのフォーマットと異なるため、そのまま書き出さずに以下のセクションへ統合する:
    - **リポジトリ概要** ← 単一エージェントの「リポジトリ概要」、または並列モードで概観担当エージェントの「リポジトリ概要」
    - **ディレクトリ構成** ← 同上
    - **ユーザーストーリーとの関連箇所** ← 各エージェントの「関連コード」と Key Files から得た一次情報
    - **既存の規約・パターン** ← 各エージェントの「既存パターン・規約」を統合
    - **拡張ポイント** ← 各エージェントの「拡張ポイント」を統合

- [ ] `codebase-survey.md` をユーザーに提示し、誤り・見落とし・追加の制約がないか確認する

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

#### Step 4a: 主要設計判断の特定と分岐評価

- [ ] Step 3 の質問結果・`codebase-survey.md`・`user-stories.md` を踏まえ、設計ドキュメントに反映する主要な技術判断（例: 認証方式、状態管理戦略、データ同期方式、API設計の粒度）を列挙する
- [ ] 各判断について、**妥当な代替案が複数あり trade-off が非自明** かどうかを評価する
  - 既存規約から自明 / 単一の合理的選択肢しかない → **分岐なし**
  - 複数案で trade-off が異なり、ユーザーの判断が必要 → **分岐あり**

#### Step 4b: 分岐がある判断について複数案を提示（該当時のみ）

分岐がない判断のみの場合はこの手順をスキップして Step 4c へ。**この場合 `decisions.md` は作成しない**（記録対象は分岐ありの判断のみ）。

- [ ] 分岐がある各判断について、**`code-architect` エージェントを2〜3並列**で起動し、異なる観点の案を生成させる
  - サブエージェントは別コンテキストで起動されるため、委任プロンプトに **以下のファイル絶対パスを必ず明示する**:
    - ワークフロー DOC_ROOT: `$ARGUMENTS[0]`
    - 要件: `$ARGUMENTS[0]/planning/user-stories.md`
    - 設計質問の回答: `$ARGUMENTS[0]/architecture/design-questions.md`（存在する場合）
    - 既存コード調査結果: `$ARGUMENTS[0]/architecture/codebase-survey.md`（存在する場合）
  - 観点の例:
    - **Minimal**: 既存資産の最大活用、変更最小、低リスク
    - **Clean**: 関心分離・抽象化重視、長期保守性優先
    - **Pragmatic**: 上記の中間。実装スピードと保守性のバランス
  - 各エージェントには「影響ファイル」「主要コンポーネントの責務」「Trade-off」を返させる
  - 各観点の出力フォーマットは `agents/code-architect.md` を参照
- [ ] 各案を **trade-off表** にまとめ、**推奨案と理由** を明記してユーザーに提示する
- [ ] ユーザーから「お任せ」と回答された場合も、推奨案を改めて提示し **明示的な確認** を得る（空回答として進めない）
- [ ] ユーザーの採用案を確定する
- [ ] **Step 4a で「分岐あり」と判定した各判断について、確定した採用案を `$ARGUMENTS[0]/architecture/decisions.md` に追記する**（分岐なしと判定した判断は記録しない）
  - 1つの「分岐あり」判断 = 1つの `AD-N` エントリ
  - `decisions.md` が未作成の場合はこのステップで新規作成する
  - フォーマットは [templates.md](references/templates.md) の `decisions.md` を参照
  - 記録項目: 決定 / 文脈 / 検討した案（code-architect が返した複数案を要約） / 採用理由 / トレードオフ
  - **トレードオフ欄に「特になし」は書かない**（書きたくなる場合は Step 4a の分岐判定を見直す）

#### Step 4c: 設計ドキュメントの作成

- [ ] `$ARGUMENTS[0]/architecture/` 配下に設計ドキュメントを作成する
  - tech-stack.md — 新規開発 or 技術選定が必要な場合
  - db-schema.md — DBを使う場合
  - interfaces.md — API or 複数コンポーネント間の連携がある場合
  - conventions.md — 新規開発 or 新しい規約が必要な場合
  - **含めないもの:** 実装例・メソッド内部のコード、詳細なProps定義・型定義
  - 各ドキュメントのフォーマットは [templates.md](references/templates.md) を参照
  - **Step 4b を実施した場合は、確定した採用案の内容を反映する**（Step 4b をスキップした場合は分岐なしの判断のみで作成する）

→ Step 5 へ。

### Step 5: 設計全体の承認とビルド作成

- [ ] 設計ドキュメント（architecture/）の全内容をユーザーに提示し、最終承認を得る
  - **承認観点:** 技術選定は妥当か、設計方針に問題はないか
- [ ] 設計ドキュメントが承認されたら、設計ドキュメントに基づいてビルドの論理的な単位を特定し、`/hikyaku:build-manager $ARGUMENTS[0]` を呼び出してビルドの作成を委任する
  - build-manager に伝える情報: 各ビルドのタイトル・スコープ・依存関係・設計ドキュメントの参照先
  - build-manager がBP見積もり、tasklist.md の作成、各 issue.md の作成、ユーザー承認までを行う

→ すべての承認を得たら Step 6 へ。フィードバックの内容に応じて対応が異なる:
- 設計ドキュメントへのフィードバック → Step 3 に戻る
- ビルドへのフィードバック → `/hikyaku:build-manager $ARGUMENTS[0]` を再度呼び出す

### Step 6: 振り返り

- [ ] `/hikyaku:retrospective $ARGUMENTS[0] architecture` を呼び出して振り返りを実施する
- [ ] 振り返り完了後（またはスキップ後）、以下を案内する

```
設計フェーズが完了しました。

BUILDフェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku:builder $ARGUMENTS[0]
```