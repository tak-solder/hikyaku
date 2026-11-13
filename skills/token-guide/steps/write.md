# write: ガイドの書き込みと版の更新

承認された変更だけを書く。

- [ ] ガイドが無ければ、標準のガイドから作る（version 1）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tokens stamp --dry-run
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tokens stamp
```

- [ ] 承認された変更を `{HIKYAKU_ROOT}/token-guide/guide.md` の本文に書き込む。先頭の版の宣言（`---` の間）は手で直さない
- [ ] もう一度 `tokens stamp` を実行して版を上げる
- [ ] 検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" validate
```

本文を変えたのに版を上げていなければ、`validate` とこのステップの完了の条件が止める。`tokens stamp` を実行し直す。
