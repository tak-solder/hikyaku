---
name: navigator
description: "Hikyaku 案内: 進行中のサイクルの状態を読み、次に実行するスキルを提案して、選ばれたものを起動する。どこから再開すればよいか分からないときの入口。"
user-invocable: true
disable-model-invocation: true
argument-hint: "[{cycle}]"
---

# Hikyaku Navigator

リポジトリの状態を読み、**次に何をすべきか**を提案する。ユーザーが選んだら、そのスキルを起動する。

```
/hikyaku:navigator     → 状態を読んで次の一手を提案する  ← あなたはここ
      ↓（ユーザーが選ぶ）
/hikyaku:init / create-cycle / planner / architect / builder / close-cycle / conductor
```

## 原則

- **状態は CLI から導く。** フェーズ・中断点・着手可能なビルドを自分で推測しない。
  `cycle list` / `cycle status` / `next` の JSON だけを根拠にする。ファイルを読み回って判定しない
- **読むだけ。** ファイルを書かない。コミットしない。ブランチを切り替えない。
  `cycle use` も実行しない（起動したスキルが自分で行う）
- **起動は選ばれてから。** 候補が1つしかなくても、ユーザーの確認なしに起動しない
- **人間の作業も「次の一手」に含める。** PR のマージ待ち・レビュー待ちのように、スキルでは進められない
  状態はそう伝える。無理にスキルを勧めない

## 作業ステップ

### Step 1: 状態を集める

- [ ] 進行中のサイクルを一覧する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle list --active --json
```

- `.hikyaku.config` が無いというエラーなら、ワークスペースが未初期化。Step 2 の「未初期化」へ
- `cycles` が空なら、Step 2 の「進行中のサイクルなし」へ

`$ARGUMENTS[0]` でサイクルが指定されていれば、以降はそのサイクルだけを見る。

- [ ] いま居る場所を確かめる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config --json
git branch --show-current
git status --porcelain
```

`config` の `cycle` / `cycleSource` が、このチェックアウトで作業中のサイクル（ブランチ名か
`.hikyaku.local` から決まる）。決められなければ `cycle` は無い。それで構わない。

- [ ] 各サイクルの詳細を取る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle} --json
```

`phase` が `building` で `returned` が `null` のときだけ、着手可能なビルドも取る。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle} --json
```

`cycle status` と `next` は origin の追跡参照を1本更新することがある。2回目以降は `--no-fetch` を付けてよい。

### Step 2: 次の一手を決める

サイクルごとに、次の表で決める。上から順に当てはめ、最初に当たった行を使う。

| 状態 | 次の一手 |
|---|---|
| 未初期化 | `/hikyaku:init` |
| 進行中のサイクルなし | 選択肢は「新しいサイクルを始める」だけになる |
| `planning` | `/hikyaku:planner {cycle}` |
| `architecting` | `/hikyaku:architect {cycle}`。ARCHITECT から最後のビルドまで任せたいなら `/hikyaku:conductor {cycle}` も候補 |
| `building` かつ `returned` あり | `cycle status` の `suggestion`（差し戻し元を指定した architect） |
| `building` かつ `resumeAt` が `build-NN/…` | 途中で止まったビルドの再開: `/hikyaku:builder {cycle} {NN}` |
| `building` かつ `next` の `available` が1件以上 | `/hikyaku:builder {cycle} {NN}`。複数あれば並行して進められる |
| `building` かつ `inProgress` のビルドのブランチに今居る | そのビルドの再開: `/hikyaku:builder {cycle} {NN}` |
| `building` かつ `available` が空で `inProgress` あり | 他のセッションが作業中の可能性。スキルは勧めず、そのブランチ名を伝える |
| `building` かつ `mergePending` のみ | PR のマージ待ち。人間の作業として伝える |
| `completed` | `/hikyaku:close-cycle {cycle}` |

補足:

- **`returned` は差し戻し元のビルドのブランチに居るときにしか見えない。** 別のブランチに居るなら、
  `cycle status` の `branches` にそのサイクルのブランチがあることだけを伝える
- `next` の `inProgress` は origin にブランチがあるビルドを並べるので、自分が居るブランチのビルドも
  含まれる。`git branch --show-current` と同じブランチのビルドは他のセッションではなく、このチェックアウトの作業
- `next` の `blockedWithBranch` にあるビルドは、他のセッションが積んで作業している可能性がある。着手可能と
  一緒に並べない
- `stacked` が `true` なら、依存ビルドがまだデフォルトブランチに入っていない。PR の base が
  スタック元になることを一言添える
- `git status --porcelain` が空でなければ、未コミットの変更があることを添える。どのスキルも
  成果物のコミットを前提に状態を導くため

### Step 3: 提案する

まず状態を短くまとめる。サイクルが複数あれば表にする。

```
| サイクル | フェーズ | ビルド | 次の一手 |
|---|---|---|---|
| 003-login ← 作業中 | building | 1/3 | build-02, build-03 に並行して着手できる |
| 004-export | completed | 2/2 | close-cycle で永続ドキュメントへ昇格する |
```

`ビルド` 列は `cycle list` の `progress` をそのまま使う。

続けて `AskUserQuestion` で選んでもらう。選択肢はサイクル単位にし、スキルやビルドを直接並べない。
細かい選択は、選ばれたあとで起動するスキルに任せる。

| 選択肢 | 説明欄に書くこと | 載せる条件 |
|---|---|---|
| `{cycle} を進める` | Step 2 で決めた次の一手（例: 「build-02 を再開する」「close-cycle で昇格する」） | 起動できる次の一手があるサイクルごとに1つ |
| 新しいサイクルを始める | planner で新しいサイクルを作って PLAN に入る。未初期化なら init から始めると書く | 常に |
| 各サイクルの進捗を詳しく確認する | サイクルごとの成果物と着手状況を表示する | 進行中のサイクルがあるとき |

`{cycle} を進める` の並べ方:

1. このチェックアウトで作業中のサイクル（`config` の `cycle`）を先頭にし、推奨として示す
2. 再開（`resumeAt` あり・差し戻し）があるサイクルを次に置く
3. 残りはサイクル番号の小さい順

選択肢は4つまでなので、`{cycle} を進める` は2つまで。収まらないサイクルは表にだけ載せ、
「その他」にサイクル名を書けば選べると添える。

次の一手が人の作業（マージ待ち・他のセッションが作業中）のサイクルは、表にだけ載せて選択肢にはしない。

### Step 4: 選ばれたものを実行する

**`{cycle} を進める`**: Step 2 で決めたスキルを、Skill ツールで引数ごと呼び出す
（例: skill `hikyaku:builder`、args `003 2`）。

- 再開・差し戻しのビルドは、ビルドを引数で指定する
- 着手可能なビルドが複数あるときは、ビルドを付けずに `/hikyaku:builder {cycle}` を起動する。
  builder がどのビルドに着手するかを尋ねる。並行して進めたい残りのビルドは、別のセッションで
  `/hikyaku:builder {cycle} {NN}` を実行するよう添える（1ビルド = 1セッションで進めるため）
- `architecting` は architect を起動する。ARCHITECT から最後のビルドまで任せる `/hikyaku:conductor {cycle}`
  もあることを一言添える

**新しいサイクルを始める**: `/hikyaku:planner` を引数なしで起動する（サイクルの作成も代行する）。
未初期化なら代わりに `/hikyaku:init` を起動する。

**各サイクルの進捗を詳しく確認する**: 各サイクルの `cycle status {cycle}` を `--json` なしで実行し、その出力を
そのまま見せる。building のサイクルは `next {cycle}` の出力も添える。見せたら Step 3 の
`AskUserQuestion` に戻る（この選択肢は外す）。

起動したあとは、そのスキルの手順に従う。navigator の役目はそこで終わる。
