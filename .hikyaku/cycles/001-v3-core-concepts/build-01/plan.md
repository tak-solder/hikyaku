# Build 01: 承認の種類の基盤（エンジン・G1・conductor の同意）

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/steps/engine.mts`

```ts
/** 同意の回。false は確認（プロファイルで省ける） */
export type ConsentTiming = "now" | "deferred";
export type ConsentJudgement = { timing: ConsentTiming; reason: string } | false;

interface StepDefinition {
  // 既存の欄に追加
  /** gate の承認の種類。gate は必ず持つ（step lint が検査）。false は常に確認 */
  consent?: false | ((ctx: StepContext) => ConsentJudgement);
  /** プロファイル・個別キーによる確認のオン・オフ。省略は有効 */
  enabled?: (ctx: StepContext) => boolean;
}

/** その回の同意の判定（consent が無い・false なら false） */
export function consentOf(definition: StepDefinition, ctx: StepContext): ConsentJudgement;

/** 手順に含めるか: when(ctx) && (consent が now || enabled(ctx) !== false) */
export function isOn(definition: StepDefinition, ctx: StepContext): boolean;
```

`evaluate` は `when` の代わりに `isOn` で `off` を決める。`deferred` の回は `enabled` で決まる（この build では返す定義が無い）。

### `scripts/lib/steps/directive.mts`

```ts
interface Directive {
  // gate のときだけ
  approval?: "confirm" | "consent";
  /** 同意の理由（確認なら null） */
  approvalReason?: string | null;
}
```

`consent` が `now` なら `consent`、それ以外（`false`・`deferred`）は `confirm`。`renderDirective` は gate の行に `承認: 確認` / `承認: 同意（理由）` を出す。

### 各ゲートの定義

| ゲート | when（構造） | enabled | consent |
|---|---|---|---|
| G1（planner） | なし | なし | 常に `now`（要件の合意） |
| G2（architect） | 追加設計でない・survey をスキップしていない | `gates.codebaseSurvey` | `false` |
| G3（architect） | `designChanges`・options をスキップしていない | `gates.designChoice` | `roundOf === "return"` なら `now`（差し戻しからの再設計） |
| G4（architect） | `designChanges` | `gates.architecture` | 同上 |
| G6（build-manager） | — | — | `false` |
| G7（builder） | なし | `gates.plan` | `false` |
| G8（builder） | — | — | `false` |
| G10（close-cycle） | — | — | 常に `now`（候補ごとの区分は build-11 が絞る。それまでは同意の側に倒す） |
| P1（patch） | — | — | 常に `now`（対応方針＝意図の合意） |
| P2（patch） | `writesDocs` | — | `false` |
| init / token-guide のゲート | 既存のまま | — | `false` |

architect の options・adr・pr の args の `designChoiceGate` は、`gates.designChoice` ではなく「その回に G3 が手順に入るか」（`isOn(G3 の定義, ctx)`）にする。express の再設計回で G3 が同意として現れたとき、options が推奨案を黙って採らず、adr がユーザーの選択を書くようにするため（指示ファイル `options.md`・`adr.md`・`pr.md` は値の意味が変わらないので直さない）。

### `scripts/lib/config.mts`

- `Gates` から `userStories` を除き、`PROFILES` の各 `gates` からも除く
- `RETIRED_KEYS` に `user_stories_gate` を足し、`retiredKeyErrors` に移行のヒント（「G1 は同意なので外せない。キーを削除する」）を足す。ルート設定は読んだ時点、サイクル設定は step の stop で止まる（既存の経路）

### `scripts/commands/config.mts`

G1 の行を「常に有効（同意）」に。

### `scripts/lib/conductor.mts`

```ts
export type Handler = "supervisor" | "user";
const DEFAULT_HANDLERS = { ..., consent: "user", failure: "user", abandon: "user", unknown: "user" };
const FIXED_CATEGORIES: AskCategory[] = ["consent", "abandon", "unknown"];
// ASKS: G6・G8 を confirm に
export function resolveAsk(
  id: string, conductor: ConductorConfig, settings: AskSettings,
  approval?: "confirm" | "consent",  // 子の手順の位置のゲートの承認の種類
): ResolvedAsk;
```

`approval` が渡されたら、その値をカテゴリにし、`enabled` を true にする（そのゲートで止まっているので出ている。静的な分類より、回ごとの判定を優先する）。`consent` なら `escalate`・`delegate` に関わらず `user`・`source: "fixed"`。`ResolvedAsk` に `approvalReason?` は持たせず、理由は parse の `step` に載せる。固定カテゴリのエラーメッセージ（`checkConductorAsks`）の「人間」を「ユーザー」にする。

### `scripts/commands/conductor.mts`

- `conductor parse`: `childStep` を先に求め、`step.kind === "gate" && step.ask === parsed.id` なら `step.approval` を `resolveAsk` に渡す。`ChildStep` に `approval`・`approvalReason` を足す
- `conductor asks`・`parse` の表示の「人間」を「ユーザー」に、「監督が判断する同意ゲート」の行を「ユーザーに上げる同意ゲート」に改める。G3・G4 は差し戻しからの再設計の回に同意としてユーザーに上がることを1行で示す（JSON には `consentWhen: { G3: "...", G4: "..." }` の形で載せる）

### `scripts/commands/step.mts`（step lint）

- gate なのに `consent` が無い（`undefined`）定義を問題にする
- gate でないのに `consent` か `enabled` を持つ定義を問題にする

### docs・スキル

- `docs/configuration/profiles.md`: ゲート表に「承認」列（確認 / 同意、条件付きの同意は条件を添える）。G1 は設定で外せない旨。確認と同意の段落を実装に合わせる
- `docs/configuration/config-file.md`: `user_stories_gate` の行を除き、廃止の一文を足す
- `docs/configuration/config-file.md` の `[conductor] delegate` の説明: 同意のゲートも指定できない
- `docs/workflow/conductor.md`（58・67・86・102 行あたり）: 同意ゲートはユーザーに上がる、G6・G8 は確認で監督が答える、express でも再設計回は G3・G4 で止まる
- `docs/workflow/plan.md`（19 行あたり）: G1 はどのプロファイル・設定でも止まる
- `skills/conductor/SKILL.md`: Step 0 の「監督が判断する同意ゲート」の行と「委任される」の段落を除き、同意ゲートはユーザーに上がることを示す。`human` → `user`。最後の PR の本文の「監督が判断した同意ゲート」（341 行）を「監督が答えた確認ゲート」に、G10 の答え方と G10 の前の検証（416・429 行）を除く。「監督に任せる」と答えたらその問いを監督が判断する（442-443 行）は、同意の問いには効かないと明記する
- `skills/conductor/references/headless-protocol.md`（88 行）: 「同意ゲート（G6 / G8 / G10）の判断も含まれます」を、確認ゲート（G6 / G8）に改める
- `CHANGELOG.md` の `[3.0.0]`

## 非機能要件

- **エラーハンドリング**: `user_stories_gate` は黙って無視せず、移行のヒントつきのエラーにする（既存の廃止キーと同じ経路）。`escalate`・`delegate` に同意の ID（G10）を書くと、既存の固定カテゴリと同じくエラー
- **マージ時点のデータ安全**: 該当なし（プラグインのスクリプトと文書の変更で、ワークスペースの記録の形は変えない。progress.jsonl は追加の欄なしで読める）。既存のサイクル設定に `user_stories_gate` があると、v3 の手順が止まる（スコープ外 Q5 で互換を要件にしない。エラーが移行先を示す）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 360k |
| builderフェーズ段階 | 395k |

**読むファイル**

- `design/design-delta.md` の「1. 承認の種類と上限」、ADR `20261116-approval-kind-in-step-definitions.md`
- `scripts/lib/steps/engine.mts`（281 行）・`directive.mts`（303 行）・`index.mts`
- `scripts/lib/steps/` の `architect.mts`・`planner.mts`・`builder.mts`・`build-manager.mts`・`close-cycle.mts`・`patch.mts`・`init.mts`・`token-guide.mts`
- `scripts/lib/conductor.mts`（662 行の前半）・`scripts/commands/conductor.mts`（parse まで）
- `scripts/lib/config.mts`（Gates・PROFILES・廃止キー・finalize）・`scripts/commands/config.mts`・`scripts/commands/step.mts`（lint）
- `tests/step*.test.mts`・`tests/conductor.test.mts`・`tests/config.test.mts`
- `skills/architect/steps/options.md`・`adr.md`・`pr.md`（`designChoiceGate` の読み方の確認）
- `docs/configuration/profiles.md`・`config-file.md`、`docs/workflow/conductor.md`・`plan.md`
- `skills/conductor/SKILL.md`・`references/headless-protocol.md`、`CHANGELOG.md` の `[3.0.0]`

**作成するファイル**

- 上記の lib・commands の変更
- `tests/step-consent.test.mts`（新規。同意を外せない・express の再設計回の `designChoiceGate`・directive の approval・lint）
- `tests/conductor.test.mts`・`tests/config.test.mts` の追加と期待値の書き換え
- docs 4本・`skills/conductor/SKILL.md`・`headless-protocol.md`・`CHANGELOG.md`

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 130k | engine/directive（約580行）・各スキルの steps 定義と index.mts・lib/commands の conductor・config.mts の Gates/PROFILES/廃止キー/finalize・commands/step.mts と config.mts・テスト（step 系約1,660行・conductor 1,148行・config 216行）・architect の options/adr/pr.md・conductor SKILL.md（443行）と headless-protocol.md・docs の profiles/config-file/workflow の conductor・plan・CHANGELOG [3.0.0]。約 60k は読了済み |
| 実装 | 75k | engine の consent/enabled/isOn、directive の approval、各 gate 定義の when→enabled と consent、architect の designChoiceGate を G3 の on に、Gates.userStories の削除と廃止エラー、ASKS・Handler・固定・resolveAsk の approval と enabled、asks の表示、parse の順序、step lint、conductor SKILL.md 4箇所と headless-protocol、docs 5本、CHANGELOG |
| テスト | 60k | 同意を外せない（G1・express と全ゲート off の再設計回の G3/G4）、express の再設計回の designChoiceGate、directive の approval、廃止キーのエラー、conductor の振り分け（consent 固定・delegate 不可・G6/G8 confirm・approval の上書き）、step lint、human の期待値の書き換え |
| 未知の領域 | 40k | Gates と Handler の型の変更が conductor の CLI 結合テストに波及する修正のループと、when を分けたときに巻き戻る結合テストの調整 |
| **予測ピーク** | **395k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: engine に `consent`・`enabled`・`consentOf`・`isOn` を足し、`evaluate` を `isOn` に切り替える
- [ ] Step 2: 各スキルのゲート定義に `consent` を付け、`gates.*` の条件を `when` から `enabled` に移す。architect の `designChoiceGate` を G3 の on に
- [ ] Step 3: directive に `approval`・`approvalReason` を出す
- [ ] Step 4: `Gates.userStories` の削除と `user_stories_gate` の廃止エラー、`config` の表示
- [ ] Step 5: conductor の `Handler`・既定・固定・ASKS・`resolveAsk` の `approval`、parse の順序
- [ ] Step 6: step lint の検査
- [ ] Step 7: テスト（新規と期待値の書き換え）
- [ ] Step 8: profiles.md・config-file.md・workflow の conductor.md・plan.md・conductor SKILL.md・headless-protocol.md・CHANGELOG
- [ ] Step 9: ローカル検証（`npx tsc --noEmit`・`npm test`・`step lint`・`conductor lint`）
