# Build 13: 中身を含まないフィードバックと、document-guide のアンカー

## 依存パッケージ

なし（実行時依存ゼロを保つ）

## クラス設計

### `scripts/lib/feedback.mts`（新規）

- `FEEDBACK_DIR = "feedback"`
- `progressFiles(hikyakuRoot: string): string[]` — HIKYAKU_ROOT の下の `progress.jsonl` を再帰で集める（`feedback/` は除く）。ユーザーが手で呼ぶコマンドなので全件の走査でよい（Stop フックの経路ではない）
- `interface StepCount { skill: string; step: string; count: number }`
- `interface GateWait { skill: string; step: string; count: number; medianMinutes: number }`
- `interface FeedbackSummary { failed: StepCount[]; gates: GateWait[]; versions: string[]; upstream: string[] }`
  - progress.jsonl の件数と最大値は出さない（作業の規模や時期の手がかりを減らす。安全側に倒す。plan-review の確度の低い懸念）
- `summarizeProgress(events: Pick<ProgressEvent, "at" | "skill" | "step" | "result" | "round" | "hikyaku">[][]): Omit<FeedbackSummary, "upstream">`
  - 入力はファイルごとの記録の列。読む欄を `at` / `skill` / `step` / `result` / `round` / `hikyaku` に絞る（`pick` で写してから渡す。`input` / `reason` / `pr` / `session` は触らない）
  - 止まった手順: `result === "failed"` を skill・step ごとに数える
  - ゲートにかかった時間: `result` が `approved` / `rejected` の記録と、同じファイルの直前の記録の `at` の差（分）。restart の直後や差が負・読めない日時は数えない
  - `round` は集計の単位に含めない（ゲートの回の種類で分けると、サイクルを特定しうる組み合わせが増えるため）。読むのは restart の区切りの判定だけ
- `upstreamItems(hikyakuRoot: string): string[]` — すべてのサイクルの `collectPromotions` から `kind === "upstream"` の本文だけを返す（`source` は捨てる）
- `renderFeedback(summary: FeedbackSummary, date: string): string` — 書き出す Markdown。節: 使い方（送る前に全文を読む、送るかはユーザーが決める）/ 止まった手順 / ゲートにかかった時間 / upstream（自由文なので全文を読む注意）/ 起票の下書き（issue の本文）
  - 起票の下書きは固定の枠（タイトルの雛形と、上の集計の表を指す本文）を埋めるだけで、文面は作らない（原則 1）。US-16.3・design-delta 10 の「AI が下書きを用意する」は、ユーザーに頼まれたセッションの AI がこのファイルを読んで文面を整えることを指し、スキルの手順は足さない（export はユーザーが自分で呼ぶコマンドで、手順に組み込むと原則 15 の「送るかはユーザーが決める」に近づくため）。docs にこの使い方を書く
- `feedbackPath(hikyakuRoot: string, date: string): string`
- `isIgnored(repoRoot: string, path: string): boolean` — `git check-ignore -q <書き出すファイルのパス>`（`feedback/{YYYYMMDD}.md`。`feedback/` はディレクトリにだけ当たるので、まだ無いディレクトリそのものを渡すと一致しない）。`gitSync` が成功（終了コード 0）したときだけ追跡対象外とみなす（git が無い・失敗は止める）

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

### `DocEntry.path` のほかの呼び出し元

`path` はアンカーを除いた値になるので、ファイルを開く・差分を取る呼び出し元は変更なしで正しく動く。

| 呼び出し元 | 扱い |
|---|---|
| `scripts/commands/context.mts` | 存在の検査・`isAutoLoaded` は `path`、返す `Suggestion.path` は `docRef`（アンカー付き） |
| `scripts/lib/steps/directive.mts:178` | 異議の照合先のポインタは `docRef` で示す（節を指したまま渡す） |
| `scripts/lib/quality-metrics.mts:135` | `path`（ファイル全体の差分）のまま。節で絞ると見出しの改名で数え漏れるため、変更しない |
| `scripts/lib/rules.mts:453` | `path` のまま（ファイルを読む） |
| `promotions.mts:481`・`risk.mts:383`・`premises.mts:217` | `path` のまま（premises の `#` 区切りは残しても害が無いので触らない） |

### `scripts/commands/init.mts`

- `planGitignore` を行ごとの判定に組み替える: 必要な行（`.hikyaku.local`・`feedback/`）のうち無いものだけを追記する。既存行には手を出さない
- details・追記の表示（「`.hikyaku.local` の除外を追記」）・`renderGitignore` のコメントを、2行を除外する説明に直す

### `scripts/commands/docs.mts`

- `docs list` の表示をアンカー付きにする。`docs validate` の説明に節の検査を足す

### AGENTS.md の索引

`document-guide.md` の glossary をアンカー付きにすると、`renderIndexBlock` の出力が変わり、AGENTS.md の索引ブロックと一致しなくなる（init の `indexStale` が報告する）。AGENTS.md（conventions）を書けるのは close-cycle だけなので、この PR では `docs link` を実行せず、handoff の「永続化すること」に `conventions` 宛てで「`docs link` で索引を再生成する」を残す

## 非機能要件

- **セキュリティ（原則 15）**: 書き出しは中身を含まない欄だけから作る。サイクル名・ビルド番号・patch の slug・作業単位のパス・ユーザーの答え・理由・PR を含めない。`upstream` は自由文なので、下書きの先頭と節で「送る前に全文を読む」を示す。外部への送信は持たない。`feedback/` が追跡対象なら止める（コミットされて中身が共有されるのを防ぐ）
- **エラーハンドリング**: 壊れた progress.jsonl は `readProgress` と同じくエラーにする（黙って読み飛ばさない）
- **マージ時点のデータ安全**: progress.jsonl・cycles.md・tasklist.md の形は変えない。新しいファイル（`feedback/`）を足すだけ。`DocEntry.path` はアンカーが無いときに今と同じ値になるので、既存の document-guide.md はそのまま読める。init の `.gitignore` は既存行に手を出さず、無い行を足すだけ。マージ時点で残るずれは、このリポジトリの AGENTS.md の索引が document-guide.md と一致しないこと（init の検査が報告する。データは壊れない。close-cycle で再生成する）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 295k |
| builderフェーズ段階 | 320k |

**読むファイル**

- `design/design-delta.md` の「10. フィードバック」「11. 文書の登録と `gh`」
- `scripts/lib/docs.mts`・`scripts/lib/progress.mts`・`scripts/lib/promotions.mts`（前半）・`scripts/commands/context.mts`・`scripts/commands/validate.mts`・`scripts/commands/docs.mts`・`scripts/commands/init.mts`（.gitignore）（読了）
- `scripts/lib/git.mts`・`scripts/lib/steps/directive.mts`・`scripts/lib/quality-metrics.mts`・`scripts/lib/rules.mts` の該当箇所・`scripts/lib/steps/init.mts`・`scripts/hikyaku.mts`
- `tests/helpers.mts`・`tests/cli.test.mts`（.gitignore の追記）
- `.hikyaku/document-guide.md`・`.hikyaku/.gitignore`・`CHANGELOG.md`
- `docs/configuration/documents.md`・`docs/reference/cli.md`・`docs/reference/directory-layout.md`・`docs/getting-started.md`・`skills/init/SKILL.md`・`skills/init/steps/cleanup.md`

**作成するファイル**

- `scripts/lib/feedback.mts`（約 200 行）
- `scripts/commands/feedback.mts`（約 80 行）
- `tests/feedback.test.mts`（約 150 行）
- `tests/docs-anchor.test.mts`（約 120 行）
- 変更: `scripts/lib/docs.mts`・`scripts/lib/steps/directive.mts`・`scripts/commands/context.mts`・`scripts/commands/docs.mts`・`scripts/commands/init.mts`・`scripts/hikyaku.mts`・`tests/cli.test.mts`・`.hikyaku/document-guide.md`・`.hikyaku/.gitignore`・`docs/configuration/documents.md`・`docs/reference/cli.md`・`docs/reference/directory-layout.md`・`docs/getting-started.md`・`skills/init/SKILL.md`・`skills/init/steps/cleanup.md`・`CHANGELOG.md`

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 95k | 読了の docs.mts・progress.mts・context.mts・validate.mts・commands/docs.mts・init.mts・promotions.mts 前半（約 60k）＋ git.mts・directive.mts・quality-metrics.mts・rules.mts の該当箇所・steps/init.mts・tests/cli.test.mts・document-guide.md・CHANGELOG・docs 4 本（documents・cli・directory-layout・getting-started）・init の SKILL.md と cleanup.md |
| 実装 | 60k | feedback.mts（集計・固定の枠の下書き、約 200 行）、commands/feedback.mts（約 80 行）、docs.mts の anchor・githubAnchor・節の検査（約 60 行）、context・directive の表示、planGitignore の行ごとの判定、docs 4 本・init のスキル・CHANGELOG |
| テスト | 45k | tests/feedback.test.mts（中身が混ざらないこと・check-ignore で止まる）、tests/docs-anchor.test.mts（アンカー生成・validate・context）、tests/cli.test.mts の .gitignore 追記 |
| 未知の領域 | 30k | 日本語見出しの GitHub 式アンカー、check-ignore の判定、型エラー・既存テストの期待値の修正ループ |
| **予測ピーク** | **320k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `docs.mts` に anchor・`githubAnchor`・`markdownAnchors`・節の検査を足し、context・directive・docs list・索引をアンカー付きの表示にする
- [ ] Step 2: `.hikyaku/document-guide.md` の glossary を `docs/concepts.md#用語` にする（AGENTS.md の索引は close-cycle に回す）
- [ ] Step 3: `feedback.mts` と `feedback export` を足す。`planGitignore` を行ごとの判定にし、`feedback/` を足す（このリポジトリの `.hikyaku/.gitignore` にも足す）
- [ ] Step 4: テスト（フィクスチャの記録に cycle 名・ビルド番号・slug・input・reason・pr を入れ、出力に現れないことを確かめる。`feedback/` が無い状態から check-ignore の判定を確かめる。`.gitignore` の追記が重複しないこと）
- [ ] Step 5: docs（documents.md・cli.md・directory-layout.md・getting-started.md）・init のスキル（SKILL.md・cleanup.md）と CHANGELOG の `[3.0.0]`
- [ ] Step 6: `npx tsc --noEmit`・`npm test`
