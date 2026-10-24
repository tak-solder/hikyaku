# pr: コミットと PR

基準表を生成も変更もしていない（`git status` で `bp-guide/` に progress.jsonl 以外の差分が無い）なら、
PR は作らず、報告もしない。`bp-guide/progress.jsonl` の変更を破棄して（新規なら削除して）終える。
記録を載せる PR が無く、残すと次の回の始まりが分からなくなるため。

- [ ] コミットする前に、もう一度ブランチを確認する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify bp-guide`）
- [ ] コミットして PR を作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title bp-guide` で生成）
  - コミットには `bp-guide/progress.jsonl` も含める
  - PR 本文に、変更の根拠（どのビルドの乖離から判断したか）を書く
- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers bp-guide --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える
- [ ] `done` を報告する
- [ ] 同じブランチへコミット & push する（progress.jsonl）
