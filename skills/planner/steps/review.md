# review: doc-reviewer による user-stories.md のレビュー

`doc-reviewer` を起動し、user-stories.md をレビューする（`context: user-stories`）。

- [ ] 起動方法を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve doc plan {cycle} --self claude --json
```

  `mode: agent` ならサブエージェントとして起動する。`mode: process` なら
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run doc plan {cycle} --self claude --context user-stories --files <渡す情報のパスをカンマ区切りで>`
  を実行し、返った本文をレビュー結果として扱う。終了コード 1 は失敗で、指摘0件として扱わずユーザーに報告する
- [ ] 渡す情報: `cycles/{cycle}/planning/user-stories.md`, `planning/questions.md`（存在する場合）
  - 出力フォーマットは `${CLAUDE_PLUGIN_ROOT}/agents/doc-reviewer.md` を参照
- [ ] 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）
- [ ] `done` を報告する
- [ ] コミット & push する（progress.jsonl も含める）
