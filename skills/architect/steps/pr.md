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
- [ ] PR を Draft で作成する（タイトルは `pr create` が `pr title` と同じ規則で付ける）
  - `pr body` の出力を本文の末尾にそのまま貼る（手で書き直さない）
  - 向き先は `pr base` に従う（値 `round` が `add` で conductor から動いているなら conductor ブランチ）
  - 値 `designChoiceGate` が false（G3 を行わない回。express の通常の回など）なら、採用案と退けた案を本文に一行で示す
    （express では PR レビューがユーザーの目になる）
  - 本文を `.tmp/hikyaku-pr-architect.md` に書き（コミットしない）、`pr create` で作る。`--base` は `pr base architect {cycle}` の値。
    同じ向きで開いている PR があれば作らずにそれを返す（`created: false`）。Draft に対応していないリポジトリでは
    スクリプトが Draft を外して作る（`draft: false`）ので、Ready への切り替えは飛ばし、完了の案内で Draft にできなかったことを伝える

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr create architect {cycle} --base {base} --body-file .tmp/hikyaku-pr-architect.md --json
```

- [ ] `done` を報告し（`--pr` に PR の URL）、progress.jsonl をコミット & push する（PR に含める）



この PR も速やかにマージすることを想定している。 tasklist.md がデフォルトブランチに
入らないと、他のサイクルからも外からもこのサイクルの進捗が見えない。

マージ前に builder を始めることはできる（このブランチから積めば、着手判定は成果が
履歴に在るかで行うため通る）。ただしサイクルの完了判定はデフォルトブランチを見るので、
マージするまでサイクルは締められない。
