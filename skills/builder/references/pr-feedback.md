# PRレビュー指摘への対応

- [ ] PR のレビューコメントを確認する
- [ ] `cycles/{cycle}/build-{NN}/plan.md` を参照してコンテキストを復元する
- [ ] 修正を実装し、ローカル検証を実行する（`steps/verify.md` と同じ）
- [ ] ドキュメント更新チェック — サイクルドキュメントのみを更新する
  - `cycles/{cycle}/build-{NN}/` — plan.md, issue.md, test-spec.md, handoff.md
  - `cycles/{cycle}/design/design-delta.md` — 設計レベルの変更があった場合
  - 永続ドキュメントは更新しない。昇格が必要な内容は handoff.md に記録する
- [ ] Push する
- [ ] `/hikyaku:retrospective {cycle} build-{NN}` を呼び出す（既に retrospective.md があれば追記モードで動作する。`retrospective` が `skip` なら、この項目ごと飛ばす）
  - 呼ばれた側は `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next build-{NN} {cycle} --skill retrospective` で手順を進める
  - 戻ったら、builder の retrospective を報告し直す（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step report build-{NN} retrospective {cycle} --result done`）。
    報告し直さないと、次のレビュー対応で呼んだ振り返りが、今回の記録で終わったものと数えられる
  - retrospective.md と progress.jsonl をコミット & push する
