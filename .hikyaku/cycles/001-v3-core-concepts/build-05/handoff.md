# Build 05: 宣言の変更の見直し・記録のテンプレート・ポインタの検査 申し送り

## 後続ビルドが前提にすること

- `領域` の書式はここで決めた: `- **領域**: \`<glob>\`, \`<glob>\``（バッククォートで囲んだ glob をカンマ区切りで1行）。ADR は1ファイルに1行で最後の欄、constraints は `##` の項目ごとに1行。build-10 の `areas dormant` はこの行を読む。読み取りの関数はまだ無い（`premises.mts` の `parseAcceptedSection` と同じく、コードブロックの中は読まない形にそろえる）
- 宣言の差分（`declarationChanges`）は、`--changed-from` を省くと `effectiveDeclaration(config).baselines` の commit を基準にし、HEAD（コミット済み）の宣言と比べる。作業ツリーの未コミットの変更は数えない。基準を1つも読めない・どこかの宣言を読めないときは、宣言されている参照をすべて変わったものとして扱う（`uncertain`）
- 「受け入れ」の定義: 記録では、`premises` を持つ risk のうち最新の決定が rejected / resolved でないもの（未決も含む）と、最新の決定が consented の objection。build-06 の事後同意の risk も、この定義でそのまま拾われる
- `pr` の args（planner / architect / builder / close-cycle / patch）の `declarationChanged` は、`step next`・Stop フック・`step where` の `directiveOf` で pr が現在のステップのとき毎回評価される（git の show を基準の数だけ）。テストで pr の args を呼ぶときは、`config.repoRoot` を渡す（無いと git の呼び出しで落ちる。`tests/step-consent.test.mts` は `/nonexistent` を渡した）
- conductor の最後の PR（conductor ブランチ→ベースブランチ）の本文に宣言の変更を載せる手順は、このビルドでは足していない（design-delta 1節にはあるが、issue.md のスコープは各フェーズの pr）。build-07 が最後の PR の本文を組み立てるときに、`ledger premises --format pr` を載せる
- `validate` は `options: ["base"]` を宣言したので、知らないオプションをエラーにするようになった
- `validate` の ID の範囲の警告は、永続ドキュメント（glossary を除く）と、進行中のサイクル（引数があればそのサイクル）の .md が対象。このサイクルの文書（design-delta.md の「US-15.1〜15.3」など）にも警告が出る

## 残したこと

なし

## 永続化すること

- `conventions` [中]: 「スクリプト」に、宣言の変更と拠り所の照合は `premises.mts` が唯一の正で、「受け入れたこと」の行の書式（1件1行、行末の `（拠り所: \`<参照>\`）`）を変えるときはテンプレート（ADR・constraints）と `parseAcceptedSection` を同じ PR で直すことを足す（テンプレートと解析が食い違うと、見直しの対象が黙って落ちる。plan-review の指摘）
