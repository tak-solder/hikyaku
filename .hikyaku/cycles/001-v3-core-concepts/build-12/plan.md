# Build 12: G4 と G8 の提示（gate brief）

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/gate-brief.mts`（新規）

G4・G8 の提示の中身を組み立てる（読み取り専用）。`commands/gate.mts` と `steps/architect.mts` の G4 の `consent` が同じ関数を使う。

```ts
/** 境界のパスと、それに当たった設計の文書のパス */
export interface BoundaryHit { boundary: string; touched: string[] }

export interface BoundaryChanges {
  /** [boundaries] を作業ツリーか基準のどちらかで宣言しているか。false なら従来どおりの提示 */
  declared: boolean;
  /** 外との境界の変更（同意が要る） */
  external: BoundaryHit[];
  /** 内部の境界の変更（確かめる） */
  internal: BoundaryHit[];
  /**
   * 作業ツリーだけが [boundaries] を宣言していて、基準を1つも読めない（作業ツリーで境界を狭めても分からない）。
   * true なら G4 は同意に倒す。effectiveDeclaration の incomplete は [app] の上限の判定（G3 にも効く）なので広げず、
   * 境界の分はここで持つ
   */
  unverified: boolean;
  /** 照合した文書（design-delta.md と、このサイクルの ADR。リポジトリからの相対パス） */
  documents: string[];
  notices: string[];
}

/**
 * design-delta.md と cycleAdrs が触れるパス（touchedPaths）を、effectiveBoundaries の external / internal と
 * overlaps で照合する。宣言が無ければ declared: false と空。ADR の一覧・文書を読めなければ Error
 */
export function boundaryChanges(config: ResolvedConfig, designDirectory: string): BoundaryChanges | Error;

/** G4 の提示。境界の変更と、build-15 の重い領域の裏取り（G4 の args の undeclaredAreas / verified）を並べる */
export interface G4Brief {
  boundaries: BoundaryChanges | { error: string };
  /** G3 の申告に無い重い領域（steps/architect.mts の undeclaredAreas を export して使う） */
  undeclaredAreas: { name: string; touched: string[] }[];
  /** 裏取りできなかった（ADR を読めない）とき false */
  verified: boolean;
}
// G4Brief は commands/gate.mts が組む: boundaries は boundaryChanges、undeclaredAreas / verified は
// architect の G4 の args をステップエンジンで評価した値（step next と同じ文脈）

export interface G8Brief {
  /** test-spec.md があるか（スキップしたビルドでは false。そのときは plan.md を提示する） */
  testSpec: boolean;
  /** 見出しに「（解釈）」の印が付いたシナリオ（見出しから次の見出しまでの本文） */
  interpreted: { heading: string; body: string }[];
  /**
   * issue.md の「対応する受け入れ基準」のうち、どのシナリオの「- 対応:」にも無いもの。
   * 追跡できない（user-stories.md に番号付きの基準が無い・issue.md に節が無い）ときは undefined。
   * そのときの提示は issue.md の受け入れ基準の節をそのまま出す（網羅性を確かめる材料を消さない）
   */
  uncovered: string[] | undefined;
  /** 追跡できないときの issue.md の「受け入れ基準」の節 */
  criteriaSection: string | undefined;
}
export function g8Brief(cycleDirectory: string, buildDirectory: string): G8Brief;

/** テキストの提示（--full なしの要約 / --full の全文）。G4 は design-delta.md、G8 は plan.md・test-spec.md の全文 */
export function renderG4Brief(brief: G4Brief, full: string | undefined): string;
export function renderG8Brief(brief: G8Brief, full: string | undefined): string;
```

`undeclaredAreas` の計算は steps/architect.mts にあるため、gate-brief.mts は architect.mts の export を `steps/index.mts` 経由で読まず、境界の照合（`boundaryChanges`）だけを architect.mts から使う向きにする。G4 の brief は CLI 側（commands/gate.mts）で `step next` と同じ文脈を組み、architect の G4 の `args`（`undeclaredAreas` / `verified`）を評価して受け取る（循環 import を作らない）。

### `scripts/lib/traceability.mts`（追加）

```ts
/** test-spec.md のシナリオ（### 見出しの単位）。heading・本文・「（解釈）」の印・「- 対応:」の番号 */
export interface TestScenario { heading: string; body: string; interpreted: boolean; criteria: string[] }
export function testSpecScenarios(testSpec: string): TestScenario[];
/** 印の文字列（テンプレートと parser で共有） */
export const INTERPRETED_MARK = "（解釈）";
```

コードブロックの中は `proseLines` と同じく読まない。

### `scripts/lib/risk.mts`（追加）

```ts
/**
 * 照合に使う境界。作業ツリーの [boundaries] と、effectiveDeclaration が読めた基準それぞれの [boundaries] の和。
 * セッションが作業ツリーで境界を消しても、ユーザーがマージした宣言の境界は残る（上限と同じく緩める向きを防ぐ）
 */
export function effectiveBoundaries(config: ResolvedConfig): Boundaries;
```

作業ツリーの `[boundaries]` の読み込み（build-02 の範囲）ではなく、基準の宣言を読む拡張。外との境界を作業ブランチで緩めさせないために要る（issue.md の「やらないこと」の `[boundaries]` の読み込みとは別）。

`Baseline` に `boundaries?: Boundaries` を足し、`readBaselineAt` で `[app]` と同じ TOML から読む（`config.mts` の `readBoundaries` を export して使う。読めなければ既存どおり `unreadableDeclaration`）。ファイルの先頭のコメント「境界はまだ判定に使わない（build-12）」を直す。

### `scripts/lib/steps/architect.mts`（変更）

- `g4Consent`: 差し戻しの回の判定・design-delta の done の前・`passedOver` の扱いはそのまま。`incomplete` の判定の前に、`boundaryChanges` の `external` が空でなければ `{ timing: "now", reason: "設計が外との境界（…）に触れている" }`。`Error`（ADR を読めない）で、境界を宣言していれば同意に倒す。境界の判定は `[app]` の宣言の有無（`undeclared`）より先に行う（`[boundaries]` だけ宣言したワークスペースでも効かせる）。外との境界は事後同意（build-06・16 の `deferred`）に回さないので、常に `now`
- 境界の判定は `unverified`（作業ツリーだけの宣言で基準を読めない）でも同意に倒す
- G4 の `args` に `boundaries: { declared, external, internal }` を足す（`positionOnly` では組み立てない）。`args`・`notices` とも、境界の組み立ては `undeclared(ctx)` の早期リターンより前に置く（`[app]` が無く `[boundaries]` だけのワークスペースでも、consent・args・notices が揃う）。境界の照合で ADR を読めなかったことも notices に出す。提示の正は `gate brief` で、args は conductor と G4.md の分岐用

### `scripts/commands/gate.mts`（新規）

```
hikyaku gate brief G4|G8 <phase> [<cycle>] [--full] [--root <path>] [--json]
```

- G4 は phase が `architect`、G8 は `build-NN` だけを受け付ける（ほかはエラー）
- `scopeFor` でサイクルを解決し、G4 は `{cycle}/design/`、G8 は `{cycle}/build-NN/` を読む
- `--json` は `G4Brief` / `G8Brief` をそのまま出す。終了コードは 0（読み取り専用。ADR を読めないときは G4 の notices に出す）
- `scripts/hikyaku.mts` に import を足す

### 手順・テンプレート

- `skills/architect/steps/G4.md`: `gate brief G4 architect {cycle}` の出力を提示する手順に改める。宣言なしなら従来どおり（design-delta と指摘への対処）。外との境界の変更があれば同意として、内部の境界の変更は確かめる変更として示す。重い領域の裏取り（`undeclaredAreas` / `verified: false`）の提示は残し、brief の出力にも並ぶ。`--full` は求められたときだけ
- `skills/builder/steps/G8.md`: `gate brief G8 build-{NN} {cycle}` の出力（「（解釈）」のシナリオと未対応の受け入れ基準）を提示し、全文は求められたときに `--full` で出す。追跡できない（番号なし）ときは brief が受け入れ基準の節を出すので、それと plan.md の実装ステップで網羅性を確かめる。test-spec をスキップしたビルドでは plan.md を提示する（従来どおり）
- `skills/builder/steps/test-spec.md`: 受け入れ基準から一意に決まらず解釈で決めた振る舞いのシナリオは、見出しの末尾に「（解釈）」を付け、`- 解釈:` の行に何をどう解釈したかを書く

### docs・CHANGELOG

- `docs/workflow/architect.md`（G4 の節）・`docs/workflow/build.md`（G8 の節）・`docs/configuration/profiles.md`（G4 の行と説明）・`docs/configuration/config-file.md`（`[boundaries]` は G4 の外との境界の同意に効く）・`docs/reference/cli.md`（gate brief をいつ使うか）
- CHANGELOG の `[3.0.0]`: 「`[boundaries]` は検査と表示だけ」を改め、`gate brief` と G4 の外の境界での同意、test-spec の「（解釈）」を追記

## 非機能要件

- **セキュリティ**: 外との境界の照合は、作業ツリーとユーザーがマージした基準の `[boundaries]` の和で行う（作業中のブランチで境界を消しても同意は外れない）。照合で迷う形は `overlaps` のとおり当たる側（同意側）に倒す。ADR を読めないときも境界を宣言していれば同意に倒す
- **パフォーマンス**: G4 の評価で `consent`・`args`・`notices` から何度も呼ばれるため、`undeclaredAreas` と同じく events を鍵にキャッシュする。`positionOnly` の経路（Stop フック）では git を読まない
- **エラーハンドリング**: `gate brief` は文書が無いとき（design-delta.md・test-spec.md が未作成）も止めずに、その旨を出す。phase と G の組み合わせが違えばエラー
- **マージ時点のデータ安全**: ワークスペースのデータの形は変えない（読み取り専用のコマンドと、test-spec.md の見出しの印の追加だけ）。印の無い既存の test-spec.md は「（解釈）」0件として読める。受け入れ基準に番号を振らない既存のサイクルでは、G8 の brief が受け入れ基準の節を出し、黙って空にしない。test-spec をスキップしたビルドは plan.md の提示のまま。`[boundaries]` を宣言していないワークスペースでは G4 の判定も提示も変わらない

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 280k |
| builderフェーズ段階 | 305k |

**読むファイル**

- `design/design-delta.md` の「9. G4 と G8 の提示」「1. 承認の種類と上限」（G4 の項）
- ADR `20261116-approval-kind-in-step-definitions.md`
- `scripts/lib/risk.mts`（約 400 行）・`scripts/lib/traceability.mts`（約 125 行）・`scripts/lib/steps/architect.mts`（約 470 行）・`scripts/lib/stack.mts` の scope
- `scripts/lib/config.mts` の `readBoundaries`・`readPaths`・`Boundaries`
- `scripts/lib/registry.mts`・`scripts/commands/diff.mts`（読み取り専用コマンドの例）
- `skills/architect/steps/G4.md`・`skills/builder/steps/G8.md`・`test-spec.md`
- `tests/step-risk-gates.test.mts`・`tests/risk.test.mts`・`tests/helpers.mts`
- docs: `workflow/architect.md`・`workflow/build.md`・`configuration/profiles.md`・`configuration/config-file.md`・`reference/cli.md`、CHANGELOG の `[3.0.0]` 節

**作成するファイル**

- `scripts/lib/gate-brief.mts`（約 220 行）
- `scripts/commands/gate.mts`（約 90 行）
- `tests/gate-brief.test.mts`（約 280 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 80k | risk.mts・traceability.mts・steps/architect.mts・design-delta・handoff 2件に加え、config.mts の boundaries 周り・registry.mts と commands/diff.mts・stack.mts の scope・tests/step-risk-gates.test.mts・tests/risk.test.mts・helpers・docs 5件（architect.md・build.md・profiles.md・config-file.md・cli.md）と CHANGELOG の [3.0.0] 節 |
| 実装 | 60k | gate-brief.mts（約 220 行）・commands/gate.mts（約 90 行）・risk.mts の基準の [boundaries] の読み取りと effectiveBoundaries・architect.mts の G4 consent/args/notices・traceability の test-spec 読み取り・G4.md/G8.md/test-spec.md・docs と CHANGELOG |
| テスト | 45k | tests/gate-brief.test.mts（G4 の分類・宣言なし・裏取りと境界の同時表示・G8 の解釈と未対応・番号なし・スキップ・--full の CLI）、step-risk-gates に G4 の外の境界での同意と [boundaries] だけの場合、risk.test.mts に基準の境界との和 |
| 未知の領域 | 30k | steps/index.mts との循環 import（gate-brief.mts を architect.mts から読む）、基準のブランチを用意する一時 Git リポジトリのテスト、touchedPaths と境界の glob の照合の取りこぼし |
| **予測ピーク** | **305k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `traceability.mts` に `testSpecScenarios` と `INTERPRETED_MARK`
- [ ] Step 2: `risk.mts` の基準に `[boundaries]` を読み、`effectiveBoundaries`（`config.mts` の `readBoundaries` を export）
- [ ] Step 3: `gate-brief.mts`（`boundaryChanges`・`g8Brief`・render）
- [ ] Step 4: `commands/gate.mts` と `hikyaku.mts` の登録
- [ ] Step 5: `steps/architect.mts` の G4 の `consent` と `args`
- [ ] Step 6: `tests/gate-brief.test.mts`、`tests/step-risk-gates.test.mts`（外の境界での同意、`[boundaries]` だけの場合、作業ツリーだけの宣言で基準を読めない場合）、`tests/risk.test.mts`（基準の境界との和、作業ツリーで消しても残ること）への追加
- [ ] Step 7: G4.md・G8.md・test-spec.md の手順
- [ ] Step 8: docs と CHANGELOG
- [ ] Step 9: ローカル検証（`npx tsc --noEmit`・`npm test`）
