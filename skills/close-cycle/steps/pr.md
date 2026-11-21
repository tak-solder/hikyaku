# pr: PR の作成

- [ ] コミットする前に、もう一度ブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify close {cycle}
```

- [ ] 本文に貼る節を出す（差分の事実・宣言の変更・未決事項・issue への参照。中身の無い節は出ない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr body close {cycle}
```

  終了コード 2 で止まったら、マージの前にユーザーが同意する項目に決定が足りない。出力の手順で一覧をユーザーに示し、
  項目ごとの決定を記録してから（ask: deferred-consent）やり直す。conductor の子なら、PR を作らずに blocked でユーザーに上げる。
- [ ] コミットして PR を Draft で作成する（タイトルは `pr create` が `pr title` と同じ規則で付ける）
  - 本文には、追加・置き換え・削除を分けて書く。**削除と置き換えは、何を・なぜ消したか（根拠の出どころ）を
    必ず書く**。ユーザーが G10 のあとで削除を確かめ直せる場はこの PR になる
  - G10 を省いた回（write の `promotionGate` が `skipped`）は、確認の変更をユーザーが初めて見る場がこの PR になる。
    その旨を本文の先頭に書く
  - 手を入れなかったが気づいた点（このサイクルの記録に根拠の無い、古そうな記述）と、
    Hikyaku への報告（宛先 `upstream` の候補）と、G10 で示したリファクタの提案（宛先 `refactor`）があれば、本文に並べる
  - `pr body` の出力を本文の末尾にそのまま貼る（手で書き直さない）。末尾の `Closes #12` で、サイクルの issue はこの PR のマージで閉じる
  - 本文を `.tmp/hikyaku-pr-close.md` に書き（コミットしない）、`pr create` で作る。`--base` は `pr base close {cycle}` の値。
    同じ向きで開いている PR があれば作らずにそれを返す（`created: false`）。Draft に対応していないリポジトリでは
    スクリプトが Draft を外して作る（`draft: false`）ので、Ready への切り替えは飛ばし、完了の案内で Draft にできなかったことを伝える

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr create close {cycle} --base {base} --body-file .tmp/hikyaku-pr-close.md --json
```

- [ ] `done` を報告し（`--pr` に PR の URL）、progress.jsonl をコミット & push する
