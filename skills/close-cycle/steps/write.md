# write: 永続ドキュメントへの書き込みと検証

G10 で承認された内容だけを書く。承認されていない候補を足さない。

- [ ] 承認された内容を永続ドキュメントへ書き込む
- [ ] `workflow` 分類が承認されていれば `{HIKYAKU_ROOT}/instructions.md` へ追記する
  （無ければ新規作成する）
- [ ] `document-guide.md` を更新する（新規作成したドキュメントの管理列とパス列）
- [ ] AGENTS.md の索引を更新する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs link --dry-run
```

新しいドキュメントを追加した場合のみ差分が出る。承認を得てから実行する（ask: docs-link）。

- [ ] 検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" validate {cycle}
```

- [ ] `done` を報告する
- [ ] コミット & push する（progress.jsonl も含める）
