# Build 08: 差分の事実と、合意との突き合わせ（agreement-review）

## やること

- `scripts/lib/diff-facts.mts` を新しく作る: `--name-status -M` と hunk から、変更ファイルと種類（A/M/D/R と `classifyPath` の分類）、テストファイルの削除、削除されたテストの宣言、追加されたスキップの印、アサーションの行の変更（「緩和」とは判定せず「変更」）、設定の宣言（`.hikyaku.config` の `[app]`・`[boundaries]`・`[consent]`）の変更、G8 承認後の test-spec.md の書き換え（G8 の承認の `at` より後のコミットと未コミットの差分）を事実として並べる。スコープの内外や緩和かどうかは判定しない
- `git.mts` に `nameStatus` / `unifiedDiff` / `commitsTouchingSince` を足す（`tryGit` の作法）。基準は `resolvePrBase`
- `[diff]` に `test_declarations` / `skip_markers` / `assertion_markers` を足す（言語に依存しない既定に追加される。既定は消せない）
- `hikyaku diff facts <phase> [<cycle>] [--format json|pr]`（読み取り専用）。`pr` の形式は、事実と `agreement.md` の理由を合わせた PR 本文の節
- builder に `agreement-review` ステップ（verify の後・review の前、`when` 無し、`produces: agreement.md`）と指示ファイルを足す。doc-reviewer に `agreement` の context（入力: 事実・issue.md・test-spec.md・plan.md の「マージ時点のデータ安全」。観点: 合意に無い変更・スコープ外・データ安全）を足す。指摘は `reviewAction` に乗せて止めない。builder が返した理由を `agreement.md` に書く
- `skills/builder/steps/review.md` のスコープ準拠とデータ安全の自己確認を削る。`pr.md` で `diff facts --format pr` の出力を貼る
- docs（`workflow/build.md`・`reference/agents-and-skills.md`・`configuration/config-file.md`）を直す。CHANGELOG に追記する

## やらないこと

- patch の自己確認の置き換え（US-2 の対象は builder）
- 言語ごとのテストの書き方の網羅（既定の印と `[diff]` の追加で補う）
- 合意に無い変更でユーザーの判断を待って止めること（スコープ外 Q6）

## 対応する受け入れ基準

- US-2.1, US-2.2, US-2.3, US-2.4, US-2.5, US-2.6

## 受け入れ基準

- [ ] テストの削除・スキップの追加・アサーションの変更・設定の宣言の変更が、事実として一覧に並ぶ（言語ごとのフィクスチャの unit）
- [ ] G8 の承認後に test-spec.md を書き換えると、その書き換えが並ぶ（一時リポジトリの結合テスト）
- [ ] `agreement-review` がどのプロファイルでも手順に入り、`agreement.md` が無ければ完了にならない
- [ ] review.md からスコープとデータ安全の自己確認が無くなっている
- [ ] PR 本文の節に、事実と返した理由が並ぶ
- [ ] `step lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「5. 差分の事実と合意の突き合わせ」と「1. 承認の種類と上限」（上限はマージ済みの宣言で決める の項の、設定の変更を事実に並べる部分）
- `decisions` の `20261116-agreement-review.md` — 事実の範囲・ステップ・PR の節がこの判断に従う

## 予測ピーク

読むファイル: `scripts/lib/git.mts`、`scripts/lib/diff-stats.mts`、`scripts/commands/tokens.mts`（buildHistory）、`scripts/lib/stack.mts`、`scripts/lib/review.mts`・`scripts/commands/review.mts`、`scripts/lib/steps/builder.mts`、`skills/builder/steps/review.md`・`pr.md`、`agents/doc-reviewer.md`、`scripts/lib/config.mts`（`[diff]`）
作成・変更するファイル: `scripts/lib/diff-facts.mts`、`scripts/commands/diff.mts`、`skills/builder/steps/agreement-review.md`、`tests/diff-facts.test.mts`、上記の lib・手順・エージェント・docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 90k | git.mts（diffStats・tryGit）・diff-stats.mts・commands/tokens.mts の buildHistory・stack.mts・lib と commands の review.mts・steps/builder.mts・builder の review.md と pr.md・doc-reviewer.md・config.mts の [diff]・ADR agreement-review |
| 実装 | 80k | diff-facts.mts 新規（約400行: name-status と hunk の解析、印、設定の変更、G8 後の test-spec の書き換え）、commands/diff.mts、git の関数3つ、agreement-review ステップと指示、doc-reviewer の context、review.md の自己確認の削除、PR の節 |
| テスト | 60k | diff の解析の unit（言語ごとの印のフィクスチャ）、一時リポジトリでの G8 後の書き換えの検出 |
| 未知の領域 | 40k | hunk の解析の境界（リネーム・バイナリ・-z の扱い） |
| **予測ピーク** | **360k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
