# Build 06: 事後同意（PR を作る直前の同意ゲート）

## 依存パッケージ

なし（実行時依存ゼロのまま）

## クラス設計

### 設定（`scripts/lib/config.mts`）

- `[consent]` はサイクル設定でだけ書ける。`loadConfig` のルート側に「サイクル設定でだけ書けるキー」の検査（`CYCLE_ONLY_TABLES = ["consent"]`）を新設し、ルートの `.hikyaku.config` にあればエラー
- `ResolvedConfig.consent: { deferred: boolean | undefined }` — サイクル設定に書かれた値（requested の素の値）。`[consent]` の未知のキーはエラー
- `readConsent(table: TomlTable | undefined, where: string): { deferred: boolean | undefined }` — 作業ツリーと merge-base のサイクル設定の両方で使う

### 有効の判定（新規 `scripts/lib/deferred-consent.mts`）

```ts
export interface DeferredConsent { requested: boolean; effective: boolean; reason: string }
export function deferredConsent(config: ResolvedConfig, cycleDirectory: string | undefined): DeferredConsent
```

- `ResolvedConfig` を鍵に WeakMap でキャッシュ（`effectiveDeclaration` と同じ型）。git を読むので `loadConfig` の中では計算しない（Stop フックの `loadConfig` を遅くしないため）。design-delta の「`ResolvedConfig.deferredConsent`」は、この関数と `config --json` の `deferredConsent` 欄で表す
- 有効の条件（順に判定し、最初に外れた理由を `reason` に入れる）
  1. `requested`（`config.consent.deferred === true`）
  2. conductor の子（`HIKYAKU_CONDUCTOR_CHILD=1`）でない（この build の時点。build-07 が扱う）
  3. `effectiveDeclaration(config).declaration?.mergeGate === "user"`（build-02 の論理積。作業ツリーだけで足した `merge_gate` は効かない）
  4. (a) planning/progress.jsonl の最後の G1 の approved の記録の `deferredConsent` が `true`、または (b) ベースブランチ（`config.baseBranch ?? デフォルトブランチ`。`resolvePrBase` の `defaultBase` と同じ）との merge-base のサイクル設定（`git show <commit>:<サイクルのディレクトリ>/.hikyaku.config`）の `[consent] deferred` が `true`。merge-base は `effectiveDeclaration(config).baselines` のうち、そのブランチの読めた基準の `commit` を使う（Hikyaku のブランチは基準にしない＝スタック元・conductor ブランチは判定に使わない）
- `deferredConsentNotice(config, cycleDirectory): string | undefined` — requested なのに有効でないときの1行

### 進捗の記録（`scripts/lib/progress.mts`・`scripts/commands/step.mts`）

- `ProgressEvent.deferredConsent?: boolean`。planner の G1 の approved で、`step report` がそのときのサイクル設定の値（`config.consent.deferred === true`）を書く。LLM の引数では受け取らない
- planner の G1 の `args` に `deferredConsent`（同じ値）を足す。`skills/planner/steps/G1.md` で profile の行と並べて1行出す

### 同意の判定（`scripts/lib/steps/engine.mts`・`architect.mts`）

- `StepDefinition.defers?: (ctx: StepContext) => DeferredRisk | undefined`（gate でないステップだけ。step lint で検査）。done の報告で、報告を足した後の記録で評価し、上限を超える受け入れで事後同意が有効なら `DeferredRisk` を返す

```ts
export interface DeferredRisk { gate: string; summary: string; premises: string[]; harm?: Harm }
```

- architect の options に `defers`（G3 の判定のうち宣言による同意＝害が上限を超える・申告が重い領域に当たる）、design-delta に `defers`（G4 の裏取りで申告に無い重い領域に触れた）を置く。同意に倒す他の理由（再設計の回・基準を読めない・申告の欠け・裏取りできない）は `now` のまま
- `step report` は `defers` が値を返したら `--loses` を必須にし、進捗を追記したあとに `risk` の事項（`who=user`・`when=merge@architect`・`ask=G3|G4`・`premises`・`loses`）を `ledger` の書き込み関数で記録する
- G3・G4 の `consent` は、宣言による同意の回で、事後同意が有効かつ、その回の options（G4 は design-delta）の最後の done より後にその gate の `risk` の事項が記録されていれば `{ timing: "deferred" }`。記録が無ければ `now`（安全側）
- 事項の前提: 害が上限を超えた → `app.exposure` / `app.data` / `app.impact` のうち上限を決めた軸、重い領域 → `area:<name>`

### 同意ゲート（新規 `scripts/lib/steps/consent.mts`）

```ts
export function consentStep(skill: string, when?: (ctx: StepContext) => boolean): StepDefinition
export function consentItems(ctx: StepContext): LedgerItem[]   // 一覧の対象
export function consentProblem(ctx: StepContext): string | undefined  // 決定の無い項目・やり直していない退け
```

- id `consent`、kind `gate`、ask `deferred-consent`、`consent: () => ({ timing: "now", reason: "上限を超えるリスクの受け入れ（事後同意）" })`
- 対象: `type=risk` かつ `who=user` かつ `when=merge@<この作業単位>` の事項（どの作業単位で記録したかは問わない）
- `when`: 対象があるとき。サイクル設定で requested のときだけサイクルの記録全体を読み、そうでなければこの作業単位の decisions.jsonl だけを読む。読めなければ手順に入れる（安全側）
- 承認の条件（`accepts` を gate の approved にも効かせる。step.mts）: 全項目にユーザーの決定（consented / rejected / resolved / decided）がある。退け（最新が rejected）は、同じ作業単位の事項ならその事項の `step` を退けの決定の後に done で報告し直していること、前のフェーズ（記録した単位が別）の事項なら resolved になっていること（それまでは return.md の経路）
- `args`: `items`（ID の一覧）、`reworkFrom`（同じ作業単位の退けのうち、まだやり直していない最も前のステップ）、`returnItems`（前のフェーズの退け）
- architect（`pr` の直前、`pr` と同じ when）・builder（`pr` の直前）・patch（`publish` の直前）に置く
- `pr` の `accepts`（patch は `publish`）にも `consentProblem` を付ける（同意ゲートが外れていても、決定の無い項目があれば PR を完了にしない）

### ledger（`scripts/commands/ledger.mts`・`scripts/lib/ledger.mts`）

- `ledger object --defer`: `--decision` / `--input` を求めず、`risk` の事項（`who=user`・`when=merge@<unit>`・`basis`・`loses`・`harm`・`premises`）を記録する。拒むのは、事後同意が無効、`--premises` が無い・`app.*` / `area:*` 以外を含む、害が上限（宣言の軸と、前提に挙げた領域の軸の最大から `ceilingOf`）を超えない、のどれか
- `ledger consent-list <phase> [<cycle>] [--full] [--json]`: 1項目を「受け入れたリスク / 拠り所の前提 / 失うもの」の3行（`--full` で根拠・害・決定まで）
- `ledger pr-section <phase> [<cycle>] [--json]`: 4節「受け入れたリスク（事後同意）」「未解決の退け」「マージの前に決める事項」（`when=merge@<unit>` の question・provisional で未決）「期限を過ぎた事項」（サイクルの未決で `overdue`）。どれも無ければ空
- `ledger return-draft <phase> [<cycle>] --items <id,...>`: 退けによる return.md の下書き（1行目の見出し・「何が崩れたか」・「試したこと」＝退けた受け入れと拠り所・「問題を変える選択肢」と「推奨」は LLM が書く欄・「退けた項目」に ID）。書き込まない
- `lib/ledger.mts` に `isConsentItem(item, unit)`・`consentItemsOf(ledger, unit)` を置き、consent.mts と commands が同じ判定を使う

### 表示

- `buildDirective` の notices に `deferredConsentNotice`（requested なのに無効のとき。手順の位置だけを読む経路では出さない）
- `config --json` に `deferredConsent`、テキストにも1行

### conductor・指示文・docs

- `ASKS` に `{ id: "deferred-consent", category: "consent" }`。`skills/{architect,builder,patch}/steps/consent.md` を新設（`（ask: deferred-consent）`）
- `skills/{planner,architect,builder,patch,close-cycle}/steps/pr.md` に `ledger pr-section` の出力を貼る手順（patch は publish.md）
- `skills/builder/references/templates.md` の return.md に「退けた項目」節、`return.md`（references）に退けからの差し戻しの1行
- `skills/architect/steps/options.md`・`design-delta.md` に `--loses` を求められたときの1行
- docs: `configuration/config-file.md`（`[consent]`）、`configuration/profiles.md`（事後同意と同意ゲート）、`workflow/` の各フェーズ、`reference/cli.md`。CHANGELOG の `[3.0.0]`

## 非機能要件

- **セキュリティ**: 該当なし（ワークフローの承認の記録。アプリケーションのアクセス制御ではない）。ただし、作業中のブランチで AI が設定を足しても効かない（G1 の記録か、ベースブランチの merge-base でだけ有効）ことを結合テストで確かめる
- **パフォーマンス**: 有効の判定は git を読むのでキャッシュし、requested でなければ git も記録も読まない。Stop フックの経路（手順の位置だけ）では同意ゲートの `when` が記録を読むのは requested のときだけ
- **エラーハンドリング**: 記録や基準を読めないときは有効にしない・同意ゲートを出す・G3/G4 を now にする、の安全側に倒す
- **マージ時点のデータ安全**: 該当なし（本番データに触れない。既存のサイクルは `[consent]` を書いていないので、事後同意も同意ゲートも現れず、従来どおり動く）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 395k |
| builderフェーズ段階 | 430k |

**読むファイル**

- `design/design-delta.md` の 1節・3節、ADR `20261116-deferred-consent.md`・`20261116-approval-kind-in-step-definitions.md`（読み済み）
- `scripts/lib/steps/engine.mts`・`architect.mts`・`builder.mts`・`patch.mts`・`planner.mts`・`publication.mts`・`directive.mts`（読み済み）
- `scripts/lib/ledger.mts`・`scripts/commands/ledger.mts`・`scripts/commands/step.mts`（読み済み）
- `scripts/lib/config.mts`（loadConfig・finalize は読み済み、読み込み関数の残り約 150 行）、`scripts/lib/risk.mts`（基準の部分は読み済み）
- `scripts/lib/conductor.mts` の ASKS、`scripts/lib/progress.mts`、`scripts/commands/config.mts`
- `skills/*/steps/pr.md`・`skills/planner/steps/G1.md`・`skills/builder/references/templates.md`（読み済み）
- `docs/configuration/config-file.md`・`profiles.md`、`tests/helpers.mts` と既存の ledger・step のテスト

**作成するファイル**

- `scripts/lib/deferred-consent.mts`（約 150 行）、`scripts/lib/steps/consent.mts`（約 120 行）
- `skills/architect/steps/consent.md`・`skills/builder/steps/consent.md`・`skills/patch/steps/consent.md`
- `tests/deferred-consent.test.mts`（約 400 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 60k | このセッションの開始時の固定分の実測 59k |
| 読み込み | 180k | plan 作成までに読んだ分の実測（約 130k: engine・architect・ledger lib/cmd・step.mts・directive.mts・config.mts の loadConfig・risk.mts の基準・依存ビルドの handoff・ADR）に、残り（config.mts の読み込み関数・conductor.mts の ASKS・各 pr.md・G1.md・docs の config-file.md と profiles.md・tests の helpers と既存の ledger テスト）約 50k |
| 実装 | 100k | 新規 lib/deferred-consent.mts（約 150 行）・steps/consent.mts（約 120 行）、config.mts・architect.mts・planner/builder/patch の steps・step.mts・directive.mts・commands/ledger.mts（consent-list・pr-section・return-draft・object --defer、約 250 行）、step 指示文 3 つと pr.md 5 つ・templates.md・docs・CHANGELOG |
| テスト | 50k | tests/deferred-consent.test.mts（一時 Git リポジトリの結合テスト、約 400 行）と既存テストの修正 |
| 未知の領域 | 40k | エンジンのやり直しの規則と退けの戻り先の組み合わせ、merge-base のサイクル設定の読み出し、npm test の修正ループ |
| **予測ピーク** | **430k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: config.mts の `[consent]`（サイクル限定・ルートでエラー）と `ResolvedConfig.consent`
- [ ] Step 2: `lib/deferred-consent.mts`（有効の判定・notice）、`ProgressEvent.deferredConsent`、G1 の args と記録、`config` の出力
- [ ] Step 3: engine の `defers`（lint を含む）、architect の options・design-delta の `defers` と G3・G4 の `deferred`、step report の `--loses` と risk の自動記録、gate の approved で `accepts`
- [ ] Step 4: `lib/ledger.mts` の同意の対象、`steps/consent.mts` と architect・builder・patch への配置、pr の accepts
- [ ] Step 5: `ledger object --defer`・`consent-list`・`pr-section`・`return-draft`、directive の notices
- [ ] Step 6: ASKS とタグ、指示文（consent.md・pr.md・G1.md・options.md・design-delta.md・templates.md・return.md）
- [ ] Step 7: docs と CHANGELOG
- [ ] Step 8: テスト（受け入れ基準ごと）、`conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test`
