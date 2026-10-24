# PRレビュー指摘への対応

- [ ] PR のレビューコメントを確認する
- [ ] `cycles/{cycle}/build-{NN}/plan.md` を参照してコンテキストを復元する
- [ ] 修正を実装し、ローカル検証を実行する（`steps/verify.md` と同じ）
- [ ] ドキュメント更新チェック — サイクルドキュメントのみを更新する
  - `cycles/{cycle}/build-{NN}/` — plan.md, issue.md, test-spec.md, handoff.md
  - `cycles/{cycle}/design/design-delta.md` — 設計レベルの変更があった場合
  - 永続ドキュメントは更新しない。昇格が必要な内容は handoff.md に記録する
- [ ] Push する
- [ ] `/hikyaku:retrospective {cycle} build-{NN}` を呼び出す（既に retrospective.md があれば追記モードで動作する）
