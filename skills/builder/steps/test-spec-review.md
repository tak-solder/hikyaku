# test-spec-review: doc-reviewer による test-spec.md のレビュー

`doc-reviewer` で test-spec.md をレビューする（`--context test-spec`）。起動方法は SKILL.md の「doc-reviewer の起動」。

- [ ] 渡す情報: `test-spec.md`, `plan.md`, `issue.md`, `design-delta.md`
- [ ] plan.md のレビューは済んでいるので、ここでは行わない
- [ ] `done` に `--findings`（レビューが返した指摘の件数。`###` の項目の数で、確度が低い懸念も含む）と
  `--adopted`（そのうち test-spec.md に反映した件数）を添える。主観的として無視した指摘も `--findings` には数える
