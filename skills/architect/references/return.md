# 差し戻しからの再設計

`$ARGUMENTS[1]` に `build-{NN}` が指定された場合、または `cycle status` が
`building（差し戻し中: build-NN）` を返した場合は、builder から差し戻された設計の見直しとして
進める。差し戻しの記録は `cycles/{cycle}/return.md` にあり、差し戻し元のビルドのブランチにだけ
コミットされている。

手順は通常の設計と同じく `step next` が返す。回ごとの違い（調査の範囲・design-delta に撤回した判断を残す・
ビルドは更新で扱う・PR を作らず差し戻しを解決する）は、各ステップの指示に値 `round: return` として書いてある。
ここに書くのは、step に入る前の準備だけ。

- ブランチ: 差し戻し元のビルドのブランチ上で作業する。 architect 用のブランチは切らない。
  Step 0 のブランチ確認は `branch verify architect` ではなく `branch verify build-{NN} {cycle}` で行い、
  `ok: true` でなければブランチを作らずにユーザーに尋ねる（ask: branch）（差し戻し元のブランチに切り替えてもらう）。
  設計の変更はそのビルドの PR に入るので、積んでいる場合も連鎖が一直線のまま保てる。
  コミット前のブランチ確認も `branch verify build-{NN} {cycle}` で行う
- 入力: `return.md` と、差し戻し元のビルドの `questions.md` を必ず読む。何が崩れたか、
  何を決め直すかはそこに書かれている。企画成果物と既存の design-delta.md も通常どおり読む
- 回の区切り: ブランチの design/progress.jsonl には通常の設計の記録が完了済みで残っているので、
  `step next` の前に再設計の回を区切る。理由の接頭辞 `return:` が回の種類を表すので、書式を変えない

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step restart architect {cycle} --reason "return: build-{NN}"
```

  中断からの再開で、この回を既に区切っている（`step status architect {cycle}` で途中まで進んでいる）なら、
  区切り直さない。区切り直すと、この回の記録が最初からやり直しになる
- 案内: `done` が返ったら、`/hikyaku:builder {cycle} {NN}` を案内する
