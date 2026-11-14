# ディレクトリとファイル

```
リポジトリルート/
├── .hikyaku.config            # 振る舞いの設定（必須）。ドキュメントの所在は含まない
├── AGENTS.md                  # 永続ドキュメントの索引ブロックが埋め込まれる
├── .claude/
│   ├── rules/                 # パス指定の rule（builder がビルドの PR で書く）
│   └── skills/                # このリポジトリのスキル（close-cycle が作る）
├── docs/                      # 永続ドキュメント（所在はリポジトリ規約に従う）
│   ├── overview.md
│   ├── constraints.md
│   └── adr/
└── docs/hikyaku/              # HIKYAKU_ROOT
    ├── document-guide.md      # 永続ドキュメントの所在を宣言（必須）
    ├── cycles.md              # サイクル索引（必須）
    ├── instructions.md        # ワークフロー独自の指示（任意）
    ├── token-guide/           # 予測ピークの見積もりのガイド（任意。無ければ標準のガイド）
    │   ├── guide.md           #   ガイド。先頭に版とハッシュ
    │   └── progress.jsonl     #   token-guide の手順の進捗
    ├── .hikyaku.local         # 最後に作業したサイクル（git 管理対象外）
    ├── .gitignore             # .hikyaku.local の1行だけ
    ├── progress.jsonl         # init の手順の進捗
    ├── patches/               # サイクルに属さない patch の記録（patch prune で古い月を消せる）
    │   └── {YYYYMM}/{slug}/
    │       └── progress.jsonl #   patch の手順の進捗
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
| `token-guide/guide.md` | 予測ピークの見積もりのガイド。標準のガイドを置き換える（任意。無ければ標準） | token-guide |
| `.hikyaku.local` | このチェックアウトで最後に作業したサイクル | `cycle use` |
| `.gitignore` | `.hikyaku.local` の1行だけ | init |
| `progress.jsonl` | init の手順の進捗。`token-guide/progress.jsonl` は token-guide の手順の進捗 | `hikyaku step report` |

`.gitignore` に包括パターンを書かないでください。close-cycle は別セッションで `handoff.md` と `retrospective.md` から候補を集めるため、まとめて除外すると読めなくなります。

`instructions.md` はインストラクションの優先順位で SKILL.md より上位にあり、スキルの挙動を上書きするための正規の場所です。走行中の他サイクルも読むため、サイクルの中で書き換えるのは close-cycle だけです（サイクルに属さない patch は、コードと同じ PR で直します）。

`token-guide/guide.md` を書き換えるのは `/hikyaku:token-guide` だけです。乖離が大きいサイクルでは close-cycle がこのスキルを呼び、変更は別のブランチの PR になります。ガイドはワークスペース全体の見積もりに効き、走行中のほかのサイクルの残りのビルドも補正後の版で見積もられます。各予測には見積もりに使った版が残るので、比較は版ごとに分けられます。構成と補正の手順は [予測ピークと見積もりのガイド](../configuration/token-guide.md) にあります。

## サイクルディレクトリ

```
cycles/{NNN}-{slug}/
├── .hikyaku.config           # このサイクルだけの上書き（任意）
├── planning/
│   ├── intake.md             # patch から引き継いだサイクルのみ（依頼・調べたこと・合意したこと）
│   ├── questions.md          # 質問が発生した場合のみ
│   ├── user-stories.md
│   ├── progress.jsonl        # planner の手順の進捗
│   └── retrospective.md      # 振り返り（永続化すること / 役に立たなかった記述）
├── design/
│   ├── codebase-survey.md    # 既存コードがある場合
│   ├── design-questions.md   # 質問が発生した場合のみ
│   ├── design-delta.md
│   ├── progress.jsonl        # 手順の進捗（architect と build-manager の記録）
│   └── retrospective.md
├── tasklist.md
`progress.jsonl` は、フェーズの手順がどこまで進んだかの記録です。置き場所はフェーズで決まり、PLAN は `planning/`、ARCHITECT は `design/`、BUILD は `build-{NN}/`、CLOSE と create-cycle はサイクルのディレクトリ直下、init は HIKYAKU_ROOT 直下、token-guide は `token-guide/` です。CLOSE がサイクルの直下なのは、成果物がサイクルの外にあり、フェーズ専用のディレクトリを持たないためです。build-manager と振り返り（retrospective）の記録は、呼び出し元のフェーズと同じファイルに入ります。`hikyaku step report` が1手ごとに1行を追記し、成果物と一緒にコミットされます。現在地そのものは保存されず、`hikyaku step next` がこの記録と成果物から毎回導き直します。別のセッションや別のマシンから再開しても、同じ続きが返るのはこのためです。手で編集すると読めなくなるので、記録を直すときも `step report` を使います。
├── return.md                 # architect への差し戻し中のみ（差し戻し元のビルドのブランチだけにある）
├── patches/{YYYYMM}/{slug}/  # このサイクルに属す patch
│   ├── progress.jsonl        # patch の手順の進捗
│   └── handoff.md            # 永続化すること（あるときだけ。close-cycle が昇格させる）
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

`handoff.md` と `retrospective.md` は、close-cycle が永続化の候補を集める元になります。どちらもコミット対象です。サイクルに属す patch の `handoff.md` も同じく候補の元になります。

`patches/{YYYYMM}/{slug}/` は [patch](../workflow/patch.md) の作業単位です。サイクルに属さない patch は HIKYAKU_ROOT の下に、進行中のサイクルに属す patch はそのサイクルのディレクトリの下に置きます。依頼・合意・検証結果は PR の本文にあり、ここに残るのは手順の記録と、サイクルに属す patch の `handoff.md` だけです。

`progress.jsonl` は、フェーズの手順がどこまで進んだかの記録です。置き場所はフェーズで決まり、PLAN は `planning/`、ARCHITECT は `design/`、BUILD は `build-{NN}/`、CLOSE と create-cycle はサイクルのディレクトリ直下、init は HIKYAKU_ROOT 直下、token-guide は `token-guide/` です。CLOSE がサイクルの直下なのは、成果物がサイクルの外にあり、フェーズ専用のディレクトリを持たないためです。build-manager と振り返り（retrospective）の記録は、呼び出し元のフェーズと同じファイルに入ります。`hikyaku step report` が1手ごとに1行を追記し、成果物と一緒にコミットされます。現在地そのものは保存されず、`hikyaku step next` がこの記録と成果物から毎回導き直します。別のセッションや別のマシンから再開しても、同じ続きが返るのはこのためです。手で編集すると読めなくなるので、記録を直すときも `step report` を使います。

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
| `予測ピーク` | architect 段階で見積もった、そのビルドのメインセッションのコンテキストのピーク（例: `380k`） |
| `dependencies` | 依存する buildID。依存が満たされた = そのビルドの `PR` 列が非空 |
| `issue` | `issue.md` へのリンク。外部へ投影したらその参照で置き換わる |
| `PR` | 非空であることが完了を意味する |

`status` 列はありません。持たせると「status は done だが PR 列は空」という嘘の状態を作れてしまいます。

依存グラフの Mermaid 表現が本文に併記され、`dependencies` 列から常に同じ内容になるようスクリプトが再生成します。グラフは推移的簡約をかけて描かれ、他の依存を経由して到達できる線（`b01 → b02 → b03` があるときの `b01 → b03`）は省かれます。`dependencies` 列は直接の依存をそのまま持ち、着手可否の判定と handoff の参照もこの列を使います。ノードは `PR` 列から決まる状態で色分けされます。`PR` 列が埋まったビルドは紫（完了）、依存するビルドがすべて完了していて着手できるものは緑（着手可能）、先行ビルドに未完了があるものはグレー（待機中）です。先行ビルドが未完了の依存線は点線になるため、まだ待っている依存だけが目立ちます。色は `hikyaku tasklist done` で `PR` 列を埋めるたびに再生成され、そのビルドの PR に含まれるので、マージと同時に切り替わります。循環依存の検証もスクリプトが行い、検出された場合は書き込まれません。

buildID の採番は `max(既存) + 1` で、リナンバリングは行いません。ディレクトリ名はゼロ埋め2桁です（buildID 3 → `build-03`）。

## ブランチ

```
{prefix}{separator}{cycle}{separator}{phase}
```

| フェーズ | 例 |
|---|---|
| `init` | `hikyaku/init`（サイクルに属さない） |
| `token-guide` | `hikyaku/token-guide`（サイクルに属さない） |
| `create` | `hikyaku/002-billing/create` |
| `plan` | `hikyaku/002-billing/plan` |
| `architect` | `hikyaku/002-billing/architect` |
| `build-NN` | `hikyaku/002-billing/build-01` |
| `close` | `hikyaku/002-billing/close` |
| `patch-YYYYMM-slug` | `hikyaku/patch/202611/list-sort`（サイクルの有無に関わらずこの形） |

patch はサイクルより先に `patch{separator}` で見分けます。サイクル名は数字で始まるので重なりません。年月をブランチ名に含めるのは、ブランチ名から記録の場所（`patches/{YYYYMM}/{slug}/`）を一意に導くためです。

フェーズは閉じた集合です。これがブランチ名の解析を成立させています（prefix を前から、フェーズを後ろから剥がせばサイクルが残るので、slug がハイフンを含んでいても破綻しません）。
