# Build 17: 同意ゲートで退けた項目の作り直しの経路

## やること

- 同意ゲート（build-06）で退けた項目（最新の決定が `rejected`）の作り直し: 同じ作業単位の事項なら directive の `args.reworkFrom` でそのステップへ戻す。事項の `step` がゲートなら、戻り先の run ステップへ対応させる（ゲートは done で報告し直せないため。architect: G3→options、G4→design-delta、builder: G7・G8→plan、patch: P1→scope、それ以外はそのゲートより前で最も近い、手順に入っている run ステップ）。前のフェーズ（記録した作業単位が別）の事項なら `return.md` で差し戻す
- 同意ゲートと `pr`（patch は `publish`）の `accepts` を同じ条件に改める（build-06 は両方で「最新が rejected なら受け付けない」）: 退けた同じ作業単位の事項は、戻り先のステップを退けの決定の後に done で報告し直していれば承認を受け付ける（作り直したあとも `resolved` までは「未解決の退け」として PR 本文と `cycle status` に出し続ける）。前のフェーズの事項は `resolved` になるまで受け付けない（return.md の経路）
- 退けによる return.md も build-09 の3節（試したこと＝退けられた受け入れとその拠り所 / 問題を変える選択肢と失うもの / 推奨）で書き、「退けた項目」に事項の ID を書く。`ledger return-draft <phase> --items <id,...>` が下書きを出し（書き込まない）、LLM が選択肢と推奨を書く。builder の `references/templates.md` の return.md に「退けた項目」の節、`references/return.md` に退けからの差し戻しの手順を足す。architect・patch の consent.md に退けたときの戻り方を足す
- docs（workflow の各フェーズ・`docs/reference/cli.md`）を直す。CHANGELOG に追記する

## やらないこと

- 同意ゲート・`ledger consent-list` / `pr-section`（build-06）
- 事後同意の有効の判定と、上限を超える受け入れの積み上げ（build-16）
- conductor で前のフェーズの判断を退けたときの扱い（最後のビルドからの差し戻し。build-07）

## 対応する受け入れ基準

- US-20.11

## 受け入れ基準

- [ ] 退けた項目が同じ作業単位なら、同意ゲートの directive の `args.reworkFrom` がそのステップ（ゲートで記録した事項なら対応する run ステップ）を示し、そこを done で報告し直すまで同意ゲートも pr（patch は publish）も完了にならない。報告し直したあとは、`resolved` の前でも PR を作れる
- [ ] 退けた項目が前のフェーズなら return.md の経路に乗り、`resolved` になるまで同意ゲートは承認にならない
- [ ] 退けによる return.md（`ledger return-draft` の下書きに選択肢と推奨を書いたもの）が行き詰まりの報告の検査を通り、architect の再設計の回を始められる
- [ ] 作り直したあとも、`resolved` を記録するまで未解決の退けが PR 本文と `cycle status` に出続ける
- [ ] `conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「3. 事後同意」（退けの項）と「6. 行き詰まりの報告」
- `decisions` の `20261116-deferred-consent.md` — 退けの経路（同じ作業単位はそのステップへ、前のフェーズは return.md）
- `decisions` の `20261116-escalation-report-check.md` — return.md の3節の検査

## 予測ピーク

読むファイル: build-06・build-09 の handoff、`scripts/lib/steps/consent.mts`・`engine.mts`・`directive.mts`・`architect.mts`・`builder.mts`・`patch.mts`、`scripts/lib/ledger.mts`・`escalation.mts`・`phase.mts`、`scripts/commands/ledger.mts`・`step.mts`、`skills/builder/references/templates.md`・`return.md`、`skills/*/steps/consent.md`、`tests/consent-gate.test.mts`・`escalation.test.mts`、`docs/workflow/` の各フェーズ・`docs/reference/cli.md`・CHANGELOG
作成・変更するファイル: `scripts/lib/steps/consent.mts`、`scripts/commands/ledger.mts`（return-draft）、`skills/builder/references/templates.md`・`return.md`、`skills/*/steps/consent.md`、テスト、docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 110k | build-06・build-09 の handoff、design-delta 3節・6節、ADR deferred-consent・escalation-report-check、steps/consent.mts・engine.mts・directive.mts・architect.mts・builder.mts・patch.mts、lib/ledger.mts・escalation.mts・phase.mts、commands/ledger.mts・step.mts、templates.md・return.md・consent.md 3つ、tests/consent-gate.test.mts・escalation.test.mts、docs/workflow・reference/cli.md・CHANGELOG |
| 実装 | 50k | consent.mts の戻り先と accepts の改訂（約 80 行）、commands/ledger.mts の return-draft（約 80 行）、templates.md・return.md・consent.md 3つ・docs・CHANGELOG |
| テスト | 40k | 退けの戻り先・前のフェーズの退け・return-draft の下書きが検査を通ること（一時 Git リポジトリ、約 250 行）と、build-06 の consent-gate.test.mts の期待値（rejected で止まる）の修正 |
| 未知の領域 | 30k | エンジンのやり直しの規則（報告し直しで後ろがやり直しになる）と退けの戻り先の組み合わせ |
| **予測ピーク** | **320k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
