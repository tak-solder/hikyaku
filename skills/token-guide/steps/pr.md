# pr: コミットと PR

ガイドを作りも変えもしていない（`git status` で `token-guide/` に progress.jsonl 以外の差分が無い）なら、
PR は作らず、報告もしない。`token-guide/progress.jsonl` の変更を破棄して（新規なら削除して）終える。
記録を載せる PR が無く、残すと次の回の始まりが分からなくなるため。

- [ ] コミットする前に、もう一度ブランチを確認する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify token-guide`）
- [ ] コミットする
  - コミットには `token-guide/progress.jsonl` も含める
  - PR 本文に、変更の根拠（どのビルドの乖離から判断したか）と、ガイドの版の変化（v1 → v2 など）を書く
  - close-cycle から呼ばれた回（`auto`）では承認を得ていないので、PR だけで採否を判断できるように書く:
    対象のビルドごとの予測・実測・比率の表、どの成分をどちらへ読み違えたか、変更前後の文面、
    見送った補正とその理由。ほかに走行中のサイクルがあれば（`hikyaku cycle list --active`）、その残りのビルドは
    補正後の版で見積もられることも添える
- [ ] push してから、本文を `.tmp/hikyaku-pr-token-guide.md` に書き（コミットしない）、`pr create` で作る（`--base` は
  `pr base token-guide` の値。タイトルは `pr title` と同じ規則で付く。同じ向きで開いている PR があれば作らずに返す）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr create token-guide --base {base} --body-file .tmp/hikyaku-pr-token-guide.md --json
```

- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers token-guide --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。出力の `applied` が `false` なら、できなかったことと `manual`
  （ユーザーが代わりに行うこと）を、完了の案内と一緒にユーザーに伝える
- [ ] `done` を報告する（`--pr` に PR の URL）
- [ ] 同じブランチへコミット & push する（progress.jsonl）
