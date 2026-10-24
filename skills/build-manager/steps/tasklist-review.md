# tasklist-review: doc-reviewer による tasklist のレビュー

`tasklist_review` が有効なとき（express / standard / thorough）に返る。
`doc-reviewer` を起動する（`context: tasklist`）。`{phase}` は値 `caller`（呼び出し元のフェーズ。
architect から呼ばれたら `architect`、builder からなら `build-{NN}`）。

- [ ] 起動方法を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve doc {phase} {cycle} --self claude --json
```

  `mode: agent` ならサブエージェントとして起動する。`mode: process` なら
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run doc {phase} {cycle} --self claude --context tasklist --files <渡す情報のパスをカンマ区切りで>`
  を実行し、返った本文をレビュー結果として扱う。終了コード 1 は失敗で、指摘0件として扱わずユーザーに報告する。
  `mode: process` では、プロンプトに直接含める `--dry-run` の出力と issue.md の本文を
  `git rev-parse --git-path hikyaku` の下の一時ファイルに書き出し、そのパスも `--files` に含める
- [ ] この時点ではまだファイルに書き込まれていない。`--dry-run` の出力（変更後の一覧・依存グラフ）と
  issue.md の本文をプロンプトに直接含めて渡す
- [ ] 参照として渡す: `cycles/{cycle}/planning/user-stories.md`, `cycles/{cycle}/design/design-delta.md`（存在する場合）,
  `{HIKYAKU_ROOT}/bp-guide/README.md`（存在する場合。無ければ `bp guide --markdown` の出力を
  プロンプトに含める）
- [ ] BP のレビュー対象は入力値（列挙したファイル数がスコープと合っているか、加算要素の
  取りこぼしが無いか）。表への当てはめはコマンドが行っているので、そこは見ない
- [ ] 明確な不整合・入力値の乖離は反映する（主観的な指摘は無視してよい）。
  反映が必要な場合は `scope` を `done` で報告し直し、整理と `bp estimate` からやり直す
- [ ] 反映が要らなければ `done` を報告する。レビュー結果とその対応は G6 の提示で使う
