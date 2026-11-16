# Build 02: アプリケーションの状況の宣言と、AI に任せてよい害の上限の計算

G6 で分割した（予測ピーク 550k → このビルド 420k と build-15 350k）。G3・G4 の `consent`、options の `--harm` / `--paths`、directive の notices、architect の手順・profiles と workflow の docs は build-15 に移した。

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/toml.mts`

テーブル配列（`[[a.b]]`）に対応する（`[[app.areas]]` のため）。`descend` は途中のセグメントがテーブル配列なら最後の要素へ降りる。`[[x]]` で既存の値がテーブル配列でない（テーブル・値）ならエラー。テーブル配列をあとから `[x]` で開くのもエラー。先頭のコメントの「非対応」から外す。

### `scripts/lib/config.mts`

```ts
export type Exposure = "personal" | "internal" | "public";
export type DataWeight = "none" | "internal" | "personal-or-secret";
export type Impact = "low" | "medium" | "high";
export interface AppAxes { exposure: Exposure; data: DataWeight; impact: Impact }
/**
 * 重い領域。name は必須で重複はエラー（前提の参照 `area:<name>` に使う。design-delta 2節）。
 * 軸は省略でき、省略した軸はアプリケーションの値になる（重い領域に触れる受け入れは害の重さに関わらず
 * 上限を超えるので、G3・G4 の判定では軸は効かない。パスごとの解決は後続の参照のために置く）
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
  /** [app] と [[app.areas]]。ルート設定限定。無ければ undefined（上限を設けない） */
  app: AppDeclaration | undefined;
  /** [boundaries]。ルート設定限定。照合は build-12 */
  boundaries: Boundaries;
}

/** [app] のテーブルを読む（ルート設定と、基準側のルート設定の両方で使う）。不正な値は HikyakuError */
export function readAppDeclaration(table: TomlTable | undefined, where: string): AppDeclaration | undefined;
```

- `[app]` があれば3軸は必須（欠ければエラー）。値は上の段の名前だけ。`[[app.areas]]` は `name`（重複不可）と `paths`（空でない文字列の配列）が必須、軸は任意。知らないキーはエラー（黙って捨てない）
- `[boundaries]` の `external` / `internal` は文字列の配列（省略は空）。知らないキーはエラー
- `assertCycleOverridable`: サイクル設定に `app` / `boundaries` があればエラー（`data_integrity.release_branches` の先例。宣言はリポジトリのアプリケーションの状況で、サイクルが自分の上限を緩められると判断をサイクル自身が下せる）
- `finalize` は merged から読む（サイクル設定にあれば `assertCycleOverridable` が先に止める）

### `scripts/lib/git.mts`

```ts
/** 同期版。失敗は undefined（終了コードだけで判断する） */
export function gitSync(cwd: string, argv: string[]): string | undefined;
```

ステップの `consent` は同期で評価されるので（build-15 が使う）、非同期の `readFileAtRef` は使えない。`rules.mts` の `execFileSync` の先例に倣う。

### `scripts/lib/stack.mts`

```ts
/** ベースブランチ（base_branch か、デフォルトブランチ）。resolvePrBase の defaultBase と同じ */
export function defaultBaseOf(config: ResolvedConfig): string | undefined;
```

`resolvePrBase` もこれを使う（式を2箇所に置かない）。

### `scripts/lib/risk.mts`（新規）

```ts
export type Harm = "高" | "中";
/** 上限。"高" まで / "中" まで / "なし"（何も任せない）。宣言が無いとき（上限を設けない）は Ceiling を返さず undefined */
export type Ceiling = "高" | "中" | "なし";

/** 上限の表（ADR risk-ceiling-table）。3軸すべて最下段→高 / どれかが中段→中 / どれかが最上段→なし */
export function ceilingOf(axes: AppAxes): Ceiling;
/** 害の申告が上限を超えるか */
export function exceeds(harm: Harm, ceiling: Ceiling): boolean;
/** パスの宣言: アプリケーションの軸に、当たる重い領域の軸を軸ごとの最大で重ねる */
export function axesForPath(declaration: AppDeclaration, path: string, files: string[]): AppAxes;
/**
 * 2つの宣言のうち厳しいほう: 軸ごとの最大、重い領域は和（同じ name は軸ごとの最大とパスの和で1つにする）、
 * 片方が無ければもう片方。mergeGate は書くほど緩める向き（build-06 の事後同意の前提）なので、
 * 両方が "user" のときだけ "user"（片方に宣言が無ければ undefined）
 */
export function strictest(a: AppDeclaration | undefined, b: AppDeclaration | undefined): AppDeclaration | undefined;
/** 2つのパス（glob 可）が同じファイルに当たりうるか */
export function overlaps(a: string, b: string, files: string[]): boolean;
/** patterns のどれかに当たる重い領域 */
export function heavyAreasHit(declaration: AppDeclaration, patterns: string[], files: string[]): AppArea[];
/** 文書がバッククォートで囲んだパスと glob（`/` か `*` か拡張子を含み、空白・URL・オプションでないもの） */
export function touchedPaths(markdown: string): string[];

export interface Baseline {
  /** 基準のブランチ（デフォルトブランチ / defaultBase） */
  branch: string;
  /** 読んだ ref（origin/<branch> か <branch>） */
  ref: string | undefined;
  /** merge-base のコミット */
  commit: string | undefined;
  /** 読めたときの宣言（宣言が無ければ undefined） */
  declaration: AppDeclaration | undefined;
  /** 読めなかった理由 */
  unavailable: string | undefined;
}
/** 上限の判定に使う宣言。作業ツリーと、読めた基準すべてのうち最も厳しいもの */
export interface EffectiveDeclaration {
  declaration: AppDeclaration | undefined;
  baselines: Baseline[];
  /** 読めなかった基準の説明（build-15 が notices に出す） */
  notices: string[];
}
export function effectiveDeclaration(config: ResolvedConfig): EffectiveDeclaration;
/** リポジトリのファイル一覧（git ls-files、追跡外も含む） */
export function repositoryFiles(config: ResolvedConfig): string[];
/** このサイクルの ADR（基準から変わった・追加した decisions のファイル）。基準を読めなければ decisions のファイルすべて */
export function cycleAdrs(config: ResolvedConfig): string[];
```

- 基準: `base_branch` は作業ツリーの設定にあり、セッションが書き換えられる。基準のブランチを2つ取る: デフォルトブランチ（`origin/HEAD`）と `defaultBaseOf(config)`（ADR の `defaultBase`。同じなら1つ）。それぞれ `origin/<branch>` とローカルの `<branch>` の両方を読めるだけ読み（コードレビューの指摘で、origin を先に採る形から改めた。PR を経ないローカルのコミットで緩めることも、古い origin が厳しいローカルに勝つことも防ぐ。questions.md の Q3）、`git merge-base HEAD <ref>` → `git show <merge-base>:.hikyaku.config` → `parseToml` → `readAppDeclaration`。作業ツリーと読めた基準すべての `strictest` を使う。ファイルが無ければその基準は「宣言なし」として読めた扱い。ref が無い・merge-base が無い・TOML が壊れている・値が不正ならその基準は読めない扱いにし、理由を `notices` に入れる。デフォルトブランチが分からない（`origin/HEAD` が無い）ことも `notices` に入れる
- これは ADR の定義（`defaultBase` との merge-base）にデフォルトブランチの基準を足す補強で、厳しくする向きだけ。ADR は書き換えず handoff の「永続化すること」に残す（G6 で監督が受け入れ、`questions.md` の Q1）
- `effectiveDeclaration`・`repositoryFiles` は `ResolvedConfig` を鍵にした `WeakMap` でキャッシュする（build-15 で1回の step の評価から何度も呼ばれる）
- glob の正規表現は `rules.mts` の `ruleGlobToRegExp` / `expandBraces` を使う（`/` を含まないパターンはどの階層のファイル名にも当たる）
- `overlaps`: どちらかが字義どおりのパス（`/` を含み、ワイルドカードが無い）なら、もう片方の正規表現で照合する。両方 glob なら、ファイル一覧のどれかに両方が当たるか、片方のワイルドカードを置き換えた見本にもう片方が当たるか、どちらかの静的な接頭辞（最初のワイルドカードより前のディレクトリ）がもう片方の接頭辞に含まれるか。迷う形は「当たる」に倒す
- 基準のブランチ（デフォルトブランチ・`defaultBase` のどちらも）が Hikyaku のブランチ名（`parseBranch` で当たるもの。conductor・フェーズ・patch のブランチ）なら、その基準は読めない扱いにする（`origin/HEAD` も `git remote set-head` で向け直せるため。plan-review の懸念）
- ADR の所在は `loadGuide` の `decisions`（管理が `未作成` / `対象外` なら無い）。このサイクルの ADR は、読めた基準それぞれの merge-base からの `git diff --name-only` の和と追跡外のファイル（多めに拾う側に倒す）

### `scripts/commands/config.mts`

`[app]`（3軸・merge_gate・作業ツリーの宣言での上限）、`[[app.areas]]`（name・paths・軸）、`[boundaries]` を表示する。宣言が無ければ「宣言なし（上限を設けない）」。この版では検査と表示だけであることを1行添える。details に1段落。JSON は `app`・`boundaries` が ResolvedConfig から出る。

### docs

- `docs/configuration/config-file.md`: 「サイクル側で上書きできないキー」に `app`・`boundaries` を足し（「3つだけ」の文も直す）、`## [app] と [boundaries]` の節（3軸の値・上限の表・重い領域・境界・基準側の宣言と厳しいほう・宣言が無いとき）。「この版では宣言は検査と表示だけで、ゲートの判定にはまだ使わない」と明記する
- `CHANGELOG.md` の `[3.0.0]`: Added（宣言、テーブル配列）。同じく「まだ判定に使わない」を明記

## 非機能要件

- **セキュリティ**: `git` は `execFileSync` に引数の配列で渡し、シェルを通さない
- **パフォーマンス**: 基準の読み取りとファイル一覧は config ごとに1回（WeakMap）。このビルドではどのコマンドの通常の経路からも呼ばない（`config` は作業ツリーの宣言だけを表示する）
- **エラーハンドリング**: 宣言の不正な値・知らないキー・名前の重複・サイクル設定への記述はエラー（黙って捨てない）。基準を読めないことはエラーにせず、読めた宣言で決めて理由を返す
- **マージ時点のデータ安全**: 該当なし（プラグインのスクリプトと文書の変更）。宣言の無いワークスペースは従来どおり動く。宣言はまだゲートの判定に使わず、docs と CHANGELOG にそう書く

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 350k |
| builderフェーズ段階 | 420k |

**読むファイル**

- 読了: design-delta 1節、ADR 2本、build-01 の handoff、`scripts/lib/steps/` の engine・directive・architect、`scripts/commands/step.mts`、`scripts/lib/progress.mts`・`toml.mts`・`git.mts`・`stack.mts`・`rules.mts`・`config.mts` の該当部、`tests/helpers.mts`（読了）、`tests/config.test.mts`・`toml.test.mts` の一部、`docs/configuration/config-file.md` の冒頭と `[data_integrity]` 節、`scripts/lib/docs.mts` の `loadGuide`
- これから: `tests/config.test.mts`・`toml.test.mts` の残り、`scripts/lib/branch.mts` の `parseBranch`、`scripts/commands/config.mts` の表示部、`docs/configuration/config-file.md` の残り、`CHANGELOG.md` の `[3.0.0]` Added

**作成するファイル**

- `scripts/lib/risk.mts`（約 300 行）、`tests/risk.test.mts`
- `scripts/lib/toml.mts`・`config.mts`・`git.mts`・`stack.mts`、`scripts/commands/config.mts` の変更
- `tests/config.test.mts`・`tests/toml.test.mts` への追加
- `docs/configuration/config-file.md`、`CHANGELOG.md`

**builderフェーズ段階の内訳**（G6 で分割したあとの見積もり。build-02/issue.md と同じ）

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 100k | 開始時の実測 59k に、手順の進行分 40k（このセッションで続ける） |
| 読み込み | 190k | このセッションで読了済み約 145k（plan と plan-review のための engine/directive/architect/step.mts 等を含む）。残り約 45k: tests の helpers/config/toml、commands/config.mts、docs.mts、config-file.md、CHANGELOG [3.0.0] |
| 実装 | 50k | toml のテーブル配列、config の [app]（3軸・merge_gate）/[[app.areas]]（name 必須）/[boundaries] の読み込み・ルート限定・表示、risk.mts 新規（約300行: 表・パスの解決・厳しいほう・overlaps・touchedPaths・2つの基準の読み取り・ADR の特定）、git/stack の補助、config-file.md の節、CHANGELOG |
| テスト | 40k | risk の unit（表・上書き・厳しいほう・mergeGate・overlaps・touchedPaths）、2つの基準の一時リポジトリ（作業ブランチ・スタック・conductor ブランチ・base_branch の書き換え）、config のルート限定と不正値、toml のテーブル配列 |
| 未知の領域 | 40k | 同期の git での基準の読み取りと一時リポジトリの調整、glob の重なりの判定、ResolvedConfig の欄の追加と resolvePrBase の defaultBaseOf への寄せが既存テストに波及する修正 |
| **予測ピーク** | **420k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [x] Step 1: toml のテーブル配列
- [x] Step 2: config の `[app]`・`[[app.areas]]`・`[boundaries]`（読み込み・ルート限定・表示）
- [x] Step 3: `risk.mts`（表・パスの解決・厳しいほう・overlaps・touchedPaths・基準の読み取り・ADR の特定）と git / stack の補助
- [x] Step 4: テスト（risk の unit と一時リポジトリ、config、toml）
- [x] Step 5: config-file.md、CHANGELOG
- [ ] Step 6: ローカル検証（`npx tsc --noEmit`・`npm test`・`step lint`・`conductor lint`）
