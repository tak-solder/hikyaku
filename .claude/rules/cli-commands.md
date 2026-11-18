---
paths:
  - "scripts/commands/**"
---

# CLI のコマンド

- PR を作ったあとに付随する処理で `gh` を呼ぶなら、`gh` の失敗で終了コード 1 にせず、`scripts/lib/gh-failure.mts` の `ghFailure` で `applied: false`・`reason`・`stage`・`manual` を返す。取り込みの判定に使う `--for-merge` は例外。
- パスの glob を引数で受けるなら、`rules.mts` の `splitList`（`{a,b}` の中のカンマで切らない）と `matchesRule` を使い、git の pathspec に glob を渡さない。`flagList` は `{a,b}` を壊し、git の pathspec は `*.md` を別の意味に読む。
