# approve: 基準表の変更の承認

この承認は profile の管轄外で、常に行う。基準表はワークスペース全体の見積もりに効き、
何を基準にするかは人間の判断だから。**承認前にコミットしない。**

- [ ] 変更後の `rules.toml` / `cases.toml` の差分と、次の2つの結果を提示して承認を求める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp render --dry-run
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp test
```

- [ ] 承認されたら `approved` を報告する（`--input` にユーザーの答え）。承認は rules.toml と
  cases.toml のハッシュに結びつくので、承認後に直すと取り直しになる
- [ ] 直す指示があれば `rejected` を報告し（`--input` にユーザーの答え）、ファイルを直してから
  `step next` に従って提示し直す
- [ ] 変更そのものをやめるとユーザーが答えたら、`git checkout` で `rules.toml` / `cases.toml` を戻し、
  `rejected` を報告して（`--input` にユーザーの答え）終了する。PR は作らない
