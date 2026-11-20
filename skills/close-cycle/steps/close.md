# close: サイクルの終了

- [ ] サイクルを closed にする

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle close {cycle} \
  --summary "{一行要約}"
```

中止する場合（セッションの準備で、未完了のまま締めるとユーザーが答えた場合）は
`--status abandoned` を付ける。

`cycle close` は tasklist.md の PR 列も、各ビルドの完了の記録からまとめて埋める（サイクルの途中は、
並行するビルドの PR がコンフリクトしないよう PR 列を書かない）。cycles.md と一緒に tasklist.md もコミットする。

サイクルディレクトリは残す。PR 履歴から辿れることに価値がある。
