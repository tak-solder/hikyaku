# plan-review: doc-reviewer による plan.md のレビュー

`doc-reviewer` で plan.md をレビューする（`--context plan`）。起動方法は SKILL.md の「doc-reviewer の起動」。

- [ ] 渡す情報: `plan.md`, `issue.md`, `design-delta.md`, 依存ビルドの `handoff.md`,
  永続ドキュメントの `overview` / `decisions` / `constraints` のパス（`docs list` で引く。全文を読ませる）,
  見積もりに使ったガイド（`tokens guide {cycle}` が示すパス）, `config --json` の `peakBands`
- [ ] 予測ピークの成分もレビュー対象である旨をプロンプトに明記する（`context: plan` の観点に含まれる）。
  見るのは、列挙したファイルとクラス設計が合っているか、未知の領域の取りこぼしが無いか
- [ ] 永続ドキュメントとの矛盾の指摘が、issue.md の指していない節に基づくものなら、その節を読んで
  plan.md を直す。あなたは指された節しか読んでいないので、この指摘が選び漏れを拾う唯一の機会
- [ ] 見積もりの乖離の指摘は `tokens estimate` を再実行して反映する。見積もり直したら、報告の `--peak` に添える
