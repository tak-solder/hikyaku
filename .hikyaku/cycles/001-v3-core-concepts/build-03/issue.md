# Build 03: 未決事項と決定の記録（ledger の中核）

## やること

- `scripts/lib/ledger.mts` を新しく作る: 作業単位ごとの `decisions.jsonl` の読み書き（壊れた行はエラー。progress.jsonl の厳密な読み書きを関数に切り出して共有）、レコード `open`（`question` / `provisional` / `objection` / `risk`）と `decide`（`decided` / `consented` / `rejected` / `resolved`）
- 「いつ」（`now` / `phase:<phase>` / `gate:<G?>[@<unit>]` / `merge[@<unit>]` / `close`）の構文と、参照先（ゲート ID・ビルド ID）が実在するかの検査。それ以外は受け付けない
- 「誰が」（`user` / `ai:<phase>` / `supervisor`）。表示は「ユーザー」「AI（<フェーズ>）」「監督」
- 状態の導出（最新の `decide`）、期限が来た事項・過ぎた事項の判定。状態を表す列は持たない
- 付け替えの禁止: `who` を変えるレコードは無い。同じ ID への2回目の `open` はエラー。`who=user` の事項に `--by supervisor` / `--by ai:*` はエラー。`--by user` は `--input` 必須（conductor の子での答えの出どころの検査は build-07 が、設定する側と同時に足す）
- `hikyaku ledger open / decide / list / show`（書き込みは `--dry-run` つき）
- `buildDirective` の `notices` に期限が来た事項と過ぎた事項を1事項1行で入れる。Stop フック・step where の経路では読まない（サイクルに属さない patch の記録を走査しない）
- `cycle status` の JSON とテキストに `ledger` の節（`due` / `open` / `rejected`）を足し、navigator の判定表に1行足す
- `docs/reference/directory-layout.md`・`cli.md` に記録の説明を足す。CHANGELOG に追記する

## やらないこと

- 各スキルから記録を書く手順（build-04）、`ledger object`（build-04）、`ledger premises`（build-05）、`consent-list` / `pr-section`（build-06）
- conductor の子での答えの出どころ（`--from` と `HIKYAKU_ANSWER_FROM`）の設定と検査（build-07）
- PR 本文の「マージの前に決める事項」「期限を過ぎた事項」の節（build-06）
- サイクルをまたぐ未決、日付や自由文の「いつ」、サイクルに属さない patch の未決事項（スコープ外 Q12・Q13）

## 対応する受け入れ基準

- US-19.2, US-19.3, US-19.4, US-19.5, US-19.6, US-19.7

## 受け入れ基準

- [ ] 語彙にない「いつ」「誰が」と、存在しない参照先は受け付けない
- [ ] 決まったかが決定の記録から導かれ、期限を過ぎて決定の無い事項が示され続ける
- [ ] `who=user` の事項に、`--by supervisor` / `--by ai:*` で決める経路が拒否される（unit と CLI の結合）
- [ ] `step next` の directive に、期限が来た事項が載る。Stop フックの経路では記録を読まない
- [ ] `cycle status --json` に `ledger` の節が出る
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「2. 未決事項と決定の記録」
- `decisions` の `20261116-pending-items-ledger.md` — 置き場・語彙・付け替えの禁止がこの判断に従う
- `conventions`（AGENTS.md）の「スクリプト」の Stop フックと patch の記録の規約

## 予測ピーク

読むファイル: `scripts/lib/progress.mts`、`scripts/lib/promotions.mts`、`scripts/lib/steps/locate.mts`・`directive.mts`・`hook.mts`、`scripts/commands/cycle.mts`、`skills/navigator/SKILL.md`、`scripts/lib/git.mts`・`branch.mts`・`patch.mts`
作成・変更するファイル: `scripts/lib/ledger.mts`、`scripts/commands/ledger.mts`、`tests/ledger.test.mts`、上記の lib・commands、`skills/navigator/SKILL.md`、`docs/reference/directory-layout.md`・`cli.md`、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 80k | progress.mts・promotions.mts（promotionSources）・steps/locate.mts・steps/directive.mts（notices）・commands/cycle.mts（status）・navigator SKILL.md・git.mts・branch.mts・patch.mts・ADR pending-items |
| 実装 | 90k | ledger.mts 新規（約500行: 型・読み書き・いつ/誰がの語彙・参照先の検査・状態の導出・期限）、commands/ledger.mts（約300行: open/decide/list/show）、notices の配線、cycle status の節、navigator の1行 |
| テスト | 60k | ledger の unit（語彙・付け替えの拒否・導出）、CLI の結合（dry-run・notices・status） |
| 未知の領域 | 30k | Stop フックの経路で読まない分岐と、作業単位の列挙の共通化 |
| **予測ピーク** | **350k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
