# test-spec-review: doc-reviewer による test-spec.md のレビュー

`doc-reviewer` を起動し、test-spec.md をレビューする（`context: test-spec`）。

- [ ] 起動方法を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve doc build-{NN} {cycle} --self claude --json
```

  `mode: agent` ならサブエージェントとして起動する。`mode: process` なら
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run doc build-{NN} {cycle} --self claude --context test-spec --files <渡す情報のパスをカンマ区切りで>`
  を実行し、返った本文をレビュー結果として扱う。終了コード 1 は失敗で、指摘0件として扱わずユーザーに報告する
- [ ] 渡す情報: `test-spec.md`, `plan.md`, `issue.md`, `design-delta.md`
- [ ] plan.md のレビューは済んでいるので、ここでは行わない
- [ ] 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）
- [ ] `done` を報告する
- [ ] コミット & push する（progress.jsonl も含める）
