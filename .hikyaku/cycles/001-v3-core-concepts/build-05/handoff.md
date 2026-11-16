# Build 05: 宣言の変更の見直し・記録のテンプレート・ポインタの検査 申し送り

## 後続ビルドが前提にすること

- `領域` の書式はここで決めた: `- **領域**: \`<glob>\`, \`<glob>\``（バッククォートで囲んだ glob をカンマ区切りで1行）。ADR は1ファイルに1行で最後の欄、constraints は `##` の項目ごとに1行。build-10 の `areas dormant` はこの行を読む。読み取りの関数はまだ無い（`premises.mts` の `parseAcceptedSection` と同じく、コードブロックの中は読まない形にそろえる）
- 宣言の差分（`declarationChanges`）は、`--changed-from` を省くと `effectiveDeclaration(config).baselines` の commit を基準にし、HEAD（コミット済み）の宣言と比べる。作業ツリーの未コミットの変更は数えない。基準を1つも読めない・どこかの宣言を読めないときは、宣言されている参照をすべて変わったものとして扱う（`uncertain`）
- 「受け入れ」の定義: 記録では、`premises` を持つ risk のうち最新の決定が rejected / resolved でないもの（未決も含む）と、最新の決定が consented の objection。build-06 の事後同意の risk も、この定義でそのまま拾われる
- patch は pr を実装の前に作るので、`declarationChanged` は `publish` の args に載せた（`publicationStep` の第3引数）。conductor の最後の PR の本文にも `ledger premises --format pr` を貼る手順を足した（コードレビュー1回目の指摘）
- `pr` の args（planner / architect / builder / close-cycle）と patch の `publish` の args の `declarationChanged` は、`step next`・Stop フック・`step where` の `directiveOf` で pr が現在のステップのとき毎回評価される（git の show を基準の数だけ）。ただし位置だけを読む経路（Stop フック・`step where`・conductor parse）では、`StepContext.positionOnly` を見て git を呼ばずに `{}` を返す（コードレビュー2回目の指摘で足した欄。重い args を足すときも同じく見る）。テストで pr の args を呼ぶときは、`config.repoRoot` を渡す（無いと git の呼び出しで落ちる。`tests/step-consent.test.mts` は `/nonexistent` を渡した）
- コードレビュー1回目で不採用にした指摘（理由つき）:
  - 「ローカルの main が origin/main より古いと、上流でマージ済みの宣言の変更も変わったと出る」: 基準を origin とローカルの両方で読み、差分の和を取るのは build-02 の基準の読み方に合わせた判断。見直しの対象が増える向き（偽陽性）にしか外れず、落とす向きには外れない
  - 「サイクルの途中のビルドで変えた宣言が、後続のビルドや close-cycle の PR でも毎回出る」: 基準はユーザーがマージした宣言（ベースブランチ）で、スタック元や conductor ブランチはユーザーのマージを経ていないので基準にしない（ADR risk-ceiling-table）。ユーザーがベースブランチへマージするまで、見直しの対象として出し続けるのが意図どおり
  - 「基準を1つも読めないと、宣言されている参照がすべて変わったものとして毎回出る」（2回目）: G8 で承認した、見直しを落とさない側に倒す判断のまま。notices に理由（origin/HEAD が無い等）を出す
  - 「サイクルに属さない patch の decisions.jsonl を読まない」（2回目）: `ledger` はサイクルに属さない patch の記録を扱わない（`ledger open` がエラーにする）ので、読む記録が無い
  - 「重複した名前・名前の無い [[app.areas]] の変更を見落とす」（2回目）: 設定の読み込み（`readAppDeclaration`）が名前の重複と欠けをエラーにする
  - 「decisions のサブディレクトリの ADR を読まない」（2回目）: `hikyaku` 管理の ADR は1判断1ファイルで直下に置く形。test-spec でも直下だけを読むと決めた。`repo` 管理でサブディレクトリに分けたリポジトリが出たら、`documentFiles` を再帰にする
  - 「基準の読み取りが risk.mts の `readBaselineAt` と重複する」（1回目・2回目）: 一部だけ採った（`APP_KEYS` は ledger.mts から読み、area はキーの順に依らない比較にした）。risk.mts は正規化した `AppDeclaration` を返すが、差分は area ごとの生の表で比べたいので、読み取りは分けたままにした
- `validate` は `options: ["base"]` を宣言したので、知らないオプションをエラーにするようになった
- `validate` の ID の範囲の警告は、永続ドキュメント（glossary を除く）と、進行中のサイクル（引数があればそのサイクル）の .md が対象。このサイクルの文書（design-delta.md の「US-15.1〜15.3」など）にも警告が出る

## 残したこと

なし

## 永続化すること

- `conventions` [中]: 「スクリプト」に、宣言の変更と拠り所の照合は `premises.mts` が唯一の正で、「受け入れたこと」の行の書式（1件1行、行末の `（拠り所: \`<参照>\`）`）を変えるときはテンプレート（ADR・constraints）と `parseAcceptedSection` を同じ PR で直すことを足す（テンプレートと解析が食い違うと、見直しの対象が黙って落ちる。plan-review の指摘）
