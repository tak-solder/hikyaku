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
  4. (a) planning/progress.jsonl の最後の G1 の approved の記録の `deferredConsent` が `true`、または (b) merge-base のサイクル設定（`git show <commit>:<サイクルのディレクトリ>/.hikyaku.config`）の `[consent] deferred` が `true`。(b) は緩める向きの判定なので**論理積**にする: デフォルトブランチ（origin/HEAD）と defaultBase（`config.baseBranch ?? デフォルトブランチ`）の両方について、`effectiveDeclaration(config).baselines` の読めたすべての ref（`origin/<branch>` とローカル）の merge-base に値があるときだけ成立。読めない基準・Hikyaku のブランチ（スタック元・conductor ブランチ）・デフォルトブランチが分からない、のどれかがあれば不成立。サイクル設定の `base_branch` を任意のブランチへ向け直しても、デフォルトブランチ側が通らなければ有効にならない（plan-review の指摘）
- `deferredConsentNotice(config, cycleDirectory): string | undefined` — requested なのに有効でないときの1行

### 進捗の記録（`scripts/lib/progress.mts`・`scripts/commands/step.mts`）

- `ProgressEvent.deferredConsent?: boolean`。planner の G1 の approved で、`step report` がそのときのサイクル設定の値（`config.consent.deferred === true`）を書く。LLM の引数では受け取らない
- 提示した値と報告した値の食い違いを防ぐ: G1 の approved で `deferredConsent: true` を記録するのは、サイクル設定の `.hikyaku.config` に未コミットの変更が無く、その最後のコミットが G1 の直前のステップ（review か user-stories）の完了の記録より前のときだけ。そうでなければ `false` を記録し、step report の出力でその旨を示す（提示のあとに書き換えた値を承認として残さない。plan-review の指摘）
- planner の G1 の `args` に `deferredConsent`（同じ値）を足す。`skills/planner/steps/G1.md` で profile の行と並べて1行出す

### 同意の判定（`scripts/lib/steps/engine.mts`・`architect.mts`）

- `StepDefinition.defers?: (ctx: StepContext) => DeferredRisk | undefined`（gate でないステップだけ。step lint で検査）。done の報告で、報告を足した後の記録で評価し、上限を超える受け入れで事後同意が有効なら `DeferredRisk` を返す

```ts
export interface DeferredRisk { gate: string; summary: string; premises: string[]; harm?: Harm }
```

- architect の options に `defers`（G3 の判定のうち宣言による同意＝害が上限を超える・申告が重い領域に当たる）、design-delta に `defers`（G4 の裏取りで申告に無い重い領域に触れた）を置く。同意に倒す他の理由（再設計の回・基準を読めない・申告の欠け・裏取りできない）は `now` のまま
- `step report` は `defers` が値を返したら `--loses` を必須にし、進捗を追記したあとに `risk` の事項（`who=user`・`when=merge@architect`・`ask=G3|G4`・`step=options|design-delta`（戻り先に固定）・`premises`・`loses`・`source: "step-report"`）を `ledger` の書き込み関数で記録する。`--dry-run` では事項も書かない
- G3・G4 の `consent` は、宣言による同意の回で、事後同意が有効かつ、次を満たす事項があれば `{ timing: "deferred" }`。無ければ `now`（安全側）
  - `source: "step-report"`（`ledger open` で手書きした事項は数えない。手書きでは `source` を付けられない）
  - その回の options（G4 は design-delta）の最後の done より後に記録
  - 事項の `premises` が、いまの判定の理由をすべて覆う: G3 は害の超過なら上限を決めた軸、重い領域ならその `area:<name>` のすべて。G4 は、いまの `undeclaredAreas` の全領域（architecture-review で設計の文書が変わり、別の重い領域に触れたら `now` に倒れる。plan-review の指摘）
- design-delta の「`risk` の事項が記録されていることを `accepts` で確かめる」は、consent の条件にして実現する。deferred の回のゲートは確認として `enabled` で外れうるので、ゲートの `accepts` では確かめられないため（安全側の解釈。handoff に残す）
- 事項の前提: 害が上限を超えた → `app.exposure` / `app.data` / `app.impact` のうち上限を決めた軸、重い領域 → `area:<name>`

### 同意ゲート（新規 `scripts/lib/steps/consent.mts`）

```ts
export function consentStep(skill: string, when?: (ctx: StepContext) => boolean): StepDefinition
export function consentItems(ctx: StepContext): LedgerItem[]   // 一覧の対象
export function consentProblem(ctx: StepContext): string | undefined  // 決定の無い項目・やり直していない退け
```

- id `consent`、kind `gate`、ask `deferred-consent`、`consent: () => ({ timing: "now", reason: "上限を超えるリスクの受け入れ（事後同意）" })`
- 対象: `type` が `risk` か `objection` で、`who=user` かつ `when=merge@<この作業単位>` の事項（どの作業単位で記録したかは問わない）
- `when`: サイクルに属し、サイクル設定で requested で、対象があるとき。requested でなければ記録を読まずに外す（サイクルに属さない patch も外す）。requested のときだけサイクルの記録全体を読む（design-delta 2節の「手順の位置だけを読む経路では記録を読まない」に対する、build-04 と同じ種類の例外。requested のサイクルに限る。読めなければ手順に入れる＝安全側）。requested でないのに対象がある場合（設定を後から消した）は、`pr` の accepts（報告の時だけ全体を読む）が止める
- 承認の条件（`accepts` を gate の approved にも効かせる。step.mts）: 全項目にユーザーの決定（consented / rejected / resolved / decided）がある。退け（最新が rejected）は、同じ作業単位の事項なら戻り先のステップを退けの決定の後に done で報告し直していること、前のフェーズ（記録した単位が別）の事項なら resolved になっていること（それまでは return.md の経路）
- 戻り先: 事項の `step` が run ならそのステップ。gate なら固定の対応（architect: G3→options、G4→design-delta。builder: G7・G8→plan。patch: P1→scope）、それ以外はそのゲートより前で最も近い、手順に入っている run ステップ（plan-review の指摘: ゲートは done で報告し直せない）
- `args`: `items`（ID の一覧）、`reworkFrom`（同じ作業単位の退けのうち、まだやり直していない最も前のステップ）、`returnItems`（前のフェーズの退け）
- architect（`pr` の直前、`pr` と同じ when）・builder（`pr` の直前）・patch（`publish` の直前）に置く
- `pr` の `accepts`（patch は `publish`）にも `consentProblem` を付ける（同意ゲートが外れていても、決定の無い項目があれば PR を完了にしない）

### ledger（`scripts/commands/ledger.mts`・`scripts/lib/ledger.mts`）

- `ledger object --defer`: `--decision` / `--input` を求めず、`objection` の事項（`who=user`・`when=merge@<unit>`・`basis`・`loses`・`harm`・`premises`）を決定なしで記録する（異議の記録は残し、決定を同意ゲートへ遅らせる。build-04 の `unacceptedObjections` は、`when` が `merge@…` の異議を同意ゲートで扱うものとして数えない）。拒むのは次のどれか
  - 事後同意が無効
  - `--premises` が無い・`app.*` / `area:*` 以外を含む
  - 害が上限（宣言の軸と、前提に挙げた領域の軸の最大から `ceilingOf`）を超えない（build-04 のとおりその場で扱う）
  - 記録する作業単位の今の回に同意ゲートの置き場が無い（plan / close / create、architect の差し戻しからの再設計の回）。plan-review の指摘
- 上限と異議（US-13.3）: `ledger object`（`--defer` なし）と `ledger open --type objection` でも、宣言があれば害を上限と比べ、超えれば `exceedsCeiling: true` を記録し、害が中でも `--accepts` と `--premises` を求める（その場の同意）。`unacceptedObjections` は「害が高、または `exceedsCeiling`」を数える。宣言が無ければ従来どおり
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
- **パフォーマンス**: 有効の判定は git を読むのでキャッシュし、requested でなければ git も記録も読まない。Stop フックの経路（手順の位置だけ）では、同意ゲートの `when` が記録を読むのは requested のサイクルだけ（requested でなければ、この作業単位のファイルも読まない）
- **エラーハンドリング**: 記録や基準を読めないときは有効にしない・同意ゲートを出す・G3/G4 を now にする、の安全側に倒す
- **マージ時点のデータ安全**: 該当なし（本番データに触れない。既存のサイクルは `[consent]` を書いていないので、事後同意も同意ゲートも現れず、従来どおり動く）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 395k |
| builderフェーズ段階 | 570k（plan-review の指摘で見積もり直し） |

**読むファイル**

- `design/design-delta.md` の 1節・3節、ADR `20261116-deferred-consent.md`・`20261116-approval-kind-in-step-definitions.md`（読み済み）
- `scripts/lib/steps/engine.mts`・`architect.mts`・`builder.mts`・`patch.mts`・`planner.mts`・`publication.mts`・`directive.mts`（読み済み）
- `scripts/lib/ledger.mts`・`scripts/commands/ledger.mts`・`scripts/commands/step.mts`（読み済み）
- `scripts/lib/config.mts`（loadConfig・finalize は読み済み、読み込み関数の残り約 150 行）、`scripts/lib/risk.mts`（基準の部分は読み済み）
- `scripts/lib/conductor.mts` の ASKS、`scripts/lib/progress.mts`、`scripts/commands/config.mts`
- `skills/*/steps/pr.md`・`skills/planner/steps/G1.md`・`skills/builder/references/templates.md`（読み済み）
- `docs/configuration/config-file.md`・`profiles.md`、`tests/helpers.mts` と既存の ledger・step のテスト
- plan-review で足したもの: `docs/workflow/plan.md`・`architect.md`・`build.md`・`patch.md`、`docs/reference/cli.md`、CHANGELOG の `[3.0.0]`、`skills/architect/steps/options.md`・`design-delta.md`、`skills/builder/references/return.md`、`skills/patch/steps/publish.md`、`scripts/lib/escalation.mts`・`stack.mts`・`premises.mts`、`tests/step-risk-gates.test.mts`・`tests/objection.test.mts`

**作成するファイル**

- `scripts/lib/deferred-consent.mts`（約 150 行）、`scripts/lib/steps/consent.mts`（約 120 行）
- `skills/architect/steps/consent.md`・`skills/builder/steps/consent.md`・`skills/patch/steps/consent.md`
- `tests/deferred-consent.test.mts`（約 400 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 100k | 開始時の実測 59k に、ガイドの手順の進行分 30k〜50k（G8 の提示・報告の出力） |
| 読み込み | 250k | plan 作成までの実測 約 130k と plan-review の対応 約 20k に、残り: config.mts の読み込み関数・conductor.mts の ASKS・stack.mts・premises.mts・escalation.mts・各 pr.md と publish.md・options.md・design-delta.md・return.md・docs の config-file.md・profiles.md・workflow の plan/architect/build/patch・reference/cli.md・CHANGELOG・tests の helpers・step-risk-gates.test.mts・objection.test.mts（約 100k） |
| 実装 | 110k | 新規 lib/deferred-consent.mts・steps/consent.mts、config.mts・architect.mts・ledger lib（exceedsCeiling・同意の対象）・steps 定義 4 つ・step.mts・directive.mts・commands/ledger.mts（consent-list・pr-section・return-draft・object --defer）、指示文と docs と CHANGELOG |
| テスト | 60k | tests/deferred-consent.test.mts（一時 Git リポジトリの結合テスト、約 450 行）と step-risk-gates・objection の既存テストの修正 |
| 未知の領域 | 50k | steps/consent.mts → ledger.mts → steps/index.mts の循環 import（build-15 の申し送りと同種）、エンジンのやり直しの規則と退けの戻り先、merge-base のサイクル設定の読み出し、npm test の修正ループ |
| **予測ピーク** | **570k** | 分割を検討（450k 超。原則として分割する） |
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
