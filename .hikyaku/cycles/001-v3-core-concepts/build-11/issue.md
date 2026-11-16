# Build 11: G10 の同意と確認の区分、基準を消す経路と指標の比較

## やること

- G10: `promotions --json` が候補ごとに `approval`（宛先が `decisions`・`constraints` なら同意、それ以外は確認）を返し、`skills/close-cycle/steps/G10.md` の提示を「同意が要る変更」と「確認の変更」に分ける
- 同意が要る変更の判定を `promotions.mts` の1つの関数に置く: `decisions`・`constraints` への変更のうち、このサイクルの ADR の frontmatter の `status` を `accepted` から `implemented` に変えるだけのものを除いた全部（設計の質問 Q11。新しい ADR、本文の変更、覆された判断への書き換えは同意のまま）。G10 の `consent`（昇格の候補と、作業ツリーの差分の両方を見て、あれば `now`）と `write` の `accepts` が同じ関数を使う。同意が要る変更が無ければ `promotion_gate` で省ける（express だけ off）
- `write` の `accepts` は、同意が要る差分があるのに同意の承認が無ければ受け付けず、directive の `args.reworkFrom` で G10 へ戻す（戻った回の G10 は差分を見て同意になる）
- 消す候補: 理由の欄（防ぐ・立つ）が欠けた基準、「役に立たなかった記述」に挙がった基準、どのファイルにも一致しない rule を、`hikyaku rules` が候補として並べる。重要度が高の基準は試しに消す候補から外す
- close-cycle の `followups` の args に `ruleRemovals` と `metricsComparison` を足す。消す変更は `{close のブランチ}-criteria` のブランチの別の PR にし、`followups` の done の記録に PR を残す（ゲートは置かない）
- 指標の比較: 後続のサイクルの close-cycle で、closed のサイクルの `followups` の記録と、ベースブランチの `git log` で削除したコミットの日時から、消した基準とマージの時点を導く。マージ前後それぞれ直近2サイクル（`[metrics] window`）の差し戻し・`rejected`・重要度が高の落とし穴・「レビューの記録」の重い指摘を比べる。揃わなければ「比較できない」。悪くなっていれば戻す判断の材料として示す
- `skills/close-cycle/steps/followups.md`・`docs/workflow/close.md`・`docs/configuration/profiles.md`（`promotion_gate`）を直す。CHANGELOG に追記する

## やらないこと

- 害が成果物に残る基準を試しに消すこと（US-9.5）
- 戻すかどうかの判断（ユーザーが行う）

## 対応する受け入れ基準

- US-9.2, US-9.3, US-9.4, US-9.5, US-11.1, US-11.2, US-11.3

## 受け入れ基準

- [ ] G10 の提示で同意が要る変更と確認の変更が分かれ、`decisions`・`constraints` の変更はどのプロファイルでも conductor でもユーザーの承認を求める
- [ ] 確認の候補だけのとき、express では G10 を省ける。ADR の `accepted → implemented` の書き換えだけなら、G10 を省いたまま `write` が通る
- [ ] G10 を省いた回に、`write` が ADR の本文の変更や新しい ADR を含めると、受け付けられずに G10 へ戻り、ユーザーの承認を求める
- [ ] 消す候補に重要度が高の基準が入らない
- [ ] 基準を消す変更は別のブランチの PR になる
- [ ] 消した PR のマージ前後の指標の比較が示され、揃わなければ「比較できない」と出る（一時リポジトリの結合テスト）
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「1. 承認の種類と上限」（G10 の項）と「7. 知見と基準」（消す PR と指標の比較の項）
- `decisions` の `20261116-approval-kind-in-step-definitions.md` — G10 を1つのまま区分することがこの判断に従う
- `decisions` の `20261116-review-records-and-criterion-reasons.md` — 消す候補と指標がこの判断に従う

## 予測ピーク

読むファイル: `scripts/lib/ledger.mts`（`rejected` の導出）、`scripts/lib/config.mts`・`tests/config.test.mts`（`promotion_gate`・`[metrics]`）、`skills/close-cycle/steps/G10.md`・`followups.md`・`collect.md`・`write.md`、`scripts/lib/steps/close-cycle.mts`、`scripts/lib/promotions.mts`・`scripts/commands/promotions.mts`、`scripts/lib/review-records.mts`、`scripts/lib/rules.mts`、`scripts/lib/tokens-history.mts`（guideReview）、`docs/workflow/close.md`
作成・変更するファイル: `scripts/lib/quality-metrics.mts`、`tests/quality-metrics.test.mts`、上記の lib・commands・手順・docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 110k | ledger.mts（rejected の導出）・config.mts と config.test.mts（promotion_gate・[metrics]）・close-cycle の G10/followups/collect/write・steps/close-cycle.mts・promotions.mts・review-records.mts・rules.mts・tokens-history.mts の guideReview（判定の型）・docs/workflow/close.md・ADR approval-kind と review-records |
| 実装 | 65k | G10 の候補ごとの approval と提示の分割、同意が要る変更の判定の関数（status だけの書き換えの除外）、promotion_gate、write の accepts と G10 への戻し、消す候補（理由の欠け・役に立たなかった・高の除外）、followups の criteria の PR と指標の比較（前後2サイクル）、[metrics] window |
| テスト | 45k | G10 の同意の判定、消す候補の除外、指標の比較と「比較できない」 |
| 未知の領域 | 30k | 過去のサイクルの close の記録とベースブランチの git log からの導出 |
| **予測ピーク** | **340k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
