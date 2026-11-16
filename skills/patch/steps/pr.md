# pr: Draft PR の作成

合意した内容を PR の本文に置く。以後、依頼と合意の正は PR の本文になる。

- [ ] PR のマージ先を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr base {phase} {cycle}
```

返った値を base にする。**デフォルトブランチを決め打ちしない。** 統合ブランチから切っていれば、
そのブランチが返る。

- [ ] ここまでのコミットを push する
- [ ] PR を Draft で作成する
  - タイトル: `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title {phase} {cycle} --build-title "{依頼の要約}"`
  - 本文: `${CLAUDE_PLUGIN_ROOT}/skills/patch/references/templates.md`（[templates.md](../references/templates.md)）の
    「PR の本文」。検証結果とドキュメントの更新は、まだ「未」のままにする（publish で埋める）
  - `gh pr create --draft` で作る。Draft に対応していないリポジトリで作成に失敗したら、`--draft` を外して作り直し、
    完了の案内で Draft にできなかったことを伝える
- [ ] `done` を報告する（`--pr` に PR の URL）
- [ ] progress.jsonl をコミット & push する
