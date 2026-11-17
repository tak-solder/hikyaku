# Build 13: 中身を含まないフィードバックと、document-guide のアンカー

## 依存パッケージ

なし（実行時依存ゼロを保つ）

## クラス設計

### `scripts/lib/feedback.mts`（新規）

- `FEEDBACK_DIR = "feedback"`
- `progressFiles(hikyakuRoot: string): string[]` — HIKYAKU_ROOT の下の `progress.jsonl` を再帰で集める（`feedback/` は除く）。ユーザーが手で呼ぶコマンドなので全件の走査でよい（Stop フックの経路ではない）
- `interface StepCount { skill: string; step: string; count: number }`
- `interface GateWait { skill: string; step: string; count: number; medianMinutes: number; maxMinutes: number }`
- `interface FeedbackSummary { failed: StepCount[]; gates: GateWait[]; versions: string[]; upstream: string[]; files: number }`
- `summarizeProgress(events: Pick<ProgressEvent, "at" | "skill" | "step" | "result" | "round" | "hikyaku">[][]): Omit<FeedbackSummary, "upstream" | "files">`
  - 入力はファイルごとの記録の列。読む欄を `at` / `skill` / `step` / `result` / `round` / `hikyaku` に絞る（`pick` で写してから渡す。`input` / `reason` / `pr` / `session` は触らない）
  - 止まった手順: `result === "failed"` を skill・step ごとに数える
  - ゲートにかかった時間: `result` が `approved` / `rejected` の記録と、同じファイルの直前の記録の `at` の差（分）。restart の直後や差が負・読めない日時は数えない
  - `round` は集計の単位に含めない（ゲートの回の種類で分けると、サイクルを特定しうる組み合わせが増えるため）。読むのは restart の区切りの判定だけ
- `upstreamItems(hikyakuRoot: string): string[]` — すべてのサイクルの `collectPromotions` から `kind === "upstream"` の本文だけを返す（`source` は捨てる）
- `renderFeedback(summary: FeedbackSummary, date: string): string` — 書き出す Markdown。節: 使い方（送る前に全文を読む、送るかはユーザーが決める）/ 止まった手順 / ゲートにかかった時間 / upstream（自由文なので全文を読む注意）/ 起票の下書き（issue の本文）
- `feedbackPath(hikyakuRoot: string, date: string): string`
- `isIgnored(repoRoot: string, path: string): boolean` — `git check-ignore -q`。終了コード 0 だけを追跡対象外とみなす（git が無い・失敗は追跡対象外とみなさない＝止める）

### `scripts/commands/feedback.mts`（新規）

- `feedback export [--dry-run] [--root] [--json]`、`writes: true`
- `feedback/` が追跡対象外でなければ書き出さずに `HikyakuError`（直し方: `{HIKYAKU_ROOT}/.gitignore` に `feedback/` を足す）。`--dry-run` でも同じ判定を行い、本文を表示して書かない
- 外部へ送る処理は持たない
- `scripts/hikyaku.mts` のコマンド読み込みに足す

### `scripts/lib/docs.mts`

- `DocEntry.anchor: string | undefined` を足す。`path` はアンカーを除いたパス（`#` より前）、`anchor` は `#` の後ろ（デコード済み）
- `docRef(entry): string | undefined` — `path#anchor` を返す（context・索引の表示用）
- `githubAnchor(heading: string): string` — GitHub 式（小文字化、英数字・日本語などの文字・`-`・`_`・空白以外を除く、空白を `-`）
- `markdownAnchors(source: string): Set<string>` — 見出しからアンカーの集合（コードブロックは除く、重複は `-1` `-2` を付ける）
- `validateGuide`: アンカーがあれば、パスがファイルで、その見出しのアンカーが存在するかを検査（無ければ「節が見つかりません」）。パスの存在の検査はアンカーを除いたパスで
- `renderIndexBlock`: 一覧に載せる判定はアンカーを除いたパスで、表示はアンカー付き

### `scripts/commands/context.mts`

- 存在の検査・`isAutoLoaded` にはアンカーを除いた `entry.path` を使い、`Suggestion.path` はアンカー付き（`docRef`）で返す

### `scripts/commands/init.mts`

- `.gitignore` の雛形と追記に `feedback/` を足す（`.hikyaku.local` と同じく、無ければ1行足す）

### `scripts/commands/docs.mts`

- `docs list` の表示をアンカー付きにする。`docs validate` の説明に節の検査を足す

## 非機能要件

- **セキュリティ（原則 15）**: 書き出しは中身を含まない欄だけから作る。サイクル名・ビルド番号・patch の slug・作業単位のパス・ユーザーの答え・理由・PR を含めない。`upstream` は自由文なので、下書きの先頭と節で「送る前に全文を読む」を示す。外部への送信は持たない。`feedback/` が追跡対象なら止める（コミットされて中身が共有されるのを防ぐ）
- **エラーハンドリング**: 壊れた progress.jsonl は `readProgress` と同じくエラーにする（黙って読み飛ばさない）
- **マージ時点のデータ安全**: progress.jsonl・cycles.md・tasklist.md の形は変えない。新しいファイル（`feedback/`）を足すだけ。`DocEntry.path` はアンカーが無いときに今と同じ値になるので、既存の document-guide.md はそのまま読める

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 295k |
| builderフェーズ段階 | 280k |

**読むファイル**

- `design/design-delta.md` の「10. フィードバック」「11. 文書の登録と `gh`」
- `scripts/lib/docs.mts`・`scripts/lib/progress.mts`・`scripts/lib/promotions.mts`（前半）・`scripts/commands/context.mts`・`scripts/commands/validate.mts`・`scripts/commands/docs.mts`・`scripts/commands/init.mts`（.gitignore）（読了）
- `scripts/lib/jsonl.mts`・`scripts/lib/markdown.mts`・`tests/helpers.mts`・`docs/configuration/documents.md`・`docs/reference/cli.md`

**作成するファイル**

- `scripts/lib/feedback.mts`（約 200 行）
- `scripts/commands/feedback.mts`（約 80 行）
- `tests/feedback.test.mts`（約 150 行）
- `tests/docs-anchor.test.mts`（約 120 行）
- 変更: `scripts/lib/docs.mts`・`scripts/commands/context.mts`・`scripts/commands/docs.mts`・`scripts/commands/init.mts`・`scripts/hikyaku.mts`・`.hikyaku/document-guide.md`・`docs/configuration/documents.md`・`docs/reference/cli.md`・`CHANGELOG.md`

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 70k | 読み終えた docs.mts・progress.mts・context.mts・validate.mts・commands/docs.mts・init.mts の一部・promotions.mts 前半（約 60k 載っている）＋ jsonl.mts・markdown.mts・tests/helpers.mts・documents.md・cli.md |
| 実装 | 55k | feedback.mts（集計・下書き、約 200 行）、commands/feedback.mts（約 80 行）、docs.mts の anchor・githubAnchor・節の検査（約 60 行）、context の返し方、init の .gitignore、docs 2 本・CHANGELOG |
| テスト | 45k | tests/feedback.test.mts（中身が混ざらないこと・check-ignore で止まる）、tests/docs-anchor.test.mts（アンカー生成・validate・context） |
| 未知の領域 | 20k | 日本語見出しの GitHub 式アンカー、check-ignore の終了コード |
| **予測ピーク** | **280k** | 統合を検討（300k 未満。推奨のみ） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `docs.mts` に anchor・`githubAnchor`・`markdownAnchors`・節の検査を足し、context・docs list・索引をアンカー付きの表示にする
- [ ] Step 2: `.hikyaku/document-guide.md` の glossary を `docs/concepts.md#用語` にする
- [ ] Step 3: `feedback.mts` と `feedback export` を足す。init の `.gitignore` に `feedback/` を足す（このリポジトリの `.hikyaku/.gitignore` にも足す）
- [ ] Step 4: テスト（フィクスチャの記録に cycle 名・ビルド番号・slug・input・reason・pr を入れ、出力に現れないことを確かめる）
- [ ] Step 5: docs（documents.md・cli.md）と CHANGELOG の `[3.0.0]`
- [ ] Step 6: `npx tsc --noEmit`・`npm test`
