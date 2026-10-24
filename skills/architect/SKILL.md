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

永続ドキュメント（overview / constraints / learnings / conventions 等）は
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

BP の都合などでやむを得ずこの原則を外す（安全でない分割）のは、`config --json` の
`unsafeSplit.allowed` が true のときだけ。これは、サイクルが `[data_integrity] allow_unsafe_split`
を宣言していて、かつ base_branch がリリースされるブランチでない（まだ本番に出ない）ことを
CLI が確かめた結果。自分で base_branch の名前から判断しない。分割の判断は build-manager が行う。

やらないこと:
- 企画内容の変更（スコープ・優先度の変更は企画フェーズに差し戻す）
- 実装コード・テストコードの記述
- ADR 以外の永続ドキュメントへの書き込み

## 通常の設計以外の起動

次の2つは `step next` を使わない（差し戻し中は `step next` が止まり、追加設計では通常の設計の
記録が完了済みとして残っているため）。Step 0 のあと、それぞれの手順に従って `steps/` の指示ファイルを
順に読んで進める。

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
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

HIKYAKU_ROOT は `.hikyaku.config` から解決されるので、引数では受け取らない。

`$ARGUMENTS[0]` でサイクルが指定されていればそれを渡す。省略された場合は
現在のブランチ → `.hikyaku.local` → 唯一の進行中サイクルの順で決まる。
決められないときは進行中サイクルの一覧を添えてエラーになるので、ユーザーに尋ねてから（ask: cycle）
指定し直す。推測して進めない（別サイクルへコミットする事故になる）。

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

概要欄を見て、今回のスコープに関係するものだけを読む。全部読む必要はない。
概要欄があるのはそのためで、パスだけでは全部読むしかなくなる。
`context` が返すのは候補と理由までで、絞るのはあなたの仕事。

- `overview` は既存コードの差分調査（`survey`）の基準になる。未作成なら差分ではなく全体を調査する
- `decisions` は採用理由とトレードオフを把握する。覆す場合は ADR の追記（`adr`）で新エントリとして記録し、既存エントリは書き換えない

`repo` 管理のドキュメントは既存形式が正。参考として読むが、形式には手を出さない。
`tech-stack` / `db-schema` / `interfaces` は俯瞰の手がかりとして読むが、
コードと矛盾したら常にコードを正とする（勝手に直さず、codebase-survey.md に記録する）。

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

3つ目はユーザーの判断であって、あなたの判断ではない。現在のブランチが実行環境に
割り当てられたものだと分かっていても、**自分で決めずに必ず尋ねる。**

実行環境が割り当てたブランチと、別の作業のブランチに紛れ込んだ状態は、セッションの中からは
区別できない。「今回は前者だから問題ない」という推測を一度でも通すと、後者もまったく
同じ理屈で通る。 それを防ぐための確認なので、確認を省いた時点で意味が無くなる。

尋ねる手段（`AskUserQuestion` など）があればそれを使い、次の3つを提示する。
**どれが妥当かの示唆を添えない。選ぶのはユーザー。**

1. Hikyaku の規則に従う — `expected` の名前でブランチを作成する
2. 現在のブランチで作業する
3. 別のブランチを指定する

ユーザーが 2 または 3 を選んだあとで、`next` の「着手中」検出が効かなくなることを
伝える（ブランチ名から導出しているため）。完了判定と中断検出には影響しない。

ブランチを決めたら、成果物をコミットする直前にもう一度この確認を行う。

- [ ] サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

ブランチを決めたあとに実行する。成果物の有無は作業ツリーを見て判定するため、
デフォルトブランチに居るまま実行すると、別セッションが push 済みの成果物が見えない。
中断からの再開なのに最初からやり直すことになる。

`building（差し戻し中: build-NN）` と表示されたら、上の「通常の設計以外の起動」の差し戻しからの再設計に進む。

- [ ] `cycles/{cycle}/design/` が無ければ作る（空のディレクトリは Git に残らないので、新しいブランチでは
  無いことがある。`step next` は作業単位のディレクトリが無いとエラーになる）
- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title architect {cycle}
```

返ってきた名前をセッション名に設定する。設定する手段が無い環境ではスキップしてよい。
`[session] title` が空文字なら「変更しません」と返るので、その場合もスキップする。

→ Step 1 へ。

### Step 1 以降: step に従って進める

ここから先の手順（並行サイクルの確認 → 既存コードの調査 → G2 → 質問 → 設計案 → G3 → ADR →
design-delta → レビュー → G4 → ビルド分割 → 検証 → 振り返り → PR）は、`step next` が設定と進捗から
1手ずつ返す。**手順を自分で組み立てない。** どのレビューやゲートが有効か、並行サイクルの確認が
要るかは step が決める。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next architect {cycle}
```

返った1手（directive）の種類ごとに動く。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら「報告」のコマンドを実行する |
| `gate` | 「指示」のファイルを読み、ユーザーに提示して承認を求める。答えを `approved` / `rejected` で報告する |
| `call` | 「呼ぶスキル」を呼び出す。「呼ばれたスキルの手順」があれば、呼ばれたスキルはそのコマンドから始める。戻ったら「報告」のコマンドを実行する |
| `done` | 手順をすべて終えた。下の「完了の案内」へ |
| `stop` | メッセージをユーザーに伝えて終了する |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 報告を受け付けないとき（成果物が無い、現在地と違うステップ）はエラーになる。メッセージに従って直す。
  報告を通すために成果物を空で作ったり、別のステップとして報告したりしない
- スキップできるのは、step がスキップを許すステップ（既存コードの調査、分岐する判断が無いときの設計案）だけ。
  理由は `--reason` で記録に残る
- 前のステップに戻るとき（G4 のフィードバックで質問に戻る、など）は、直した成果物のステップ
  （`design-delta` など）を `done` で報告し直す。そこから後ろはやり直しになる。成果物が残っている
  ステップより前を報告し直すと、step は記録の欠けとして止まる（各ステップの指示に戻り方がある）
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る
- 進捗は `cycles/{cycle}/design/progress.jsonl` に記録される（build-manager の記録も同じファイルに入る）。
  成果物と一緒にコミットする

### 完了の案内

`done` が返ったら、次に着手できるビルドを案内する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

```
設計フェーズが完了しました。

BUILDフェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku:builder {cycle} {buildID}

依存関係のないビルドは並行して進められます。
```
