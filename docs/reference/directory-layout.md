# ディレクトリとファイル

```
リポジトリルート/
├── .hikyaku.config            # 振る舞いの設定（必須）。ドキュメントの所在は含まない
├── AGENTS.md                  # 永続ドキュメントの索引ブロックが埋め込まれる
├── docs/                      # 永続ドキュメント（所在はリポジトリ規約に従う）
│   ├── overview.md
│   ├── constraints.md
│   ├── learnings.md
│   └── adr/
└── docs/hikyaku/              # HIKYAKU_ROOT
    ├── document-guide.md      # 永続ドキュメントの所在を宣言（必須）
    ├── cycles.md              # サイクル索引（必須）
    ├── instructions.md        # ワークフロー独自の指示（任意）
    ├── bp-guide/              # BP の基準表（任意。無ければ既定値）
    │   ├── rules.toml         #   正本
    │   ├── README.md          #   人間向けの説明。表は rules.toml から生成
    │   ├── cases.toml         #   期待値テスト
    │   └── progress.jsonl     #   bp-guide の手順の進捗
    ├── .hikyaku.local         # 最後に作業したサイクル（git 管理対象外）
    ├── .gitignore             # .hikyaku.local の1行だけ
    ├── progress.jsonl         # init の手順の進捗
    └── cycles/
        ├── 001-user-auth/
        │   ├── .hikyaku.config  # このサイクルだけの上書き（任意）
        │   ├── planning/
        │   ├── design/
        │   ├── tasklist.md
        │   ├── build-01/
        │   └── build-02/
        └── 002-billing/
```

永続ドキュメントは HIKYAKU_ROOT の外にあり、リポジトリ側の規約に従った場所に置きます。所在は `document-guide.md` が宣言します。

## HIKYAKU_ROOT 直下

| ファイル | 役割 | 書き換えるのは |
|---|---|---|
| `document-guide.md` | 永続ドキュメントの所在と管理主体。無ければ Hikyaku は動かない | init / close-cycle |
| `cycles.md` | サイクル索引。並行サイクル検出の起点 | create-cycle / close-cycle |
| `instructions.md` | このリポジトリで Hikyaku を回すときの手順・前提（任意） | close-cycle |
| `bp-guide/` | BP の基準表。`rules.toml` が正本で、`README.md` の表と `cases.toml` の期待値がそれに従う（任意。無ければ既定値） | init / bp-guide |
| `.hikyaku.local` | このチェックアウトで最後に作業したサイクル | `cycle use` |
| `.gitignore` | `.hikyaku.local` の1行だけ | init |
| `progress.jsonl` | init の手順の進捗。`bp-guide/progress.jsonl` は bp-guide の手順の進捗 | `hikyaku step report` |

`.gitignore` に包括パターンを書かないでください。close-cycle は別セッションで `retrospective.md` を昇格素材として読むため、まとめて除外すると読めなくなります。

`instructions.md` はインストラクションの優先順位で SKILL.md より上位にあり、スキルの挙動を上書きするための正規の場所です。走行中の他サイクルも読むため、書き換えるのは close-cycle だけです。

`bp-guide/` も同じ理由でワークフローの外からだけ書き換えます。基準表はワークスペース全体の見積もりに効くため、サイクルの途中で動かすとそのサイクルの中で見積もりの比較が成立しなくなります。構成と調整の手順は [BP の基準表](../configuration/bp-guide.md) にあります。

## サイクルディレクトリ

```
cycles/{NNN}-{slug}/
├── .hikyaku.config           # このサイクルだけの上書き（任意）
├── planning/
│   ├── questions.md          # 質問が発生した場合のみ
│   ├── user-stories.md
│   └── retrospective.md
├── design/
│   ├── codebase-survey.md    # 既存コードがある場合
│   ├── design-questions.md   # 質問が発生した場合のみ
│   ├── design-delta.md
│   ├── progress.jsonl        # 手順の進捗（architect と build-manager の記録）
│   └── retrospective.md
├── tasklist.md
├── progress.jsonl            # create-cycle の手順の進捗
├── return.md                 # architect への差し戻し中のみ（差し戻し元のビルドのブランチだけにある）
└── build-{NN}/
    ├── issue.md              # architect が作成
    ├── questions.md          # 質問が発生した場合のみ
    ├── plan.md
    ├── test-spec.md          # テスト対象があるビルドのみ
    ├── handoff.md
    ├── progress.jsonl        # 手順の進捗（hikyaku step report が追記する）
    └── retrospective.md
```

ディレクトリ名は `{NNN}-{slug}` です。slug は英数字とハイフンに正規化されます（ブランチ名の解析を壊さないため）。`closed` になったサイクルのディレクトリも残します。PR 履歴から辿れることに価値があるためです。

`handoff.md` と `retrospective.md` は close-cycle の昇格素材になります。どちらもコミット対象です。

`progress.jsonl` は、フェーズの手順がどこまで進んだかの記録です。置き場所はフェーズで決まり、ARCHITECT は `design/`、BUILD は `build-{NN}/`、create-cycle はサイクルのディレクトリ直下、init は HIKYAKU_ROOT 直下、bp-guide は `bp-guide/` です。build-manager の記録は、呼び出し元のフェーズと同じファイルに入ります。`hikyaku step report` が1手ごとに1行を追記し、成果物と一緒にコミットされます。現在地そのものは保存されず、`hikyaku step next` がこの記録と成果物から毎回導き直します。別のセッションや別のマシンから再開しても、同じ続きが返るのはこのためです。手で編集すると読めなくなるので、記録を直すときも `step report` を使います。

`return.md` は、builder が architect に差し戻したときに書く記録です。差し戻し元のビルドのブランチにだけコミットされ、architect が再設計の最後に削除するので、デフォルトブランチには入りません。作業ツリーにこのファイルがあることが「差し戻し中」を意味し、1行目の見出し（`# 差し戻し: build-NN`）から差し戻し元のビルドが読まれます。

## cycles.md

| 列 | 意味 |
|---|---|
| `ID` | 3桁ゼロ埋めの採番 |
| `slug` | 英数字とハイフン。全履歴で一意ではない |
| `status` | `active` 進行中 / `closed` 昇格まで完了 / `abandoned` 中止 |
| `profile` | 作成時に選択したプロファイル。ここが唯一の正 |
| `hikyaku` | 作成時の Hikyaku バージョン。ディレクトリ構造の解釈に使う。以後更新しない |
| `チケット` | このサイクルの発端になった外部チケット（人が作ったもの） |
| `外部` | Hikyaku が投影した親 issue / 親タスク。可視化のためのビューで、判定には使わない |
| `依存` | 依存するサイクルの ID。依存が満たされた = そのサイクルが `closed` |
| `開始` / `完了` | 日付 |
| `要約` | 一行要約 |

列は並びではなく見出し名で読みます。列が増えても既存の `cycles.md` を読めなくなりません。

## tasklist.md

| 列 | 意味 |
|---|---|
| `buildID` | ビルドの識別番号。`build-{NN}` ディレクトリに対応する |
| `title` | ビルドのタイトル |
| `BP` | ビルドポイントの見積もり |
| `dependencies` | 依存する buildID。依存が満たされた = そのビルドの `PR` 列が非空 |
| `issue` | `issue.md` へのリンク。外部へ投影したらその参照で置き換わる |
| `PR` | 非空であることが完了を意味する |

`status` 列はありません。持たせると「status は done だが PR 列は空」という嘘の状態を作れてしまいます。

依存グラフの Mermaid 表現が本文に併記され、`dependencies` 列と常に一致するようスクリプトが再生成します。循環依存の検証もスクリプトが行い、検出された場合は書き込まれません。

buildID の採番は `max(既存) + 1` で、リナンバリングは行いません。ディレクトリ名はゼロ埋め2桁です（buildID 3 → `build-03`）。

## ブランチ

```
{prefix}{separator}{cycle}{separator}{phase}
```

| フェーズ | 例 |
|---|---|
| `init` | `hikyaku/init`（サイクルに属さない） |
| `bp-guide` | `hikyaku/bp-guide`（サイクルに属さない） |
| `create` | `hikyaku/002-billing/create` |
| `plan` | `hikyaku/002-billing/plan` |
| `architect` | `hikyaku/002-billing/architect` |
| `build-NN` | `hikyaku/002-billing/build-01` |
| `close` | `hikyaku/002-billing/close` |

フェーズは閉じた集合です。これがブランチ名の解析を成立させています（prefix を前から、フェーズを後ろから剥がせばサイクルが残るので、slug がハイフンを含んでいても破綻しません）。
