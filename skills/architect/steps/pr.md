# pr: PR の作成

- [ ] コミット前にブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify architect {cycle}
```

- [ ] 本文に貼る節を出す（差分の事実・宣言の変更・未決事項・issue への参照。中身の無い節は出ない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr body architect {cycle}
```

  終了コード 2 で止まったら、マージの前にユーザーが同意する項目に決定が足りない。出力の手順で一覧をユーザーに示し、
  項目ごとの決定を記録してから（ask: deferred-consent）やり直す。conductor の子なら、PR を作らずに blocked でユーザーに上げる。
- [ ] PR を Draft で作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title architect {cycle}` で生成）
  - `pr body` の出力を本文の末尾にそのまま貼る（手で書き直さない）
  - 向き先は `pr base` に従う（値 `round` が `add` で conductor から動いているなら conductor ブランチ）
  - 値 `designChoiceGate` が false（G3 を行わない回。express の通常の回など）なら、採用案と退けた案を本文に一行で示す
    （express では PR レビューがユーザーの目になる）
  - `gh pr create --draft` で作る。Draft に対応していないリポジトリで作成に失敗したら、`--draft` を外して作り直し、Ready への切り替えは飛ばす。完了の案内で Draft にできなかったことを伝える

- [ ] `done` を報告し（`--pr` に PR の URL）、progress.jsonl をコミット & push する（PR に含める）



この PR も速やかにマージすることを想定している。 tasklist.md がデフォルトブランチに
入らないと、他のサイクルからも外からもこのサイクルの進捗が見えない。

マージ前に builder を始めることはできる（このブランチから積めば、着手判定は成果が
履歴に在るかで行うため通る）。ただしサイクルの完了判定はデフォルトブランチを見るので、
マージするまでサイクルは締められない。
