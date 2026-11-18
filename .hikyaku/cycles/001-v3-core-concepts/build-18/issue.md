# Build 18: 上限を超える異議と、事後同意の同意ゲートの範囲

build-16 から分割した（builder の plan-review のあと、G6）。設計の下書きは、plan-review の指摘を反映した時点の build-16 の plan.md の「異議」「同意ゲート」の節（`git show bf55737:.hikyaku/cycles/001-v3-core-concepts/build-16/plan.md`。build-16 は範囲に合わせて plan.md を書き直すので、コミットを固定して読む）。

## やること

- 異議の害の重さを `risk.mts` の上限と比べ、上限を超える受け入れかを判定する（US-13.3）。上限は宣言の軸と、前提に挙げた `area:<name>` の領域の軸を軸ごとの最大で重ねて `ceilingOf`（領域を前提に挙げれば害の重さに関わらず超える）。基準の宣言を読めない回（`incomplete`）は超えるとみなす。宣言が無ければ超えない
- `ledger object`（`--defer` なし）と `ledger open --type objection`: 上限を超えれば `exceedsCeiling: true` を記録し、事後同意が無効でも害が中でも、`consented` には `--accepts` と `--premises` を求める（その場の同意）。上限を超えなければ build-04 のとおり
- 「高として扱う異議か」の述語 `isHighObjection`（害が高、または `exceedsCeiling`）を1つにまとめ、`objectionSettled` の呼び手・`unacceptedObjections`・`consentDecided` がそれを呼ぶ（build-06 の handoff は `consentDecided` を変えずに使うとしていた。rejected・resolved の扱いは変えない）
- `ledger object --defer`: 根拠が `app.*` / `area:*` のときだけ、`objection` の事項を `when=merge@<unit>`・決定なしで記録する（build-06 の同意ゲートの一覧に載る。`unacceptedObjections` は、`when` が `merge@…` の異議を数えない）。事後同意が無効（build-16 の判定）、上限を超えない、記録する作業単位の今の回に同意ゲートの置き場が無い（plan / close / create、architect の差し戻しからの再設計の回、この回ですでに pr（patch は publish）を done にした）なら拒む
- 同意ゲート（build-06）の `when` を広げる: requested のサイクルでは、その作業単位のファイルだけでなくサイクルの記録全体から対象を探す（ほかの作業単位で記録した `when=merge@<この単位>` の事項を、ゲートで示すため。読めなければ手順に入れる）。requested でなければ build-06 のまま。手順の位置だけを読む経路（Stop フック・step where・conductor parse）は、requested のサイクルでは記録を読まずに同意ゲートを手順に入れる（安全側）
- `locate.mts` の `directiveOf` は `evaluate` にも `positionOnly: true` を渡す。positionOnly で変わるのは同意ゲートの `when` だけにする（G3・G4 の consent は build-16 のとおり変わらない）。`buildDirective` の `consentOf`、`commands/ledger.mts` の `currentStep` の `off` も同じ評価にそろえる。`consentProblem` の案内の分岐も同じ判定にそろえる
- `ledger object` の help、`docs/workflow/` の build・patch（同意ゲートの出る条件）、`docs/reference/cli.md`（`ledger object --defer`）を直す。CHANGELOG に追記する

## やらないこと

- 事後同意の有効の判定・G1 の記録・G3・G4 の積み上げ（build-16）
- 退けの作り直しの経路（build-17）
- conductor での事後同意と、監督の答えの上限との比較（build-07）
- 意図を変える判断・外の前提が要る判断の事後同意（スコープ外 Q7）
- マージを機械で止めること（スコープ外 Q18）、マージが関門かを GitHub の設定から確かめること（スコープ外 Q9）

## 対応する受け入れ基準

- US-13.3

## 受け入れ基準

- [ ] 上限を超える異議は、事後同意が無効でも害が中でも、`--accepts`・`--premises` が無ければ拒まれる。基準の宣言を読めない回も同じ
- [ ] 上限を超えない異議と、根拠が宣言（`app.*` / `area:*`）でない `--defer` は、事後同意の一覧に積まれない。事後同意が無効なとき、pr を done にしたあとの `--defer` も拒まれる
- [ ] 事後同意が有効なサイクルで、`--defer` で記録した異議が同意ゲートの一覧に載り、決定なしではゲートも pr も完了しない
- [ ] requested のサイクルで、ほかの作業単位で記録した `when=merge@<この単位>` の事項だけがあるとき、`step next` も手順の位置だけを読む経路も同意ゲートを示す。requested でないサイクルは build-06 のまま
- [ ] 手順の位置だけを読む経路と `step next` で、G3・G4 の位置がずれない
- [ ] `conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「2. 未決事項と決定の記録」（異議の項）と「3. 事後同意」
- `decisions` の `20261116-deferred-consent.md` — 同意ゲートの範囲と異議の積み上げがこの判断に従う
- `decisions` の `20261116-risk-ceiling-table.md` — 上限の計算と基準の宣言（incomplete）の扱い
- `decisions` の `20261116-pending-items-ledger.md` — 異議と決定の記録の形
- build-16 の `plan.md`（`bf55737` の版）の「異議」「同意ゲート」— plan-review の指摘を反映した設計の下書き

## 予測ピーク

読むファイル: design-delta 2節・3節、ADR deferred-consent・risk-ceiling-table・pending-items-ledger、build-04・06・16 の handoff、build-16 の plan.md（`bf55737` の版）、`scripts/lib/ledger.mts`（異議・事後同意の節）・`risk.mts`（上限）・`deferred-consent.mts`（build-16）・`config.mts`（`ResolvedConfig.consent`）・`progress.mts`・`steps/engine.mts`（evaluate・StepContext）・`steps/architect.mts`（G3・G4 の consent・roundOf）・`steps/consent.mts`・`locate.mts`・`directive.mts`（buildDirective）、`scripts/commands/ledger.mts`（open・object・currentStep）・`step.mts`（where）・`conductor.mts`（parse の childStep）、tests の consent-gate・objection・step-hook・ledger・deferred-consent（build-16）の該当部分、`docs/workflow/build.md`・`patch.md`・`docs/reference/cli.md`、CHANGELOG の `[3.0.0]`
作成するファイル: `tests/deferred-objection.test.mts`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 170k | design-delta 2節・3節、ADR deferred-consent・risk-ceiling-table・pending-items-ledger、build-04・06・16 の handoff、build-16 の plan.md（bf55737 の版の異議・同意ゲートの節）、scripts/lib/ledger.mts（異議・事後同意の節）・risk.mts（上限）・deferred-consent.mts（build-16）・config.mts（ResolvedConfig.consent）・progress.mts・steps/engine.mts（evaluate・StepContext）・architect.mts（G3・G4 の consent・roundOf）・consent.mts・locate.mts・directive.mts（buildDirective）、scripts/commands/ledger.mts（open・object・currentStep）・step.mts（where）・conductor.mts（parse の childStep）、tests の consent-gate・objection・step-hook・ledger・deferred-consent（build-16）の該当部分、docs の workflow の build・patch・reference/cli.md、CHANGELOG の [3.0.0] |
| 実装 | 50k | risk.mts の exceedsCeilingFor（incomplete で超える）、ledger.mts の isHighObjection と objectionSettled・unacceptedObjections・consentDecided の置き換え、exceedsCeiling 欄、ledger object --defer と ledger open --type objection の上限との比較、consent.mts の when の拡張（requested のサイクルでサイクル全体・positionOnly で記録を読まない）、locate.mts の directiveOf の positionOnly、directive の consentOf、commands/ledger.mts の currentStep の off、help、docs 3つ、CHANGELOG |
| テスト | 45k | tests/deferred-objection.test.mts（一時 Git リポジトリの結合テスト、約 350 行。上限を超える異議の受け入れ・--defer の拒否と積み上げ・requested のサイクルの同意ゲートの範囲・位置だけの経路）と既存テストの期待値の修正 |
| 未知の領域 | 40k | directiveOf が評価全体に positionOnly を渡す変更の波及（Stop フック・conductor parse・ledger の現在のステップ）、build-06 の consentDecided の前提の変更、コードレビューの修正ループ |
| **予測ピーク** | **395k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
