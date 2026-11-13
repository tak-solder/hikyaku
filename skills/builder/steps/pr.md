# pr: PR 作成と完了記録

振り返りまで済ませてから PR を作る。作成後の push は、tasklist.md と progress.jsonl の完了記録を
まとめた1回だけにする。

- [ ] 外部連携が有効なら、PR 本文へ入れる参照行を生成する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref build-{NN} {cycle}
```

`Closes #12`（GitHub）またはタスクの URL（Asana）が返る。空なら何も入れない。
issue が閉じても完了判定には使わない。判定は常に tasklist.md の PR 列。

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

`done` の報告後も、Ready への切り替えとレビュアーのアサインまで行ってから完了の案内へ進む。

- [ ] `config` 出力の `pr.autoReady`（`[pr] auto_ready`、既定 true）が true なら、PR を Ready for Review にする（conductor の子なら飛ばす）

```bash
gh pr ready {PR の URL}
```

  - true なら省略しない。false なら Draft のまま残し、完了の案内で「確認後に `gh pr ready {PR の URL}` で Ready にする」と伝える。**false のときに自分の判断で Ready にしない**
  - 失敗したら、Draft のままであることと再実行のコマンドを完了の案内で伝える
  - conductor の子は `pr.autoReady` に関わらず Ready にしない。監督が取り込む前に Ready にする

- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers build-{NN} {cycle} --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える

- [ ] 外部投影が有効な場合は同期を試みる（失敗してもワークフローは止めない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
```

gh CLI が無い環境では投影内容だけが返る（`reason: "gh-not-found"`）。その場合は
GitHub MCP ツールで適用し、`cycle link` / `tasklist link` で参照を記録する。
