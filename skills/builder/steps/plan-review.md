# plan-review: doc-reviewer による plan.md のレビュー

`doc-reviewer` で plan.md をレビューする（`--context plan`）。起動方法は SKILL.md の「doc-reviewer の起動」。

- [ ] 渡す情報: `plan.md`, `issue.md`, `design-delta.md`, 依存ビルドの `handoff.md`,
  `{HIKYAKU_ROOT}/bp-guide/README.md`（存在する場合。無ければ `bp guide --markdown` の出力を
  プロンプトに含める）, `config --json` の `bpMax`
- [ ] BP見積もりの入力値もレビュー対象である旨をプロンプトに明記する（`context: plan` の観点に含まれる）。
  見るのは、列挙したファイルとクラス設計が合っているか、加算要素の取りこぼしが無いか
- [ ] 入力値の乖離の指摘は `bp estimate` を再実行して反映する。算出し直したら、報告の `--bp` に添える
