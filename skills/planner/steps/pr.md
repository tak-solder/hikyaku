# pr: 親 issue と PR の作成

- [ ] コミット前にブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify plan {cycle}
```

- [ ] 外部連携が有効なら、親 issue を作る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref plan {cycle}
```

親 issue はここで作る。この時点なら user-stories があって親の要約として成立し、
以降のすべての PR が親を参照できる。参照は `cycles.md` の外部列に記録され、この PR で
デフォルトブランチに入るので、並行セッションからも見える。

gh CLI が無い環境では投影内容だけが返る（`reason: "gh-not-found"`）。その場合は
GitHub MCP ツールで適用し、`cycle link {cycle} --external {URL}` で記録する。

- [ ] PR を作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title plan {cycle}` で生成）
  - `external ref` が返した行（`Refs #12` など）を本文の末尾に入れる。空なら入れない
  - create-cycle を代行した場合は、cycles.md の変更もこの PR に含める
- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers plan {cycle} --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える
- [ ] `done` を報告し、progress.jsonl をコミット & push する

このフェーズの PR はドキュメントのみで、速やかにマージすることを想定している。
デフォルトブランチに入っていない情報は他サイクルから見えないため。
