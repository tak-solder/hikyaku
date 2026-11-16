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
  issueChanged: boolean;              // このビルドの issue.md が基準から変わっている（合意そのものの書き換え）
  afterG8: { approvedAt: string | undefined; files: { path: string; commits: CommitSummary[]; uncommitted: boolean }[] }; // test-spec.md と plan.md
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
- **未追跡のファイル**は追加（A）として並べ、中身を読んで全行を `+` 行として印の照合に加える（初めのコミットは review なので、新しいテストファイルは未追跡のまま。index を変える `git add -N` は使わない）
- 変更ファイルの一覧から除くのは、このビルドのディレクトリのうち builder が正当に書く成果物（`progress.jsonl`・`decisions.jsonl`・`handoff.md`・`agreement.md`・`retrospective.md`・`questions.md`・`plan.md`・`test-spec.md`）だけ。issue.md・ほかのビルドの成果物・`decisions` の ADR などワークスペースの他の変更は一覧に残す
- **合意の文書の書き換え**: issue.md が基準から変わっていれば `issueChanged`。plan.md と test-spec.md は G8 の承認より後のコミットと未コミットの変更を `afterG8` に並べる
- **テストファイルの削除**: `deletedTestFiles` は D の変更と、元のパスがテストに分類され、新しいパスがテストでない R の変更（リネームでテストから外したもの）
- 設定の宣言はルートの `.hikyaku.config` と、サイクルの `.hikyaku.config` を merge-base と作業ツリーで別に比べる
- G8 の承認の `at` は、このビルドの progress.jsonl の `builder`・`G8`・`approved` の最後の記録。無ければ `afterG8.approvedAt` は undefined で、ファイルは並べない
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
| builderフェーズ段階 | 415k |

**読むファイル**

- `design/design-delta.md` の「5.」「1.」の該当項、ADR `20261116-agreement-review.md`（読了）
- `scripts/lib/git.mts`・`diff-stats.mts`・`steps/builder.mts`・`review.mts`・`commands/review.mts`・`premises.mts` の宣言の差分（読了）
- `skills/builder/steps/review.md`・`pr.md`・`verify.md`・`agents/doc-reviewer.md`（読了）
- これから: `scripts/lib/steps/engine.mts`（produces）、`scripts/lib/progress.mts`、`scripts/lib/stack.mts` の `resolvePrBase`・`scopeFor`、`scripts/lib/config.mts` の `[diff]`、`scripts/hikyaku.mts`、`tests/helpers.mts`、`tests/step.test.mts`・`tests/objection.test.mts`（verify → review の期待値）・`tests/config.test.mts`・`tests/review.test.mts`・`tests/session.test.mts`（`DiffPatterns` の組み立て）、docs 4本（`workflow/build.md`・`reference/agents-and-skills.md`・`configuration/config-file.md`・`reference/cli.md`）の該当節

**作成するファイル**

- `scripts/lib/diff-facts.mts`（約 450 行）
- `scripts/commands/diff.mts`（約 120 行）
- `skills/builder/steps/agreement-review.md`（約 50 行）
- `tests/diff-facts.test.mts`（約 300 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 100k | 開始時の固定分 59k に、手順の進行分（agreement-review・review・retrospective・PR）40k |
| 読み込み | 110k | plan 時点で 143k（固定分込み）。残りは engine.mts の produces・progress.mts・stack.mts の resolvePrBase/scopeFor・config.mts の該当節・hikyaku.mts・tests/helpers.mts・config/review/session/step の既存テスト・docs 4本の該当節で約 25k |
| 実装 | 100k | diff-facts.mts 新規（約450行。未追跡ファイルの中身、合意の文書の書き換え、リネームでテストから外れたもの）、commands/diff.mts（約120行）、git.mts に6関数、config.mts の [diff] 3キー、review action の agreement、builder.mts のステップ、agreement-review.md、review.md・pr.md・doc-reviewer.md、docs 4本、CHANGELOG |
| テスト | 60k | tests/diff-facts.test.mts（unified diff のフィクスチャ解析・印・設定の変更・リネーム）と一時リポジトリでの CLI 結合（G8 後の書き換え・未追跡のテスト・agreement.md 必須）、既存の step テストと session.test の DiffPatterns の期待値の更新 |
| 未知の領域 | 45k | hunk の解析の境界（リネーム・バイナリ・未追跡）、DiffPatterns の型の連鎖、step lint と既存テストの期待値の連鎖 |
| **予測ピーク** | **415k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [x] Step 1: `diff-stats.mts` と `config.mts` に印の既定と `[diff]` の3キー（既定に追加）
- [x] Step 2: `git.mts` に `nameStatus` / `unifiedDiff` / `commitsTouchingSince` / `untrackedFiles` / `mergeBaseOf` / `hasUncommittedChange`
- [x] Step 3: `diff-facts.mts`（diff の解析、未追跡ファイルの中身、印の事実、リネームでテストから外れたもの、設定の宣言の変更、issue.md の変更と G8 後の plan.md・test-spec.md、text / pr の描画、agreement.md の読み取り）
- [x] Step 4: `commands/diff.mts` と `hikyaku.mts` の登録
- [x] Step 5: `review action doc --context agreement`
- [x] Step 6: builder の `agreement-review` ステップと指示ファイル、review.md の自己確認の削除、pr.md、doc-reviewer.md
- [x] Step 7: テスト（`tests/diff-facts.test.mts`: 言語ごとのフィクスチャの unit、リネームでテストから外したファイル、`[[app.areas]]` の削除と paths の縮小、一時リポジトリでの G8 後の test-spec の書き換え・未追跡の新しいテストのスキップ、agreement.md が無ければ完了にならない、PR の節）と既存テストの期待値
- [x] Step 8: docs（`workflow/build.md`・`reference/agents-and-skills.md`・`configuration/config-file.md`・`reference/cli.md`）と CHANGELOG の `[3.0.0]`
- [x] Step 9: ローカル検証（`step lint`・`conductor lint`・`npx tsc --noEmit`・`npm test`）
