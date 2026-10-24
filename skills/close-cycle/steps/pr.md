# pr: PR の作成

- [ ] コミットする前に、もう一度ブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify close {cycle}
```

- [ ] 外部連携が有効なら、参照行を生成する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref close {cycle}`）
- [ ] コミットして PR を作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title close {cycle}` で生成）
  - `external ref` が返した行（`Closes #12` など）を本文の末尾に入れる。
    親 issue はこの PR のマージで閉じる
- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers close {cycle} --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える
- [ ] `done` を報告し、progress.jsonl をコミット & push する
