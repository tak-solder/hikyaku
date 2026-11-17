# Build 06: 事後同意（PR を作る直前の同意ゲート）

分割（G6）のあとの範囲: 同意ゲートと `ledger consent-list` / `pr-section`。有効の判定と上限を超える受け入れの積み上げは build-16、退けの作り直しの経路は build-17。分割前の設計（plan-review の指摘を反映済み）は、この plan.md の Git の履歴にあり、build-16 の issue.md が指している。

## 依存パッケージ

なし（実行時依存ゼロのまま）

## クラス設計

### 同意の対象（`scripts/lib/ledger.mts`）

```ts
/** 同意ゲートの一覧の対象: type が risk か objection、who=user、when=merge@<unit> */
export function isConsentItem(item: LedgerItem, unit: string): boolean
export function consentItemsOf(ledger: Ledger, unit: string): LedgerItem[]
/** 決定が足りない項目（決定が無い、ユーザーの決定でない、最新が rejected） */
export function undecidedConsentItems(items: LedgerItem[]): LedgerItem[]
/** その作業単位の decisions.jsonl だけに対象があるか（読めなければ true＝安全側） */
export function unitHasConsentItems(unitDirectory: string, unit: string): boolean
```

- 決定として数えるのは、最新の決定が `by=user` の `consented` / `decided` / `resolved`。`rejected` は数えない（作り直しの経路は build-17。それまでは `resolved` まで止める）
- 期限の判定（`timingOf`）の `merge` の区切りは既存の `mergeAnchor`（`consent` があればそれ）をそのまま使う

### 同意ゲート（新規 `scripts/lib/steps/consent.mts`）

```ts
export function consentStep(skill: string, when?: (ctx: StepContext) => boolean): StepDefinition
export function consentProblem(ctx: StepContext): string | undefined
```

- `consentStep`: id `consent`、kind `gate`、ask `deferred-consent`、`consent: () => ({ timing: "now", reason: "上限を超えるリスクの受け入れ（事後同意）" })`
  - `when`: 引数の `when`（architect は `pr` と同じ）を満たし、サイクルに属し、conductor の子（`HIKYAKU_CONDUCTOR_CHILD=1`）でなく、`unitHasConsentItems(ctx.unitDirectory, ctx.unit)`。手順の位置だけを読む経路でもこのファイル1つだけを読む（build-04 の delegation のきっかけと同じ種類の例外）
  - `accepts`: `consentProblem`
  - `args`: `{ items: <ID の一覧> }`（手順の位置だけを読む経路では空）
- `consentProblem`: サイクルが無ければ undefined。`readLedger`（失敗したら `readUnitLedger` に倒さず、読めないことを理由に返す＝安全側）で対象を集め、`undecidedConsentItems` が空でなければ ID と、`ledger consent-list` / `ledger decide` の案内を返す
- `ledger.mts` は `steps/index.mts` を import しているので、`consent.mts` は `ledger.mts` から値（関数）だけを使い、`ledger.mts` からは `consent.mts` を import しない（循環を作らない）

### 手順への配置

- architect: `pr` の直前に `consentStep("architect", (ctx) => roundOf(ctx) !== "return")`。`pr` に `accepts: consentProblem`
- builder: `pr` の直前に `consentStep("builder")`。`pr` に `accepts: consentProblem`
- patch: `publish` の直前に `consentStep("patch")`。`publish` に `accepts: consentProblem`（`publicationStep` に accepts を渡せるようにする）
- `scripts/commands/step.mts`: gate の approved の報告でも `definition.accepts` を確かめる（今は done だけ。gate で accepts を持つのは consent だけ）。`engine.mts` の `accepts` の説明を改める

### ledger のコマンド（`scripts/commands/ledger.mts`）

- `ledger consent-list <phase> [<cycle>] [--full] [--json]`: 対象を1項目につき「受け入れたリスク: summary / 拠り所の前提: premises / 失うもの: loses」の3行と、ID・決定の状態の見出しで出す。`--full` で根拠・害・いつ・決定の記録まで
- `ledger pr-section <phase> [<cycle>] [--json]`: 次の節を、中身があるものだけ Markdown で出す。どれも無ければ空
  - 「受け入れたリスク（事後同意）」: その単位の対象と決定
  - 「未解決の退け」: サイクル全体で最新が rejected の事項
  - 「マージの前に決める事項」: `when=merge@<unit>` の question・provisional で未決
  - 「期限を過ぎた事項」: サイクル全体の未決で `overdue`
- どちらも書き込まない

### conductor・指示文・docs

- `ASKS` に `{ id: "deferred-consent", category: "consent", where: "architect / builder / patch: PR を作る直前の事後同意の一覧" }`
- `skills/{architect,builder,patch}/steps/consent.md` を新設（`（ask: deferred-consent）`。`ledger consent-list` で示し、項目ごとに `ledger decide --by user` で記録してから承認を報告する）
- `skills/{planner,architect,builder,close-cycle}/steps/pr.md` と `skills/patch/steps/publish.md` に、`ledger pr-section` の出力を本文に貼る1行
- docs: `docs/workflow/` の architect・build・patch、`docs/reference/cli.md`。CHANGELOG の `[3.0.0]`

## 非機能要件

- **セキュリティ**: 該当なし（ワークフローの承認の記録）
- **パフォーマンス**: 同意ゲートの `when` は作業単位のファイル1つだけを読む。サイクル全体を読むのは報告の時の `accepts` と、ゲートの args・コマンドだけ
- **エラーハンドリング**: 記録を読めないときは、`when` は手順に入れ、`accepts` は受け付けない（安全側）
- **マージ時点のデータ安全**: 該当なし（本番データに触れない。既存のサイクルには `when=merge@` の `risk`・`objection` の事項が無いので、同意ゲートは現れず、pr の accepts も通る）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 395k（分割後の issue.md では 435k） |
| builderフェーズ段階 | 435k |

**読むファイル**

- 読み済み: design-delta 1節・3節、ADR deferred-consent、`scripts/lib/steps/engine.mts`・`architect.mts`・`builder.mts`・`patch.mts`・`planner.mts`・`publication.mts`・`directive.mts`、`scripts/lib/ledger.mts`、`scripts/commands/ledger.mts`・`step.mts`、`skills/builder/steps/pr.md`
- 残り: `scripts/lib/conductor.mts` の ASKS、`scripts/lib/steps/locate.mts`、各 `pr.md`・`publish.md`、`tests/helpers.mts` と手順の並びを確かめる既存テスト、`docs/workflow/` の各フェーズ・`docs/reference/cli.md`・CHANGELOG

**作成するファイル**

- `scripts/lib/steps/consent.mts`（約 100 行）
- `skills/architect/steps/consent.md`・`skills/builder/steps/consent.md`・`skills/patch/steps/consent.md`
- `tests/consent-gate.test.mts`（約 300 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 100k | このセッションの開始時の実測 59k に、手順の進行分（plan・2回のレビュー・分割の検討・G6・G8 の提示） |
| 読み込み | 205k | このセッションの見積もり時点の実測 274k のうち、固定費を除く読み込み約 175k（engine・architect・builder・patch・planner・directive・ledger lib/cmd・step.mts・config.mts・risk.mts・依存ビルドの handoff・ADR・2回のレビュー結果）に、残り: conductor.mts の ASKS・locate.mts・各 pr.md と publish.md・tests の helpers と手順の並びを確かめる既存テスト・docs/workflow の各フェーズ・reference/cli.md・CHANGELOG（約 30k） |
| 実装 | 55k | 新規 steps/consent.mts（約 100 行）、lib/ledger.mts（同意の対象）、architect・builder・patch の steps 定義と pr の accepts、step.mts（gate の approved で accepts）、commands/ledger.mts（consent-list・pr-section、約 150 行）、consent.md 3つ・pr.md 5つ・docs・CHANGELOG |
| テスト | 45k | tests/consent-gate.test.mts（一時 Git リポジトリ。同意ゲートの出現と accepts、conductor の子、pr-section の4節、約 300 行）と、手順の並びを確かめる既存テストの修正 |
| 未知の領域 | 30k | steps/consent.mts → ledger.mts → steps/index.mts の循環 import、npm test の修正ループ |
| **予測ピーク** | **435k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `lib/ledger.mts` の同意の対象の関数
- [ ] Step 2: `steps/consent.mts` と architect・builder・patch への配置、pr / publish の accepts、step.mts の gate の approved で accepts
- [ ] Step 3: `ledger consent-list`・`ledger pr-section`
- [ ] Step 4: ASKS とタグ、consent.md 3つ、pr.md・publish.md
- [ ] Step 5: docs と CHANGELOG
- [ ] Step 6: テスト、`conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test`
