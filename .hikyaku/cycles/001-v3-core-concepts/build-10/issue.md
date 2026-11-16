# Build 10: 知見の置き場の「なくす」と、rule を移すきっかけ・領域の開発頻度

## やること

- `skills/close-cycle/references/persistence.md` の置き場の順の先頭に「なくす（リファクタ）」と宛先 `refactor` を足す。`promotions.mts` の `PLAIN_TARGETS` に加える。`agents/doc-triager.md` から写していた順を消し、persistence.md を読ませる。`docs/configuration/persistence.md` を直す
- 基準の理由: rule の frontmatter に `prevents` / `basis` / `importance: 高|中` を足し、文書の基準と「永続化すること」の行に `（防ぐ: … / 立つ: … / 重要度: 高|中）` を持たせる（persistence.md・テンプレート・promotions を同じ PR で直す）
- handoff.md に見出し「レビューの記録」（`- [重|軽] \`rule:<パス>\`: 指摘の要約`）を足し、builder の review・handoff の手順で書かせる。`scripts/lib/review-records.mts` が、サイクルをまたいで回数と重い指摘を集める（`collectPeakRecords` の型）
- `hikyaku rules` に、閾値（`[rules] hit_threshold`、既定3）以上引かれた rule（移す候補）と、どのファイルにも一致しない rule（既存の `stale`）を並べ、各行に最終変更からの日数を添える。builder と close-cycle の手順から呼ぶ。移すか消すかはスクリプトが決めない
- `git.mts` に `lastTouched(paths)` を足し、`[areas] dormant_days`（既定180）と比べる。`hikyaku areas dormant --paths <glob,...>` が休眠した領域と、結び付いた rule・ADR・constraints の項目（build-05 が決めた `領域:` の行）を返す。architect の survey の後と builder の plan で、挙げたパスを渡して呼ぶ手順を足す
- CHANGELOG に追記する

## やらないこと

- 基準を消す PR と指標の比較（build-11）
- 置き場の判断そのもの（LLM とユーザーが行う）

## 対応する受け入れ基準

- US-4.1, US-4.2, US-4.3, US-4.4, US-5.1, US-5.2, US-5.3, US-5.4, US-5.5, US-9.1

## 受け入れ基準

- [ ] builder・close-cycle・doc-triager の振り分けで「なくす」が先頭に選べる
- [ ] 「レビューの記録」から rule ごとの回数が集まり、閾値以上が移す候補として並ぶ（サイクルをまたいだ結合テスト）
- [ ] 一致しない rule が並ぶ
- [ ] 休眠の期間を超えた領域に変更が入るとき、結び付いた rule・前提が示される（一時リポジトリのコミット日時を使った結合テスト）
- [ ] rule と文書の基準に、防ぐもの・立つもの・重要度を残せる
- [ ] persistence.md・テンプレート・promotions の見出しと宛先の語が一致している。`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「7. 知見と基準」（なくす・レビューの記録・rule の理由・休眠の項）
- `decisions` の `20261116-review-records-and-criterion-reasons.md` — 記録の書式と集計がこの判断に従う
- `conventions`（AGENTS.md）の「スクリプト」の persistence.md と promotions.mts の規約

## 予測ピーク

読むファイル: `scripts/lib/config.mts`・`tests/config.test.mts`（`[rules]`・`[areas]`）、`skills/architect/references/templates.md`・`skills/close-cycle/references/constraints-template.md`（build-05 が決めた `領域:` の書式）、`skills/close-cycle/references/persistence.md`、`agents/doc-triager.md`、`scripts/lib/promotions.mts`、`scripts/lib/rules.mts`・`scripts/commands/rules.mts`、`scripts/lib/git.mts`、`scripts/lib/tokens-history.mts`、`skills/builder/references/templates.md`・`steps/handoff.md`・`steps/plan.md`・`steps/review.md`、`skills/retrospective/steps/write.md`、`skills/architect/steps/survey.md`、`docs/configuration/persistence.md`
作成・変更するファイル: `scripts/lib/review-records.mts`、`scripts/commands/areas.mts`、`tests/review-records.test.mts`、上記の lib・commands・手順・エージェント・docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 110k | config.mts と config.test.mts（[rules]・[areas]）・architect の templates（領域の書式）・persistence.md・doc-triager.md・promotions.mts・lib と commands の rules.mts・git.mts・tokens-history.mts（収集の型）・builder の templates/handoff/plan/review・retrospective の write・architect の survey・docs/configuration/persistence.md・ADR review-records |
| 実装 | 70k | 置き場の順の「なくす」と refactor 宛先、レビューの記録の見出しと解析、review-records.mts 新規、rule の frontmatter の理由、rules の移す候補と休眠の日数、lastTouched、areas dormant コマンド、[rules]・[areas] の設定 |
| テスト | 50k | promotions の新しい見出し、回数の閾値、休眠の判定（一時リポジトリのコミット日時） |
| 未知の領域 | 25k | rule の frontmatter の解析と既存実装の整合 |
| **予測ピーク** | **345k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
