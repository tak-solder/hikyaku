# Build 12: G4 と G8 の提示（gate brief）

## やること

- `hikyaku gate brief G4|G8 <phase> [<cycle>] [--full]`（読み取り専用）を足す
  - G4: design-delta.md と ADR が触れるパス（build-02 の `risk.mts` の `touchedPaths` を使う）を `[boundaries]` の `external` / `internal` と照合し、外との境界の変更（同意が要る変更）と内部の境界の変更（確かめる変更）を分けて示す。宣言が無ければ従来どおりの提示（design-delta と指摘への対処）
  - G8: test-spec.md の「（解釈）」の印が付いたシナリオと、どのシナリオの `- 対応:` にも無い受け入れ基準だけを示す（`traceability.mts` に test-spec の読み取りを足す）
  - `--full` で全文を出す
- G4 の `consent`: `gate brief G4` と同じ照合で外との境界の変更を検出したら `now`（事後同意には回さない）
- `skills/architect/steps/G4.md`・`skills/builder/steps/G8.md` を、`gate brief` の出力を示す手順に改める。test-spec.md のテンプレートに「（解釈）」の印の書き方を足す
- docs（`workflow/architect.md`・`build.md`）を直す。CHANGELOG に追記する

## やらないこと

- `[boundaries]` の読み込み（build-02）
- G8 のゲートそのものの分類の変更（確認のまま。Q1）

## 対応する受け入れ基準

- US-12.1, US-12.2, US-12.3, US-12.4, US-12.5

## 受け入れ基準

- [ ] 境界のパスを宣言したワークスペースで、G4 の提示が外との境界と内部の境界の変更に分かれ、外との境界の変更があれば G4 が同意になる
- [ ] 宣言が無いワークスペースでは、G4 は従来どおりの提示になる
- [ ] G8 の提示が「（解釈）」のシナリオと未対応の受け入れ基準だけになり、`--full` で全文が出る
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「9. G4 と G8 の提示」と「1. 承認の種類と上限」（G4 の項）
- `decisions` の `20261116-approval-kind-in-step-definitions.md` — G4 の同意の条件がこの判断に従う

## 予測ピーク

読むファイル: `scripts/lib/traceability.mts`、`scripts/lib/steps/directive.mts`・`architect.mts`、`scripts/lib/risk.mts`（boundaries）、`skills/architect/steps/G4.md`、`skills/builder/steps/G8.md`・`test-spec.md`
作成・変更するファイル: `scripts/commands/gate.mts`、`scripts/lib/gate-brief.mts`、`tests/gate-brief.test.mts`、上記の lib・手順・docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 80k | traceability.mts・directive.mts・risk.mts（boundaries と touchedPaths）・steps/architect.mts・architect の G4.md・builder の G8.md と test-spec.md・ADR approval-kind |
| 実装 | 55k | gate brief コマンド（G4: 外と内の境界の変更、G8: 解釈の印と未対応の受け入れ基準、--full）、traceability の test-spec の読み取り、G4 の外の境界での同意、test-spec テンプレートの（解釈） |
| テスト | 40k | brief の出力、境界の照合、未対応の基準の検出 |
| 未知の領域 | 15k | 既存の G4・G8 の提示との切り替え（パスを拾う規則は build-02 の touchedPaths を使う） |
| **予測ピーク** | **280k** | 統合を検討（300k 未満。推奨のみ） |
| ガイド | 標準 v2 | 03897ac0 |

統合は見送る。依存の近い build-02（340k）とまとめると 450k を超え、ほかのビルドとは触るファイルが重ならないため
