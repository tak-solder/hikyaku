# ワークフロー

```
/hikyaku:init            → ワークスペースを初期化（リポジトリにつき1回）
      ↓
/hikyaku:create-cycle    → サイクルを作成し profile を選択
      ↓
/hikyaku:planner         → planning/ を生成
      ↓
/hikyaku:architect       → design/ + tasklist.md + build-NN/issue.md を生成
      ↓
/hikyaku:builder         → build-01 を実装 → PR
/hikyaku:builder         → build-02 を実装 → PR   （依存が無ければ並行実行可）
      ↓
/hikyaku:close-cycle     → 永続ドキュメントへ昇格し、サイクルを closed に
```

各フェーズは別のセッションが担当します。情報の引き継ぎはすべてファイル経由で、前のセッションの会話履歴は要りません。

| フェーズ | 決めること | 成果物 |
|---|---|---|
| [PLAN](plan.md) | 何を作るか | `planning/user-stories.md`, `planning/questions.md` |
| [ARCHITECT](architect.md) | どう作るか、どう割るか | `design/`, `tasklist.md`, `build-{NN}/issue.md` |
| [BUILD](build.md) | 実装 | コード, `plan.md`, `test-spec.md`, `handoff.md` |
| [CLOSE](close.md) | 何を残すか | 永続ドキュメントの更新, `cycles.md` の更新 |

## どこから始めるか

`init` と `create-cycle` は明示的に制御したいときの入口です。省略して `/hikyaku:planner` から始めれば、未初期化なら init を、サイクルが無ければ create-cycle を planner が代行します。実質の最短経路は4フェーズです。

逆に `create-cycle` から始めた場合も、そのまま PLAN へ続けられます（既定は続ける）。その場合はブランチと PR を PLAN のものに畳むので、PR は増えません。

## サイクルの指定は任意

スキルにサイクルを渡すのは任意です。

```
/hikyaku:builder 002-billing
/hikyaku:builder 002-billing 3    ← buildID まで指定する
/hikyaku:builder                  ← 省略する
```

省略した場合は 現在のブランチ → `.hikyaku.local` の記録 → 進行中サイクルが1つだけならそれ、の順に決まります。決まらなければ候補を挙げて尋ねます。詳細は [複数サイクルの並行運用](../operations/multi-cycle.md)。

HIKYAKU_ROOT は渡しません。`.hikyaku.config` から解決されます。

## PR のリズム

すべてのフェーズが PR を作ります。デフォルトブランチに入っていない情報は、他のサイクルからも次のフェーズからも見えないためです。

PLAN / ARCHITECT / CLOSE の PR はドキュメントのみで、速やかにマージすることを想定しています。とくに ARCHITECT の PR は、`tasklist.md` が main に無いと builder が依存ビルドの完了を判定できないため、放置すると後続が止まります。

BUILD の PR にはコードと `tasklist.md` の `PR` 列の更新が同梱されます。この同梱があるから、main 上で `PR` 列が埋まっていること自体が「マージ済み = 完了」を意味します。

## ブランチ

各フェーズは作業前に `hikyaku branch verify` で現在のブランチを確認します。命名は次の構造で固定です。

```
{prefix}{separator}{cycle}{separator}{phase}
例: hikyaku/002-billing/build-01
```

着手状態の導出にブランチ名を解析するため、構造は変えられません（`prefix` と `separator` のみ設定可能）。

不一致だったときの扱いはスクリプトではなくスキルが決めます。デフォルトブランチに居るならまだブランチを切っていないだけなので、期待する名前で作成します。別の作業ブランチに居る場合はユーザーに尋ねます。実行環境がブランチ名を決めている場合（クラウド版の Claude Code など）と、別の作業のブランチに紛れ込んでいる場合は、セッションの中からは区別できないためです。

規則から外れたブランチで作業した場合に失うのは `next` の「着手中」表示だけです。完了判定（`PR` 列）と中断検出（成果物の有無）には影響しません。

## 承認とレビュー

どこで手が止まるかはプロファイルによって変わります。全体像は [プロファイル](../configuration/profiles.md) に、レビューを担うエージェントの一覧は [内部スキルとエージェント](../reference/agents-and-skills.md) にあります。

どのプロファイルでも省略されない承認は4つです。要件の合意（PLAN）、tasklist と issue の変更、plan と test-spec の承認（いずれも BUILD）、永続ドキュメント昇格の承認（CLOSE）。
