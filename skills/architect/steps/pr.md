# pr: PR の作成

- [ ] コミット前にブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify architect {cycle}
```

- [ ] PR を作る前に、マージの前にユーザーが同意する項目に決定が足りないかを確かめる
  （`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger consent-list architect {cycle}` の「決定が足りない」が 0 か）。
  同意ゲートは設計フェーズで記録した項目だけで現れるので、ほかのフェーズで記録した項目はここで見つかる。
  足りなければ一覧をその場でユーザーに示し、項目ごとに
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger decide architect <ID> {cycle} --decision <consented|decided|rejected> --by user --input "<ユーザーの答え>"`
  で記録してから作る（ask: deferred-consent）。conductor の子なら、PR を作らずに blocked でユーザーに上げる。
  決定が足りないままでは `done` を受け付けない
- [ ] 外部連携が有効なら、参照行を生成する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref architect {cycle}`）
- [ ] PR を Draft で作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title architect {cycle}` で生成）
  - `external ref` が返した行（`Refs #12` など）を本文の末尾に入れる。空なら入れない
  - 向き先は `pr base` に従う（値 `round` が `add` で conductor から動いているなら conductor ブランチ）
  - 値 `designChoiceGate` が false（G3 を行わない回。express の通常の回など）なら、採用案と退けた案を本文に一行で示す
    （express では PR レビューが人間の目になる）
  - 値 `declarationChanged` が `false` でなければ、`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger premises --format pr`
    の出力を本文にそのまま貼る（変わった宣言を拠り所にした受け入れを、ユーザーがマージの前に見直すため）
  - `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger pr-section architect {cycle}` の出力を本文にそのまま貼る
    （受け入れたリスク・未解決の退け・マージの前に決める事項・期限を過ぎた事項。空なら何も貼らない）
  - `gh pr create --draft` で作る。Draft に対応していないリポジトリで作成に失敗したら、`--draft` を外して作り直し、Ready への切り替えは飛ばす。完了の案内で Draft にできなかったことを伝える

- [ ] `done` を報告し（`--pr` に PR の URL）、progress.jsonl をコミット & push する（PR に含める）



この PR も速やかにマージすることを想定している。 tasklist.md がデフォルトブランチに
入らないと、他のサイクルからも外からもこのサイクルの進捗が見えない。

マージ前に builder を始めることはできる（このブランチから積めば、着手判定は成果が
履歴に在るかで行うため通る）。ただしサイクルの完了判定はデフォルトブランチを見るので、
マージするまでサイクルは締められない。
