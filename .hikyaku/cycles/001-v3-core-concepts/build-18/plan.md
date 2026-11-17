# Build 18: 上限を超える異議と、事後同意の同意ゲートの範囲

設計の下書きは build-16 の plan.md（`bf55737` の版）の「異議」「同意ゲート」の節。ここでは、そこから具体化した点と、このビルドの範囲だけを書く。

## 依存パッケージ

なし（実行時依存ゼロのまま）

## クラス設計

### 上限との比較（`scripts/lib/risk.mts`）

```ts
/** 異議の害が上限を超えるか（US-13.3） */
export function exceedsCeilingFor(effective: EffectiveDeclaration, harm: Harm | undefined, premises: string[]): boolean
```

- `effective.incomplete` なら true（基準の宣言を読めない回。G3・G4 の INCOMPLETE と揃える）
- `effective.declaration` が無ければ false（US-13.4: 上限を設けない）
- 前提の `area:<name>` が宣言の重い領域の名前に当たれば true（害の重さに関わらず超える）。当たる領域の軸を宣言の軸に軸ごとの最大で重ねるので、上限は必ず「なし」になる。宣言に無い名前は重ねない
- それ以外は `exceeds(harm ?? "中", ceilingOf(declaration.axes))`（`ledger open` で害を書かなかった異議は中として比べる）

### 異議の記録（`scripts/lib/ledger.mts`）

- `OpenRecord.exceedsCeiling?: true`（`ledger object` / `ledger open --type objection` が上限を超えると判定したときだけ書く）
- `isHighObjection(item: LedgerItem): boolean` — `type === "objection"` かつ（`harm === "高"` か `exceedsCeiling === true`）
- `unacceptedObjections`: 条件を `isHighObjection` に置き換え、`when` が `merge@…` の異議を数えない（同意ゲートで扱う）
- `consentDecided`: `isHighObjection(item)` なら `objectionSettled(item)`。rejected・resolved の扱いは変えない（build-06 の handoff は「変えずに使う」としていたが、US-13.3 で上限を超える異議を高と同じに扱うため条件だけを置き換える。handoff に残す）
- `commands/ledger.mts` の `consentState`（「受け入れの言葉なし（害が高の異議）」）の文面を、上限を超える異議にも合うように直す

### `ledger object` / `ledger open`（`scripts/commands/ledger.mts`）

- 上限の比較は `exceedsCeilingFor(effectiveDeclaration(config), harm, premises)`
- `ledger open --type objection`: 上限を超えれば `exceedsCeiling: true` を書き、`--premises` が無ければ拒む（高と同じ）
- `ledger object`（`--defer` なし）: 上限を超えれば `exceedsCeiling: true` を書き、`consented` には `--accepts` と `--premises` を求める（害が中でも、事後同意が無効でも）。出力に「上限を超える」ことを1行出す
- `ledger object --defer`: `--decision` / `--input` / `--accepts` を受け付けない（渡したら拒む）。`objection` の事項を `who=user`・`when=merge@<記録する作業単位>`・`exceedsCeiling: true`・決定なしで1行書く。拒む条件（理由を添える）:
  1. `deferredConsent(config, cycleDirectory).effective` でない（理由をそのまま出す）
  2. `--premises` が無い、または `app.*`・`area:*` 以外の参照を含む
  3. 上限を超えない（その場で決定を記録する案内）
  4. 記録する作業単位の今の回に同意ゲートの置き場が無い（下の `consentGateSlot`）
- `currentStep` の `off` は、`directiveOf` と同じく `positionOnly: true` の ctx で評価する

### 同意ゲート（`scripts/lib/steps/consent.mts`）

```ts
/** 同意ゲートの置き場が今の回にあるか。無ければ理由を返す（ledger object --defer が使う） */
export function consentGateSlot(skill: SkillSteps, ctx: StepContext): string | undefined
```

- `consentStep` の `when` を「置き場（slot）」と「対象があるか」に分ける。slot = スキルごとの構造の条件（architect の差し戻しの回を外す）・サイクルがある・conductor の子でない・この回で pr（patch は publish）を done にしていない。定義に `slot` を持たせ（`StepDefinition` を広げた `ConsentStepDefinition`）、`consentGateSlot` はスキルの consent ステップの `slot` を呼ぶ。consent ステップを持たないスキル（planner・close-cycle・create-cycle）は「置き場が無い」。循環 import の初期化順の問題を避けるため、モジュールの const の表には持たない
- 対象があるか（`hasConsentItems(ctx)`）:
  - requested（`config.consent.deferred === true`）でなければ build-06 のまま（`unitHasConsentItems`。その作業単位のファイル1つ）
  - requested で `ctx.positionOnly` なら記録を読まずに true（安全側）
  - requested なら `consentItemsOf(readLedger(cycle))` が空でないか。読めなければ true
- `consentProblem` の案内の分岐（ゲートが手順に入るか）を `hasConsentItems` に揃える

### 手順の位置だけを読む経路（`scripts/lib/steps/locate.mts`・`directive.mts`）

- `directiveOf` は `evaluate` と `buildDirective` に `positionOnly: true` の ctx を渡す（今は args にだけ渡している）。返す `opened` は元のまま（呼び手は `nextCommand` にだけ使う）
- `buildDirective` は `notices: false` のとき、args と `consentOf` に同じ `positionOnly: true` の ctx を使う
- `positionOnly` で変わるのは同意ゲートの `when` だけ。G3・G4 の consent は build-16 のとおり `positionOnly` を見ない（テストで位置がずれないことを確かめる）

### help・docs・CHANGELOG

- `ledger object` の usage・details に `--defer` と、上限を超える異議の扱い
- `docs/workflow/build.md`・`patch.md`（同意ゲートの出る条件: 事後同意を選んだサイクルでは、ほかの作業単位で記録した事項でも出る）、`docs/reference/cli.md`（`ledger object --defer`）
- CHANGELOG の `[3.0.0]` に追記（バージョンは 3.0.0 のまま）

## 非機能要件

- **セキュリティ**: 該当なし（ワークフローの承認の記録）。上限を超える受け入れを、ユーザーの言葉と前提なしに通す経路を作らないことを結合テストで確かめる
- **パフォーマンス**: requested でないサイクルでは、同意ゲートの `when` は従来どおりファイル1つだけを読む。requested でも位置だけを読む経路は記録を読まない
- **エラーハンドリング**: 記録・基準を読めないときは、同意ゲートを手順に入れる・上限を超えるとみなす（安全側）
- **マージ時点のデータ安全**: 該当なし（本番データに触れない。既存のサイクルは `[consent]` を書いていないので同意ゲートの範囲は変わらない。異議の上限との比較は `[app]` を宣言したワークスペースだけで効き、宣言の無いワークスペースは従来どおり）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 395k |
| builderフェーズ段階 | 340k |

**読むファイル**

- 読み済み: issue.md、build-16 の handoff と plan.md（`bf55737` の版）、design-delta 2節・3節、`scripts/lib/risk.mts`（上限まで）・`ledger.mts`（異議・事後同意）・`deferred-consent.mts`・`steps/consent.mts`・`steps/locate.mts`・`steps/directive.mts`（buildDirective）・`commands/ledger.mts`（open・object・currentStep）、tests の consent-gate・deferred-consent・objection の作り
- 残り: ADR deferred-consent・risk-ceiling-table・pending-items-ledger の該当節、tests の step-hook・ledger の該当部分、`docs/workflow/build.md`・`patch.md`、`docs/reference/cli.md`、CHANGELOG の `[3.0.0]`

**作成するファイル**

- `tests/deferred-objection.test.mts`（約 350 行）

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 120k | 読み済み（約 80k）: issue.md、build-16 の handoff と plan.md（bf55737 の版）、design-delta 2節・3節、lib/risk.mts（上限まで）・ledger.mts（異議・事後同意）・deferred-consent.mts・steps/consent.mts・locate.mts・directive.mts（buildDirective）・commands/ledger.mts（open・object・currentStep）、tests の consent-gate・deferred-consent・objection の作り。残り約 40k: ADR deferred-consent・risk-ceiling-table・pending-items-ledger の該当節、tests の step-hook・ledger の該当部分、docs/workflow の build・patch、docs/reference/cli.md、CHANGELOG の [3.0.0] |
| 実装 | 45k | risk.mts の exceedsCeilingFor、ledger.mts の isHighObjection・exceedsCeiling 欄と3関数の置き換え、commands/ledger.mts の open・object の上限との比較と --defer（拒否の5条件）、consent.mts の同意ゲートの when の拡張・置き場の判定（slot）・consentProblem の案内、locate.mts の directiveOf と directive.mts の consentOf の positionOnly、currentStep の off、help、docs 3つ、CHANGELOG |
| テスト | 45k | tests/deferred-objection.test.mts（一時 Git リポジトリの結合テスト、約 350 行。上限を超える異議の受け入れ・--defer の拒否と積み上げ・requested のサイクルの同意ゲートの範囲・位置だけの経路）と既存テスト（consent-gate・objection）の期待値の修正 |
| 未知の領域 | 40k | directiveOf が評価全体に positionOnly を渡す変更の波及（Stop フック・step where・conductor parse・ledger の現在のステップ）、consentDecided の条件の変更の波及、コードレビューの修正ループ |
| **予測ピーク** | **340k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `risk.mts` の `exceedsCeilingFor`、`ledger.mts` の `exceedsCeiling`・`isHighObjection` と3関数の置き換え
- [ ] Step 2: `ledger open --type objection`・`ledger object` の上限との比較
- [ ] Step 3: 同意ゲートの slot と `hasConsentItems`（requested のサイクル全体）、`consentProblem` の案内
- [ ] Step 4: `ledger object --defer`（拒否の条件）
- [ ] Step 5: `directiveOf`・`buildDirective`・`currentStep` の positionOnly
- [ ] Step 6: help・docs・CHANGELOG
- [ ] Step 7: テスト（受け入れ基準ごと）、`conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test`
