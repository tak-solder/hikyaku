---
name: architect
description: "Hikyaku 設計フェーズ: 企画成果物と既存コードを入力に、このサイクルの設計差分（design-delta）とビルド分割を出力する。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{cycle}] [build-{NN} | add {指摘}]"
---

# Hikyaku Architect

対象サイクルの設計フェーズ（ARCHITECT）を実行する。

```
/hikyaku:planner       → planning/ を生成（完了済み）
/hikyaku:architect     → design/ + tasklist.md + build-NN/issue.md  ← あなたはここ
/hikyaku:builder       → build-NN を実装 → PR
/hikyaku:close-cycle   → 永続ドキュメントへ昇格
```

## あなたの役割

企画フェーズの成果物を入力とし、「どう作るか」を決める。

### 最も重要な制約: 永続ドキュメントを書き換えない

永続ドキュメント（overview / decisions / constraints / conventions 等）は
「実装済みの現実（as-is）」を表す。あなたが作るのは「これから作るもの（to-be）」で、
それは `design-delta.md` に書く。

この区別があるから、並行して走る別サイクルが未実装の設計を現実として読む事故が防げる。
昇格は実装が全部終わってから close-cycle が行う。

**ADR（decisions）だけが例外。** 決定した時点で記録するのが ADR 本来の思想なので、
あなたが `status: accepted`（決定済み・未実装）で追記する。`implemented` への更新は
close-cycle が行う。並行サイクルはこの status を見て「決まっているが、まだ動いていない」と
判別できる。

### 守る原則: ビルドのマージで本番データを壊さない

各ビルドは、PR をマージした時点で既存機能に影響せず、本番でどんな操作が起きても
データが壊れたり不整合を起こしたりしない単位に分ける。本番データの破壊は取り返しがつかない。

ビルドの大きさの都合などでやむを得ずこの原則を外す（安全でない分割）のは、`config --json` の
`unsafeSplit.allowed` が true のときだけ。これは、サイクルが `[data_integrity] allow_unsafe_split`
を宣言していて、かつ base_branch がリリースされるブランチでない（まだ本番に出ない）ことを
CLI が確かめた結果。自分で base_branch の名前から判断しない。分割の判断は build-manager が行う。

やらないこと:
- 企画内容の変更（スコープ・優先度の変更は企画フェーズに差し戻す）
- 実装コード・テストコードの記述
- ADR 以外の永続ドキュメントへの書き込み

## 通常の設計以外の起動

次の2つも手順は `step next` が返す。同じ `design/` で手順を回し直すので、Step 0 の中で `step restart` で
回を区切ってから始める。ブランチ・入力・区切り方は、それぞれの準備の手順に従う。

- `$ARGUMENTS[1]` に `build-{NN}` が指定された場合、または `cycle status` が `building（差し戻し中: build-NN）`
  を返した場合: 差し戻しからの再設計。`${CLAUDE_PLUGIN_ROOT}/skills/architect/references/return.md`
  （[return.md](references/return.md)）に従う
- `$ARGUMENTS[1]` が `add` の場合: 指摘からの追加設計。`add` に続く引数の残り（改行以降も含む）が、
  対応する指摘の内容。`${CLAUDE_PLUGIN_ROOT}/skills/architect/references/add.md`（[add.md](references/add.md)）に従う

## 作業ステップ

### Step 0: 設定の解決と入力の読み込み

- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/architect/references/templates.md`: 各種テンプレート（必須）
- [ ] 設定と対象サイクルを解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --require-cycle --json
```

`$ARGUMENTS[0]` のサイクルを渡す。省略時は CLI が現在のブランチ → `.hikyaku.local` →
唯一の進行中サイクルの順で決め、決まらなければ候補を添えてエラーになる。そのときは推測せず
ユーザーに尋ねて（ask: cycle）指定し直す（別サイクルへコミットする事故になる）。HIKYAKU_ROOT は
`.hikyaku.config` から解決されるので、引数では受け取らない。

出力の `cycle` と `cycleSource` を、作業対象としてユーザーに1行で示す。
`unsafeSplit.allowed` が true なら、その `message` も1行で示す（このサイクルでは原則を外せることを、
分割の前にユーザーが知っておくため）。

- [ ] 対象サイクルを記録する（次回から尋ねられずに済む）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle use {cycle}
```

- [ ] 企画成果物を読み込む（必須）
  - `cycles/{cycle}/planning/user-stories.md`
  - `cycles/{cycle}/planning/questions.md`（存在する場合）

いずれも無ければ `/hikyaku:planner` を先に実行するよう案内して終了する。

- [ ] 読むべきドキュメントの候補を取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" context architect {cycle}
```

概要欄を見て、今回のスコープに関係するものだけを読む。`context` が返すのは候補と理由までで、
絞るのはあなたの仕事。

- `overview` は既存コードの差分調査（`survey`）の基準になる。未作成なら差分ではなく全体を調査する
- `decisions` は採用理由とトレードオフを把握する。覆す場合は ADR の追記（`adr`）で新エントリとして記録し、既存エントリは書き換えない

`repo` 管理のドキュメントは既存形式が正。参考として読むが、形式には手を出さない。
永続ドキュメントがコードと矛盾したら常にコードを正とする（勝手に直さず、codebase-survey.md に記録する）。

- [ ] ブランチを作成し、命名規則どおりか確認する（差し戻しからの再設計・指摘からの追加設計では、
  それぞれの手順のブランチの決め方に従う）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify architect {cycle}
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

ユーザーが 2 か 3 を選んだら、`next` の「着手中」検出が効かなくなることを伝える
（ブランチ名から導出しているため）。ブランチを決めたら、成果物をコミットする直前にもう一度
この確認を行う。

- [ ] サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

ブランチを決めてから実行する（成果物の有無は作業ツリーで判定するため、デフォルトブランチの
ままでは push 済みの成果物が見えない）。中断からの再開なら、表示された位置から再開する。

`building（差し戻し中: build-NN）` と表示されたら、上の「通常の設計以外の起動」の差し戻しからの再設計に進む。

- [ ] 差し戻しからの再設計・指摘からの追加設計なら、それぞれの準備の手順に従って回を区切る（`step restart`）
- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title architect {cycle}
```

返った名前をセッション名に設定する。設定する手段が無い環境と、「変更しません」と返った場合はスキップする。

→ Step 1 へ。

### Step 1 以降: step に従って進める

ここから先の手順（並行サイクルの確認 → 既存コードの調査 → G2 → 質問 → 設計案 → G3 → ADR →
design-delta → レビュー → G4 → ビルド分割 → 検証 → 振り返り → PR）は、`step next` が設定と進捗から
1手ずつ返す。**手順を自分で組み立てない。** どのレビューやゲートが有効か、並行サイクルの確認が
要るかは step が決める。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next architect {cycle}
```

返った1手（directive）の種類ごとに動く。報告のコマンドは directive の「報告」にあるものを使う。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら `done` を報告する |
| `gate` | 「指示」のファイルを読み、ユーザーに提示して承認を求める。承認されたら `approved`、フィードバックなら `rejected` を報告する。どちらも `--input` にユーザーの答えを添える。`rejected` のあとは指示ファイルの戻り方に従い、無ければ答えを反映して `step next` に従って提示し直す |
| `call` | 「指示」のファイルを読み、「呼ぶスキル」を呼び出す。「呼ばれたスキルの手順」があれば、呼ばれたスキルはそのコマンドから始める。呼ばれたスキルが手順を終えて戻ったら、指示ファイルの「戻ったら」に従って `done` を報告する。呼ばれたスキルが `stop` で止まったら報告せず、そのメッセージを伝えて止まる |
| `done` | 手順をすべて終えた。下の「完了の案内」へ |
| `stop` | メッセージをユーザーに伝えて終了する |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 成果物や完了の条件（tasklist.md のビルド、`return.md` の削除など）、報告に添える値（`--pr`）は CLI が確かめ、
  足りなければ報告を受け付けない。メッセージに従って直す。報告を通すために成果物を空で作ったり、
  別のステップとして報告したりしない
- `skipped` は、指示ファイルがスキップを指示する場合だけ。理由を `--reason` に書く
- 前のステップに戻るとき（G4 のフィードバックで質問に戻る、など）は、戻る先のステップを `done` で
  報告し直す。そこから後ろはやり直しになる。承認したあとの成果物の変更は Git の履歴で追い、
  取り直すと決めたときも同じく報告し直す
- 再開したとき、前のステップで会話の中に作った成果（trade-off表と推奨案、レビューの指摘と対処など）が
  手元に無ければ、そのステップを `done` で報告し直してやり直す
- 報告したら、成果物と `cycles/{cycle}/design/progress.jsonl`（build-manager の記録も同じファイルに入る）を
  コミット & push する。指示ファイルにコミット・push の時機の定めがあれば（resolve-return / pr）、そちらに従う
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る

### 完了の案内

`done` が返ったら、次に着手できるビルドを案内する。差し戻しからの再設計では、差し戻し元のビルド
（`/hikyaku:builder {cycle} {NN}`）を案内する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

```
設計フェーズが完了しました。

BUILDフェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku:builder {cycle} {buildID}

依存関係のないビルドは並行して進められます。
```
