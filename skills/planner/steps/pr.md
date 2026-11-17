# pr: サイクルの issue と PR の作成

- [ ] コミット前にブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify plan {cycle}
```

- [ ] 外部連携が有効なら、サイクルの issue を作る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref plan {cycle}
```

サイクルの issue はここで1回だけ作る。この時点なら user-stories があって要約として成立し、
以降のすべての PR がこの issue を参照できる。参照は `cycles.md` の外部列に記録され、この PR で
デフォルトブランチに入るので、並行セッションからも見える。ビルドごとの issue は作らない。

gh CLI が無い環境では投影内容だけが返る（`reason: "gh-not-found"`）。その場合は
GitHub MCP ツールで起票し、`cycle link {cycle} --external {URL}` で記録する。

- [ ] PR を Draft で作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title plan {cycle}` で生成）
  - `external ref` が返した行（`Refs #12` など）を本文の末尾に入れる。空なら入れない
  - create-cycle を代行した場合は、cycles.md の変更もこの PR に含める
  - 値 `declarationChanged` が `false` でなければ、`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger premises --format pr`
    の出力を本文にそのまま貼る（変わった宣言を拠り所にした受け入れを、ユーザーがマージの前に見直すため）
  - `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger pr-section plan {cycle}` の出力を本文にそのまま貼る
    （受け入れたリスク・未解決の退け・マージの前に決める事項・期限を過ぎた事項。空なら何も貼らない）。
    `done` が「ユーザーの決定がありません」で拒まれたら、`ledger consent-list plan {cycle}` をその場でユーザーに示し、
    項目ごとに `ledger decide plan <ID> {cycle} --by user --input "<ユーザーの答え>"` で決定を記録してから報告し直す（ask: deferred-consent）
  - `gh pr create --draft` で作る。Draft に対応していないリポジトリで作成に失敗したら、`--draft` を外して作り直し、Ready への切り替えは飛ばす。完了の案内で Draft にできなかったことを伝える

- [ ] `done` を報告し（`--pr` に PR の URL）、progress.jsonl をコミット & push する



このフェーズの PR はドキュメントのみで、速やかにマージすることを想定している。
デフォルトブランチに入っていない情報は他サイクルから見えないため。
