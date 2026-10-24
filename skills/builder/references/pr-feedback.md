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
  - 呼ぶ前に、振り返りの手順を最初から回し直す区切りを記録する。builder の手順は終わっていて
    報告するものが無いので、区切らないと前回の振り返りの記録で終わったものと数えられる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step restart build-{NN} {cycle} --skill retrospective --reason "PR レビュー対応の振り返り"
```

  - 呼ばれた側は、restart が返した1手から `step next build-{NN} {cycle} --skill retrospective` で手順を進める。
    `done` が返ったら戻る（builder の報告は要らない）
  - retrospective.md と progress.jsonl をコミット & push する
