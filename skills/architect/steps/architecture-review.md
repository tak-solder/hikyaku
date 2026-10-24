# architecture-review: doc-reviewer による設計のレビュー

`architecture_review` が有効なとき（express / standard / thorough）に返る。
`doc-reviewer` を起動する（`context: architecture`）。

- [ ] 起動方法を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve doc architect {cycle} --self claude --json
```

  `mode: agent` ならサブエージェントとして起動する。`mode: process` なら
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run doc architect {cycle} --self claude --context architecture --files <渡す情報のパスをカンマ区切りで>`
  を実行し、返った本文をレビュー結果として扱う。終了コード 1 は失敗で、指摘0件として扱わずユーザーに報告する
- [ ] 渡す情報: `design-delta.md`, `codebase-survey.md`, 今回追記した ADR, `user-stories.md`
- [ ] 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）
- [ ] `done` を報告する。指摘と対処は G4 の提示で使うので、このセッションに残しておく
- [ ] 反映したらコミット & push する（progress.jsonl も含める）
