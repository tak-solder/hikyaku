# scope: 対応方針の案と予測ピークの見積もり

項目ごとに、合意を取りに行く案を作る。

- [ ] 項目ごとに次を書く
  - 現状: いまどうなっているか（再現条件・該当箇所）
  - 期待する挙動: 変更後にどうなるか。曖昧な点は選択肢にして尋ねる
  - 対応範囲: 何を変え、何を変えないか（やらないことを明示する）
  - 検証方法: 自動テストで何を確かめるか。手元で確かめるならその手順
- [ ] マージ時点のデータ安全を確かめる。スキーマ・マイグレーション・保存形式・API の契約・既存データを
  読み書きする処理に触れるなら、マージ直後の本番で既存データと既存機能が壊れない根拠を書く。
  触れないなら「該当なし」とする
- [ ] 予測ピークを見積もる。ガイドに沿って成分ごとに見積もり、合計と判定は CLI に任せる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tokens guide {cycle} [--no-cycle]
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tokens estimate {cycle} [--no-cycle] \
  --fixed <n> --reading <n> --implementation <n> --tests <n> --unknown <n>
```

  サイクルに属さないときは `{cycle}` の代わりに `--no-cycle` を付ける
- [ ] `done` を報告する（`--peak` に予測ピーク）。案はまだ提示しない（fit の判定のあと、P1 で提示する）
