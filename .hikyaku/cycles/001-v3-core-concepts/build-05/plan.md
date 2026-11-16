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

/** 作業ツリーにある全サイクルの decisions.jsonl の、拠り所（premises）を持つ事項 */
function ledgerAcceptances(config: ResolvedConfig): { items: LedgerAcceptance[]; problems: string[] };

/** merge-base(HEAD, base) と HEAD のルートの .hikyaku.config の [app]・[[app.areas]] を比べ、変わった参照（app.<key> / area:<name>）を返す */
function declarationChanges(config: ResolvedConfig, base: string): DeclarationChanges;
interface DeclarationChanges { base: string; commit: string | undefined; changed: string[]; notices: string[] }

/** 変わった参照を拠り所にした受け入れ（記録と ADR・constraints）と、読めない行の警告 */
function premisesReview(config: ResolvedConfig, base: string): PremisesReview;

/** pr の args: { declarationBase, declarationChanged }（変わったキーをカンマ区切り。無ければ false） */
function declarationArgs(ctx: StepContext): Record<string, unknown>;

/** ID の範囲（`X-1〜X-5`・`US-15.1〜15.3`）を本文の行から拾う。コードブロックとインラインコードは除く */
function idRanges(markdown: string): { line: number; text: string }[];
```

- 拠り所の解析は行末の `（拠り所: \`a\`, \`b\`）` に限る。中身は `ledger.mts` の `parsePremise` で検査し、合わなければ警告。`（拠り所:` が行末以外にある行も警告
- 節の中で箇条書きでない行（続きの行は箇条書きより深い字下げなら前の項目の続きとして扱う）、太字の項目の同じ行に本文を書いた形は警告
- 宣言の差分: 両側を `parseToml` で読み、`exposure` / `data` / `impact` / `merge_gate` の値と、名前ごとの area の中身（JSON で比較。足した・消した area も含む）を比べる。どちらかを読めなければ notices に出し、読めた側にあるキーをすべて変わったものとして扱う（見直しの対象を落とさない向き）
- base の既定は `defaultBaseOf(config)`。解決できなければ `declarationArgs` は `declarationChanged: false` と notice を返さず値だけ（`declarationBase: false`）

### `scripts/commands/ledger.mts`

- `ledger premises [--changed-from <base>] [--format text|pr] [--json]` を足す。サイクルに依らない（作業ツリーの全サイクルと永続ドキュメント）。`--changed-from` の既定は `defaultBaseOf`。終了コード 0。`--format pr` は PR 本文に貼る「宣言の変更」節を返す

### `scripts/commands/validate.mts`

- `warnings: Problem[]` を足す（JSON の `warnings`、テキストは `! scope: message`）。終了コードは problems だけで決める
- 常に: 永続ドキュメント（document-guide の hikyaku / repo 管理のパス、ディレクトリなら直下の .md）と、対象サイクル（進行中のサイクル、引数があればそのサイクル）の .md の ID の範囲を警告。ADR・constraints の「受け入れたこと」の読めない行を警告
- `--base <ref>`: `premisesReview` の変わったキーと拠り所にした受け入れを警告

### `scripts/lib/steps/{planner,architect,builder,close-cycle,patch}.mts`

- `pr` の定義に `args: declarationArgs` を足す（patch はサイクルに属さなくても同じ）

### 指示文・テンプレート

- 5つの `steps/pr.md`: `declarationChanged` が false でなければ `ledger premises --changed-from {declarationBase} --format pr` の出力を本文に貼る
- `skills/architect/references/templates.md`: ADR を 決定 / 文脈 / 外の前提 / 検討した案 / 推奨 / 採用理由 / 受け入れたこと / トレードオフ / 再評価条件 / 退けた推奨で失う利点 / 影響範囲 / 領域（任意。`- **領域**: \`<glob>\``）。design-questions に 選択肢・各案の欠点・推奨・回答・失う利点
- `skills/architect/steps/adr.md`・`questions.md` を同じ欄に
- `skills/close-cycle/references/constraints-template.md`（新規）と `steps/write.md` からの参照
- 件数・範囲を添えさせる指示: build-manager / builder の templates（予測ピークの根拠は残す）、close-cycle の G10・collect、init の pr・triage-approval、conductor の SKILL.md、token-guide の propose
- `docs/operations/ci.md`（`validate --base`）、`docs/reference/cli.md`、CHANGELOG `[3.0.0]`

## 非機能要件

- **セキュリティ**: 外部への送信なし。git はすべて引数配列で呼ぶ（`gitSync`）
- **パフォーマンス**: `declarationArgs` は pr の directive を作るときだけ評価される（`directive.mts` は現在のステップの args だけ評価）。git の呼び出しは merge-base と show の数回
- **エラーハンドリング**: 宣言・記録・文書を読めないときは止めずに notices / warnings に出す（`ledger premises` と `validate` の警告の段階は終了コード 0）
- **マージ時点のデータ安全**: 読み取りと、テンプレート・指示文の変更だけ。ワークスペースのデータの形は変えない。validate の終了コードは警告で変わらないので、既存の CI は落ちない

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 330k |
| builderフェーズ段階 | 325k |

**読むファイル**

- 読了: `scripts/lib/ledger.mts`、`scripts/commands/ledger.mts`、`scripts/commands/validate.mts`、`scripts/lib/risk.mts`、`scripts/lib/docs.mts`、architect の `references/templates.md`・`steps/adr.md`・`steps/questions.md`
- これから: `scripts/lib/steps/` の5つの pr 定義、5つの `steps/pr.md`、`skills/close-cycle/steps/write.md`・`G10.md`・`collect.md`、`skills/init/steps/pr.md`・`triage-approval.md`、`skills/conductor/SKILL.md` の該当節、`skills/token-guide/steps/propose.md`、`docs/operations/ci.md`、`tests/helpers.mts`

**作成するファイル**

- `scripts/lib/premises.mts`、`skills/close-cycle/references/constraints-template.md`、`tests/premises.test.mts`

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 100k | ledger.mts・commands/ledger.mts・validate.mts・risk.mts・docs.mts は読了。残りは steps の pr 定義と5つの steps/pr.md、architect の templates/adr/questions、close-cycle の write・G10・collect、init の pr・triage-approval、conductor SKILL の該当節、token-guide propose、ci.md、tests/helpers と既存の結合テスト |
| 実装 | 65k | lib/premises.mts（宣言の差分・受け入れたことの節の解析・ID の範囲の検出）、ledger premises、validate の warnings と --base、pr の args（5スキル）と pr.md、ADR・constraints・design-questions のテンプレート、件数の指示の修正、CHANGELOG・cli.md・ci.md |
| テスト | 45k | premises の単体（節の解析・拠り所・警告）、一時リポジトリでの ledger premises と validate --base の結合、範囲の警告と終了コード 0 |
| 未知の領域 | 25k | 受け入れたことの節の書式の揺れ（見出し形と太字の箇条書き形）、validate がこのリポジトリ自身の文書で出す範囲の警告 |
| **予測ピーク** | **325k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `scripts/lib/premises.mts`（節の解析・宣言の差分・ID の範囲）と単体テスト
- [ ] Step 2: `ledger premises` と結合テスト
- [ ] Step 3: `validate` の警告の段階・`--base`・範囲の検査と結合テスト
- [ ] Step 4: pr の args と5つの pr.md
- [ ] Step 5: ADR・constraints・design-questions のテンプレートと adr.md・questions.md・write.md
- [ ] Step 6: 件数・範囲の指示の修正（grep で確かめる）
- [ ] Step 7: docs（ci.md・cli.md）と CHANGELOG、`npx tsc --noEmit`・`npm test`
