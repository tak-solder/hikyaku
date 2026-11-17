# Build 15: G3・G4 を宣言の上限で同意にする（害とパスの申告と裏取り）

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/progress.mts`

- `ProgressEvent` に任意欄を足す: `harm?: "高" | "中"`、`paths?: string[]`（options の done の申告。中身を含まない値）

### `scripts/lib/steps/engine.mts`

- `StepDefinition` に足す:
  - `declaresRisk?: boolean` — done の報告で `--harm` / `--paths` を受け付けるステップ（architect の options だけ）。gate は持てない（`lintApproval` で検査）
  - `notices?: (ctx: StepContext) => string[]` — directive の notices に足す行（G3・G4 が基準の宣言を読めなかったことを出す）。手順の位置だけを読む経路（`notices: false`）では呼ばない

### `scripts/commands/step.mts`（`buildEvent`）

- `--harm` は `高|中` だけ、`--paths` は `splitList`（rules.mts。波括弧の外のカンマで区切る）で空でない glob の並び
- どちらも `declaresRisk` のステップの done だけで受け付ける（ほかはエラー）。欠けていても受け付ける
- usage と details に `--harm` / `--paths` を足す

### `scripts/lib/steps/directive.mts`

- `reportCommand`: `declaresRisk` のステップの done に ` --harm 高|中 --paths <触れるパスの glob,...>` を載せる
- `buildDirective`: `definition.notices` があれば、`options.notices !== false` のときに `base.notices` に足す

### `scripts/lib/steps/architect.mts`

- `riskDeclaration(ctx): { harm?: Harm; paths?: string[] } | undefined` — この回（`currentEvents`）の最後の options の done の申告。done が無ければ undefined
- `g3Consent(ctx, { withDeclaration }): ConsentJudgement`
  1. 差し戻しからの再設計の回 → `now`
  2. `withDeclaration` が false（options の done がまだ無い）→ false
  3. `effectiveDeclaration(config)` が `incomplete` → `now`（厳しさの分からない基準がある）
  4. 宣言が無い → false（従来どおりプロファイル）
  5. `--harm` か `--paths` が欠ける → `now`
  6. `exceeds(harm, ceilingOf(declaration.axes))` → `now`
  7. `heavyAreasHit(declaration, paths, repositoryFiles(config))` が空でない → `now`（害の重さに関わらず）
  8. それ以外 → false
- `undeclaredAreas(ctx): { name: string; touched: string[] }[] | Error` — design-delta.md と `cycleAdrs` の各 ADR の本文の `touchedPaths` を、`heavyAreasHit` で重い領域と照合し、G3 の申告の `paths` を同じ `heavyAreasHit`・同じ files で照合した領域（名前）を除く。options をスキップした回・申告に `--paths` が無い回は、申告は空とみなす。`cycleAdrs` が投げたら Error を返す
- G4 の `consent`: 再設計の回 → `now` / 宣言が無ければ false / `incomplete` → `now` / `undeclaredAreas` が Error → `now`（裏取りできない） / 空でなければ `now`（理由に領域名） / それ以外 false
- G4 の `args`: `undeclaredAreas`（宣言が無ければ空配列）
- G3・G4 の `notices`: `effectiveDeclaration(config).notices`（G4 は裏取りできなかった理由も）
- `designChoiceGate`: options の done がまだ無い間は `g3Consent(ctx, { withDeclaration: false })`、あれば宣言込みで判定
- options に `declaresRisk: true`
- 宣言の計算は `effectiveDeclaration`・`repositoryFiles` のキャッシュ（ResolvedConfig を鍵）に任せる

### `scripts/lib/risk.mts`

- 冒頭のコメント「この版では宣言はまだゲートの判定に使わない」を、G3・G4 に使うことに改める（関数は変えない）

### `scripts/lib/conductor.mts`

- `CONSENT_WHEN` の G3・G4 の説明を、宣言の上限・申告の欠け・裏取りを含む文に改める

### 手順・docs

- `skills/architect/steps/options.md`: done に `--harm`（採る案の害の重さ。persistence.md の重要度の高・中）と `--paths`（採る案が触れるパスの glob）を付ける。宣言のあるワークスペースで欠けると G3 が同意になること
- `skills/architect/steps/G3.md`: 同意（`承認: 同意（…）`）として返ったときの提示（理由と、上限を超えた点を添える。お任せで済ませない）
- `skills/architect/steps/G4.md`: `undeclaredAreas` が空でないとき、当たった領域と触れたパスを示し、G3 の申告に無かったことを伝えて同意を得る
- `docs/configuration/profiles.md`・`docs/workflow/conductor.md`・`docs/workflow/architect.md`・`docs/configuration/config-file.md` の [app] 節、`CHANGELOG.md` の `[3.0.0]`

## 非機能要件

- **エラーハンドリング**: 基準を読めない・ADR の一覧を読めないときは、手順を止めずに同意（`now`）に倒し、notices に理由を出す（原則11: スクリプトの判定できない分は上げる向き）
- **パフォーマンス**: `consent` は Stop フック・conductor parse でも評価される。git を読む計算は `effectiveDeclaration`・`repositoryFiles` のキャッシュに載せ、宣言が無ければ ADR とファイル一覧を読まない
- **マージ時点のデータ安全**: 該当なし（データに触れない。宣言の無いワークスペースでは G3・G4 の判定は従来どおり）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 350k |
| builderフェーズ段階 | 340k |

**読むファイル**

- `design/design-delta.md` の「1. 承認の種類と上限」、ADR `20261116-risk-ceiling-table.md`・`20261116-approval-kind-in-step-definitions.md`、`build-02/handoff.md`
- `scripts/lib/risk.mts`（約 400 行）、`scripts/lib/steps/engine.mts`（約 420 行）・`directive.mts`（約 400 行）・`architect.mts`（約 280 行）、`scripts/commands/step.mts` の report（約 200 行）、`scripts/lib/progress.mts`
- `tests/step-consent.test.mts`（約 460 行）・`step-architect.test.mts`（約 370 行）・`risk.test.mts`（約 480 行）・`helpers.mts`
- `skills/architect/steps/options.md`・`G3.md`・`G4.md`、docs 4本の該当節、`CHANGELOG.md` の `[3.0.0]`

**作成するファイル**

- 上記 lib・commands・手順・docs の変更（約 250 行）
- `tests/step-risk-gates.test.mts`（新規、約 300 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 標準ガイドの出発点の中央。手順の進行分を含む |
| 読み込み | 110k | design-delta 1節・ADR 2本・build-02 handoff・risk.mts・engine/directive/architect.mts・step.mts（report）・progress.mts は読了。残りは tests/step-consent・step-architect・risk.test・helpers、docs 4本の該当節、CHANGELOG [3.0.0] |
| 実装 | 55k | progress の harm/paths、StepDefinition.declaresRisk と notices、step report の検査、reportCommand、architect.mts の G3/G4 consent・args・notices・designChoiceGate、CONSENT_WHEN、options/G3/G4.md、docs 4本、CHANGELOG |
| テスト | 50k | G3 の同意化（上限超え・重い領域・申告の欠け・宣言なし・incomplete）、G4 の裏取り（申告に無い領域・options スキップ）、notices、--harm/--paths の検査、designChoiceGate、既存テストの追随 |
| 未知の領域 | 35k | 一時リポジトリで宣言と design-delta/ADR を置く結合テストの調整、既存の architect の結合テストへの波及 |
| **予測ピーク** | **340k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
