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
| 進行中のサイクルなし | `/hikyaku:planner`（サイクルの作成も代行する）。profile やブランチ規則を先に決めたいなら `/hikyaku:create-cycle` |
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

続けて、提案を `AskUserQuestion` で示す。並べ方は次のとおり。

1. **このチェックアウトで作業中のサイクル**（`config` の `cycle`）の次の一手を先頭にし、推奨として示す
2. 再開（`resumeAt` あり・差し戻し）を、新しい着手より先に置く
3. 残りはサイクル番号の小さい順に並べる

選択肢は4つまで。収まらない分は表にだけ載せ、「その他」で選べることを添える。人間の作業
（マージ待ち・他セッション作業中）は表にだけ載せ、選択肢には入れない。起動できるものが
1つも無ければ、`AskUserQuestion` を使わずに状態と待っている作業を伝えて**終了**する。

並行して進められるビルドが複数あるときは、ここで起動できるのは1つだけだと伝える。残りは
別のセッションで `/hikyaku:builder {cycle} {NN}` を実行するよう案内する。Hikyaku は
1ビルド = 1セッションで進めるため。

### Step 4: 起動する

- [ ] 選ばれたスキルを、Skill ツールで引数ごと呼び出す（例: skill `hikyaku:builder`、args `003 2`）

起動したあとは、そのスキルの手順に従う。navigator の役目はここで終わる。

「何もしない」が選ばれたら、表をそのまま残して終了する。
