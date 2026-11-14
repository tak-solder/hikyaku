# pr: PR 作成と完了記録

振り返りまで済ませてから PR を作る。振り返りの記録は作成前の push にまとめる。

- [ ] 外部連携が有効なら、PR 本文へ入れる参照行を生成する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref build-{NN} {cycle}
```

サイクルの issue への `Refs #12` が返る（ビルドごとの issue は無いので、閉じない）。
空なら何も入れない。

- [ ] PR のマージ先を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr base build-{NN} {cycle}
```

返った値を PR の base にする。**デフォルトブランチを決め打ちしない。**
スタックしている場合はスタック元のブランチが返る。デフォルトブランチ宛てに作ると、
先行ビルドの差分まで含んだ PR になる。

- [ ] ここまでのコミットをすべて push する
- [ ] PR を Draft で作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title build-{NN} {cycle} --build-title "{title}"` で生成）
  - マージ先は上で取得した base
  - 本文の末尾に上の参照行を入れる
  - 「確度: 要確認」の懸念が残る場合は、handoff.md の「残したこと」へのコミット固定リンクと要点を本文に入れる。
    懸念の本文は handoff に置き、PR に重複して転記しない
  - PR 作成前の承認は取らない。PR はレビューのための提案であって不可逆ではなく、
    ユーザーが `/hikyaku:builder` を実行した時点で PR 作成まで依頼されている
  - `gh pr create --draft` で作る。Draft に対応していないリポジトリで作成に失敗したら、`--draft` を外して作り直し、Ready への切り替えは飛ばす。完了の案内で Draft にできなかったことを伝える

- [ ] tasklist.md の PR 列を更新する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist done {cycle} \
  --id {buildID} --pr {PR の URL}
```

PR を作ってからでないと URL が無い。だから PR 作成が先で、PR 列の更新は後になる。

- [ ] `done` を報告する（`--pr` に PR の URL）
- [ ] 同じブランチへコミット & push する（tasklist.md と progress.jsonl）

**この変更は必ずこのビルドの PR に同梱する。** 先にデフォルトブランチへ入れると、
未マージのビルドを完了と誤判定する。PR 列が非空であること自体が「マージ済み = 完了」を
意味するのは、この同梱が守られているからこそ成立する。
