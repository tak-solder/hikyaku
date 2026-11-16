# Build 08: 差分の事実と、合意との突き合わせ（agreement-review）

## 依存パッケージ

なし（実行時依存ゼロのまま。git の出力を自前で解析する）

## クラス設計

### `scripts/lib/git.mts`（追加。`tryGit` の作法で、失敗は値で返す）

- `nameStatus(cwd, from: string): Promise<NameStatusEntry[] | undefined>` — `git diff --name-status -M -z <from>`（作業ツリーとの比較。コミット済みと未コミットの追跡ファイルの両方）
  - `NameStatusEntry = { status: "A" | "M" | "D" | "R" | "C" | "T"; path: string; from?: string }`
- `unifiedDiff(cwd, from: string, paths?: string[]): Promise<string | undefined>` — `git diff -M -U0 --no-color --no-ext-diff <from> [-- paths]`
- `commitsTouchingSince(cwd, path: string, since: string): Promise<CommitSummary[] | undefined>` — `git log --since=<since> --format=%h%x09%cI%x09%s -- <path>`。`since` より後（厳密に後）のコミットだけ残す
- `untrackedFiles(cwd): Promise<string[]>` — `git ls-files --others --exclude-standard -z`（未追跡の新規ファイルも追加として並べるため）
- `mergeBaseOf(cwd, ref, head = "HEAD"): Promise<string | undefined>`

### `scripts/lib/diff-stats.mts`（変更）

- `DiffPatterns` に `testDeclarations` / `skipMarkers` / `assertionMarkers`（印。**部分文字列**で照合する。正規表現にしないのは、利用者が書いた印のエスケープ漏れで検査が壊れないため）
- 既定値 `DEFAULT_TEST_DECLARATIONS` / `DEFAULT_SKIP_MARKERS` / `DEFAULT_ASSERTION_MARKERS`（JS/TS・Python・Go・Ruby・Java/Kotlin・Rust・PHP の主要な枠組み）

### `scripts/lib/config.mts`（変更）

- `readDiffPatterns` が `test_declarations` / `skip_markers` / `assertion_markers` を読む。**既定に追加**（重複は除く）。`exclude` / `tests` は従来どおり置き換え

### `scripts/lib/diff-facts.mts`（新規）

```ts
interface HunkLine { side: "-" | "+"; line: number; text: string }
interface FileHunks { path: string; from?: string; lines: HunkLine[] }
export function parseUnifiedDiff(diff: string): FileHunks[]   // -U0 の出力。バイナリ・空の hunk を扱う

interface MarkerFact { path: string; line: number; text: string; marker: string }
export interface DiffFacts {
  phase: string;
  base: { name: string; ref: string | undefined; mergeBase: string | undefined };
  files: { status: string; path: string; from?: string; kind: FileKind; untracked?: true }[];
  deletedTestFiles: string[];
  deletedTests: MarkerFact[];         // テストファイルの - 行で、宣言の印を含み、同じファイルの + 行に同じ文が無いもの
  addedSkips: MarkerFact[];           // テストファイルの + 行で、スキップの印を含み、同じファイルの - 行に同じ文が無いもの
  assertionChanges: (MarkerFact & { side: "-" | "+" })[]; // テストファイルのアサーションの行の増減（移動だけのものは除く）。緩和とは判定しない
  configChanges: ConfigChange[];
  testSpec: { approvedAt: string | undefined; commits: CommitSummary[]; uncommitted: boolean } | undefined;
  notices: string[];
}
export interface ConfigChange { file: string; ref: string; change: "added" | "removed" | "changed"; detail: string }

export function collectMarkerFacts(hunks: FileHunks[], patterns: DiffPatterns): Pick<DiffFacts, "deletedTests" | "addedSkips" | "assertionChanges">
export function declarationConfigChanges(file: string, before: string | undefined, after: string | undefined): ConfigChange[]
  // [app] の各キー・[[app.areas]]（name ごと。削除・追加・paths の削除と追加・ほかのキーの変更）・[boundaries]・[consent]
export async function diffFacts(input: { config: ResolvedConfig; context: CycleContext | undefined; phase: Phase; base: PrBase }): Promise<DiffFacts>
export function renderFactsText(facts: DiffFacts): string        // 人とレビュアーが読む形
export function renderFactsPr(facts: DiffFacts, agreement: string | undefined): string // PR 本文の節
export function agreementReasons(markdown: string): string[]    // agreement.md の「## 返した理由」の箇条書き
```

- 差分の基準は `resolvePrBase` の `ref` と HEAD の merge-base。作業ツリーと比べる（agreement-review は review のコミットの前に走るため）
- 変更ファイルの一覧から `hikyakuRoot` 配下は除く（ワークフローの成果物）。ただし設定の宣言はルートの `.hikyaku.config` と、サイクルの `.hikyaku.config` を merge-base と作業ツリーで別に比べる
- G8 の承認の `at` は、このビルドの progress.jsonl の `builder`・`G8`・`approved` の最後の記録。無ければ `testSpec` は承認前として `approvedAt: undefined`（並べない）
- PR の節は、PR の diff から読める変更ファイルの一覧は写さず（原則7）、問題を変えうる事実（テストの削除・スキップ・アサーション・設定の宣言・G8 後の test-spec）と返した理由だけを並べる。事実が無ければ「該当なし」と1行

### `scripts/commands/diff.mts`（新規）

- `hikyaku diff facts <phase> [<cycle>] [--format text|json|pr] [--no-fetch] [--json]`（読み取り専用）。phase は `build-NN`（patch はスコープ外）。`--format pr` は `build-NN/agreement.md` を読む（無ければ理由は「agreement.md がありません」）
- `scripts/hikyaku.mts` に import を足す

### `scripts/commands/review.mts`（変更）

- `review action doc <phase> --context agreement --round 1 ...` を受け付ける。agreement は `max_rounds` に関わらず1回で終える（`reviewAction` に `maxRounds: 1` で渡す）。`confirm` にならないので止まらない。それ以外の doc の context は従来どおりエラー

### `scripts/lib/steps/builder.mts`（変更）

- `{ id: "agreement-review", kind: "run", title: "差分の事実と合意の突き合わせ", produces: ["agreement.md"] }` を verify と review の間に（`when` 無し）

### 指示文・エージェント

- `skills/builder/steps/agreement-review.md`（新規）: `diff facts` を実行 → doc-reviewer（context `agreement`）を起動 → `review action doc --context agreement` → 直すか理由を返す → `agreement.md`（`## 指摘` / `## 返した理由`）を書く
- `skills/builder/steps/review.md`: スコープ準拠とデータ安全の自己確認の2項目を削る
- `skills/builder/steps/pr.md`: `diff facts build-{NN} {cycle} --format pr` の出力を本文に貼る
- `agents/doc-reviewer.md`: `context: agreement` の入力・報告する根拠ラベル（合意に無い変更・スコープ外の変更・データ安全の不備・テストの後退の合意なし）を足す

## 非機能要件

- **セキュリティ**: git には引数配列で渡す（シェルを通さない）。基準の ref は `resolvePrBase` 由来で、利用者の入力をそのまま git のオプションに渡さない
- **パフォーマンス**: `-U0` の diff を1回だけ取り、`maxBuffer` は 64MB に上げる（大きな差分で落ちない）
- **エラーハンドリング**: 基準を解決できない・git が失敗したときは推測で埋めず、`notices` に理由を出して該当の事実を空にする（終了コードは 0。読み取り専用の事実の一覧なので、手順は止めない）。設定の TOML を読めなければ「読めない」ことを事実として並べる
- **マージ時点のデータ安全**: 本番データは無い（プラグイン）。既存のワークスペースのデータ（progress.jsonl・tasklist.md）の形は変えず、新しい成果物 `agreement.md` を足すだけ。`[diff]` の新キーは省略時に既定を使うので、既存の設定ファイルはそのまま読める。進行中のビルドで `agreement-review` が増えると、verify を終えた進行中のビルドの次の1手が agreement-review になる（記録を読み直すだけで壊れない）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 360k |
| builderフェーズ段階 | 350k |

**読むファイル**

- `design/design-delta.md` の「5.」「1.」の該当項、ADR `20261116-agreement-review.md`（読了）
- `scripts/lib/git.mts`・`diff-stats.mts`・`steps/builder.mts`・`review.mts`・`commands/review.mts`・`premises.mts` の宣言の差分（読了）
- `skills/builder/steps/review.md`・`pr.md`・`verify.md`・`agents/doc-reviewer.md`（読了）
- これから: `scripts/lib/steps/engine.mts`（produces）、`scripts/lib/progress.mts`、`scripts/lib/stack.mts` の `resolvePrBase`・`scopeFor`、`tests/helpers.mts`、step の既存テスト、docs 3本の該当節

**作成するファイル**

- `scripts/lib/diff-facts.mts`（約 400 行）
- `scripts/commands/diff.mts`（約 120 行）
- `skills/builder/steps/agreement-review.md`（約 50 行）
- `tests/diff-facts.test.mts`（約 300 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 60k | tokens session の開始時の固定分 59k |
| 読み込み | 100k | plan 時点で 143k（固定分込み）。残りは engine.mts の produces・step lint・progress.mts・tests/helpers.mts・既存のCLI結合テストの型・docs 3本の該当節で約 15k |
| 実装 | 90k | diff-facts.mts 新規（約400行）、commands/diff.mts（約120行）、git.mts に3関数、config.mts の [diff] 3キー、review action の agreement、builder.mts のステップ、指示ファイル agreement-review.md、review.md・pr.md・doc-reviewer.md の修正、docs 3本、CHANGELOG |
| テスト | 60k | tests/diff-facts.test.mts（unified diff のフィクスチャ解析・印・設定の変更）と一時リポジトリでの CLI 結合（G8 後の test-spec 書き換え・agreement.md 必須）、既存の step テストの期待値の更新 |
| 未知の領域 | 40k | hunk の解析の境界（リネーム・バイナリ・未追跡）、step lint と既存テストの期待値の連鎖 |
| **予測ピーク** | **350k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `diff-stats.mts` と `config.mts` に印の既定と `[diff]` の3キー（既定に追加）
- [ ] Step 2: `git.mts` に `nameStatus` / `unifiedDiff` / `commitsTouchingSince` / `untrackedFiles` / `mergeBaseOf`
- [ ] Step 3: `diff-facts.mts`（diff の解析、印の事実、設定の宣言の変更、G8 後の test-spec、text / pr の描画、agreement.md の読み取り）
- [ ] Step 4: `commands/diff.mts` と `hikyaku.mts` の登録
- [ ] Step 5: `review action doc --context agreement`
- [ ] Step 6: builder の `agreement-review` ステップと指示ファイル、review.md の自己確認の削除、pr.md、doc-reviewer.md
- [ ] Step 7: テスト（`tests/diff-facts.test.mts`: 言語ごとのフィクスチャの unit、`[[app.areas]]` の削除と paths の縮小、一時リポジトリでの G8 後の test-spec の書き換え、agreement.md が無ければ完了にならない、PR の節）と既存テストの期待値
- [ ] Step 8: docs（`workflow/build.md`・`reference/agents-and-skills.md`・`configuration/config-file.md`・`reference/cli.md`）と CHANGELOG の `[3.0.0]`
- [ ] Step 9: ローカル検証（`step lint`・`conductor lint`・`npx tsc --noEmit`・`npm test`）
