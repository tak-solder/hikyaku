---
name: planner
description: "Hikyaku 企画フェーズ: チケットと既存の企画ドキュメントを読み込み、そのサイクルのユーザーストーリーとして構造化する。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{cycle}]"
---

# Hikyaku Planner

対象サイクルの企画フェーズ（PLAN）を実行する。各フェーズは別セッションが担当し、
引き継ぎはファイルで行う。

```
/hikyaku:init          → ワークスペースを初期化（初回のみ）
/hikyaku:create-cycle  → サイクルを作成し profile を選ぶ
/hikyaku:planner       → planning/ を生成  ← あなたはここ
/hikyaku:architect     → design/ + tasklist.md + build-NN/issue.md を生成
/hikyaku:builder       → build-NN を実装 → PR（依存が無ければ並行実行可）
/hikyaku:close-cycle   → 永続ドキュメントへ昇格し、サイクルを closed に
```

## あなたの役割

ユーザーは既にチケットや企画メモを持っている。あなたの仕事は、それを読み込んで
次の設計フェーズ（ARCHITECT）が作業を開始できる形に構造化すること。成果物は
`cycles/{cycle}/planning/` の `user-stories.md` と `questions.md`。

やらないこと:
- 技術的な実現方法の決定（設計フェーズの仕事）
- 永続ドキュメントへの書き込み（close-cycle だけが行う）
- このサイクル外のストーリーを書くこと（バックログ管理はスコープ外）

## 作業ステップ

### Step 0: 設定の解決とサイクルの特定

- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/planner/references/templates.md`: 各種テンプレート（必須）
- [ ] 設定と対象サイクルを解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

`$ARGUMENTS[0]` のサイクルを渡す。省略時は CLI が現在のブランチ → `.hikyaku.local` →
唯一の進行中サイクルの順で決め、決まらなければ候補を添えてエラーになる。そのときは推測せず
ユーザーに尋ねて指定し直す（別サイクルへコミットする事故になる）。HIKYAKU_ROOT は
`.hikyaku.config` から解決されるので、引数では受け取らない。

出力の `cycle` と `cycleSource` を、作業対象としてユーザーに1行で示す。
以降のゲートとレビューの有無は、出力の `gates` / `reviews` で決める。

ここで次のエラーが出た場合は代行する。

- 未初期化（`.hikyaku.config` が無い / `document-guide.md` が無い）
  → `/hikyaku:init` を実行して初期化を代行する
- サイクルが未作成（「サイクルがまだありません」）
  → `/hikyaku:create-cycle` を実行して代行する
  - 代行した場合、create-cycle は PR を作らない。成果物が cycles.md の1行だけなので、
    このスキルの PR に畳む

- [ ] 対象サイクルを記録する（次回から尋ねられずに済む）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle use {cycle}
```

- [ ] 読むべきドキュメントの候補を取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" context plan {cycle}
```

企画で読む既定の永続ドキュメントは `constraints`（確定済みの非機能要件を再度質問しないため）と
`glossary`（語を既存の定義に揃えるため）。`repo` 管理の独自ドキュメントも候補に含まれるので、
概要欄を見て、今回のスコープに関係するものだけを読む。

インストラクションは次の優先順で適用する。上位が下位と矛盾する場合は上位を優先する。

1. リポジトリ全体のインストラクション（AGENTS.md, CLAUDE.md 等）
2. ワークフロー独自のインストラクション（`{HIKYAKU_ROOT}/instructions.md`）
3. このスキルの説明（SKILL.md）

→ Step 1 へ。

### Step 1: ブランチとセッション名

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify plan {cycle}
```

出力の `ok` と `onBaseBranch` で分岐する。自分で決めず、この表に従う。

| 状況 | 対応 |
|---|---|
| `ok: true` | そのまま続ける |
| `ok: false` かつ `onBaseBranch: true` | `expected` の名前でブランチを作成して続ける |
| `ok: false` かつ `onBaseBranch` が `false` / `null` | ユーザーに尋ねる（下記） |

3つ目は、現在のブランチが実行環境に割り当てられたものだと分かっていても、**自分で決めずに
必ず尋ねる。** セッションの中からは、別の作業のブランチに紛れ込んだ状態と区別できない。
尋ねる手段（`AskUserQuestion` など）で次の3つを、どれが妥当かの示唆を添えずに提示する。

1. Hikyaku の規則に従う — `expected` の名前でブランチを作成する
2. 現在のブランチで作業する
3. 別のブランチを指定する

ユーザーが 2 か 3 を選んだら、`next` の「着手中」検出が効かなくなることを伝える
（ブランチ名から導出しているため）。ブランチを決めたら、成果物をコミットする直前にもう一度
この確認を行う。

- [ ] サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

ブランチを決めてから実行する（成果物の有無は作業ツリーで判定するため、デフォルトブランチの
ままでは push 済みの成果物が見えない）。中断からの再開なら、表示された位置から再開する。

- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title plan {cycle}
```

返った名前をセッション名に設定する。設定する手段が無い環境と、「変更しません」と返った場合はスキップする。

→ Step 2 へ。

### Step 2: インプットの読み込み

- [ ] cycles.md に記録されたチケットを確認する
- [ ] ユーザーが指定したドキュメント（企画書、仕様メモ、Issue、Slack抜粋など）を読み込む
  - 指定がない場合はユーザーにインプットの場所を確認する。自分で探索しない
- [ ] Step 0 の `context` が `constraints` を返していれば読む
  - 既に確定している非機能要件を再度質問しないため

→ Step 3 へ。

### Step 3: 目的とスコープのすり合わせ

質問ループに入る前に、インプットから読み取った内容を要約して提示し、認識のズレを先に解消する。

- [ ] 以下の4項目を簡潔にまとめてユーザーに提示する
  - 何を実現したいか: ユーザーが何ができるようになる機能か
  - 背景・目的: なぜこの機能が必要か
  - 対象画面・対象データ: どの画面・どのデータに関わるか
  - 制約・要件: あれば（`constraints` に既にあるものは再掲せず参照する）
  - インプットから読み取れない補完には「（推測）」を付ける
- [ ] ユーザーから誤り・補足を聞き、認識を合わせる

→ Step 4 へ。

### Step 4: 質問ループと user-stories の作成

**インプットや Step 3 で明記されている内容は質問しない。**

- [ ] 構造化に必要な情報を質問する
  - 1ラウンドの質問数に上限はない。聞くべきことは1回でまとめて聞く
  - 確認観点: 目的, 対象ユーザー, コア機能, スコープ境界, 優先度, 制約条件
  - 質問が発生した場合のみ `cycles/{cycle}/planning/questions.md` に記録する
  - 未回答の質問を放置しない。未回答なら明示的にそう記す
- [ ] `cycles/{cycle}/planning/user-stories.md` を作成する
  - フォーマットは [templates.md](references/templates.md) を参照
  - Step 3 の4項目を冒頭の「概要」セクションに反映する
  - このサイクルのスコープに閉じる。将来やりたいことは書かない
  - やらないと決めたことは、理由とともに「スコープ外」に残す（ストーリーにはしない）
  - 受け入れ基準に `US-N.M` の番号を振る。後続フェーズはこの番号で受け入れ基準を参照する
- [ ] コミット & push する

成果物を1つ作るごとにコミット & push すること。コミットされていなければ、
中断時に他セッションから進捗が見えず、再開点を検出できない。

→ Step 5 へ。

### Step 5: レビューと承認

- [ ] `user_stories_review` が有効な場合、`doc-reviewer` を起動する（`context: user-stories`）
  - 起動方法は `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve doc plan {cycle} --self claude --json` の `mode` で決める。
    `agent` ならサブエージェントとして起動する。`process` なら
    `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run doc plan {cycle} --self claude --context user-stories --files <渡す情報のパスをカンマ区切りで>`
    の本文をレビュー結果とする。終了コード 1 は失敗で、指摘0件として扱わずユーザーに報告する
  - 渡す情報: `cycles/{cycle}/planning/user-stories.md`, `planning/questions.md`
  - 出力フォーマットは `${CLAUDE_PLUGIN_ROOT}/agents/doc-reviewer.md` を参照
  - 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）
- [ ] ユーザーに提示して承認を得る（G1）
  - このゲートは**どのプロファイルでも省略しない**。要件の合意は後段の承認では
    代替できない（設計も plan も「その要件で正しいか」を前提に置くため）
  - `user_stories_gate` を個別キーで `false` にした場合のみ省略する

→ 承認を得たら Step 6 へ。

### Step 6: 振り返りと PR

- [ ] `retrospective` 設定に従って `/hikyaku:retrospective {cycle} planning` を呼び出す
- [ ] コミット前にブランチを確認する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify plan {cycle}`）
- [ ] 外部連携が有効なら、親 issue を作る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref plan {cycle}
```

親 issue はここで作る。user-stories が親の要約になり、以降のすべての PR が親を参照できる。

gh CLI が無い環境では投影内容だけが返る（`reason: "gh-not-found"`）。その場合は
GitHub MCP ツールで適用し、`cycle link {cycle} --external {URL}` で記録する。

- [ ] PR を Draft で作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title plan {cycle}` で生成）
  - `external ref` が返した行（`Refs #12` など）を本文の末尾に入れる。空なら入れない
  - `gh pr create --draft` で Draft として作る。リポジトリが Draft PR に対応しておらず作成に失敗したら、
    `--draft` を外して作り直し、下の「Ready にする」は飛ばす。Draft にできなかったことを完了の案内で伝える
- [ ] `config` 出力の `pr.autoReady`（`[pr] auto_ready`、既定 true）が true なら、PR を Ready for Review にする

```bash
gh pr ready {PR の URL}
```

  - false なら Draft のまま残し、完了の案内で「PR は Draft のまま。確認後に `gh pr ready {PR の URL}` で
    Ready にする」と伝える。**false のときに自分の判断で Ready にしない**
  - 失敗したら、Draft のままであることと再実行のコマンドを完了の案内でユーザーに伝える
- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers plan {cycle} --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える

この PR は速やかにマージすることを想定している。デフォルトブランチに入っていない情報は他サイクルから見えない。

- [ ] 完了後、以下を案内する

```
企画フェーズが完了しました。

設計フェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku:architect {cycle}
```
