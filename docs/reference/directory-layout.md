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
    ├── .hikyaku.local         # 最後に作業したサイクル（git 管理対象外）
    ├── .gitignore             # .hikyaku.local の1行だけ
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
| `.hikyaku.local` | このチェックアウトで最後に作業したサイクル | `cycle use` |
| `.gitignore` | `.hikyaku.local` の1行だけ | init |

`.gitignore` に包括パターンを書かないでください。close-cycle は別セッションで `retrospective.md` を昇格素材として読むため、まとめて除外すると読めなくなります。

`instructions.md` はインストラクションの優先順位で SKILL.md より上位にあり、スキルの挙動を上書きするための正規の場所です。走行中の他サイクルも読むため、書き換えるのは close-cycle だけです。

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
│   └── retrospective.md
├── tasklist.md
└── build-{NN}/
    ├── issue.md              # architect が作成
    ├── questions.md          # 質問が発生した場合のみ
    ├── plan.md
    ├── test-spec.md          # テスト対象があるビルドのみ
    ├── handoff.md
    └── retrospective.md
```

ディレクトリ名は `{NNN}-{slug}` です。slug は英数字とハイフンに正規化されます（ブランチ名の解析を壊さないため）。`closed` になったサイクルのディレクトリも残します。PR 履歴から辿れることに価値があるためです。

`handoff.md` と `retrospective.md` は close-cycle の昇格素材になります。どちらもコミット対象です。

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
| `create` | `hikyaku/002-billing/create` |
| `plan` | `hikyaku/002-billing/plan` |
| `architect` | `hikyaku/002-billing/architect` |
| `build-NN` | `hikyaku/002-billing/build-01` |
| `close` | `hikyaku/002-billing/close` |

フェーズは閉じた集合です。これがブランチ名の解析を成立させています（prefix を前から、フェーズを後ろから剥がせばサイクルが残るので、slug がハイフンを含んでいても破綻しません）。
