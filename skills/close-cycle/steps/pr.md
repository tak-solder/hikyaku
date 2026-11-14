# pr: PR の作成

- [ ] コミットする前に、もう一度ブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify close {cycle}
```

- [ ] 外部連携が有効なら、参照行を生成する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref close {cycle}`）
- [ ] コミットして PR を Draft で作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title close {cycle}` で生成）
  - 本文には、追加・置き換え・削除を分けて書く。**削除と置き換えは、何を・なぜ消したか（根拠の出どころ）を
    必ず書く**。conductor の配下では G10 を監督が承認しているので、人間が削除を確かめる場はこの PR になる
  - 手を入れなかったが気づいた点（このサイクルの記録に根拠の無い、古そうな記述）と、
    Hikyaku への報告（宛先 `upstream` の候補）があれば、本文に並べる
  - `external ref` が返した行（`Closes #12` など）を本文の末尾に入れる。
    サイクルの issue はこの PR のマージで閉じる
  - `gh pr create --draft` で作る。Draft に対応していないリポジトリで作成に失敗したら、`--draft` を外して作り直し、Ready への切り替えは飛ばす。完了の案内で Draft にできなかったことを伝える

- [ ] `done` を報告し（`--pr` に PR の URL）、progress.jsonl をコミット & push する
