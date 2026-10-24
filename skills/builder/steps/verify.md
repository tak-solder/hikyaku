# verify: ローカル検証

**全ての項目がパスするまで Push しない。**

- [ ] リポジトリの規約に従い品質管理を実行する（lint, test, build 等）
- [ ] エラーがあれば修正して再実行する
  - `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/retry-policy.md`（[retry-policy.md](../references/retry-policy.md)）の試行回数上限に従う
  - 上限に達したらユーザーに報告して判断を仰ぐ
- [ ] すべてパスしたら `done` を報告する
