# pr: PR 作成と完了記録

振り返りまで済ませてから PR を作る。振り返りの記録は作成前の push にまとめる。

- [ ] PR のマージ先を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr base build-{NN} {cycle}
```

返った値を PR の base にする。**デフォルトブランチを決め打ちしない。**
スタックしている場合はスタック元のブランチが返る。デフォルトブランチ宛てに作ると、
先行ビルドの差分まで含んだ PR になる。

- [ ] 本文に貼る節を出す（差分の事実と agreement.md の返した理由・宣言の変更・未決事項・issue への参照）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr body build-{NN} {cycle}
```

  終了コード 2 で止まったら、マージの前にユーザーが同意する項目に決定が足りない（ほかのフェーズで記録した項目は
  同意ゲートに出ないので、ここで見つかる）。出力の手順で一覧をユーザーに示し、項目ごとの決定を記録してから
  （ask: deferred-consent）やり直す。conductor の子なら、PR を作らずに blocked でユーザーに上げる
- [ ] ここまでのコミットをすべて push する
- [ ] PR を Draft で作成する（タイトルは `pr create` が `pr title` と同じ規則で付ける）
  - マージ先は上で取得した base
  - `pr body` の出力を本文の末尾にそのまま貼る（手で書き直さない）
  - 「確度: 要確認」の懸念が残る場合は、未決事項の ID と要点を本文に入れる。懸念の本文は未決事項の記録
    （`hikyaku ledger show <ID>`）に置き、PR に重複して転記しない
  - PR 作成前の承認は取らない。PR はレビューのための提案であって不可逆ではなく、
    ユーザーが `/hikyaku:builder` を実行した時点で PR 作成まで依頼されている
  - 本文を `.tmp/hikyaku-pr-build-{NN}.md` に書き（コミットしない）、`pr create` で作る。`--base` は `pr base build-{NN} {cycle}` の値。
    同じ向きで開いている PR があれば作らずにそれを返す（`created: false`）。Draft に対応していないリポジトリでは
    スクリプトが Draft を外して作る（`draft: false`）ので、Ready への切り替えは飛ばし、完了の案内で Draft にできなかったことを伝える

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr create build-{NN} {cycle} --base {base} --body-file .tmp/hikyaku-pr-build-{NN}.md --build-title "{title}" --json
```

- [ ] `done` を報告する（`--pr` に PR の URL）。この記録がビルドの完了の記録になる
- [ ] 依存グラフを描き直す

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist done {cycle} --id {buildID}
```

完了の記録（`build-{NN}/progress.jsonl` の pr の done）を読み、このビルドのブロックだけを描き直す。PR 列には
書かない（並行するビルドの PR が隣り合う行を埋めてコンフリクトするため、PR 列は close-cycle がまとめて埋める）。

- [ ] 同じブランチへコミット & push する（progress.jsonl と tasklist.md）

**この記録は必ずこのビルドの PR に同梱する。** 先にデフォルトブランチへ入れると、
未マージのビルドを完了と誤判定する。デフォルトブランチ上に完了の記録が在ること自体が「マージ済み = 完了」を
意味するのは、この同梱が守られているからこそ成立する。
