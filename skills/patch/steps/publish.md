# publish: PR の本文の仕上げと公開

- [ ] PR の本文を仕上げる（`${CLAUDE_PLUGIN_ROOT}/skills/patch/references/templates.md` の「PR の本文」）
  - 検証: verify で実行したコマンドと結果、手元で確かめた内容
  - ドキュメント: この PR で直した永続ドキュメント、またはサイクルの handoff.md へのリンク。無ければ「なし」
  - 残したこと: そのまま進めたレビュー指摘、「確度: 要確認」の懸念、通常のサイクルへ引き継いだ項目、
    `hook` / `upstream` の候補。無ければ「なし」
  - 値 `declarationChanged` が `false` でなければ、`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger premises --format pr`
    の出力を本文にそのまま貼る（変わった宣言を拠り所にした受け入れを、ユーザーがマージの前に見直すため）
  - サイクルに属す patch なら、`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger pr-section {phase} {cycle}` の出力を
    本文にそのまま貼る（受け入れたリスク・未解決の退け・マージの前に決める事項・期限を過ぎた事項。空なら何も貼らない）
  - 合意した挙動は書き換えない。合意を取り直した場合だけ、取り直した内容に更新する
- [ ] サイクルに属す patch なら、公開する前に、マージの前にユーザーが同意する項目に決定が足りないかを確かめる
  （`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger consent-list {phase} {cycle}` の最後の行「決定が足りない項目」が「なし」か）。
  足りなければ一覧をその場でユーザーに示し、項目ごとに
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger decide {phase} <ID> {cycle} --decision <consented|decided|rejected> --by user --input "<ユーザーの答え>"`
  で記録してから公開する（ask: deferred-consent）。決定が足りないままでは `done` を受け付けない
- [ ] directive の `値` にある PR を公開し、レビュアーを依頼する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr ready {phase} {cycle} --pr {pr}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers {phase} {cycle} --pr {pr}
```

Ready にするかは CLI が設定から決める。gh が使えずにできなかったこと（出力の `applied` が `false`）は、
止めずに `manual`（ユーザーが代わりに行うこと）を伝え、公開の完了を報告してよい。終了コードが 1 なら
`failed` を報告し、エラーと再実行のコマンドを伝えて止まる。

- [ ] `done` を報告し、progress.jsonl をコミット & push する
