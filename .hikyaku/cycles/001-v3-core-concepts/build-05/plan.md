# Build 05: 宣言の変更の見直し・記録のテンプレート・ポインタの検査

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/premises.mts`（新規）

宣言の変更と、それを拠り所にした受け入れを導く。読み取り専用。

```ts
/** 「受け入れたこと」の1行 */
interface AcceptedLine {
  source: string;          // リポジトリルートからの相対パス
  line: number;            // 1始まり
  text: string;            // 拠り所を除いた本文
  premises: string[];      // 拠り所の参照（無ければ空。照合の対象にしない）
}
interface AcceptedProblem { source: string; line: number; message: string }

/** Markdown の「受け入れたこと」の節を読む。見出し形（## 受け入れたこと）と、太字の箇条書き形（- **受け入れたこと**:）の両方 */
function parseAcceptedSection(markdown: string, source: string): { lines: AcceptedLine[]; problems: AcceptedProblem[] };

/** document-guide.md の decisions・constraints が指すファイル（ディレクトリなら直下の .md）の「受け入れたこと」 */
function persistentAcceptances(config: ResolvedConfig): { lines: AcceptedLine[]; problems: AcceptedProblem[] };

/** 作業ツリーにある全サイクルの decisions.jsonl の受け入れ（下の定義） */
function ledgerAcceptances(config: ResolvedConfig): { items: LedgerAcceptance[]; problems: string[] };
interface LedgerAcceptance {
  cycle: string; id: string; unit: string; type: "risk" | "objection";
  summary: string; premises: string[];
  decision: Decision | null;   // 最新の決定（未決の risk は null）
}

/**
 * 基準のコミットと HEAD のルートの .hikyaku.config の [app]・[[app.areas]] を比べ、
 * 変わった参照（app.<key> / area:<name>）の和を返す
 */
function declarationChanges(config: ResolvedConfig, from?: string): DeclarationChanges;
interface DeclarationChanges {
  bases: { ref: string; commit: string }[];  // 比べた基準
  changed: string[];
  uncertain: boolean;                         // 基準を1つも読めなかった・宣言を読めなかった
  notices: string[];
}

/** 変わった参照を拠り所にした受け入れ（記録と ADR・constraints）と、読めない行の警告 */
function premisesReview(config: ResolvedConfig, from?: string): PremisesReview;

/** pr の args に足す: { declarationChanged }（変わった参照をカンマ区切り。無ければ false） */
function declarationArgs(ctx: StepContext): Record<string, unknown>;

/** ID の範囲（`X-1〜X-5`・`US-15.1〜15.3`）を本文の行から拾う。コードブロックとインラインコードは除く */
function idRanges(markdown: string): { line: number; text: string }[];
```

- 拠り所の解析は行末の `（拠り所: \`a\`, \`b\`）` に限る。中身は `ledger.mts` の `parsePremise` で検査し、合わなければ警告。`（拠り所:` が行末以外にある行も警告
- 節の中で箇条書きでない行（続きの行は箇条書きより深い字下げなら前の項目の続きとして扱う）、太字の項目の同じ行に本文を書いた形は警告
- 宣言の差分の基準は build-02 の読み方を使う: `--changed-from` が無ければ `effectiveDeclaration(config).baselines` のうち読めたものの `commit`（デフォルトブランチと base_branch、それぞれ `origin/` とローカル、Hikyaku のブランチは除く）。HEAD の宣言と各基準を比べ、変わった参照の和を取る（見直しを落とさない向き）。`--changed-from <ref>` があれば `origin/<ref>` と `<ref>` を `rev-parse --verify` で確かめて読めるものすべての merge-base を使う。`-` で始まる値は受け付けない（git のオプションとして読まれないように）
- 比べ方: 両側を `parseToml` で読み、`exposure` / `data` / `impact` / `merge_gate` の値と、名前ごとの area の中身（JSON で比較。足した・消した area も含む）を比べる
- 基準を1つも解決できない（浅い clone で merge-base が無いなど）、またはどこかの宣言を読めないときは、`uncertain: true` にし、HEAD と読めた基準に宣言されている参照をすべて変わったものとして扱い、notices に理由を出す（build-02 の handoff の「厳しさの分からない基準は上げる向き」にそろえる）。宣言がどこにも無ければ changed は空
- 受け入れの定義: `risk` は最新の決定が `rejected` / `resolved` でないもの（未決も含む。事後同意待ちの受け入れも見直しの対象）、`objection` は最新の決定が `consented` のもの（`decided` はユーザーが選択を改めたので受け入れが無い）。どちらも premises を持つものだけ。読めないサイクルの記録は problems に出して続ける
- `declarationArgs` は pr の directive を作るたびに評価される（`step next`・Stop フック・`step where` の `directiveOf` も通る）。git の呼び出しは基準の数だけで、`effectiveDeclaration` のキャッシュを使う。architect の pr は既存の args と合成する

### `scripts/commands/ledger.mts`

- `ledger premises [--changed-from <ref>] [--format text|pr] [--json]` を足す。サイクルに依らない（作業ツリーの全サイクルと永続ドキュメント）。`--changed-from` を省くと build-02 の基準を使う。終了コード 0。`--format pr` は PR 本文に貼る「宣言の変更」節を返す（変わった参照と、それを拠り所にした受け入れ。ポインタは ID とファイル:行）

### `scripts/commands/validate.mts`

- `warnings: Problem[]` を足す（JSON の `warnings`、テキストは `! scope: message`）。終了コードは problems だけで決める
- 常に: 永続ドキュメント（document-guide の hikyaku / repo 管理のパス、ディレクトリなら直下の .md。glossary は除く: 管理の対象が「用語」節だけで、ほかの節は利用者向けの説明として範囲の書き方の例を載せうる）と、対象サイクル（進行中のサイクル、引数があればそのサイクル）の .md の ID の範囲を警告。ADR・constraints の「受け入れたこと」の読めない行を警告
- `--base <ref>`: `premisesReview` の変わった参照と拠り所にした受け入れを警告（ref の検証は ledger premises と同じ）。CI の例には履歴の深さ（`fetch-depth: 0`）の前提を書く

### `scripts/lib/steps/{planner,architect,builder,close-cycle,patch}.mts`

- `pr` の定義に `args: declarationArgs` を足す（patch はサイクルに属さなくても同じ）

### 指示文・テンプレート

- 5つの `steps/pr.md`: `declarationChanged` が false でなければ `ledger premises --changed-from {declarationBase} --format pr` の出力を本文に貼る
- `skills/architect/references/templates.md`: ADR を 決定 / 文脈 / 外の前提 / 検討した案 / 推奨 / 採用理由 / 受け入れたこと / トレードオフ / 再評価条件 / 退けた推奨で失う利点 / 影響範囲 / 領域（任意）。design-questions に 選択肢・各案の欠点・推奨・回答・失う利点
- `領域` の書式（build-10 の `areas dormant` が読む）: `- **領域**: \`<glob>\`[, \`<glob>\`]`。バッククォートで囲んだ glob をカンマ区切りで並べる。ADR は1ファイルに1行、constraints は項目（`##` の見出し）ごとに1行
- `skills/architect/steps/adr.md`・`questions.md` を同じ欄に
- `skills/close-cycle/references/constraints-template.md`（新規）と `steps/write.md` からの参照
- 件数・範囲を添えさせる指示: build-manager / builder の templates（予測ピークの根拠は残す）、close-cycle の G10・collect、init の pr・triage-approval、conductor の SKILL.md、token-guide の propose
- `docs/operations/ci.md`（`validate --base`）、`docs/reference/cli.md`、CHANGELOG `[3.0.0]`

## 非機能要件

- **セキュリティ**: 外部への送信なし。git はすべて引数配列で呼ぶ（`gitSync`）。`--changed-from` / `--base` は `-` 始まりを拒み、`rev-parse --verify` で ref を確かめてから使う
- **パフォーマンス**: `declarationArgs` は現在のステップが pr のときだけ評価される（`directive.mts` は現在のステップの args だけ評価。Stop フック・`step where` も同じ経路）。git の呼び出しは基準の数だけの show
- **エラーハンドリング**: 宣言・記録・文書を読めないときは止めずに notices / warnings に出す（`ledger premises` と `validate` の警告の段階は終了コード 0）
- **マージ時点のデータ安全**: 読み取りと、テンプレート・指示文の変更だけ。ワークスペースのデータの形は変えない。validate の終了コードは警告で変わらないので、既存の CI は落ちない

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 330k |
| builderフェーズ段階 | 375k |

**読むファイル**

- 読了: `scripts/lib/ledger.mts`、`scripts/commands/ledger.mts`、`scripts/commands/validate.mts`、`scripts/lib/risk.mts`、`scripts/lib/docs.mts`、architect の `references/templates.md`・`steps/adr.md`・`steps/questions.md`、5つの `steps/pr.md`、close-cycle の `write.md`・`G10.md`・`collect.md`、init の `pr.md`・`triage-approval.md`、`skills/conductor/SKILL.md` と `skills/token-guide/steps/propose.md` の該当節、`docs/operations/ci.md`
- これから: `scripts/lib/config.mts`（`ResolvedConfig`・`readAppDeclaration`）、`scripts/lib/toml.mts`、`scripts/lib/git.mts`（`gitSync`）、`scripts/lib/stack.mts`、`scripts/lib/steps/directive.mts`・`engine.mts`・`locate.mts`（args の評価経路）、5スキルの pr 定義（`scripts/lib/steps/architect.mts` は既存の args と合成）、`skills/build-manager/references/templates.md`・`skills/builder/references/templates.md`、`CHANGELOG.md`・`docs/reference/cli.md`、`tests/helpers.mts`・`tests/cli.test.mts`・`tests/risk.test.mts`

**作成するファイル**

- `scripts/lib/premises.mts`、`skills/close-cycle/references/constraints-template.md`、`tests/premises.test.mts`

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 140k | 読了: ledger.mts・commands/ledger.mts・validate.mts・risk.mts・docs.mts・architect の templates/adr/questions・5つの pr.md・close-cycle の write/G10/collect・init の pr/triage-approval・conductor SKILL と token-guide propose の該当節・ci.md。これから: config.mts（ResolvedConfig・readAppDeclaration）・toml.mts・git.mts（gitSync）・stack.mts・steps の directive/engine/locate（args の評価経路）・5スキルの pr 定義（architect は既存の args と合成）・build-manager と builder の templates・CHANGELOG・cli.md・tests/cli.test.mts と tests/risk.test.mts（一時リポジトリの先例） |
| 実装 | 65k | lib/premises.mts（risk.mts の基準を使う宣言の差分・受け入れたことの節の解析・ID の範囲の検出）、ledger premises、validate の warnings と --base、pr の args（5スキル）と pr.md、ADR・constraints・design-questions のテンプレート、件数の指示の修正、CHANGELOG・cli.md・ci.md |
| テスト | 45k | premises の単体（節の解析・拠り所・警告）、一時リポジトリでの ledger premises と validate --base の結合、範囲の警告と終了コード 0 |
| 未知の領域 | 35k | 受け入れたことの節の書式の揺れ、validate の JSON の形の変更による既存テストの修正ループ、CI の浅い clone で merge-base が無い場合 |
| **予測ピーク** | **375k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `scripts/lib/premises.mts`（節の解析・宣言の差分・ID の範囲）と単体テスト
- [ ] Step 2: `ledger premises` と結合テスト
- [ ] Step 3: `validate` の警告の段階・`--base`・範囲の検査と結合テスト
- [ ] Step 4: pr の args と5つの pr.md
- [ ] Step 5: ADR・constraints・design-questions のテンプレートと adr.md・questions.md・write.md
- [ ] Step 6: 件数・範囲の指示の修正（grep で確かめる）
- [ ] Step 7: docs（ci.md・cli.md）と CHANGELOG、`npx tsc --noEmit`・`npm test`
