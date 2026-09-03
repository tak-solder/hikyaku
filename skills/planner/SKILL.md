---
name: planner
description: "Hikyaku 企画フェーズ: チケットと既存の企画ドキュメントを読み込み、そのサイクルのユーザーストーリーとして構造化する"
user-invocable: true
disable-model-invocation: true
argument-hint: "[{HIKYAKU_ROOT}] [{cycle}]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "2.0.0"
---

# Hikyaku Planner

対象サイクルの企画フェーズ（PLAN）を実行する。

## Hikyaku ワークフロー概要

Hikyaku は PLAN → ARCHITECT → BUILD → CLOSE の4フェーズで構成される、
AIエージェント協働開発ワークフロー。

- 各フェーズは **別セッション（＝別のAI）** が担当する（1セッション20万トークンが目安）
- フェーズ間の情報引き継ぎはファイルで行う
- **1サイクル = 1チケット**。複数のサイクルを並行して回せる

```
/hikyaku:init          → ワークスペースを初期化（初回のみ）
/hikyaku:create-cycle  → サイクルを作成し profile を選ぶ
/hikyaku:planner       → planning/ を生成  ← あなたはここ
/hikyaku:architect     → design/ + tasklist.md + build-NN/issue.md を生成
/hikyaku:builder       → build-NN を実装 → PR（依存が無ければ並行実行可）
/hikyaku:close-cycle   → 永続ドキュメントへ昇格し、サイクルを closed に
```

### ディレクトリ構造

```
{HIKYAKU_ROOT}/
├── .hikyaku.config
├── document-guide.md          # 永続ドキュメントの所在（必須）
├── cycles.md                  # サイクル索引（必須）
├── instruction.md             # ワークフロー独自の指示（任意）
└── cycles/
    └── {NNN}-{slug}/
        ├── planning/          # ← あなたが作る
        │   ├── questions.md
        │   └── user-stories.md
        ├── design/            # ARCHITECT が作る
        ├── tasklist.md        # ARCHITECT が作る
        └── build-01/          # BUILD が作る
```

**永続ドキュメント（overview / decisions / constraints / learnings / conventions 等）は
HIKYAKU_ROOT の外にある。** 所在は `document-guide.md` が宣言する。

### あなたの役割

ユーザーは既にチケットや企画メモを持っている。あなたの仕事は、それを読み込んで
**次の設計フェーズ（ARCHITECT）が作業を開始できる形に構造化すること**。

**やらないこと:**
- 技術的な実現方法の決定（設計フェーズの仕事）
- **永続ドキュメントへの書き込み**（close-cycle だけが行う）
- このサイクル外のストーリーを書くこと（バックログ管理はスコープ外）

## 作業ステップ

### Step 0: 設定の解決とサイクルの特定

- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/planner/references/templates.md`: 各種テンプレート（必須）
- [ ] 設定を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config --root $ARGUMENTS[0] --json
```

- **未初期化の場合**（`document-guide.md` が無い）→ `/hikyaku:init` を実行して初期化を代行する
- **サイクルが未作成の場合** → `/hikyaku:create-cycle` を実行して代行する
  - 代行した場合、create-cycle は PR を作らない。成果物が cycles.md の1行だけなので、
    このスキルの PR に畳む
- [ ] 対象サイクルを特定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle} --root {HIKYAKU_ROOT}
```

**中断からの再開の場合**、このコマンドがどこまで進んだかを教えてくれる。
既存の成果物があれば読み込んで途中から再開する。

- [ ] `{HIKYAKU_ROOT}/instruction.md` を読む（存在する場合のみ）
- [ ] サイクルの `profile` を確認し、以降のゲートとレビューの有無を決める

インストラクションは次の優先順で適用する。上位が下位と矛盾する場合は上位を優先する。

1. リポジトリ全体のインストラクション（AGENTS.md, CLAUDE.md 等）
2. ワークフロー独自のインストラクション（`{HIKYAKU_ROOT}/instruction.md`）
3. このスキルの説明（SKILL.md）

→ Step 1 へ。

### Step 1: ブランチ作成

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch name plan {cycle} --root {HIKYAKU_ROOT}
```

返ってきた名前でブランチを作成する。

→ Step 2 へ。

### Step 2: インプットの読み込み

- [ ] cycles.md に記録された**チケット**を確認する
- [ ] ユーザーが指定したドキュメント（企画書、仕様メモ、Issue、Slack抜粋など）を読み込む
  - 指定がない場合はユーザーにインプットの場所を確認する。自分で探索しない
- [ ] `document-guide.md` を読み、**`constraints` が登録されていれば読む**
  - 既に確定している非機能要件を再度質問しないため

→ Step 3 へ。

### Step 3: 目的とスコープのすり合わせ

質問ループに入る前に、インプットから読み取った内容を要約して提示し、認識のズレを先に解消する。

- [ ] 以下の4項目を簡潔にまとめてユーザーに提示する
  - **何を実現したいか**: ユーザーが何ができるようになる機能か
  - **背景・目的**: なぜこの機能が必要か
  - **対象画面・対象データ**: どの画面・どのデータに関わるか
  - **制約・要件**: あれば（`constraints` に既にあるものは再掲せず参照する）
  - インプットから読み取れない補完には **「（推測）」** を付ける
- [ ] ユーザーから誤り・補足を聞き、認識を合わせる

→ Step 4 へ。

### Step 4: 質問ループと user-stories の作成

**インプットや Step 3 で明記されている内容は質問しない。**

- [ ] 構造化に必要な情報を質問する
  - 1ラウンドの質問数に上限はない。聞くべきことは1回でまとめて聞く
  - 確認観点: **目的**, **対象ユーザー**, **コア機能**, **スコープ境界**, **優先度**, **制約条件**
  - 質問が発生した場合のみ `cycles/{cycle}/planning/questions.md` に記録する
  - **未回答の質問を放置しない。** 未回答なら明示的にそう記す
- [ ] `cycles/{cycle}/planning/user-stories.md` を作成する
  - フォーマットは [templates.md](references/templates.md) を参照
  - Step 3 の4項目を冒頭の「概要」セクションに反映する
  - **このサイクルのスコープに閉じる。** 将来やりたいことは書かない
- [ ] **コミット & push する**

成果物を1つ作るごとにコミット & push すること。コミットされていなければ、
中断時に他セッションから進捗が見えず、再開点を検出できない。

→ Step 5 へ。

### Step 5: レビューと承認

- [ ] **`user_stories_review` が有効な場合**（light / standard / strict）、`doc-reviewer` を起動する（`context: user-stories`）
  - 渡す情報: `cycles/{cycle}/planning/user-stories.md`, `planning/questions.md`
  - 出力フォーマットは `${CLAUDE_PLUGIN_ROOT}/agents/doc-reviewer.md` を参照
  - 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）
- [ ] **`user_stories_gate` が有効な場合**（saving / standard / strict）、ユーザーに提示して承認を得る
  - `light` ではこのゲートを省略する。問題は PR レビューで拾う想定

profile ごとの有効・無効は Step 0 の `config --json` の `gates` / `reviews` を見る。

→ 承認を得たら（または light で省略したら）Step 6 へ。

### Step 6: 振り返りと PR

- [ ] `retrospective` 設定に従って `/hikyaku:retrospective {HIKYAKU_ROOT} {cycle} planning` を呼び出す
- [ ] PR を作成する（タイトルは `hikyaku pr title plan {cycle}` で生成）

**このフェーズの PR はドキュメントのみで、速やかにマージすることを想定している。**
デフォルトブランチに入っていない情報は他サイクルから見えないため。

- [ ] 完了後、以下を案内する

```
企画フェーズが完了しました。

設計フェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku:architect {HIKYAKU_ROOT} {cycle}
```
