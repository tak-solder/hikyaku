---
name: create-cycle
description: "Hikyaku サイクル作成: チケットを起点に新しいサイクルを採番し、profile を選択して cycles.md に登録する。"
user-invocable: true
disable-model-invocation: false
argument-hint: "[{slug}]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "2.0.0"
---

# Hikyaku Create Cycle

新しいサイクル（PLAN → ARCHITECT → BUILD → CLOSE の1周）を作成する。

**1サイクル = 1チケット**を想定している。バックログ管理は Hikyaku のスコープ外で、
チケットは外部システム（GitHub issue / Asana など）に残る。

## 作業ステップ

### Step 0: 前提の確認

- [ ] 設定を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config --json
```

未初期化（`document-guide.md` が無い）の場合は `/hikyaku:init` を案内して終了する。

- [ ] 進行中のサイクルを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle list --active
```

**`completed` のまま放置されているサイクルがあれば警告する**（ブロックはしない）。
実装は済んでいるのに永続ドキュメントへの昇格が終わっていない状態で、この期間に
他サイクルが古い `overview` を「実装済みの現実」として読む危険がある。

```
⚠ サイクル 001-user-auth が completed のまま残っています。
  実装は完了していますが、永続ドキュメントへの昇格がまだです。
  先に /hikyaku:close-cycle を実行することを推奨します。
```

→ Step 1 へ。

### Step 1: サイクルの定義

- [ ] **チケット**を確認する。ユーザーが提示していなければ尋ねる
  - チケット番号・URL、または「チケット無し」
- [ ] **slug** を決める（英数字とハイフン。例: `billing`, `user-auth`）
  - `$ARGUMENTS[0]` があればそれを使う
  - 無ければチケットの内容から提案し、確認を得る
- [ ] **一行要約**を書く（cycles.md の索引に載る）
- [ ] **サイクル間の依存**があれば特定する
  - 依存はサイクルレベルに留める。ビルドレベルのクロスサイクル依存は扱わない
    （依存グラフが2次元になって破綻するため）
  - 依存が満たされた = 依存先サイクルが `closed`

→ Step 2 へ。

### Step 2: profile の選択（必須）

**必ずユーザーに明示的に選ばせる。** config の `profile` は推奨値の提示にすぎず、
無条件には採用しない。毎回意識して選ぶことを担保するため。

```
このサイクルの profile を選択してください（.hikyaku.config の設定: standard）

  light     承認ゲート最小、レビューは有効。人間の時間を節約する
            → 小規模・低リスク。問題は PR レビューで拾う

  saving    承認は残し、レビューエージェントを起動しない。AI 実行コストを節約する
            → 自分で見るのでレビューは要らない、という場合

  standard  全レビュー有効、各フェーズで承認
            → 通常はこれ

  strict    codebase-survey の確認と plan 単独の承認を追加、validate を各ステップで実行
            → 影響範囲が大きい、慎重に進めたい
```

profile は**サイクルの属性**であり、作成時に決まって以後変わらない。

→ Step 3 へ。

### Step 3: 作成

- [ ] 差分を提示する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle new {slug} \
  --profile {profile} --ticket "{ticket}" --summary "{要約}" \
  --depends {依存サイクルID} --dry-run
```

- [ ] 内容を確認して実行する（`--dry-run` を外す）

スクリプトが採番し、ディレクトリを作り、cycles.md に追記する。
cycles.md には**作成時の Hikyaku バージョン**も記録される。ディレクトリ構造や
ファイル形式は作成時に決まるため、後からそれを解釈するのに必要になる。

→ Step 4 へ。

### Step 4: コミットと PR

- [ ] ブランチを作成する（`hikyaku branch name create {cycle}`）
- [ ] コミットして PR を作成する

**cycles.md がデフォルトブランチに入らないと、他サイクルからこのサイクルが見えない。**
並行サイクルの検出が機能しなくなるため、この PR は速やかにマージする。

**planner から代行された場合はこのステップを飛ばす。** 成果物が cycles.md の1行
だけなので、planner の PR に畳んだほうが PR 本数が減る。

- [ ] 完了後、次を案内する

```
サイクル {NNN}-{slug} を作成しました（profile: {profile}）。

企画フェーズを開始するには、新しいセッションで:
/hikyaku:planner {NNN}-{slug}
```
