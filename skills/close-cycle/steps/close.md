# close: サイクルの終了

- [ ] サイクルを closed にする

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle close {cycle} \
  --summary "{一行要約}"
```

中止する場合（セッションの準備で、未完了のまま締めるとユーザーが答えた場合）は
`--status abandoned` を付ける。

サイクルディレクトリは残す。PR 履歴から辿れることに価値がある。
