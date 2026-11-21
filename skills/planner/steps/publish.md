# publish: PR の公開とレビュアーの依頼

- [ ] directive の `値` にある PR を公開する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr ready {phase} {cycle} --pr {pr}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers {phase} {cycle} --pr {pr}
```

Ready にするかは CLI が設定と実行元から決める。gh が使えずにできなかったこと（出力の `applied` が `false`）は、
止めずに `manual`（ユーザーが代わりに行うこと）を伝え、公開の完了を報告してよい。終了コードが 1 なら
`failed` を報告し、エラーと再実行のコマンドを伝えて止まる。

- [ ] `done` を報告し、progress.jsonl をコミット & push する
