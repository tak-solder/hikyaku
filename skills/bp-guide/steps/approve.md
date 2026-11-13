# approve: 基準表の変更の承認

基準表はワークスペース全体の見積もりに効き、何を基準にするかは人間の判断なので、承認を得る。
**承認前にコミットしない。**

- [ ] 変更後の `rules.toml` / `cases.toml` の差分と、次の2つの結果を提示して承認を求める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp render --dry-run
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp test
```

- [ ] 直す指示があれば、ファイルを直してから提示し直す
- [ ] 変更そのものをやめるとユーザーが答えたら、`git checkout` で `rules.toml` / `cases.toml` を戻し、
  `rejected` を報告して（`--input` にユーザーの答え）終了する。PR は作らない
