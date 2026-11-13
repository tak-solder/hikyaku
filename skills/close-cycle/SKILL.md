---
name: close-cycle
description: "Hikyaku サイクル終了: 実装済みの成果を永続ドキュメントへ昇格させ、サイクルを closed にする。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{cycle}]"
---

# Hikyaku Close Cycle

全ビルドが完了したサイクルを締め、サイクルの成果を永続ドキュメントへ昇格させる。

## あなたの役割

永続ドキュメント（実装済みの現実）を書けるのは、このスキルだけ。architect は ADR を
`accepted` で追記するだけで、planner と builder は書かない。`{HIKYAKU_ROOT}/instructions.md` も
同じ扱いで、書き換えるのは close-cycle だけ（走行中の他サイクルが読むため）。

`completed`（全ビルド完了）のあいだは、実装が入っているのに `overview` が古く、他サイクルが
古い `overview` を現実として読む。だから CLOSE は速やかに終える。

予測ピークの見積もりのガイド（`{HIKYAKU_ROOT}/token-guide/guide.md`）は、close-cycle の昇格と
`/hikyaku:token-guide` が書き換える。ビルドの見積もりの中では書き換えない（build-manager / builder は読むだけ）。
走行中の他サイクルがあっても補正の昇格は止めない。補正した版はその後に見積もる全ビルドに効き、
各予測の表には見積もりに使ったガイドの版が残るので、補正の前と後は `tokens history --group-by guide` で
分けて比べられる。止めて待つより、早く補正したほうが以降の見積もりの精度が上がる。

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

`$ARGUMENTS[0]` のサイクルを渡す。省略時は CLI が現在のブランチ → `.hikyaku.local` →
唯一の進行中サイクルの順で決め、決まらなければエラーになる。そのときは推測せずユーザーに
尋ねる（ask: cycle）。HIKYAKU_ROOT は `.hikyaku.config` から解決されるので、引数では受け取らない。

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

3つ目は、現在のブランチが実行環境に割り当てられたものだと分かっていても、**自分で決めずに
必ず尋ねる。** セッションの中からは、別の作業のブランチに紛れ込んだ状態と区別できない。
尋ねる手段（`AskUserQuestion` など）で次の3つを、どれが妥当かの示唆を添えずに提示する。

1. Hikyaku の規則に従う — `expected` の名前でブランチを作成する
2. 現在のブランチで作業する
3. 別のブランチを指定する

ユーザーが 2 か 3 を選んだら、`next` の「着手中」検出が効かなくなることを伝える
（ブランチ名から導出しているため）。ブランチを決めたら、成果物をコミットする直前にもう一度
この確認を行う。

- [ ] 対象サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

ブランチを決めてから実行する（成果物の有無は作業ツリーで判定するため、デフォルトブランチの
ままでは push 済みの成果物が見えない）。

`completed` でない場合はユーザーに確認する（ask: abandon）。未完了のビルドを残したまま締めるのは、
サイクルを中止（abandoned）する場合に限る。中止すると答えたら、サイクルの終了で
`--status abandoned` を付ける。

- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title close {cycle}
```

返った名前をセッション名に設定する。設定する手段が無い環境と、「変更しません」と返った場合はスキップする。

→ Step 1 へ。

### Step 1 以降: step に従って進める

ここから先の手順（振り返り → 素材の収集 → 昇格候補の整理 → G10 → 書き込み → サイクルの終了 → PR）は、
`step next` が設定と進捗から1手ずつ返す。**手順を自分で組み立てない。** 振り返りを行うかは
step が `retrospective` の設定から決める。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next close {cycle}
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
- 成果物や完了の条件、報告に添える値（`--pr`）は CLI が確かめ、足りなければ報告を受け付けない。
  メッセージに従って直す。報告を通すために成果物を空で作ったり、別のステップとして報告したりしない
- 再開したとき、前のステップで会話の中に作った成果（集めた素材、昇格の候補）が手元に無ければ、
  `collect` を `done` で報告し直してやり直す（G10 の指示も参照）
- 報告したら、成果物（永続ドキュメントの変更、`close/retrospective.md`）とサイクルのディレクトリ直下の
  `cycles/{cycle}/progress.jsonl` をコミット & push する。pr の指示にコミットの時機の定めがあれば、そちらに従う
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る

### 完了の案内

`done` が返ったら、次を案内する。

```
サイクル {cycle} を closed にしました。

次のサイクルを開始するには:
/hikyaku:create-cycle <slug>
```
