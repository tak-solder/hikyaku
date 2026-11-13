---
name: close-cycle
description: "Hikyaku サイクル終了: 実装済みの成果を永続ドキュメントへ昇格させ、サイクルを closed にする。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{cycle}]"
---

# Hikyaku Close Cycle

全ビルドが完了したサイクルを締め、サイクルで得た知見を永続化する。足すだけでなく、
役に立たなかった記述や古くなった記述を消し、置き換える。

## なぜ独立したフェーズなのか

永続ドキュメントは「実装済みの現実（as-is）」を表す。サイクルドキュメントは
「これから作るもの（to-be）」を表す。この区別があるから、並行して走る別サイクルが
未実装の設計を「現実」として読んでしまう事故が防げる。

昇格は PR がマージされて初めて真になるので、実装が全部終わってから行う。

ただし `completed`（全ビルド完了）と `closed`（昇格完了）の間には危険な空白がある。
実装は main に入っているのに `overview` はまだ古い。この期間に他サイクルの architect が
走ると、古い `overview` を現実として信じる。だから CLOSE は速やかに実行する。

最終ビルドに混ぜないのは、builder のコンテキストが実装だけに集中できなくなるため。

## 誰が何を書くか

置き場は読み込まれ方で選ぶ（基準は [persistence.md](references/persistence.md)）。書く人は置き場で決まる。

| 置き場 | 書く人 |
|---|---|
| コード（lint・テスト・ヘルパー・その場のコメント）、パス指定の rule | builder（見つけたビルドの PR）。後続のビルドに間に合わせるため |
| 永続ドキュメント（overview / decisions / constraints / conventions / glossary） | close-cycle だけ。ADR の追記は architect |
| `{HIKYAKU_ROOT}/instructions.md`、スキル | close-cycle だけ |
| フック | close-cycle が別のブランチの PR にする |
| 見積もりのガイド（`token-guide/guide.md`） | `/hikyaku:token-guide`。乖離が大きいサイクルでは close-cycle が呼ぶ |

永続ドキュメントと `instructions.md` を close-cycle だけが書くのは、走行中の他サイクルの
planner / architect が読むため。フェーズ途中で書き換えると前提が途中で変わる。

あなたは追加だけでなく、削除と置き換えも提案できる。ただし範囲は、このサイクルの記録（handoff・
振り返り）に根拠があるものと、このサイクルのビルドが書いた rule に限る。根拠の無い記述の正否は、
このサイクルの知識では判断できない。

## 作業ステップ

### Step 0: 読み込みと完了確認

- [ ] 設定と document-guide を読み込む

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" context close {cycle}
```

`context` は昇格先の所在を返す。全文は読まない。読むのは、集めた候補が指す節だけ（collect の指示）。
末尾の「未作成」は昇格先の候補で、そこへ昇格させるなら新規作成になるため、昇格の承認で併せて承認を得る。

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

ここから先の手順（候補の収集 → 整理と G10 → 書き込み → サイクルの終了 → PR → 別の PR にするもの）は、
`step next` が設定と進捗から1手ずつ返す。**手順を自分で組み立てない。**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next close {cycle}
```

返った1手（directive）の種類ごとに動く。報告のコマンドは directive の「報告」にあるものを使う。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら `done` を報告する |
| `gate` | 「指示」のファイルを読み、ユーザーに提示して承認を求める。承認されたら `approved`、フィードバックなら `rejected` を報告する。どちらも `--input` にユーザーの答えを添える。`rejected` のあとは答えを反映し、`step next` に従って提示し直す |
| `done` | 手順をすべて終えた。下の「完了の案内」へ |
| `stop` | メッセージをユーザーに伝えて終了する |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 成果物や完了の条件、報告に添える値（`--pr`）は CLI が確かめ、足りなければ報告を受け付けない。
  メッセージに従って直す。報告を通すために成果物を空で作ったり、別のステップとして報告したりしない
- 再開したとき、候補が会話の中に無ければ、`hikyaku promotions {cycle}` を実行し直す。候補はスクリプトで
  再現できるので、`collect` を報告し直す必要はない
- 報告したら、成果物（永続ドキュメント・rule・スキルの変更）とサイクルのディレクトリ直下の
  `cycles/{cycle}/progress.jsonl` をコミット & push する。pr の指示にコミットの時機の定めがあれば、そちらに従う
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る

### 完了の案内

`done` が返ったら、次を案内する。

```
サイクル {cycle} を closed にしました。

（別の PR を作った場合）
見積もりのガイドの見直し: {PR の URL}
フックの提案: {PR の URL}
どちらも、採るかはマージで決めてください。

次のサイクルを開始するには:
/hikyaku:create-cycle <slug>
```

見送ったもの（未マージの token-guide の PR がある等）や、失敗したものがあれば、理由と一緒に伝える。
