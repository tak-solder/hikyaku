# Build 10: 知見の置き場の「なくす」と、rule を移すきっかけ・領域の開発頻度 申し送り

## 後続ビルドが前提にすること

- 基準の理由の解析は `promotions.mts` の `parseCriterionReasons` が唯一の入口。build-11 が「理由の欠けた基準」を文書から探すときも、この関数で行末の `（防ぐ: … / 立つ: … / 重要度: …）` を読む。欄が無ければ `reasons: undefined`、欄が崩れている（閉じていない・後ろに文字が続く・「立つ」が無い・重要度が高/中以外）ならエラーの文字列を返す。欄の区切りは、次の欄の名前（防ぐ・立つ・重要度）が続く `/` だけ（パスの `/` で切らない）
- rule の理由は `listRuleFiles` の `RuleFile.reasons`（`prevents` / `basis` / `importance`）と `problems` に入る。`importance: 高` の rule を試しに消す候補から外す判定（build-11）はこの値を見る
- 品質の指標は `review-records.mts` の `collectReviewRecords`（全サイクルの build-NN/handoff.md の「レビューの記録」）と `heavyCountByCycle` から取る。patch の handoff.md は読まない（patch の手順はまだ「レビューの記録」を書かない）
- `ruleCandidates` は、一致しない rule を閾値に関わらず `stale` の1行にする（`move` と重複させない）。`missing` は記録の rule のパスが `.claude/rules/` に無いもの（先頭の `./` はそろえて比べる）
- glob の意味は rule と同じ `matchesRule` にそろえた。`lastTouched` には glob を渡さず、追跡ファイルを JS で絞ってから `:(literal)` で渡す（git の pathspec では `*.md` や `{a,b}` の意味が変わる）。`[diff] exclude` に当たる生成物は日数に数えない
- `rules candidates` と `areas dormant` は `openCycleIfAny` で設定を読む（任意の `<cycle>`・`--no-cycle`）。サイクル設定の `[rules]`・`[areas]` はここで効く
- `areas dormant` の constraints の所在は `path#見出しの文字列`（GitHub のアンカーの形ではない）。見出しから GitHub 式のアンカーを作る関数は build-13（document-guide のアンカー）が足す予定なので、そろえるならそこで
- design-delta の「`hikyaku rules` が消す候補を並べる」は build-11 の範囲として残した（このビルドは移す候補・一致しない rule・記録にあるが無い rule まで）
- この環境では、リポジトリの CLI（`node scripts/hikyaku.mts …`）を直接実行できず、`conductor lint`・`step lint` を走らせていない。問い・ステップの定義は変えていない。インストール済みのプラグイン（3.0.0 のキャッシュ）には `ledger` コマンドが無いので、「残したこと」は未決事項の ID ではなく本文で書いた

## 残したこと

- コードレビューで「そのまま進める」とした指摘（監督の判断。questions.md の Q2）: `heavyCountByCycle` の本番の呼び出し元が無い。build-11 のマージ前後の指標の比較で使う（ADR review-records-and-criterion-reasons）。いつ: build-11、誰が: build-11 の builder
- コードレビューで「そのまま進める」とした指摘（監督の判断。questions.md の Q2）: `rules candidates` が `ruleCandidates` を2回呼ぶ（日数を引く rule を選ぶため）。`dormantAreas` は休眠の有無に関わらず ADR・constraints を読む。どちらも小さな処理で、git の履歴の走査は候補に絞ってある
- patch の手順（review・persist・templates）に「レビューの記録」と理由の欄を書かせることと、`collectReviewRecords` で patch の handoff.md を読むこと（G8 で範囲外とした。questions.md の Q1）。いつ: close、誰が: ユーザー

## レビューの記録

- [重] `-`: `areas dormant --paths` が `{a,b}` の中のカンマでも切り、休眠した領域を見落とす
- [重] `-`: 理由の欄の入れ子の括弧・閉じていない欄・後ろに文字が続く欄を、黙って「理由なし」として読む
- [軽] `-`: 理由の欄の中のパスの `/` で欄を切り、行が読めなくなる
- [軽] `-`: rule ごとの最終変更を全 rule について git から引いていた
- [軽] `-`: 生成物の変更で領域が最近触られたように見える
- [軽] `-`: constraints の項目を `###` の小見出しで取っていた
- [軽] `-`: 一致しない rule が閾値にも達すると2行出る
- [軽] `-`: サイクル設定の `[rules]`・`[areas]` を CLI が読んでいなかった
- [軽] `-`: glob を囲んでいない「領域」行を黙って落とす
- [軽] `-`: `rules check` が frontmatter の理由の不正を出さない
- [軽] `-`: テンプレートの例のままの「レビューの記録」を記録として数える
- [軽] `-`: review.md に重さの基準を写していた（persistence.md が唯一の正）
- [軽] `-`: CHANGELOG の Changed のリストが途中で切れていた

## 永続化すること

- `conventions` [中]: 「スクリプト」に、基準の理由の行末の書式 `（防ぐ: … / 立つ: … / 重要度: 高|中）` と「レビューの記録」の行の書式を変えるときは、persistence.md・テンプレート（builder の templates.md・retrospective の write.md）と `promotions.mts` の `parseCriterionReasons`・`review-records.mts` の `parseReviewRecord` を同じ PR で直すことを足す（テンプレートと解析が食い違うと、理由や記録が黙って落ちる。`tests/promotions.test.mts` が例の行を解析して確かめる）（防ぐ: 書式を片方だけ変えて、候補や記録が読めない行になる / 立つ: いまの promotions と review-records の行の解析 / 重要度: 中）
- `conventions` [中]: 「スクリプト」に、パスの glob を CLI の引数で受けるときは `rules.mts` の `splitList`（`{a,b}` の中のカンマで切らない）と `matchesRule` を使い、git の pathspec に glob を渡さないことを足す（`flagList` は `{a,b}` を壊し、git の pathspec は `*.md` を別の意味に読む）（防ぐ: build-10 のコードレビューで、休眠した領域を見落とす分割が見つかった / 立つ: rule の glob の解釈を rules.mts が持っていること / 重要度: 中）
