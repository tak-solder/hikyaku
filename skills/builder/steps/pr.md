# pr: PR 作成と完了記録

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

- [ ] PR を作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title build-{NN} {cycle} --build-title "{title}"` で生成）
  - マージ先は上で取得した base
  - 本文の末尾に上の参照行を入れる
  - PR 作成前の承認は取らない。PR はレビューのための提案であって不可逆ではなく、
    ユーザーが `/hikyaku:builder` を実行した時点で PR 作成まで依頼されている
- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers build-{NN} {cycle} --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える

- [ ] tasklist.md の PR 列を更新する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist done {cycle} \
  --id {buildID} --pr {PR の URL}
```

PR を作ってからでないと URL が無い。だから PR 作成が先で、PR 列の更新は後になる。

- [ ] `done` を報告する（PR 列が埋まっていないと受け付けない）
- [ ] 同じブランチへコミット & push する（tasklist.md と progress.jsonl）

**この変更は必ずこのビルドの PR に同梱する。** 先にデフォルトブランチへ入れると、
未マージのビルドを完了と誤判定する。PR 列が非空であること自体が「マージ済み = 完了」を
意味するのは、この同梱が守られているからこそ成立する。

- [ ] 外部投影が有効な場合は同期を試みる（失敗してもワークフローは止めない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
```

gh CLI が無い環境では投影内容だけが返る（`reason: "gh-not-found"`）。その場合は
GitHub MCP ツールで適用し、`cycle link` / `tasklist link` で参照を記録する。
