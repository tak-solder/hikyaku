# Build 16: 事後同意の有効の判定と、上限を超える受け入れの積み上げ

設計の下書きは build-06 の分割前の plan.md（`git show f55c573:.hikyaku/cycles/001-v3-core-concepts/build-06/plan.md`）。ここでは、そこから変えた点と、このビルドの範囲だけを書く。

## 依存パッケージ

なし（実行時依存ゼロのまま）

## クラス設計

### 設定（`scripts/lib/config.mts`）

- `ResolvedConfig.consent: { deferred: boolean | undefined }`（サイクル設定に書いた素の値。requested の元）
- `readConsent(table: TomlTable | undefined, where: string): { deferred: boolean | undefined }` — 未知のキー・真偽値でない値はエラー。作業ツリーと merge-base のサイクル設定の両方で使う
- サイクル設定でだけ書けるキーの検査を新設: `CYCLE_ONLY_TABLES = ["consent"]`、`assertNotCycleOnly(table, path)`。`loadConfig` でルートの `.hikyaku.config` を読んだ直後（`allowMissingRoot` の早期 return より前）に呼び、あればエラー

### 有効の判定（新規 `scripts/lib/deferred-consent.mts`）

```ts
export interface DeferredConsent { requested: boolean; effective: boolean; reason: string }
export function deferredConsent(config: ResolvedConfig, cycleDirectory: string | undefined): DeferredConsent
export function deferredConsentNotice(config: ResolvedConfig, cycleDirectory: string | undefined): string | undefined
/** G1 の承認で記録する値（提示のあとに書き換えた値は false） */
export function g1ConsentRecord(config: ResolvedConfig, cycleDirectory: string, presentedAfter: string | undefined): { value: boolean; note?: string }
```

- `ResolvedConfig` とサイクルのディレクトリを鍵にキャッシュ（`WeakMap<ResolvedConfig, Map<string, DeferredConsent>>`）。git を読むので `loadConfig` の中では計算しない
- 判定の順（最初に外れた理由を `reason` に入れる）: requested → conductor の子でない（`HIKYAKU_CONDUCTOR_CHILD`。consent.mts は ledger.mts 経由で循環するので import せず、環境変数を直接読む）→ `effectiveDeclaration(config).declaration?.mergeGate === "user"` → (a) `planning/progress.jsonl` の最後の planner G1 approved の `deferredConsent === true`、または (b) merge-base のサイクル設定
- (b): デフォルトブランチ（`defaultBranch`）が分からなければ不成立。`effectiveDeclaration(config).baselines`（デフォルトブランチと defaultBase、それぞれ `origin/<branch>` とローカル）が1つでも `unavailable`（Hikyaku のブランチ・ref が無い・共通の祖先が無い・宣言を読めない）なら不成立。すべての baseline の `commit` で `git show <commit>:<サイクルのディレクトリ>/.hikyaku.config` を読み、`[consent] deferred = true` のときだけ成立（PR のマージ先は使わない）
- `g1ConsentRecord`: requested でなければ false。サイクル設定に未コミットの変更がある（`git status --porcelain -- <path>`）、最後のコミット（`git log -1 --format=%cI -- <path>`）が `presentedAfter`（G1 の直前の完了のステップの記録の時刻）より後、git を読めない、のどれかなら false と、その理由

### 進捗の記録（`scripts/lib/progress.mts`・`scripts/commands/step.mts`）

- `ProgressEvent.deferredConsent?: boolean`
- planner の G1 の approved で、`step report` が `g1ConsentRecord` の値を書く。`presentedAfter` は評価で G1 の直前にある完了のステップの記録の `at`。false に倒したときは出力に1行出す
- planner の G1 の args に `deferredConsent: config.consent.deferred === true`（`skills/planner/steps/G1.md` で profile の行と並べて1行出す）

### 積み上げ（`scripts/lib/steps/engine.mts`・`architect.mts`・`commands/step.mts`）

```ts
export interface DeferredRisk { gate: string; step: string; summary: string; premises: string[]; harm?: Harm }
// StepDefinition
defers?: (ctx: StepContext) => DeferredRisk | undefined   // gate でないステップだけ（lintApproval で検査）
```

- architect の options に G3 の `defers`、design-delta に G4 の `defers`。どちらも、宣言による同意（G3: 害が上限を超える・申告が重い領域に当たる、G4: 設計が申告に無い重い領域に触れる）の回で、事後同意が有効なときだけ値を返す。差し戻しの回・基準を読めない・申告の欠け・境界・裏取りできない回は返さない（`now` のまま）
- 前提: G3 の害の超過は上限を決めた軸（`ceilingAxes(axes)` を `risk.mts` に足す。上限が「なし」なら最上段の軸、「中」なら中段の軸）を `app.<axis>`、重い領域は `area:<name>`。両方当たれば両方。G4 はいまの `undeclaredAreas` の全領域を `area:<name>`
- `step report`: done の報告で、報告を足した後の評価で `defers` が値を返したら `--loses` を必須にする（無ければ受け付けない）。progress を追記したあとに `risk` の事項（`who=user`、`when=merge@architect`、`ask=G3|G4`、`step=options|design-delta`、`premises`、`loses`、`harm`、`source: "step-report"`）を書く。`--dry-run` では書かない。ledger は progress を追記する前に読み、読めなければ報告を受け付けない
- `OpenRecord.source?: "step-report"`。`ledger open` には欄の指定が無いので手書きでは付かない
- G3・G4 の `consent`: 宣言による同意の回で、事後同意が有効、かつ `source: "step-report"`・`ask` が同じゲート・`at` がその回の options（G4 は design-delta）の最後の done 以後の事項があり、その `premises` がいまの判定の前提をすべて覆うときだけ `{ timing: "deferred" }`。それ以外は `now`。事項は design/ の decisions.jsonl 1つだけを読む（読めなければ `now`）
- G4 の順序は build-12 のまま（差し戻し → design-delta の前 → 通り過ぎた → 境界（常に now）→ 基準を読めない → 宣言なし → 裏取り）。deferred は最後の裏取りの分岐だけ
- design-delta の「`risk` の事項が記録されていることを `accepts` で確かめる」は、consent の条件で実現する（deferred の回のゲートは確認として外れうるので、ゲートの accepts では確かめられない）

### 異議（`scripts/commands/ledger.mts`・`scripts/lib/ledger.mts`）

- `ledger object --defer`: `--decision` / `--input` を求めず、`objection` の事項（`who=user`・`when=merge@<unit>`・`basis`・`loses`・`harm`・`premises`）を決定なしで記録する。拒むのは: 事後同意が無効 / `--premises` が無いか `app.*`・`area:*` 以外を含む / 害が上限を超えない / 作業単位が plan・close・create か、architect の差し戻しからの再設計の回
- 上限との比較（US-13.3）: `exceedsCeilingFor(declaration, harm, premises)` を `risk.mts` に置く。上限は宣言の軸と、前提に挙げた `area:<name>` の領域の軸を軸ごとの最大で重ねて `ceilingOf`（領域を前提に挙げれば、害の重さに関わらず超えるとみなす）。宣言は `effectiveDeclaration(config).declaration`。宣言が無ければ超えない
- `ledger object`（`--defer` なし）と `ledger open --type objection`: 上限を超えれば `exceedsCeiling: true` を記録し、`consented` には `--accepts` と `--premises` を求める（害が中でも）。`objectionSettled`・`unacceptedObjections`・`consentDecided` は「害が高、または `exceedsCeiling`」を高と同じに扱う
- `unacceptedObjections` は `when` が `merge@…` の異議を数えない（同意ゲートで扱う）

### 同意ゲート（`scripts/lib/steps/consent.mts`・`locate.mts`）

- `when`: requested（`config.consent.deferred === true`）のサイクルでは、サイクル全体の記録（`readLedger`）から対象を探す（読めなければ手順に入れる）。手順の位置だけを読む経路（`ctx.positionOnly`）では記録を読まずに手順に入れる。requested でなければ build-06 のまま（作業単位のファイル1つ）
- `locate.mts` の `directiveOf` は `evaluate` に `positionOnly: true` の ctx を渡す（今は args にだけ渡している。Stop フック・step where・conductor parse・ledger の現在のステップ）
- `consentProblem` の案内の分岐（ゲートが手順に入るか）も同じ判定に揃える

### 表示

- `buildDirective` の notices に `deferredConsentNotice`（requested なのに有効でないとき。notices を読む経路だけ）
- `config --json` に `deferredConsent`、テキストに1行

### 指示文・docs

- `skills/planner/steps/G1.md`（事後同意の値の1行）、`skills/architect/steps/options.md`・`design-delta.md`（`--loses` を求められたときの1行）
- `docs/configuration/config-file.md`（`[consent]`、サイクル設定でだけ書けるキー）、`profiles.md`（事後同意）、`docs/workflow/` の plan・architect、CHANGELOG の `[3.0.0]`

## 非機能要件

- **セキュリティ**: 該当なし（ワークフローの承認の記録）。作業中のブランチで AI が設定を足しても効かないこと（G1 の記録か、両方の基準の merge-base でだけ有効）を結合テストで確かめる
- **パフォーマンス**: requested でなければ git も記録も読まない。有効の判定はキャッシュする
- **エラーハンドリング**: 記録・基準を読めないときは、有効にしない・同意ゲートを出す・G3/G4 を now にする（安全側）
- **マージ時点のデータ安全**: 該当なし（本番データに触れない。既存のサイクルは `[consent]` を書いていないので、事後同意も同意ゲートの範囲の拡張も現れず従来どおり。異議の上限との比較は、宣言を書いたワークスペースだけで効く）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 430k |
| builderフェーズ段階 | 445k |

**読むファイル**

- 読み済み: design-delta 1節・3節、ADR deferred-consent、build-02・06・12・15 の handoff、build-06 の分割前の plan.md、`scripts/lib/steps/architect.mts`・`engine.mts`・`consent.mts`・`planner.mts`・`directive.mts`（後半）・`locate.mts`（後半）、`scripts/commands/step.mts`・`ledger.mts`（object まで）・`config.mts`、`scripts/lib/ledger.mts`（前半）・`progress.mts`・`risk.mts`、`scripts/lib/config.mts`（ResolvedConfig・loadConfig・finalize・assertCycleOverridable）、`skills/planner/steps/G1.md`・`skills/architect/steps/options.md`
- 残り: `tests/helpers.mts`、`tests/step-risk-gates.test.mts`・`consent-gate.test.mts`・`objection.test.mts`（作り方の部分）、`skills/architect/steps/design-delta.md`、`docs/configuration/config-file.md`・`profiles.md`・`docs/workflow/` の plan と architect の該当節、CHANGELOG の `[3.0.0]`

**作成するファイル**

- `scripts/lib/deferred-consent.mts`（約 180 行）
- `tests/deferred-consent.test.mts`（約 400 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 190k | plan 作成までの実測 約 150k（design-delta 1・3節、ADR deferred-consent、build-02・06・12・15 の handoff、build-06 の分割前の plan、steps/architect.mts・engine.mts・consent.mts・planner.mts・directive.mts・locate.mts の一部、commands/step.mts・ledger.mts・config.mts、lib/ledger.mts・progress.mts・risk.mts、config.mts の読み込み部分）に、残り約 40k（tests/helpers.mts・step-risk-gates.test.mts・consent-gate.test.mts・objection.test.mts の一部、skills の design-delta.md、docs/configuration/config-file.md・profiles.md・workflow の plan と architect の該当節、CHANGELOG の [3.0.0]） |
| 実装 | 75k | 新規 lib/deferred-consent.mts（約 180 行）、config.mts の [consent]（サイクル限定・ルートでエラー）、progress.mts の deferredConsent、step.mts（G1 の記録・defers と --loses・risk の自動記録）、engine.mts の defers と lint、architect.mts の G3・G4 の deferred と defers、consent.mts の when の拡張、locate.mts の positionOnly、ledger の object --defer と上限との比較・source 欄、directive の notices、config の出力、指示文 G1.md・options.md・design-delta.md、docs と CHANGELOG |
| テスト | 55k | tests/deferred-consent.test.mts（一時 Git リポジトリの結合テスト、約 400 行）と既存テストの期待値の修正 |
| 未知の領域 | 35k | merge-base のサイクル設定の読み出し、architect.mts の循環 import、npm test の修正ループ |
| **予測ピーク** | **445k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: config.mts の `[consent]`（サイクル限定・ルートでエラー）と `ResolvedConfig.consent`
- [ ] Step 2: `lib/deferred-consent.mts`（有効の判定・notice・G1 の記録の値）、`ProgressEvent.deferredConsent`、G1 の args と記録、`config` の出力、directive の notices
- [ ] Step 3: engine の `defers`（lint を含む）、architect の options・design-delta の `defers` と G3・G4 の `deferred`、step report の `--loses` と risk の自動記録
- [ ] Step 4: 同意ゲートの `when` の拡張と `directiveOf` の positionOnly
- [ ] Step 5: `ledger object --defer` と上限との比較（`exceedsCeiling`）
- [ ] Step 6: 指示文（G1.md・options.md・design-delta.md）、docs、CHANGELOG
- [ ] Step 7: テスト（受け入れ基準ごと）、`conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test`
