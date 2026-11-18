# Build 14: 操作する人を「ユーザー」と書く用語の統一

## やること

- docs/・スキル（SKILL.md・steps・references）・エージェント定義・CLI の出力の文字列で、コーディングエージェントを操作する人を「人間」と書いているところを「ユーザー」に改める
- 操作する人以外を指す「人間」（チームメンバー、一般の人など）は改めない。concepts.md と AGENTS.md の用法（162cf90）に合わせる
- 出力の文字列を固定しているテストを更新する
- CHANGELOG に追記する

## やらないこと

- `docs/concepts.md`・`AGENTS.md`（直し済み）
- 文の書き換えを超えた説明の変更

## 対応する受け入れ基準

- なし（G3 でユーザーが指示した用語の統一。design-questions Q10）

## 受け入れ基準

- [ ] 操作する人を指す「人間」が docs/・skills/・agents/・scripts の出力に残っていない（grep で列挙して確かめる）
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「12. 用語」
- `glossary`（`docs/concepts.md` の「用語」）— 「ユーザー」の用法の正

## 予測ピーク

読むファイル（2026-11-16 時点の grep の結果。build-01〜13・15 が先に直す行があるので、着手時に grep し直して対象を絞る）:
- docs: `workflow/conductor.md`・`workflow/build.md`・`workflow/close.md`・`getting-started.md`・`reference/cli.md`・`configuration/profiles.md`・`configuration/config-file.md`・`configuration/documents.md`・`operations/ci.md`
- skills: `conductor/SKILL.md`・`conductor/references/headless-protocol.md`・`close-cycle/steps/G10.md`・`close-cycle/steps/pr.md`・`close-cycle/steps/followups.md`・`patch/steps/P1.md`・`patch/steps/P2.md`・`builder/references/security-review.md`・`architect/steps/pr.md`・`architect/steps/G3.md`・`navigator/SKILL.md`・`token-guide/steps/approve.md`・`init/steps/link-approval.md`
- agents: `doc-reviewer.md`
- scripts（出力の文字列とコメント）: `lib/conductor.mts`・`commands/conductor.mts`・`lib/config.mts`・`lib/output.mts`・`lib/markdown.mts`・`lib/workspace.mts`・`lib/reviewers.mts`・`lib/progress.mts`・`lib/docs.mts`・`lib/steps/close-cycle.mts`・`commands/docs.mts`・`commands/validate.mts`・`commands/naming.mts`・`commands/reviewers.mts`・`commands/cycle.mts`
作成・変更するファイル: 上記の該当ファイル、出力を固定しているテスト、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 100k | 2026-11-16 の grep で「人間」を含む docs（9ファイル）・skills（13ファイル）・agents（1ファイル）・scripts（15ファイル）の該当箇所の前後。conductor の SKILL.md と workflow/conductor.md、lib と commands の conductor.mts が大半。build-01〜13・15 が先に直す行を差し引く |
| 実装 | 50k | 操作する人を指す「人間」を「ユーザー」に置き換える編集（多ファイル・小さな差分） |
| テスト | 15k | 出力文字列を固定しているテストの更新と実行 |
| 未知の領域 | 20k | 操作する人以外を指す「人間」の判別 |
| **予測ピーク** | **275k** | 統合を検討（300k 未満。推奨のみ） |
| ガイド | 標準 v2 | 03897ac0 |

ほかのすべてのビルドに依存させる（各ビルドが同じファイルを編集するので、最後にまとめて置き換えるとコンフリクトが少ない）。統合は見送る（どのビルドとまとめても、置き換えが途中のビルドと衝突する）
