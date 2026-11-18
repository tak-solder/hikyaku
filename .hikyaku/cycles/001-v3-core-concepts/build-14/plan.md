# Build 14: 操作する人を「ユーザー」と書く用語の統一

## 依存パッケージ

なし

## クラス設計

なし。型・関数の変更はない（conductor の `Handler` の値 `"human"` → `"user"` は先行ビルドで直し済み。`scripts/lib/conductor.mts` の `Handler = "supervisor" | "user"`）。変えるのは文書・指示文・CLI の出力の文字列とコメントだけ。

### 置き換えの判別

`docs/concepts.md` の用語「ユーザー」（コーディングエージェントを操作し、Hikyaku でサイクルを回す人。結果の責任を引き受け、同意を下す）に当たる「人間」を「ユーザー」に改める。次は操作する人を指さないので残す。

| 残す用法 | 箇所 | 理由 |
|---|---|---|
| Bot（Copilot など）と対比するレビュアー | `docs/configuration/config-file.md`（`phase_reviewers` の「人間のレビュアーを入れると」）、`docs/workflow/conductor.md`（`phase_reviewers` の「人間のレビュアーを入れると」）、`scripts/lib/reviewers.mts`、`scripts/lib/conductor.mts`（`phaseReviewers` のコメント） | レビュアーはチームメンバーで、操作する人とは限らない |
| Hikyaku（AI）が書いた部分と対比する、手で書いた部分 | `docs/configuration/documents.md`、`docs/operations/ci.md`、`skills/init/steps/link-approval.md`、`scripts/commands/docs.mts`、`scripts/commands/validate.mts`、`scripts/lib/markdown.mts` | 書いたのはチームの誰でもよい |
| AI が作った定義と対比する、人が定めた定義 | `scripts/lib/docs.mts`（glossary の purpose「人間が権威を持って定義したもの」） | 定義するのはドメインを知るチームの誰でもよく、操作する人とは限らない（手で書いた部分と同じ構造） |
| 人間可読（human-readable）・人間が読む想定 | `scripts/lib/output.mts`、`scripts/lib/progress.mts`、`scripts/lib/workspace.mts`（179 行目の「人間可読な根拠」。55 行目は改める） | 出力の形式を指す一般の用法 |

同じファイル・同じ段落に残す句と改める句が混じる箇所（`docs/configuration/config-file.md` の 443 行、`docs/workflow/conductor.md`、`scripts/lib/conductor.mts`、`scripts/lib/workspace.mts`）は、ファイル単位ではなく句の単位で置き換える。

それ以外（監督が問いを上げる相手、承認・同意・マージを決める人、最後の PR をレビューする人、要件をすり合わせる相手など）は「ユーザー」に改める。見出し「確度が低い懸念（要人間判断）」（`agents/doc-reviewer.md`・`skills/builder/references/security-review.md`）も「要ユーザー判断」にする。スクリプトはこの見出しを読まない（grep で確認済み）。

## 非機能要件

- **エラーハンドリング**: 出力の文字列を変えるだけで、終了コード・JSON のキーと値は変えない
- **マージ時点のデータ安全**: 該当なし（データに触れない。文書と出力の文字列だけの変更）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 275k |
| builderフェーズ段階 | 250k |

**読むファイル**（読み込みの根拠。名前で列挙する）

- `design/design-delta.md` の「12. 用語」、`docs/concepts.md` の「用語」
- 「人間」を含む行の前後（2026-11-18 の grep の結果）
  - docs: `configuration/config-file.md`・`configuration/documents.md`・`configuration/profiles.md`・`getting-started.md`・`operations/ci.md`・`reference/cli.md`・`workflow/build.md`・`workflow/close.md`・`workflow/conductor.md`
  - skills: `architect/steps/G3.md`・`architect/steps/pr.md`・`builder/references/security-review.md`・`conductor/SKILL.md`・`conductor/references/headless-protocol.md`・`init/steps/link-approval.md`・`navigator/SKILL.md`・`patch/steps/P1.md`・`patch/steps/P2.md`・`token-guide/steps/approve.md`
  - agents: `doc-reviewer.md`
  - scripts: `commands/conductor.mts`・`commands/cycle.mts`・`commands/docs.mts`・`commands/naming.mts`・`commands/validate.mts`・`lib/conductor.mts`・`lib/config.mts`・`lib/docs.mts`・`lib/markdown.mts`・`lib/output.mts`・`lib/progress.mts`・`lib/reviewers.mts`・`lib/steps/close-cycle.mts`・`lib/workspace.mts`
  - tests: `conductor.test.mts`（テスト名1件）

**作成するファイル**（実装・テストの根拠。名前で列挙する）

- 上記のうち「残す用法」以外の該当ファイル（行単位の置き換え）
- `CHANGELOG.md`（`[3.0.0]` の節に追記）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 90k | grep で「人間」を含む行を全件列挙済み（docs 9・skills 10・agents 1・scripts 14 ファイル、約115行）。conductor の SKILL.md・workflow/conductor.md・lib と commands の conductor.mts は該当行がファイル全体に散らばり、ほぼ全文を読む。Step 4 の grep の再実行を含む |
| 実装 | 40k | 該当行を「ユーザー」に置き換える小さな編集 約80か所と CHANGELOG の追記 |
| テスト | 15k | tests/conductor.test.mts のテスト名1件の更新と tsc・npm test の実行 |
| 未知の領域 | 15k | 操作する人以外（Bot と対比するレビュアー、AI と対比する手で書いた部分、人間可読）の判別の見直し |
| **予測ピーク** | **250k** | 統合を検討（300k 未満。推奨のみ） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: docs/ の該当行を置き換える
- [ ] Step 2: skills/・agents/ の該当行を置き換える
- [ ] Step 3: scripts/ の出力の文字列とコメントを置き換え、テスト名を直す
- [ ] Step 4: grep で「人間」の残りを列挙し、すべてが「残す用法」に当たることを確かめる
- [ ] Step 5: CHANGELOG の `[3.0.0]` に追記する
- [ ] Step 6: ローカル検証（`npx tsc --noEmit`・`npm test`・`node scripts/hikyaku.mts conductor lint`）
