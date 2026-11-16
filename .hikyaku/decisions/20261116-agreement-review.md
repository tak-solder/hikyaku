---
status: accepted
---

# 差分の事実はスクリプトが並べ、全プロファイル必須の agreement-review が合意と突き合わせる

- **決定**: `scripts/lib/diff-facts.mts` が、ビルドの差分（`--name-status -M` と hunk）から事実だけを並べる。変更ファイルと種類、テストファイルの削除、削除されたテストの宣言、追加されたスキップの印、アサーションの行の変更（「緩和」とは判定せず「変更」として出す）、G8 承認後の test-spec.md の書き換え。印は言語に依存しない既定を内蔵し、`[diff]` で既定に追加できる（既定を消すことはできない）。builder に verify の後、review の前のステップ `agreement-review` を `when` 無しで足し、doc-reviewer の `agreement` の context が事実を issue.md・test-spec.md・plan.md の「マージ時点のデータ安全」と突き合わせる。builder 自身のスコープとデータ安全の確認はここへ移す。指摘は既存の `reviewAction` に乗せ、止めない。返した理由は `agreement.md` に残し、PR の節は `diff facts --format pr` が、そのときの差分から作る事実と `agreement.md` の理由を合わせて組み立てる。設定の宣言（`[app]`・`[boundaries]`・`[consent]`）の変更も事実として並べる
- **文脈**: US-2 と原則3で、AI が問題を黙って変えた差分を、作った本人ではないレビューが合意と突き合わせる。Q4 で全プロファイル必須、Q6（企画）で止めないと決めた
- **外の前提**: 利用者のテストの書き方は、主要な枠組みの慣習（`it(`・`test(`・`def test_`・`.skip(` など）に沿っていることが多い（仮定。2026-11-16 時点で利用者のリポジトリでの検証なし）
- **検討した案**:
  - Minimal: `review facts` を足し、既存の `review doc --files` に相乗りする
  - Clean: 上記の決定
  - Pragmatic: review の種類に `agreement` を足し、理由を handoff の見出しに書く
- **推奨**: Clean
- **採用理由**: 独立したステップにすると、全プロファイル必須をエンジンが保証する（原則1）。PR の節をスクリプトがその時点の差分から作るので、修正後の現実とずれない（原則7・12）
- **受け入れたこと**: ヒューリスティクスなので見逃しも誤検出もある。見逃しはレビュアーが差分を読んで補う。ビルドごとにサブエージェントの実行が1回増える（拠り所: 上記の仮定）
- **トレードオフ**: builder のステップと成果物（`agreement.md`）が1つずつ増える。patch の自己確認は今回は変えない
- **再評価条件**: 既定の印で拾えない言語・枠組みの利用者から見逃しの報告があったとき。economy のコストが問題になったとき
- **退けた推奨で失う利点**: なし（推奨どおり採用）
- **影響範囲**: `scripts/lib/diff-facts.mts`・`scripts/commands/diff.mts`（新規）、`scripts/lib/git.mts`、`scripts/lib/config.mts`（`[diff]`）、`scripts/lib/review.mts`、`scripts/lib/steps/builder.mts`、`agents/doc-reviewer.md`、`skills/builder/steps/{agreement-review,review,pr}.md`
