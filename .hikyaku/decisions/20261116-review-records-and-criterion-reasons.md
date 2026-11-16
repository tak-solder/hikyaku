---
status: accepted
---

# レビューで引いた rule は handoff の1つの見出しに、基準の理由は rule の frontmatter に残す

- **決定**: handoff.md に見出し「レビューの記録」を足し、行は `- [重|軽] \`rule:<パス>\`: 指摘の要約`（rule に当たらなければ宛先は `-`）。この1つの記録から、rule が引かれた回数（`[rules] hit_threshold`、既定3、サイクルをまたいで数える）と重い指摘の数（品質の指標）を `review-records.mts` が集める。rule の frontmatter に `prevents`・`basis`・`importance: 高|中` を足し、`conventions` などに書く基準と「永続化すること」の行には末尾に `（防ぐ: … / 立つ: … / 重要度: 高|中）` を持たせる。置き場の順の先頭に宛先 `refactor`（なくす）を足す。ADR と `constraints` の前提の行に `領域: <glob>` を書けるようにし、`git.mts` の `lastTouched` と `[areas] dormant_days`（既定180）で休眠を判定する。消す候補は、一致しない rule（既存の `stale`）・役に立たなかった記述・理由の欠けた基準から作り、`importance: 高` は試しに消す候補から外す。消す PR とマージ前後2サイクルの指標の比較は close-cycle の `followups` に乗せる
- **文脈**: US-4・US-5・US-9 と原則5・10。現状、レビューの重い指摘はコミットされた記録に残っていない
- **外の前提**: なし
- **検討した案**:
  - Minimal: handoff の「レビューの指摘」と rule の frontmatter
  - Clean: 集計の走査を `collectBuildRecords<T>` に一般化し、`criteria` / `premises` / `dormancy` / `quality-metrics` のモジュールを足す。重い指摘は `--heavy` で progress.jsonl に残す
  - Pragmatic: 上記の決定
- **推奨**: Pragmatic
- **採用理由**: `promotions.mts` の行の書式と `collectPeakRecords` の型をそのまま使い回せ、rule の理由は rule と一緒に生きて一緒に消える
- **受け入れたこと**:
  - rule を引いたかの対応付けは LLM の申告なので、書き漏らすと回数が少なく出る（移す候補を見逃す側に倒れ、危険側には倒れない）
  - 書式の誤りは `unparsed` として見えるだけ
- **トレードオフ**: 行の書式に欄が増える。persistence.md・テンプレート・promotions・rules を同じ PR で直す必要がある
- **再評価条件**: 書き漏れで移す候補が出ないことが続いたとき。指標を足すたびに読み手を書き足す負担が大きくなったとき（Clean の一般化を再検討する）
- **退けた推奨で失う利点**: なし（推奨どおり採用）
- **影響範囲**: `scripts/lib/promotions.mts`、`scripts/lib/review-records.mts`（新規）、`scripts/lib/rules.mts`、`scripts/lib/git.mts`、`scripts/lib/config.mts`、`scripts/lib/steps/close-cycle.mts`、`skills/close-cycle/references/persistence.md`、`agents/doc-triager.md`、`skills/builder/references/templates.md`、`skills/retrospective/steps/write.md`、`docs/configuration/persistence.md`
