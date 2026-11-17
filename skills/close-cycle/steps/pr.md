# pr: PR の作成

- [ ] コミットする前に、もう一度ブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify close {cycle}
```

- [ ] 外部連携が有効なら、参照行を生成する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref close {cycle}`）
- [ ] コミットして PR を Draft で作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title close {cycle}` で生成）
  - 本文には、追加・置き換え・削除を分けて書く。**削除と置き換えは、何を・なぜ消したか（根拠の出どころ）を
    必ず書く**。ユーザーが G10 のあとで削除を確かめ直せる場はこの PR になる
  - G10 を省いた回（write の `promotionGate` が `skipped`）は、確認の変更をユーザーが初めて見る場がこの PR になる。
    その旨を本文の先頭に書く
  - 手を入れなかったが気づいた点（このサイクルの記録に根拠の無い、古そうな記述）と、
    Hikyaku への報告（宛先 `upstream` の候補）と、G10 で示したリファクタの提案（宛先 `refactor`）があれば、本文に並べる
  - 値 `declarationChanged` が `false` でなければ、`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger premises --format pr`
    の出力を本文にそのまま貼る（変わった宣言を拠り所にした受け入れを、ユーザーがマージの前に見直すため）
  - `external ref` が返した行（`Closes #12` など）を本文の末尾に入れる。
    サイクルの issue はこの PR のマージで閉じる
  - `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger pr-section close {cycle}` の出力を本文にそのまま貼る
    （受け入れたリスク・未解決の退け・マージの前に決める事項・期限を過ぎた事項。空なら何も貼らない）。
    `done` が「ユーザーの決定がありません」で拒まれたら、`ledger consent-list close {cycle}` をその場でユーザーに示し、
    項目ごとに `ledger decide close <ID> {cycle} --by user --input "<ユーザーの答え>"` で決定を記録してから報告し直す（ask: deferred-consent）
  - `gh pr create --draft` で作る。Draft に対応していないリポジトリで作成に失敗したら、`--draft` を外して作り直し、Ready への切り替えは飛ばす。完了の案内で Draft にできなかったことを伝える

- [ ] `done` を報告し（`--pr` に PR の URL）、progress.jsonl をコミット & push する
