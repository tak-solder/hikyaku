---
name: planner
description: "Hikyaku 企画フェーズ: チケットと既存の企画ドキュメントを読み込み、そのサイクルのユーザーストーリーとして構造化する"
user-invocable: true
disable-model-invocation: true
argument-hint: "[{cycle}]"
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
リポジトリルート/
├── .hikyaku.config            # 設定のベース（必須）。hikyaku_root もここ
└── {HIKYAKU_ROOT}/
    ├── document-guide.md      # 永続ドキュメントの所在（必須）
    ├── cycles.md              # サイクル索引（必須）
    ├── instruction.md         # ワークフロー独自の指示（任意）
    ├── .hikyaku.local         # 最後に作業したサイクル（git 管理対象外）
    └── cycles/
        └── {NNN}-{slug}/
            ├── .hikyaku.config  # サイクル固有の上書き（任意）
            ├── planning/        # ← あなたが作る
            │   ├── questions.md
            │   └── user-stories.md
            ├── design/          # ARCHITECT が作る
            ├── tasklist.md      # ARCHITECT が作る
            └── build-01/        # BUILD が作る
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
- [ ] 設定と対象サイクルを解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

HIKYAKU_ROOT は `.hikyaku.config` から解決されるので、引数では受け取らない。

`$ARGUMENTS[0]` でサイクルが指定されていればそれを渡す。省略された場合は
**現在のブランチ → `.hikyaku.local` → 唯一の進行中サイクル** の順で決まる。
決められないときは進行中サイクルの一覧を添えてエラーになるので、**ユーザーに尋ねてから**
指定し直す。推測して進めない（別サイクルへコミットする事故になる）。

出力の `cycle` と `cycleSource` を、作業対象としてユーザーに1行で示す。

ここで次のエラーが出た場合は代行する。

- **未初期化**（`.hikyaku.config` が無い / `document-guide.md` が無い）
  → `/hikyaku:init` を実行して初期化を代行する
- **サイクルが未作成**（「サイクルがまだありません」）
  → `/hikyaku:create-cycle` を実行して代行する
  - 代行した場合、create-cycle は PR を作らない。成果物が cycles.md の1行だけなので、
    このスキルの PR に畳む

- [ ] 対象サイクルを記録する（次回から尋ねられずに済む）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle use {cycle}
```

- [ ] サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
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

### Step 1: ブランチとセッション名

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify plan {cycle}
```

出力の `ok` と `onBaseBranch` で分岐する。**自分で決めず、この表に従う。**

| 状況 | 対応 |
|---|---|
| `ok: true` | そのまま続ける |
| `ok: false` かつ `onBaseBranch: true` | `expected` の名前でブランチを作成して続ける |
| `ok: false` かつ `onBaseBranch` が `false` / `null` | **ユーザーに尋ねる**（下記） |

3つ目は、実行環境がブランチ名を決めている場合（クラウド版の Claude Code など）と、
別の作業のブランチに紛れ込んでいる場合の区別がつかない。**推測して進めない。**
次の3つを提示して選ばせる。

1. **Hikyaku の規則に従う** — `expected` の名前でブランチを作成する
2. **現在のブランチで作業する** — 実行環境がブランチ名を決めている場合はこれ
3. **その他** — ユーザーが指定したブランチで作業する

2 と 3 を選んだ場合は、`next` の「着手中」検出が効かなくなることを伝えてから続ける
（ブランチ名から導出しているため）。**完了判定と中断検出には影響しない。**

ブランチを決めたら、成果物をコミットする直前にもう一度この確認を行う。

- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title plan {cycle}
```

返ってきた名前をセッション名に設定する。設定する手段が無い環境ではスキップしてよい。
`[session] title` が空文字なら「変更しません」と返るので、その場合もスキップする。

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

- [ ] `retrospective` 設定に従って `/hikyaku:retrospective {cycle} planning` を呼び出す
- [ ] コミット前にブランチを確認する（`hikyaku branch verify plan {cycle}`）
- [ ] 外部連携が有効なら、親 issue を作る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref plan {cycle}
```

**親 issue はここで作る。** この時点なら user-stories があって親の要約として成立し、
以降のすべての PR が親を参照できる。参照は `cycles.md` の外部列に記録され、この PR で
デフォルトブランチに入るので、並行セッションからも見える。

gh CLI が無い環境では投影内容だけが返る（`reason: "gh-not-found"`）。その場合は
GitHub MCP ツールで適用し、`cycle link {cycle} --external {URL}` で記録する。

- [ ] PR を作成する（タイトルは `hikyaku pr title plan {cycle}` で生成）
  - `external ref` が返した行（`Refs #12` など）を本文の末尾に入れる。空なら入れない

**このフェーズの PR はドキュメントのみで、速やかにマージすることを想定している。**
デフォルトブランチに入っていない情報は他サイクルから見えないため。

- [ ] 完了後、以下を案内する

```
企画フェーズが完了しました。

設計フェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku:architect {cycle}
```
