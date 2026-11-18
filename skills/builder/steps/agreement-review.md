# agreement-review: 差分の事実と合意の突き合わせ

AI が問題を黙って変えた差分（テストの削除・スキップ・期待値の変更、受け入れ基準の未実現、スコープの変更）を、
作った本人ではないレビューが合意と突き合わせる。事実はスクリプトが並べ、判断は doc-reviewer（`agreement` の context）が行う。
プロファイルに関わらず必ず行い、指摘で止めない。

- [ ] 差分の事実を取る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" diff facts build-{NN} {cycle}
```

未コミットの変更と未追跡のファイルも含まれる。`注意` に基準を解決できない旨が出たら、fetch してから取り直す。

- [ ] doc-reviewer を `--context agreement` で起動する（起動方法は SKILL.md の「doc-reviewer の起動」）
  - 渡す情報: 差分の事実、`issue.md`、`test-spec.md`（スキップしたなら無し）、`plan.md`（「実装ステップ」と「マージ時点のデータ安全」の節を見させる）
  - `mode: agent` なら事実の出力を委任のプロンプトにそのまま含める。`mode: process` なら出力を
    `.git` の中（`git rev-parse --git-path hikyaku/diff-facts-build-{NN}.md` の場所）に保存し、そのパスを `--files` に含める
- [ ] 指摘ごとに、直すか理由を返すかを決める
  - 合意（issue.md・test-spec.md）に沿うように直せるものは直し、verify と同じ検証を通す
  - 直さないもの（合意の範囲内だと説明できる、意図した変更である）は、理由を1行で書く
  - ユーザーの判断を待って止めない。合意そのものが成り立たないと分かったら、SKILL.md の「architect への差し戻し」に従う
- [ ] 対応を解決する（`agreement` は1回で終わり、`confirm` は返らない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review action doc build-{NN} {cycle} --context agreement --round 1 {判定したフラグ} --json
```

直すべき指摘があれば `--has-findings`、確度の低い懸念だけなら `--uncertain` を添える。`fix` なら直してから先へ進む
（再レビューはしない）。`deferUncertain` が true なら、懸念を review と同じく未決事項として `ledger open` で記録し
（要約に「確度: 要確認」と理由）、handoff の「残したこと」と PR 本文に事項の ID と要点を載せる。

- [ ] `cycles/{cycle}/build-{NN}/agreement.md` を書く。指摘が0件でも書く（全プロファイル必須の記録）

```markdown
# Build {NN}: 合意との突き合わせ

## 指摘

- （指摘の要点）: 直した
- （指摘の要点）: 理由を返した

（指摘が無ければ「なし」）

## 返した理由

- （指摘の要点）: （直さなかった理由）

（無ければ「なし」）
```

「返した理由」の箇条書きは、pr で `diff facts --format pr` が PR 本文に並べる。事実そのものは写さない
（PR を作るときに、そのときの差分から作り直す）。

- [ ] `done` を報告する。push はしない（直したコードと agreement.md・progress.jsonl のコミットは、review の
  ローカルのコミットにまとめる。push は PR を作る前に行う）
