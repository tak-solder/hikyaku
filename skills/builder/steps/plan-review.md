# plan-review: doc-reviewer による plan.md のレビュー

`doc-reviewer` で plan.md をレビューする（`--context plan`）。起動方法は SKILL.md の「doc-reviewer の起動」。

- [ ] 渡す情報: `plan.md`, `issue.md`, `design-delta.md`, 依存ビルドの `handoff.md`,
  見積もりに使ったガイド（`tokens guide {cycle}` が示すパス）, `config --json` の `peakBands`
- [ ] 予測ピークの成分もレビュー対象である旨をプロンプトに明記する（`context: plan` の観点に含まれる）。
  見るのは、列挙したファイルとクラス設計が合っているか、未知の領域の取りこぼしが無いか
- [ ] 見積もりの乖離の指摘は `tokens estimate` を再実行して反映する。見積もり直したら、報告の `--peak` に添える
