# Build 03: 未決事項と決定の記録（ledger の中核） 申し送り

## 後続ビルドが前提にすること

- 期限の判定は `ledger.mts` の `timingOf` が唯一の正。build-06 の `pr-section`・`consent-list` は、これと `summarize` を呼ぶだけにする（定義を写さない）。design-delta に「過ぎた」の定義が無いので、次の振る舞いは AI が解釈で決めた（G8 で監督が承認。plan.md の「いつ」の期限）
  - どの判定も、事項の `at` より後の記録だけを見る（回の区切り）。記録した時点でゲート・フェーズがもう過ぎていれば「過ぎた」
  - `merge` の区切りは、ID `consent` のステップがあればそれ。無ければ、patch は `publish`、ほかは `pr`。build-06 は、同意ゲートの ID を `consent` にすれば区切りに乗る。「過ぎた」になるのは、build-NN がベースブランチへマージされたとき（`cycle status` が `merged` を渡す）だけ。plan・architect・patch・close の merge、および `step next` と `ledger list` では、決まるまで「来た」のまま示す
  - `phase:` は、記録した単位自身の記録を「後のフェーズの記録」に数えない
- 他の単位の現在のステップは、`cycleTimeline(config, cycle)` が engine で評価して入れる（評価に失敗した単位だけ記録から近似）。directive は自分の単位を自分の評価で上書きするが、内部スキル（build-manager・retrospective）の評価では上書きしない
- ID は `{unit}.{n}-{4桁の16進}`（例 `build-03.1-a3f9`）。`ledger open --json` の `record.id` をそのまま `decide` / `show` に渡す。スキルの指示文で ID を組み立てさせない。ただし、2つのブランチが同じ作業単位の `decisions.jsonl` に追記すると、行の追記どうしで git のマージは衝突する（ID の重なりを防ぐだけ）。決定は決めた単位に書くので、通常の並行ビルドでは起きない
- 付け替えの禁止は、G8 のあとで締めた。who=user はユーザーだけが決める（`--input` 必須）。それ以外は who と同じ決め手（`ai:<phase>` は同じフェーズ）か、ユーザーが決める。CLI の `--by ai:<phase>` は、決めた作業単位 `<phase>` と同じフェーズだけ（コードレビュー2回目の指摘。questions.md の Q2 で監督が受け入れ）。build-04 が「AI が別のフェーズの暫定判断を確定する」手順を作るなら、`--by user` で決めるか、事項の who をそのフェーズにして記録する
- `OpenRecord.step` は `ledger open` が自動で入れる（`directiveOf` と同じ判定。内部スキルの最中なら呼ばれた側のステップ）。build-04 の「そのステップの高の異議」と、build-06 の deferred の回の risk は、これと `ask` で引く
- `--ask` は `ASK_IDS` か、ゲートの ID（G1・P1・P2 は ASKS に無い）を受け付ける
- `DecideRecord.from` は欄だけがある（値を入れるのは build-07）
- 記録を読めないと、`step next` / `step report` は止めずに notices に「未決事項の記録を読めません」を1行出す。`cycle status --json` は `ledger.error` を返す。`ledger` のコマンドは止まる。Stop フック・`step where`・`conductor parse`（`directiveOf`）は `notices: false` で読まない
- `parseJsonl(text, source, isRecord, labels)` は文字列から読む。build-07 が origin のブランチの記録を `git show` で読むときに使える

## 残したこと

- コードレビュー1回目の #6 を不採用にした。plan・architect・patch・close の merge の事項は、マージを導けないので「過ぎた」にならない（決まるまで「来た」で示し続ける。G8 で承認した解釈のまま。questions.md の Q2）。マージを導く手段（ベースブランチの PR 列のような記録）がビルド以外の単位にもできたら、`mergeTiming` に足す
- 確度: 要確認 — 「過ぎた」の定義（上の「後続ビルドが前提にすること」）は design-delta に無い AI の解釈。最後の PR で、ユーザーがこの定義のままでよいかを判断する
- `step lint`・`conductor lint` は、このセッションの権限ではリポジトリのスクリプトを実行できず、回していない。このビルドはステップ定義も `（ask: …）` のタグも変えていない
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない）
- `docs/reference/directory-layout.md` で、`progress.jsonl` の段落がサイクルディレクトリのコードブロックの中に重複して入っていたので、取り除いた（plan に無い変更。同じ段落はブロックの後にある）

## 永続化すること

- `conventions` [中]: 「スクリプト」に、`decisions.jsonl` は `hikyaku ledger` だけが書き、期限の判定は `ledger.mts` の `timingOf` だけに置くこと、手順の位置だけを読む経路（`directiveOf`）は `notices: false` で記録を読まないことを足す（後続のビルドが別の判定を書くと、PR 本文・notices・status の期限が食い違う。plan-review とコードレビューの指摘）
- `decisions` [高]: ADR 20261116-pending-items-ledger に、ID の形（`{unit}.{n}-{4桁の16進}`。2つのブランチの採番が重ならないため）と、ai・supervisor の事項は who と同じ決め手かユーザーだけが決め、`--by ai:<phase>` は決めた作業単位と同じフェーズだけであることを足す（コードレビューの指摘、questions.md の Q2）
