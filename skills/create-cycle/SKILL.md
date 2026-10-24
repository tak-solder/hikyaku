---
name: create-cycle
description: "Hikyaku サイクル作成: チケットを起点に新しいサイクルを採番し、profile と、ルート設定の ask に並んだキー（base_branch / ブランチ規則 / PR タイトル / セッション名 / 外部投影先）を決めて cycles.md に登録する。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{slug}]"
---

# Hikyaku Create Cycle

新しいサイクル（PLAN → ARCHITECT → BUILD → CLOSE の1周）を作成する。

1サイクル = 1チケットを想定している。バックログ管理は Hikyaku のスコープ外で、
チケットは外部システム（GitHub issue / Asana など）に残る。

## 作業ステップ

Step 0〜3 はサイクルを作るまでの準備で、ここに書いてある。サイクルを作ったあとの手順は
`step next` が1手ずつ返す（Step 4 以降）。進捗の記録はサイクルのディレクトリに置くので、
サイクルができるまでは step に乗せられない。

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

`completed` のまま放置されているサイクルがあれば警告する（ブロックはしない）。
実装は済んでいるのに永続ドキュメントへの昇格が終わっていない状態で、この期間に
他サイクルが古い `overview` を「実装済みの現実」として読む危険がある。

```
⚠ サイクル 001-user-auth が completed のまま残っています。
  実装は完了していますが、永続ドキュメントへの昇格がまだです。
  先に /hikyaku:close-cycle を実行することを推奨します。
```

→ Step 1 へ。

### Step 1: サイクルの定義

- [ ] チケットを確認する。ユーザーが提示していなければ尋ねる
  - チケット番号・URL、または「チケット無し」
- [ ] slug を決める（英数字とハイフン。例: `billing`, `user-auth`）
  - `$ARGUMENTS[0]` があればそれを使う
  - 無ければチケットの内容から提案し、確認を得る
- [ ] 一行要約を書く（cycles.md の索引に載る）
- [ ] サイクル間の依存があれば特定する
  - 依存はサイクルレベルに留める。ビルドレベルのクロスサイクル依存は扱わない
    （依存グラフが2次元になって破綻するため）
  - 依存が満たされた = 依存先サイクルが `closed`

→ Step 2 へ。

### Step 2: profile の選択（必須）

**必ずユーザーに明示的に選ばせる。** config の `profile` は推奨値の提示にすぎず、
無条件には採用しない。毎回意識して選ぶことを担保するため。

```
このサイクルの profile を選択してください（.hikyaku.config の設定: standard）

  express   承認は要件（user-stories）と plan + test-spec だけ。設計案は AI の推奨を採用する
            → 人間の時間を節約する。要件だけ握って先は任せたい場合

  economy   承認は残し、中間成果物のレビューエージェントを起動しない（コードレビューは残る）
            → 自分で見るのでレビューは要らない、という場合

  standard  全レビュー有効、各フェーズで承認
            → 通常はこれ

  thorough  codebase-survey の確認と plan 単独の承認を追加、validate を各ステップで実行
            → 影響範囲が大きい、慎重に進めたい
```

profile はサイクルの属性であり、作成時に決まって以後変わらない。

→ Step 3 へ。

### Step 3: 作成

- [ ] 差分を提示する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle new {slug} \
  --profile {profile} --ticket "{ticket}" --summary "{要約}" \
  --depends {依存サイクルID} --dry-run
```

- [ ] 出力の `askAtCreate` が空でなければ、そのキーをユーザーに尋ねる

ルート設定の `ask` に並んでいるキーは、このサイクルの値をここで決めるという
意味なので、勝手に既定で通さない。出力に各キーの既定値と対応するオプションが
並ぶので、1つずつ尋ねてから、オプションを付けて `--dry-run` をやり直す。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle new {slug} \
  --profile {profile} --ticket "{ticket}" --summary "{要約}" \
  --base-branch {回答} --external {回答} --external-repo {回答} --dry-run
```

尋ねるときは、出力の既定値をそのまま採る選択肢も必ず提示する。profile と同じで、
ルート設定の値は推奨の提示にすぎない。何を答えてもそのサイクルの `.hikyaku.config`
に記録され、以後そのサイクルの全フェーズで使われる。

`askAtCreate` が空なら、この確認は飛ばす。`ask` に並んでいないキーは、
サイクルごとに決めるものではない。

- [ ] 内容を確認して実行する（`--dry-run` を外す）

スクリプトが採番し、ディレクトリを作り、cycles.md に追記する。決めた値があれば
`{サイクル}/.hikyaku.config` も書き出す。
cycles.md には作成時の Hikyaku バージョンも記録される。ディレクトリ構造や
ファイル形式は作成時に決まるため、後からそれを解釈するのに必要になる。

- [ ] 作業サイクルとして記録する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle use {NNN}-{slug}
```

→ Step 4 へ。

### Step 4 以降: step に従って進める

planner から代行された場合は、step に乗せずにここで終える。既に PLAN の途中なので、
そのまま planner へ戻る（PLAN へ進むかの確認もしない）。

それ以外は、ここから先の手順（PLAN へ進むかの確認 → plan のブランチで planner へ、または
単独で PR）を、`step next` が進捗から1手ずつ返す。**手順を自分で組み立てない。**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next create {NNN}-{slug}
```

返った1手（directive）の種類ごとに動く。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら「報告」のコマンドを実行する |
| `done` | 手順をすべて終えた。PLAN へ続けた場合は指示どおり planner を呼ぶ。単独で終えた場合は下の「完了の案内」へ |
| `stop` | メッセージをユーザーに伝えて終了する |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 報告を受け付けないとき（現在地と違うステップ）はエラーになる。メッセージに従って直す
- スキップできるのは、step がスキップを許すステップだけ。理由は `--reason` で記録に残る
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る
- 進捗は `{HIKYAKU_ROOT}/cycles/{NNN}-{slug}/progress.jsonl` に記録される。cycles.md と一緒にコミットする

### 完了の案内

単独で終えた場合は、次を案内する。

```
サイクル {NNN}-{slug} を作成しました（profile: {profile}）。

企画フェーズを開始するには、新しいセッションで:
/hikyaku:planner {NNN}-{slug}
```
