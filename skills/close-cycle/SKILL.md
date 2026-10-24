---
name: close-cycle
description: "Hikyaku サイクル終了: 実装済みの成果を永続ドキュメントへ昇格させ、サイクルを closed にする。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{cycle}]"
---

# Hikyaku Close Cycle

全ビルドが完了したサイクルを締め、サイクルの成果を永続ドキュメントへ昇格させる。

## なぜ独立したフェーズなのか

永続ドキュメントは「実装済みの現実（as-is）」を表す。サイクルドキュメントは
「これから作るもの（to-be）」を表す。この区別があるから、並行して走る別サイクルが
未実装の設計を「現実」として読んでしまう事故が防げる。

昇格は PR がマージされて初めて真になるので、実装が全部終わってから行う。

ただし `completed`（全ビルド完了）と `closed`（昇格完了）の間には危険な空白がある。
実装は main に入っているのに `overview` はまだ古い。この期間に他サイクルの architect が
走ると、古い `overview` を現実として信じる。だから CLOSE は速やかに実行する。

最終ビルドに混ぜないのは、builder のコンテキストが実装だけに集中できなくなるため。

## あなたは永続ドキュメントを書ける唯一のスキル

| スキル | 永続ドキュメント |
|---|---|
| planner | ✗ |
| architect | ADR の追記のみ（決定した時点で記録するのが ADR 本来の思想） |
| builder | ✗ |
| close-cycle | ✓（唯一） |

`{HIKYAKU_ROOT}/instructions.md` も同じ扱いで、書き換えるのは close-cycle だけ。
永続ドキュメントではないが、走行中の他サイクルの planner / architect が読むため、
フェーズ途中で書き換えると前提が途中で変わる。

## 作業ステップ

### Step 0: 読み込みと完了確認

- [ ] 設定と document-guide を読み込む

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" context close {cycle}
```

`context` は昇格先の所在と、素材（全ビルドの `handoff.md` / `design-delta.md`）を
まとめて返す。末尾の「未作成」は昇格先の候補で、そこへ昇格させるなら新規作成に
なるため、昇格の承認で併せて承認を得る。

HIKYAKU_ROOT は `.hikyaku.config` から解決されるので、引数では受け取らない。
`$ARGUMENTS[0]` でサイクルが指定されていなければ、現在のブランチ → `.hikyaku.local`
→ 唯一の進行中サイクル の順で決まる。決められないときはユーザーに尋ねる（ask: cycle）。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle use {cycle}
```

- [ ] ブランチを作成し、命名規則どおりか確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify close {cycle}
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

- [ ] 対象サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

`completed` でない場合はユーザーに確認する（ask: abandon）。未完了のビルドを残したまま締めるのは、
サイクルを中止（abandoned）する場合に限る。中止すると答えたら、サイクルの終了で
`--status abandoned` を付ける。

ブランチを決めたあとに実行する。成果物の有無は作業ツリーを見て判定するため、
デフォルトブランチに居るまま実行すると、別セッションが push 済みの成果物が見えない。
中断からの再開なのに最初からやり直すことになる。

- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title close {cycle}
```

返ってきた名前をセッション名に設定する。設定する手段が無い環境ではスキップしてよい。

→ Step 1 へ。

### Step 1 以降: step に従って進める

ここから先の手順（振り返り → 素材の収集 → 昇格候補の整理 → G10 → 書き込み → サイクルの終了 → PR）は、
`step next` が設定と進捗から1手ずつ返す。**手順を自分で組み立てない。** 振り返りを行うかは
step が `retrospective` の設定から決める。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next close {cycle}
```

返った1手（directive）の種類ごとに動く。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら「報告」のコマンドを実行する |
| `gate` | 「指示」のファイルを読み、ユーザーに提示して承認を求める。答えを `approved` / `rejected` で報告する |
| `call` | 「呼ぶスキル」を呼び出す。戻ったら「報告」のコマンドを実行する |
| `done` | 手順をすべて終えた。下の「完了の案内」へ |
| `stop` | メッセージをユーザーに伝えて終了する |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 報告を受け付けないとき（成果物が無い、現在地と違うステップ）はエラーになる。メッセージに従って直す。
  報告を通すために成果物を作ったり、別のステップとして報告したりしない
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る
- 進捗はサイクルのディレクトリ直下の `cycles/{cycle}/progress.jsonl` に記録される。
  永続ドキュメントの変更と一緒にコミットする

### 完了の案内

`done` が返ったら、次を案内する。

```
サイクル {cycle} を closed にしました。

次のサイクルを開始するには:
/hikyaku:create-cycle <slug>
```
