# Build 02: アプリケーションの状況の宣言と、AI に任せてよい害の上限

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/toml.mts`

テーブル配列（`[[a.b]]`）に対応する（`[[app.areas]]` のため）。`descend` は途中のセグメントがテーブル配列なら最後の要素へ降りる。`[[x]]` で既存の値が配列でない（テーブル・値）ならエラー。先頭のコメントの「非対応」から外す。

### `scripts/lib/config.mts`

```ts
export type Exposure = "personal" | "internal" | "public";
export type DataWeight = "none" | "internal" | "personal-or-secret";
export type Impact = "low" | "medium" | "high";
export interface AppAxes { exposure: Exposure; data: DataWeight; impact: Impact }
/**
 * 重い領域。name は必須で重複はエラー（前提の参照 `area:<name>` に使う。design-delta 2節）。
 * 軸は省略でき、省略した軸はアプリケーションの値になる（重い領域に触れる受け入れは害の重さに関わらず
 * 上限を超えるので、この build の判定では軸は効かない。パスごとの解決は後続の参照のために置く）
 */
export interface AppArea { name: string; paths: string[]; exposure?: Exposure; data?: DataWeight; impact?: Impact }
export interface AppDeclaration {
  axes: AppAxes;
  /** マージがユーザーの関門である前提（"user" だけを受け付ける。省略可） */
  mergeGate: "user" | undefined;
  areas: AppArea[];
}
export interface Boundaries { external: string[]; internal: string[] }

interface ResolvedConfig {
  /** [app] と [[app.areas]]。ルート設定限定。無ければ undefined（上限なし） */
  app: AppDeclaration | undefined;
  /** [boundaries]。ルート設定限定。照合は build-12 */
  boundaries: Boundaries;
}

/** [app] のテーブルを読む（ルート設定と、基準側のルート設定の両方で使う）。不正な値は HikyakuError */
export function readAppDeclaration(table: TomlTable | undefined, where: string): AppDeclaration | undefined;
```

- `[app]` があれば3軸は必須（欠ければエラー）。値は上の段の名前だけ。`[[app.areas]]` は `name`（重複不可）と `paths`（空でない文字列の配列）が必須、軸は任意で、3軸すべて省略もよい（パスに触れるだけで上限を超える）。知らないキーはエラー（黙って捨てない）
- `[boundaries]` の `external` / `internal` は文字列の配列（省略は空）
- `assertCycleOverridable`: サイクル設定に `app` / `boundaries` があればエラー（`data_integrity.release_branches` の先例。理由: 宣言はリポジトリのアプリケーションの状況で、サイクルが自分の上限を緩められると判断をサイクル自身が下せる）
- `finalize` は `readAppDeclaration(readTable(merged, "app"))` と `readBoundaries`。サイクル設定にあれば `assertCycleOverridable` が先に止めるので、merged から読んでよい

### `scripts/lib/git.mts`

```ts
/** 同期版。ステップの判定（同期）から呼ぶ。失敗は undefined */
export function gitSync(cwd: string, argv: string[]): string | undefined;
```

`rules.mts` の `execFileSync` の先例に倣う。ステップの `consent` は同期で評価されるので、非同期の `readFileAtRef` は使えない。

### `scripts/lib/stack.mts`

```ts
/** ベースブランチ（base_branch か、デフォルトブランチ）。resolvePrBase の defaultBase と同じ */
export function defaultBaseOf(config: ResolvedConfig): string | undefined;
```

`resolvePrBase` もこれを使う（式を2箇所に置かない）。

### `scripts/lib/risk.mts`（新規）

```ts
export type Harm = "高" | "中";
/** 上限。"高" まで / "中" まで / "なし"（何も任せない） */
export type Ceiling = "高" | "中" | "なし";

/** 上限の表（ADR risk-ceiling-table）。3軸すべて最下段→高 / どれかが中段→中 / どれかが最上段→なし */
export function ceilingOf(axes: AppAxes): Ceiling;
/** 害の申告が上限を超えるか */
export function exceeds(harm: Harm, ceiling: Ceiling): boolean;
/** パスの宣言: アプリケーションの軸に、当たる重い領域の軸を軸ごとの最大で重ねる */
export function axesForPath(declaration: AppDeclaration, path: string, files: string[]): AppAxes;
/**
 * 2つの宣言のうち厳しいほう: 軸ごとの最大、重い領域は和、片方が無ければもう片方。
 * mergeGate は書くほど緩める向き（build-06 の事後同意の前提）なので、両方が "user" のときだけ "user"
 * （片方に宣言が無ければ undefined）
 */
export function strictest(a: AppDeclaration | undefined, b: AppDeclaration | undefined): AppDeclaration | undefined;
/** 2つのパス（glob 可）が同じファイルに当たりうるか。リポジトリのファイル一覧と、まだ無いパスの見本で判定する */
export function overlaps(a: string, b: string, files: string[]): boolean;
/** patterns のどれかに当たる重い領域 */
export function heavyAreasHit(declaration: AppDeclaration, patterns: string[], files: string[]): AppArea[];
/** 文書がバッククォートで囲んだパスと glob（`/` か `*` か拡張子を含み、空白・URL・オプションでないもの） */
export function touchedPaths(markdown: string): string[];

/** 上限の判定に使う宣言。作業ツリーと、ベースブランチとの merge-base のうち厳しいほう */
export interface EffectiveDeclaration {
  declaration: AppDeclaration | undefined;
  /** 基準の宣言を読めなかった理由（作業ツリーの宣言だけで決めた）。notices に出す */
  baselineUnavailable: string | undefined;
  /** 基準のコミット（読めたとき） */
  baseline: string | undefined;
}
export function effectiveDeclaration(config: ResolvedConfig): EffectiveDeclaration;

/** G3: options の申告と上限の比較 */
export function judgeDeclared(effective: AppDeclaration | undefined, harm: Harm | undefined, paths: string[] | undefined, files: string[]): { exceeds: boolean; reason: string } ;
/**
 * G4: 設計の文書が触れる重い領域のうち、G3 の申告に当たっていないもの。
 * 「申告が領域に当たるか」は G3 と同じ heavyAreasHit(declaration, declared, files) で判定する
 * （同じ関数・同じ入力で、G3 で同意にならなかった領域だけを残す。当たる側に倒すと G4 を上げない向きに効くため、
 * G3 と別の判定を持たない）
 */
export function undeclaredAreas(effective: AppDeclaration | undefined, touched: string[], declared: string[], files: string[]): AppArea[];
/** リポジトリのファイル一覧（git ls-files、追跡外も含む）。config ごとにキャッシュ */
export function repositoryFiles(config: ResolvedConfig): string[];
/** design-delta.md と、このサイクルの ADR（基準から変わった・追加した decisions のファイル） */
export function designDocuments(config: ResolvedConfig, cycleDirectory: string): { path: string; text: string }[];
```

- 基準（plan-review の指摘で補強）: `base_branch` は作業ツリーの設定にあり、セッションが書き換えられる。基準のブランチを作業ツリーの値だけで決めると、自分のブランチに向け直すだけで基準を外せる。そこで基準のブランチを2つ取る: デフォルトブランチ（`origin/HEAD`。作業ツリーで変えられない）と `defaultBaseOf(config)`（ADR の `defaultBase`）。それぞれについて `origin/<branch>` を先に、無ければローカルの `<branch>` を ref にし（ローカルのブランチには PR を経ないコミットが載りうるため、マージ済みの写しを先に採る）、`git merge-base HEAD <ref>` → `git show <merge-base>:.hikyaku.config` を `parseToml` して `readAppDeclaration`。作業ツリーと読めた基準すべての `strictest` を使う（基準を足すほど厳しくなる向きにしか効かない）。ファイルが無ければその基準は「宣言なし」として読めた扱い。ref が無い・merge-base が無い・TOML が壊れている・値が不正ならその基準は読めない扱いにし、理由を返す。デフォルトブランチの基準を読めない（`origin/HEAD` が無い）ことも notices に出す
- ADR の定義（`defaultBase` との merge-base）にデフォルトブランチの基準を足す補強で、厳しくする向きだけなので ADR は書き換えず handoff の「永続化すること」に残す（G8 で示す）
- `effectiveDeclaration` と `repositoryFiles` は `ResolvedConfig` を鍵にした `WeakMap` でキャッシュする（1回の step の評価で G3・`designChoiceGate` から何度も呼ばれるため）
- glob の正規表現は `rules.mts` の `ruleGlobToRegExp` / `expandBraces` を使う（`/` を含まないパターンはどの階層のファイル名にも当たる、の意味も同じ）
- `overlaps`: どちらかが字義どおりのパス（`/` を含み、ワイルドカードが無い）なら、もう片方の正規表現で照合する。両方 glob なら、ファイル一覧のどれかに両方が当たるか、片方のワイルドカードを置き換えた見本にもう片方が当たるか。判定に迷う形は「当たる」に倒す（上げる向きにしか効かせない）
- ADR の所在は `loadGuide` の `decisions`。管理が `未作成` / `対象外` なら ADR は無い。このサイクルの ADR は `git diff --name-only <merge-base> -- <decisions>` と追跡外のファイル。基準を読めなければ decisions のファイルすべて（上げる向き）

### `scripts/lib/progress.mts`

`ProgressEvent` に `harm?: "高" | "中"`、`paths?: string[]`（architect の options の done の申告。中身を含まない値）。

### `scripts/lib/steps/engine.mts`

```ts
interface StepDefinition {
  /** done に --harm / --paths（害の重さとパスの申告）を添えるか（architect の options） */
  declaresRisk?: boolean;
  /** directive の notices に足す注意（G3・G4 の基準を読めなかったこと） */
  notices?: (ctx: StepContext) => string[];
}
```

### `scripts/commands/step.mts`（step report）

`--harm 高|中`・`--paths <glob,...>` を受け付ける。`--paths` は波括弧の外のカンマで区切る（`src/{api,db}/**` を割らない）。`declaresRisk` でないステップに添えればエラー。値が不正ならエラー。done で欠けていても記録は受け付ける（G3 が同意に倒れる。欠けを報告の拒否にすると「欠ければ同意」の経路が無くなる）。usage と details に追記。

### `scripts/lib/steps/directive.mts`

- `reportCommand`: `declaresRisk` の done に ` --harm <高|中> --paths <glob,...>` を付ける
- `buildDirective`: `definition.notices?.(ctx)` を `notices` に足す。`renderDirective` に notices の行が無ければ足す

### `scripts/lib/steps/architect.mts`

- `options` に `declaresRisk: true`
- G3 の `consent`: 再設計の回 → `now`。そうでなければ `effectiveDeclaration` が宣言なし → `false`（従来どおりプロファイル）。宣言があり、この回の最後の options の記録（skipped なら申告なし）に `harm` か `paths` のどちらかが無い → `now`（「害の重さ・パスの申告が無い」）。`judgeDeclared` が超える → `now`（理由に上限と申告、当たった重い領域）。それ以外 `false`
- G4 の `consent`: 再設計の回 → `now`。宣言があり、`undeclaredAreas(design-delta.md と ADR の touchedPaths, この回の options の paths)` が空でない → `now`（理由に領域のパス）。options をスキップした回は申告が空なので、当たればすべて申告に無い扱い
- `designChoiceGate`: options の done がまだ無い間（options 自身の args）は、宣言による同意を含めず従来の判定（再設計の回か `gates.designChoice`）で返す。申告の欠けで常に true になり、同じ回で adr と食い違うのを防ぐ
- G4 の `args`: `undeclaredAreas`（領域の `paths` を `、` で連ねた文字列。無ければ渡さない）
- G3・G4 の `notices`: 宣言の判定に入る回で、基準を読めなかったら「基準（{ref}）の宣言を読めなかったので、作業ツリーの宣言で上限を決めました: {理由}」

### `scripts/lib/conductor.mts`

`CONSENT_WHEN` の G3・G4 の説明に、上限を超える申告・申告に無い重い領域を足す（`tests/step-consent.test.mts` の一致検査は鍵だけなので鍵は変えない）。

### `scripts/commands/config.mts`

`[app]`（3軸・merge_gate・作業ツリーの宣言での上限）、`[[app.areas]]`（paths と軸）、`[boundaries]` を表示する。宣言が無ければ「宣言なし（上限なし）」。details に1段落。

### スキル・docs

- `skills/architect/steps/options.md`: done に添える `--harm`（採用しうる案のうち最も重い害。`persistence.md` の重要度の高・中）と `--paths`（設計が触れるパスと glob）の付け方。軽く書かない（G4 で裏取りされ、当たれば設計の書き直しになる）
- `skills/architect/steps/G3.md`: directive が同意のとき、理由（上限を超える申告・重い領域・申告の欠け）と、受け入れる害をユーザーに示し、同意を得る
- `skills/architect/steps/G4.md`: 同意で `undeclaredAreas` があるとき、その領域と、design-delta.md・ADR のどこが触れているかを示し、受け入れるか（設計を見直すか）を問う
- `docs/configuration/profiles.md`（ゲート表の G3・G4 の承認の列と説明）・`docs/workflow/conductor.md`・`docs/workflow/architect.md`: G3・G4 は差し戻しの回に加え、宣言の上限を超える申告・申告に無い重い領域でも同意になる
- `docs/configuration/config-file.md`: 「サイクル側で上書きできないキー」に `[app]`・`[boundaries]` を足し、`## [app] と [boundaries]` の節（3軸の値・上限の表・重い領域・基準側の宣言と厳しいほう・宣言が無いとき）
- `CHANGELOG.md` の `[3.0.0]`: Added（宣言と上限、G3・G4 の同意化、`--harm` / `--paths`、テーブル配列）、Migration（宣言しなければ従来どおり。宣言したら options の done に申告を添える）

## 非機能要件

- **セキュリティ**: `git` は `execFileSync` に引数の配列で渡し、シェルを通さない。ref とパスは設定の値と git の出力だけ
- **パフォーマンス**: 基準の読み取りとファイル一覧は config ごとに1回（WeakMap）。G3・G4 の consent を評価するとき（architect の手順）だけ git を呼ぶ。宣言が作業ツリーにも基準にも無いかを先に見て、無ければファイル一覧を取らない
- **残す懸念（handoff の「残したこと」へ）**: 最上段の宣言（上限「なし」）でも、options をスキップした回は G3 が無く、G4 は重い領域に当たったときだけ同意になる。分岐の無い判断に害の受け入れは無いとみなす（design-delta・ADR はこの場合を書いていない）
- **エラーハンドリング**: 宣言の不正な値・サイクル設定への記述はエラー（黙って捨てない）。基準を読めないことはエラーにせず、作業ツリーの宣言で決めて notices に出す
- **マージ時点のデータ安全**: 該当なし（プラグインのスクリプトと文書の変更）。宣言の無いワークスペースは従来どおり動き、progress.jsonl の新しい欄は任意で、古い記録はそのまま読める

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 350k |
| builderフェーズ段階 | 550k |

**読むファイル**

- `design/design-delta.md` の「1. 承認の種類と上限」、ADR `20261116-risk-ceiling-table.md`・`20261116-approval-kind-in-step-definitions.md`、`build-01/handoff.md`（読了）
- `scripts/lib/steps/engine.mts`・`directive.mts`・`architect.mts`、`scripts/commands/step.mts`（report まで）、`scripts/lib/progress.mts`、`scripts/lib/toml.mts`、`scripts/lib/git.mts`・`stack.mts`（resolvePrBase）、`scripts/lib/rules.mts`（glob）、`scripts/lib/config.mts`（ResolvedConfig・assertCycleOverridable・finalize）、`skills/architect/steps/options.md`・`G3.md`・`G4.md`（読了）
- これから: `scripts/commands/config.mts`、`scripts/lib/docs.mts`（loadGuide・DocEntry）、`tests/helpers.mts`・`tests/config.test.mts`・`tests/toml.test.mts`、`tests/step-consent.test.mts` の残り、`docs/configuration/config-file.md` の該当節、`CHANGELOG.md` の `[3.0.0]`

**作成するファイル**

- `scripts/lib/risk.mts`（約 300 行）
- `scripts/lib/toml.mts`・`config.mts`・`git.mts`・`stack.mts`・`progress.mts`・`steps/engine.mts`・`steps/directive.mts`・`steps/architect.mts`・`conductor.mts`、`scripts/commands/step.mts`・`config.mts` の変更
- `tests/risk.test.mts`（新規。表・上書き・厳しいほう・overlaps・touchedPaths・基準の読み取りの一時リポジトリ: 作業ブランチ・スタック・conductor ブランチで緩めても緩まない）
- `tests/config.test.mts`・`tests/toml.test.mts`・`tests/step-consent.test.mts` への追加（ルート限定・不正値・テーブル配列・G3 と G4 の同意化・宣言なしは従来どおり・`--harm` の検査）
- `skills/architect/steps/options.md`・`G3.md`・`G4.md`、`docs/configuration/config-file.md`、`CHANGELOG.md`

**builderフェーズ段階の内訳**（plan-review の指摘で見積もり直した。固定費に手順の進行分を足し、読み込みに漏れたテストと docs を足した）

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 100k | 開始時の実測 59k に、手順の進行分（レビュー・G8・agreement-review・pr の指示と結果）40k |
| 読み込み | 240k | plan-review 時点の実測 205k のうち固定費を除く約 145k は読了済み（engine/directive/architect/step.mts/progress/toml/git/stack/rules/config.mts・ADR 2本・design-delta・テストの一部・doc-reviewer の結果）。残り約 95k: step-consent/step-architect/config/toml のテスト・helpers・docs.mts・commands/config.mts・config-file.md・profiles.md・workflow の conductor.md と architect.md・CHANGELOG [3.0.0] |
| 実装 | 100k | risk.mts 新規（約350行: 表・パスの解決・厳しいほう・mergeGate の論理積・overlaps・touchedPaths・2つの基準の読み取り・ADR の特定）、toml のテーブル配列、config の [app]（name 必須）/[[app.areas]]/[boundaries] と表示、step report の --harm/--paths（波括弧の外で区切る）、directive の報告コマンドと notices、G3・G4 の consent/args/notices と designChoiceGate、options/G3/G4.md、config-file・profiles・workflow 2本、CHANGELOG |
| テスト | 70k | risk の unit、2つの基準の一時リポジトリ（作業ブランチ・スタック・conductor ブランチ・base_branch の書き換え）、config のルート限定と不正値、toml のテーブル配列、G3/G4 の同意化と宣言なしの従来どおり、--harm/--paths の検査、step-architect の既存テストの追随 |
| 未知の領域 | 40k | 同期の git での基準の読み取りと一時リポジトリの調整、glob の重なりの判定、ResolvedConfig の欄の追加が既存テストに波及する修正 |
| **予測ピーク** | **550k** | 分割を検討（450k 超。原則として分割する） |
| ガイド | 標準 v2 | 03897ac0 |

分割の案（doc-reviewer の提案）: (A) このビルド — toml のテーブル配列、`[app]` / `[[app.areas]]` / `[boundaries]` の読み込みと表示、`risk.mts` と基準の読み取り（一時リポジトリの結合テストを含む）、config-file.md。(B) 新しいビルド — `step report` の `--harm` / `--paths`、directive、G3・G4 の consent・args・notices と `designChoiceGate`、options/G3/G4.md、profiles.md・workflow の docs

## 実装ステップ

- [ ] Step 1: toml のテーブル配列
- [ ] Step 2: config の `[app]`・`[[app.areas]]`・`[boundaries]`（読み込み・ルート限定・表示）
- [ ] Step 3: `risk.mts`（表・パスの解決・厳しいほう・overlaps・touchedPaths・基準の読み取り）と git / stack の補助
- [ ] Step 4: step report の `--harm` / `--paths`、directive の報告コマンドと notices
- [ ] Step 5: architect の G3・G4 の consent・args・notices、`CONSENT_WHEN`
- [ ] Step 6: テスト
- [ ] Step 7: options.md・G3.md・G4.md、config-file.md、CHANGELOG
- [ ] Step 8: ローカル検証（`npx tsc --noEmit`・`npm test`・`step lint`・`conductor lint`）
