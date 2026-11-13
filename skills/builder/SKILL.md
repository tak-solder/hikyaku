---
name: builder
description: "Hikyaku 実装フェーズ: 1ビルド = 1セッションでコード実装から PR 作成までを完結させる。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{cycle}] [{buildID}]"
---

# Hikyaku Builder

対象ビルドの実装フェーズ（BUILD）を実行する。1ビルド = 1セッションで完結させる。

```
/hikyaku:architect     → design/ + tasklist.md + build-NN/issue.md（完了済み）
/hikyaku:builder       → build-NN を実装 → PR  ← あなたはここ
/hikyaku:close-cycle   → 永続ドキュメントへ昇格
```

## あなたの役割

対象ビルドを実装し、PR を作成する。

### 最も重要な制約: 永続ドキュメントを書き換えない

永続ドキュメント（overview / constraints / learnings / decisions 等）を書けるのは
close-cycle だけ。あなたは読むだけで、一切書き換えない。

実装中に設計とのズレや新たに判明した制約があれば、`handoff.md` に記録する。
close-cycle がそれを素材として昇格させる。

これにより、あなたのコンテキストは実装だけに集中できる。

### 守る原則: マージした時点で本番データを壊さない

このビルドの PR をマージした時点で、既存機能に影響せず、本番でどんな操作が起きても
データが壊れたり不整合を起こしたりしない実装にする。本番データの破壊は取り返しがつかない。

例外は、issue.md に「マージ時点で残る危険」の節があるビルドだけ。architect がやむを得ず
安全でない分割を選び、G6 で承認されている。そのときも、節に書かれた範囲を超える危険は残さない。

節に無い危険を残さないと実装できないと分かったら、自分で緩めない。下の「architect への差し戻し」
に従って確認する。

## 作業ステップ

### Step 0: 設定の解決と対象ビルドの決定

- [ ] 設定と対象サイクルを解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

`$ARGUMENTS[0]` のサイクルを渡す。省略時は CLI が現在のブランチ → `.hikyaku.local` →
唯一の進行中サイクルの順で決め、決まらなければ候補を添えてエラーになる。そのときは推測せず
ユーザーに尋ねて（ask: cycle）指定し直す（別サイクルへコミットする事故になる）。HIKYAKU_ROOT は
`.hikyaku.config` から解決されるので、引数では受け取らない。

出力の `cycle` と `cycleSource` を、作業対象としてユーザーに1行で示す。
以降のゲートとレビューの有無は、出力の `gates` / `reviews` で決める。

- [ ] 対象サイクルを記録する（次回から尋ねられずに済む）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle use {cycle}
```

- [ ] 対象ビルドを決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

`$ARGUMENTS[1]` で buildID が指定されていればそれを使う。省略された場合、
`next` が返した着手可能なビルドから選ぶ。

`next` は、依存ビルドの成果が `HEAD` の履歴に在るか（`HEAD` の tasklist.md の `PR` 列）で
判定する。デフォルトブランチ経由でマージされていても、先行ビルドのブランチから積んで
（スタックして）いても着手できる。判定はいま居るブランチで変わるので、Step 2 でブランチを
決めたあとにもう一度確認する。待機中と表示されたビルドには着手しない。

依存関係がないビルドは並行実行できる。`next` が「着手中」と表示したビルドは、
他セッションが作業している可能性がある。選ぶ前にユーザーに確認する（ask: build-select）。待機中の行に
`ブランチあり` が付いているものも同様（他セッションが積んで作業している可能性）。

→ Step 1 へ。

### Step 1: コンテキスト復元

- [ ] 読むべきドキュメントの候補を取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" context build-{NN} {cycle}
```

返るものは3層に分かれている。どの層の話をしているかを意識して読む。

| 層 | 何を表すか |
|---|---|
| 永続 | 実装済みの現実（他サイクルの成果も含む） |
| サイクル | このサイクルが作ろうとしている差分 |
| ビルド | 同一サイクル内の先行ビルドの実績（依存ビルドの `handoff.md`） |

依存ビルドの `handoff.md` は `context` が tasklist.md の依存グラフから辿る。
自分で辿らない。直接依存する分だけが返るので、全ビルド分を読むことにはならない。

- [ ] 概要欄を見て、今回のビルドに関係するものだけを読む
  - `issue.md`（対象ビルドの定義）と `design-delta.md` は必ず読む
  - `decisions` は採用理由とトレードオフを把握し、実装中に判断を覆さない
  - 覆す必要が生じた場合は、覆した ADR・理由・影響範囲を `handoff.md` に記録する
    （ADR 自体の更新は close-cycle が行う。あなたは永続ドキュメントを書き換えない）
  - 設計どおりでは要件を満たせないと分かった場合は、自分で設計を変えない。
    下の「architect への差し戻し」に従う

→ Step 2 へ。

### Step 2: ブランチとセッション名

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify build-{NN} {cycle}
```

出力の `ok` と `onBaseBranch` で分岐する。自分で決めず、この表に従う。

| 状況 | 対応 |
|---|---|
| `ok: true` | そのまま続ける |
| `ok: false` かつ `onBaseBranch: true` | `expected` の名前でブランチを作成して続ける |
| `ok: false` かつ `onBaseBranch` が `false` / `null` | ユーザーに尋ねる（下記）（ask: branch） |

3つ目は、現在のブランチが実行環境に割り当てられたものだと分かっていても、**自分で決めずに
必ず尋ねる。** セッションの中からは、別の作業のブランチに紛れ込んだ状態と区別できない。
尋ねる手段（`AskUserQuestion` など）で次の3つを、どれが妥当かの示唆を添えずに提示する。

1. Hikyaku の規則に従う — `expected` の名前でブランチを作成する
2. 現在のブランチで作業する
3. 別のブランチを指定する

ユーザーが 2 か 3 を選んだら、`next` の「着手中」検出と `pr base` のスタック元の導出が
効かなくなることを伝える（どちらもブランチ名から導出しているため）。

出力の `stackedOn` が非 null なら、先行フェーズのブランチの上に積んでいる。PR のマージ先は
そのブランチになる（pr。正は `pr base` で、`stackedOn` は目安）。

ブランチを作成したら早めに push する（ブランチの存在が「着手中」の印になる）。ブランチを
決めたら、成果物をコミットする直前にもう一度この確認を行う。

- [ ] `cycle status` で既存の成果物を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

ブランチを決めてから実行する（成果物の有無は作業ツリーで判定するため、デフォルトブランチの
ままでは push 済みの成果物が見えない）。中断からの再開なら、表示された位置から既存の成果物を
読み込んで再開する。

`building（差し戻し中: build-NN）` と表示されたら、作業を始めずに止まる。このブランチは
architect に差し戻されて再設計中なので、表示された再開コマンド（`/hikyaku:architect {cycle} build-NN`）を
案内して終了する。

- [ ] ブランチを決めたあと、対象ビルドが着手可能かを確認し直す

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

切り替えた先で待機中になったなら着手しない（デフォルトブランチへ移った場合など）。

- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title build-{NN} {cycle}
```

返った名前をセッション名に設定する。設定する手段が無い環境と、「変更しません」と返った場合はスキップする。

`--build-title` にビルドのタイトルを渡すと、セッション名にビルド名まで入る。

→ Step 3 へ。

### Step 3 以降: step に従って進める

ここから先の手順（plan → レビュー → G8 → 実装 → 検証 → コードレビュー → handoff → 振り返り → PR）は、
`step next` が設定と進捗から1手ずつ返す。**手順を自分で組み立てない。** どのレビューが有効か、
どのゲートがあるかは step が決める。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next build-{NN} {cycle}
```

返った1手（directive）の種類ごとに動く。報告のコマンドは directive の「報告」にあるものを使う。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら `done` を報告する |
| `gate` | 「指示」のファイルを読み、ユーザーに提示して承認を求める。承認されたら `approved`、フィードバックなら `rejected` を報告する。どちらも `--input` にユーザーの答えを添える。`rejected` のあとは答えを反映し、`step next` に従って提示し直す |
| `call` | 「指示」のファイルを読み、「呼ぶスキル」を呼び出す。「呼ばれたスキルの手順」があれば、呼ばれたスキルはそのコマンドから始める。呼ばれたスキルが手順を終えて戻ったら、指示ファイルの「戻ったら」に従って `done` を報告する。呼ばれたスキルが `stop` で止まったら報告せず、そのメッセージを伝えて止まる |
| `done` | 手順をすべて終えた。下の「完了の案内」へ |
| `stop` | メッセージをユーザーに伝えて終了する |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 成果物や完了の条件（PR 列など）、報告に添える値（`--peak` / `--pr`）は CLI が確かめ、足りなければ
  報告を受け付けない。メッセージに従って直す。報告を通すために成果物を空で作ったり、別のステップと
  して報告したりしない
- `skipped` は、指示ファイルがスキップを指示する場合だけ。理由を `--reason` に書く
- 承認したあとの成果物の変更は Git の履歴で追う。承認を取り直すと決めたら（スコープが変わって plan.md を
  直したときなど）、作り直したステップを `done` で報告し直す。そこから後ろはやり直しになる
- 再開したとき、前のステップで会話の中に作った成果（提示する案・指摘の統合など）が手元に無ければ、
  そのステップを `done` で報告し直してやり直す
- 報告したら、成果物と `cycles/{cycle}/build-{NN}/progress.jsonl` をコミット & push する。
  指示ファイルにコミット・push の時機の定めがあれば（implement / verify / review / retrospective / pr）、そちらに従う
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る
- `context` が付いた1手は、コンテキストの区切り（G8・実装開始前・レビュー前）。目安を超えていても
  止まらず、継続するか分割するかを自分で判断する。継続するなら、次のゲートの報告でそのことを伝える
  （詳しくは各ステップの指示）

### doc-reviewer の起動（plan-review / test-spec-review）

起動方法は設定で決まる。指示ファイルの `--context` と渡す情報を使う。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve doc build-{NN} {cycle} --self claude --json
```

`mode: agent` ならサブエージェントとして起動する。`mode: process` なら次を実行し、返った本文を
レビュー結果として扱う。終了コード 1 は失敗で、指摘0件として扱わずユーザーに報告する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run doc build-{NN} {cycle} --self claude --context {context} --files <渡す情報のパスをカンマ区切りで>
```

明確な不整合・網羅漏れは反映する。主観的な指摘は無視してよい。

### 完了の案内

`done` が返ったら、次の状況を案内する。`overruns` があれば、まだ伝えていない超過もここで伝える。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

全ビルドが完了していれば、close-cycle を案内する。

```
Build {NN} が完了しました。

（未完了のビルドがある場合）
次のビルドを開始するには、新しいセッションで:
/hikyaku:builder {cycle} {次のbuildID}

（全ビルドが完了した場合）
サイクルを締めるには、新しいセッションで:
/hikyaku:close-cycle {cycle}

実装は完了していますが、永続ドキュメントへの昇格がまだです。
この状態が続くと、他サイクルが古い overview を「実装済みの現実」として
読んでしまいます。速やかに実行してください。
```

このビルドに依存する後続ビルドを始める経路は2つある。

1. この PR をマージしてから、デフォルトブランチで始める（既定）
2. このブランチから積んで始める（スタック）。マージを待たずに進められるが、
   後続ビルドの PR のマージ先はこのブランチになり、この PR が先にマージされるまで
   後続はマージできない

どちらでも `next` は着手可能と判定する（判定は `HEAD` の履歴に成果が在るかで行うため）。

---

## ビルド管理（実装中のスコープ変更）

実装中に以下が判明した場合、`/hikyaku:build-manager {cycle}` を呼び出す。見積もり直した予測ピークによる分割の
検討は、step が `call` として返す。build-manager は `step next build-{NN} {cycle} --skill build-manager`
から始め、このビルドの progress.jsonl に記録する。前回の build-manager の呼び出しのあと builder が
何も報告していないうちに呼び直すときは「呼び直し」と伝え、build-manager が
`step restart build-{NN} {cycle} --skill build-manager` で区切ってから始める。

- 実装中 — 想定外の複雑さや未定義の依存 → ビルドの追加・更新
- コードレビュー時 — 指摘の「新ビルド化して後で対応」 → 新ビルドの追加
- handoff 作成時 — 意図的に先送りした作業 → 新ビルドの追加

呼び出し後の対応:
- 現在のビルドのスコープが変わった場合: plan.md を修正して `tokens estimate` で見積もり直し、`plan` を
  `done` で報告し直す（`--peak` に見積もり直した予測ピーク）。そこから後ろはやり直しになり、G8 の承認も取り直す
- 新ビルドが追加されただけの場合: 現在の作業を続行する

## architect への差し戻し（設計の前提が崩れたとき）

設計どおりに作ると要件を満たせない、設計の前提が実際のコードと食い違って判断が変わる、
issue.md のスコープどおりではマージ時点で本番データの安全を保てない、と分かったときは、
自分で設計を変えずに `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/return.md`
（[return.md](references/return.md)）の手順に従う。

## PRレビュー指摘への対応

PR 作成後にレビュー指摘への対応を頼まれたときは、`${CLAUDE_PLUGIN_ROOT}/skills/builder/references/pr-feedback.md`
（[pr-feedback.md](references/pr-feedback.md)）の手順に従う。
