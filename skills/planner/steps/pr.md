# pr: サイクルの issue と PR の作成

- [ ] コミット前にブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify plan {cycle}
```

- [ ] 外部連携が有効なら、サイクルの issue を作る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
```

サイクルの issue はここで1回だけ作る。この時点なら user-stories があって要約として成立し、
以降のすべての PR がこの issue を参照できる。参照は `cycles.md` の外部列に記録され、この PR で
デフォルトブランチに入るので、並行セッションからも見える。ビルドごとの issue は作らない。

gh CLI が無い環境では投影内容だけが返る（`reason: "gh-not-found"`）。その場合は
GitHub MCP ツールで起票し、`cycle link {cycle} --external {URL}` で記録する。

- [ ] 本文に貼る節を出す（差分の事実・宣言の変更・未決事項・issue への参照。中身の無い節は出ない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr body plan {cycle}
```

  終了コード 2 で止まったら、マージの前にユーザーが同意する項目に決定が足りない。出力の手順で一覧をユーザーに示し、
  項目ごとの決定を記録してから（ask: deferred-consent）やり直す。
- [ ] PR を Draft で作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title plan {cycle}` で生成）
  - `pr body` の出力を本文の末尾にそのまま貼る（手で書き直さない）
  - create-cycle を代行した場合は、cycles.md の変更もこの PR に含める
  - `gh pr create --draft` で作る。Draft に対応していないリポジトリで作成に失敗したら、`--draft` を外して作り直し、Ready への切り替えは飛ばす。完了の案内で Draft にできなかったことを伝える

- [ ] `done` を報告し（`--pr` に PR の URL）、progress.jsonl をコミット & push する



このフェーズの PR はドキュメントのみで、速やかにマージすることを想定している。
デフォルトブランチに入っていない情報は他サイクルから見えないため。
