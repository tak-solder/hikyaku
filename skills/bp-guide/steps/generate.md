# generate: 基準表の生成

`bp-guide/rules.toml` が既にあれば何もせず、`done` を報告する。無ければ Hikyaku の既定値から生成する。

- [ ] 生成されるものを確かめる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" init --root {HIKYAKU_ROOT} --dry-run
```

`bp-guide/` の3ファイルだけが「生成」になることを確認してから `--dry-run` を外して実行する。
既存ファイルには触れない。

- [ ] `done` を報告する（3ファイルが揃っていなければ、step が受け付けない）

生成直後の内容は既定値そのもの。ここで止めるなら、次の `collect` を `skipped` で報告して
PR へ進む（既定値をワークスペースの持ち物として固定するだけでも意味がある。
以後プラグインの既定値が変わっても、このリポジトリの基準は動かない）。
