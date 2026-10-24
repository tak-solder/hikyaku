# render: README の表の再生成と検証

- [ ] README の表を再生成し、検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp render
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" validate
```

`validate` は README の表が古いこと、期待値の不一致、`rules.toml` の構文エラーを検出する。

- [ ] 通れば `done` を報告する（step も同じ検査をし、通らなければ受け付けない）
- [ ] 通らなければ変更案に戻る。`rules.toml` / `cases.toml` を直し、`propose` を `done` で
  報告し直す（そこから後ろはやり直しになり、承認も取り直す）
