# resolve-return: 差し戻しの解決

差し戻しからの再設計の回（`step restart architect {cycle} --round return`）だけで返る。
再設計では PR を作らない。設計の変更は差し戻し元のビルドの PR に入る。

- [ ] コミット前にブランチを確認する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify build-{NN} {cycle}`）
- [ ] `cycles/{cycle}/return.md` と、差し戻し元のビルドの `plan.md` / `test-spec.md`（古い設計の上で
  書かれたもの）を削除する
- [ ] `done` を報告する（`return.md` が残っていると受け付けない）
- [ ] 削除と progress.jsonl をコミット & push する。この削除が差し戻しの解決の記録になる

`return.md` が消えれば、`cycle status` は差し戻し元のビルドの plan.md からの再開を返す。
完了の案内では `/hikyaku:builder {cycle} {NN}` を案内する。同じブランチで builder を起動し直せば、
plan からやり直せる。
