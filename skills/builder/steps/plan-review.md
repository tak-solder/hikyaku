# plan-review: doc-reviewer による plan.md のレビュー

`doc-reviewer` を起動し、plan.md をレビューする（`context: plan`）。

- [ ] 起動方法を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve doc build-{NN} {cycle} --self claude --json
```

  `mode: agent` ならサブエージェントとして起動する。`mode: process` なら
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run doc build-{NN} {cycle} --self claude --context plan --files <渡す情報のパスをカンマ区切りで>`
  を実行し、返った本文をレビュー結果として扱う。終了コード 1 は失敗で、指摘0件として扱わずユーザーに報告する
- [ ] 渡す情報: `plan.md`, `issue.md`, `design-delta.md`, 依存ビルドの `handoff.md`,
  `{HIKYAKU_ROOT}/bp-guide/README.md`（存在する場合。無ければ `bp guide --markdown` の出力を
  プロンプトに含める）, `config --json` の `bpMax`
- [ ] BP見積もりの入力値もレビュー対象である旨をプロンプトに明記する（`context: plan` の観点に含まれる）。
  見るのは、列挙したファイルとクラス設計が合っているか、加算要素の取りこぼしが無いか
- [ ] 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）
- [ ] 入力値の乖離の指摘は `bp estimate` を再実行して反映する
- [ ] `done` を報告する。BP を算出し直したら `--bp` に添える
- [ ] コミット & push する（progress.jsonl も含める）
