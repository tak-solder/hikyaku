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
- `objection` の事項は build-04 の `objectionSettled`（export する）で判定する。害が高の異議は、受け入れの言葉（`--accepts`）の無い `consented` を決定として数えない（build-04 の handoff「事後同意に回す異議もこの関数で判定する」。plan-review の指摘）。`resolved` は、異議でも片づきとして数える（作り直したあとにユーザーが記録するもの）
- 期限の判定（`timingOf`）の `merge` の区切りは既存の `mergeAnchor`（`consent` があればそれ）をそのまま使う

### 同意ゲート（新規 `scripts/lib/steps/consent.mts`）

```ts
export function consentStep(skill: string, when?: (ctx: StepContext) => boolean): StepDefinition
export function consentProblem(ctx: StepContext): string | undefined
```

- `consentStep`: id `consent`、kind `gate`、ask `deferred-consent`、`consent: () => ({ timing: "now", reason: "上限を超えるリスクの受け入れ（事後同意）" })`
  - `when`: 引数の `when`（architect は `pr` と同じ）を満たし、サイクルに属し、conductor の子（`HIKYAKU_CONDUCTOR_CHILD=1`）でなく、`unitHasConsentItems(ctx.unitDirectory, ctx.unit)`。手順の位置だけを読む経路でもこのファイル1つだけを読む（build-04 の delegation のきっかけと同じ種類の例外）
  - `accepts`: `consentProblem`
  - `reopens`: 承認のあとに、その作業単位のファイルに決定の足りない対象が足されたら現在地に戻す（ファイル1つだけを読む。plan-review の指摘）
  - `args`: `{ items: <ID の一覧> }`（手順の位置だけを読む経路では空）
- `consentProblem`: サイクルが無ければ undefined。`readLedger`（失敗したら `readUnitLedger` に倒さず、読めないことを理由に返す＝安全側）で対象を集め、`undecidedConsentItems` が空でなければ ID と、「`skills/<skill>/steps/consent.md` の手順で一覧をユーザーに示し、決定を記録してから報告し直す」という案内を返す（`ledger decide` を直接促さない。ユーザーへの問いは `（ask: deferred-consent）` の付いた手順の中で行う）
- `ledger.mts` は `steps/index.mts` を import しているので、`consent.mts` は `ledger.mts` から値（関数）だけを使い、`ledger.mts` からは `consent.mts` を import しない（循環を作らない）

### 手順への配置

- architect: `pr` の直前に `consentStep("architect", (ctx) => roundOf(ctx) !== "return")`。`pr` に `accepts: consentProblem`
- builder: `pr` の直前に `consentStep("builder")`。`pr` に `accepts: consentProblem`
- patch: `publish` の直前に `consentStep("patch")`。`publish` に `accepts: consentProblem`（`publicationStep` に accepts を渡せるようにする）
- planner・close-cycle: 同意ゲートは置かないが、`pr` に `accepts: consentProblem` を付ける（`merge@plan` / `merge@close` の `who=user` の事項が決定なしで PR になるのを防ぐ。plan-review の指摘）。案内は consent.md の代わりに「その場でユーザーに示して決定を記録する」
- `scripts/commands/step.mts`: gate の approved の報告でも `definition.accepts` を確かめる（今は done だけ。gate で accepts を持つのは consent だけ）。`engine.mts` の `accepts` の説明を改める

### ledger のコマンド（`scripts/commands/ledger.mts`）

- `ledger consent-list <phase> [<cycle>] [--full] [--json]`: 対象を1項目につき「受け入れたリスク: summary / 拠り所の前提: premises / 失うもの: loses」の3行と、ID・決定の状態の見出しで出す。`--full` で根拠・害・いつ・決定の記録まで
- `ledger pr-section <phase> [<cycle>] [--json]`: 次の節を、中身があるものだけ Markdown で出す。どれも無ければ空
  - 「受け入れたリスク（事後同意）」: その単位の対象のうち決定のあるものと決定。決定の無いものは「受け入れた」と読める見出しの下に出さず、「同意の決定が無い項目」として別に出す
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
| builderフェーズ段階 | 390k（新しいセッションで test-spec から再開する前提） |

plan と分割の検討を行ったセッションは、plan-review の時点で 325k に達した。このまま実装まで続けると約 520k になり、範囲をさらに分けてもこのセッションの消費は減らない。そのため、test-spec から新しいセッションで再開する前提で見積もった（plan-review の2回目の指摘）

**読むファイル**

- 読み済み: design-delta 1節・3節、ADR deferred-consent、`scripts/lib/steps/engine.mts`・`architect.mts`・`builder.mts`・`patch.mts`・`planner.mts`・`publication.mts`・`directive.mts`、`scripts/lib/ledger.mts`、`scripts/commands/ledger.mts`・`step.mts`、`skills/builder/steps/pr.md`
- 残り: `scripts/lib/conductor.mts` の ASKS、`scripts/lib/steps/locate.mts`・`index.mts`、`scripts/lib/steps/close-cycle.mts`、各 `pr.md`・`publish.md`、`tests/helpers.mts`・`objection.test.mts`・期限（`mergeAnchor`）のテストと手順の並びを確かめる既存テスト、`docs/workflow/` の各フェーズ・`docs/reference/cli.md`・CHANGELOG

**作成するファイル**

- `scripts/lib/steps/consent.mts`（約 100 行）
- `skills/architect/steps/consent.md`・`skills/builder/steps/consent.md`・`skills/patch/steps/consent.md`
- `tests/consent-gate.test.mts`（約 300 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 110k | 新しいセッションで test-spec から再開する前提。標準ガイドの出発点 90k に、残りの手順の進行分（test-spec の委任と review・G8・agreement-review・コードレビュー2ラウンドの結果・handoff・retrospective・pr・publish）20k |
| 読み込み | 130k | plan.md・issue.md・design-delta 3節・ADR deferred-consent・build-04 の handoff、steps/engine.mts・architect.mts・builder.mts・patch.mts・planner.mts・close-cycle.mts・publication.mts・index.mts・locate.mts、lib/ledger.mts、commands/ledger.mts・step.mts、conductor.mts の ASKS、各 pr.md・publish.md、tests の helpers・objection.test.mts・期限のテスト・手順の並びのテスト、docs/workflow の architect・build・patch・reference/cli.md・CHANGELOG |
| 実装 | 60k | 新規 steps/consent.mts（約 120 行。reopens を含む）、lib/ledger.mts（同意の対象・objectionSettled の export）、5つのスキルの steps 定義と pr / publish の accepts、step.mts（gate の approved で accepts）、commands/ledger.mts（consent-list・pr-section、約 150 行）、consent.md 3つ・pr.md 4つ・publish.md・docs・CHANGELOG |
| テスト | 50k | tests/consent-gate.test.mts（一時 Git リポジトリ。同意ゲートの出現と accepts・reopens、高の異議の受け入れの言葉、conductor の子、planner の pr の accepts、pr-section の節、約 350 行）と、期限・手順の並びの既存テストの修正 |
| 未知の領域 | 40k | steps/consent.mts → ledger.mts → steps/index.mts の循環 import、mergeAnchor が consent に変わる期限の判定、コードレビューの修正ループ |
| **予測ピーク** | **390k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [x] Step 1: `lib/ledger.mts` の同意の対象の関数
- [x] Step 2: `steps/consent.mts` と architect・builder・patch への配置、pr / publish の accepts、step.mts の gate の approved で accepts
- [x] Step 3: `ledger consent-list`・`ledger pr-section`
- [x] Step 4: ASKS とタグ、consent.md 3つ、pr.md・publish.md
- [x] Step 5: docs と CHANGELOG
- [x] Step 6: テスト、`conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test`（lint は npm test の中のテストで確かめた。CLI の直接実行は権限で拒否された）
