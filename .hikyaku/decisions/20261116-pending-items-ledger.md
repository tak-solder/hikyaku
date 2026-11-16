---
status: accepted
---

# 未決事項と決定の記録を、作業単位ごとの追記型ファイル decisions.jsonl に置く

- **決定**: 作業単位（`planning/`・`design/`・`build-NN/`・サイクル直下・`patches/{YYYYMM}/{slug}/`）ごとに `decisions.jsonl` を置き、CLI（`ledger open / decide / object / list / show / premises`）だけが追記する。レコードは `open`（`question` / `provisional` / `objection` / `risk`）と `decide`（`decided` / `consented` / `rejected` / `resolved`）の2種類。「いつ」は `now` / `phase:` / `gate:` / `merge` / `close` だけを受け付け、参照先（ゲート ID・ビルド ID）が実在するかも検査する。「誰が」は `user` / `ai:<phase>` / `supervisor`。決まったかは最新の `decide` から導き、状態を表す列は持たない。`decide` のレコードは、事項のあるファイルではなく、決めた作業単位のファイルに追記する（前のフェーズの事項に、並行するビルドがそれぞれ決定を足しても、同じファイルへの追記にならない）。事項と決定は ID で結び、状態はサイクルの全ファイルを読んで導く。`who` を変えるレコードは無く、`who=user` の事項はユーザー以外が決められない。conductor の子の中では、`ledger decide --by user` に、`conductor launch --from user` が設定する `HIKYAKU_ANSWER_FROM=user` を要し、launch は handler がユーザーの問いに `--from supervisor` を弾く（Clean 案から取り込み）。`ledger decide` は、子の中では `HIKYAKU_ANSWER_FROM` の値を決定のレコードに残す。異議の記録も progress.jsonl ではなくここに置く
- **文脈**: US-19 で、後で決める事項をいつ・誰が決めるかとともに記録し、その時が来たらスクリプトが示す。異議と決定（US-1.6）と事後同意の一覧（US-20）もこの記録に載る
- **外の前提**: なし
- **検討した案**:
  - Minimal: progress.jsonl に `kind` 付きの行を足し、読み手で分ける
  - Clean: 作業単位ごとの `ledger.jsonl`。参照先の実在の検査と、答えの出どころを環境変数で縛る
  - Pragmatic: 上記の決定
- **推奨**: Pragmatic（「いつ」の参照先の実在の検査と、答えの出どころの検査は Clean から取り込む）
- **採用理由**: progress.jsonl を「位置だけで中身を含まない記録」のまま残せる（US-16 のフィードバックの書き出しがこれに頼る）。作業単位ごとで、決定も決めた作業単位のファイルに書くので、並行するビルドの追記がマージで衝突しない
- **受け入れたこと**:
  - まだマージされていない並行ビルドの事項は、マージまで見えない（conductor の待ちだけは origin のブランチから読む）
  - 対話のセッションで答えたのが本当にユーザーかは、既存のゲートの `--input` と同じく機械では確かめない
  - conductor の子での出どころの検査（`HIKYAKU_ANSWER_FROM`）は、取り違えを防ぐもので、偽装は防げない。子はシェルを実行できるので、環境変数を自分で付ければ `--by user` の決定を記録できる。ユーザーが見て気づけるように、最後の PR の本文に、同意・退けの決定を答えの出どころとともに載せる
- **トレードオフ**: 作業単位の数だけファイルが増え、ユーザーがまとめて読むには `ledger list` を通す
- **再評価条件**: サイクルをまたぐ未決（ADR の再評価条件など、Q12 でスコープ外にしたもの）を扱うとき。並行ビルドどうしで事項を即時に見せる必要が出たとき
- **退けた推奨で失う利点**: なし（推奨どおり採用）
- **影響範囲**: `scripts/lib/ledger.mts`・`scripts/commands/ledger.mts`（新規）、`scripts/lib/progress.mts`（JSONL の読み書きの共有）、`scripts/lib/steps/directive.mts`（`notices`）、`scripts/commands/cycle.mts`、記録する側の各スキル、`skills/navigator/SKILL.md`、`skills/conductor/references/headless-protocol.md`
