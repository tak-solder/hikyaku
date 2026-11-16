# Build 15: G3・G4 を宣言の上限で同意にする（害とパスの申告と裏取り）

## やること

- architect の options の done に `--harm 高|中` と `--paths <glob,...>`（波括弧の外のカンマで区切る）を受け付ける。欠けていても報告は受け付け、宣言があれば G3 を同意に倒す。`progress.jsonl` の任意欄に残す（中身を含まない値）。directive の報告コマンドに載せる
- G3 の `consent`: 申告を build-02 の `risk.mts` で上限と比べて超えれば `now`（申告したパスが重い領域に当たれば、害の重さに関わらず超えるとみなす）。申告はこの回の最後の options の記録から読み、`--harm` か `--paths` のどちらかが欠ければ `now`。宣言が無ければ従来どおりプロファイルで決まる
- G4 の `consent`（G3 の申告の裏取り）: design-delta.md とこのサイクルの ADR の `touchedPaths` が重い領域に当たり、その領域が G3 の申告に当たっていなければ `now`。申告が領域に当たるかは G3 と同じ関数・同じ入力で判定する。G4 の args に当たった領域を渡し、`skills/architect/steps/G4.md` に、このとき示す中身を足す
- `designChoiceGate`: options の done がまだ無い間は、宣言による同意を含めず従来の判定で返す
- G3・G4 の directive の notices に、基準の宣言を読めなかったことを出す
- `CONSENT_WHEN` の G3・G4 の説明を直す
- `skills/architect/steps/options.md`・`G3.md` に、申告の付け方と G3 が同意になったときの提示を足す
- `docs/configuration/profiles.md`・`docs/workflow/conductor.md`・`docs/workflow/architect.md`・`docs/configuration/config-file.md` の [app] 節に、G3・G4 が宣言の上限で同意になることを書く。config-file.md と CHANGELOG の「この版では宣言は検査と表示だけで、ゲートの判定にはまだ使わない」（build-02）を、G3・G4 に効くことに改める。`[boundaries]` は判定にまだ使わないという断りは残し、build-12 が境界の照合を足すときに外す。CHANGELOG に追記する

## やらないこと

- 事後同意（`deferred`）の扱い（build-06。G3 と G4 の裏取りが `deferred` を返す経路はそこで足す）
- G4 の境界の照合（build-12）
- 宣言の読み込み・上限の計算そのもの（build-02）
- 宣言が無いワークスペースに上限を設けること（スコープ外 Q3）

## 対応する受け入れ基準

- US-10.3, US-13.3, US-13.4

## 受け入れ基準

- [ ] G3 は、上限を超える案が無ければ確認として省け、あれば（申告の欠け・申告したパスが重い領域に当たる場合を含む）ユーザーに上がる
- [ ] G3 の申告に無い重い領域に design-delta.md か ADR が触れていれば、どのプロファイルでも G4 がユーザーに上がる
- [ ] 宣言が無いワークスペースでは、従来どおり G3 はプロファイルで決まる
- [ ] 基準の宣言を読めなかった回は、G3・G4 の directive の notices にそのことが出る
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「1. 承認の種類と上限」（G3・G4 の裏取り・アプリケーションの状況・上限はユーザーがマージした宣言で決める の項）
- `decisions` の `20261116-risk-ceiling-table.md` — 上限の表と重い領域の扱いがこの判断に従う
- `decisions` の `20261116-approval-kind-in-step-definitions.md` — G3 の `consent` と申告の必須、G4 の裏取りがこの判断に従う

## 予測ピーク

読むファイル: design-delta 1節・ADR 2本・build-02 の handoff、`scripts/lib/risk.mts`、`tests/risk.test.mts`（基準の一時リポジトリの組み方）・`tests/helpers.mts`、`scripts/lib/steps/engine.mts`・`directive.mts`・`architect.mts`、`scripts/commands/step.mts`（report）、`scripts/lib/progress.mts`、`scripts/lib/conductor.mts` の `CONSENT_WHEN`、`tests/step-consent.test.mts`・`step-architect.test.mts`、`skills/architect/steps/options.md`・`G3.md`・`G4.md`、`docs/configuration/profiles.md`・`config-file.md` の [app] 節、`docs/workflow/conductor.md`・`architect.md`、`CHANGELOG.md` の `[3.0.0]`
作成するファイル: 上記の lib・commands・テスト・手順・docs の変更、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 標準ガイドの出発点 80k〜100k の中央（このサイクルの build-01 の開始時の実測は約 60k、手順の進行分を足す） |
| 読み込み | 120k | design-delta 1節・ADR 2本・build-02 の handoff、scripts/lib/risk.mts（build-02 で新規）・tests/risk.test.mts・tests/helpers.mts、steps/engine.mts・directive.mts・architect.mts、commands/step.mts（report）、progress.mts、tests/step-consent.test.mts・step-architect.test.mts、skills/architect/steps/options.md・G3.md・G4.md、docs/configuration/profiles.md・config-file.md の [app] 節、docs/workflow/conductor.md・architect.md、lib/conductor.mts の CONSENT_WHEN、CHANGELOG [3.0.0] |
| 実装 | 55k | step report の --harm/--paths（波括弧の外で区切る）と progress の欄、engine の declaresRisk/notices、directive の報告コマンドと notices、G3・G4 の consent・args・notices と designChoiceGate、CONSENT_WHEN、options/G3/G4.md、profiles/conductor/architect/config-file の docs、CHANGELOG |
| テスト | 50k | G3 の同意化（上限超え・重い領域・申告の欠け）、宣言なしは従来どおり、G4 の裏取り（申告に無い重い領域・options をスキップした回）、基準を読めないときの notices、--harm/--paths の検査、designChoiceGate、step-architect の既存テストの追随 |
| 未知の領域 | 35k | 一時リポジトリで宣言と design-delta/ADR を置いて G3/G4 を通す結合テストの調整、既存の architect の結合テストへの波及 |
| **予測ピーク** | **350k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
