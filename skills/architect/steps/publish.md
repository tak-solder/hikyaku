# publish: PR の公開とレビュアーの依頼

- [ ] directive の `値` にある PR を公開する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr ready {phase} {cycle} --pr {pr}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers {phase} {cycle} --pr {pr}
```

Ready にするかは CLI が設定と実行元から決める。Ready への切り替えに失敗したら `failed` を報告し、
エラーと再実行のコマンドを伝えて止まる。レビュアー依頼だけの失敗は内容を伝え、公開の完了を報告してよい。

- [ ] `done` を報告し、progress.jsonl をコミット & push する
