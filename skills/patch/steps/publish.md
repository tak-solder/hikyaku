# publish: PR の本文の仕上げと公開

- [ ] PR の本文を仕上げる（`${CLAUDE_PLUGIN_ROOT}/skills/patch/references/templates.md` の「PR の本文」）
  - 検証: verify で実行したコマンドと結果、手元で確かめた内容
  - ドキュメント: この PR で直した永続ドキュメント、またはサイクルの handoff.md へのリンク。無ければ「なし」
  - 残したこと: そのまま進めたレビュー指摘、「確度: 要確認」の懸念、通常のサイクルへ引き継いだ項目、
    `hook` / `upstream` の候補。無ければ「なし」
  - 合意した挙動は書き換えない。合意を取り直した場合だけ、取り直した内容に更新する
- [ ] directive の `値` にある PR を公開し、レビュアーを依頼する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr ready {phase} {cycle} --pr {pr}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers {phase} {cycle} --pr {pr}
```

Ready にするかは CLI が設定から決める。Ready への切り替えに失敗したら `failed` を報告し、エラーと
再実行のコマンドを伝えて止まる。レビュアー依頼だけの失敗は内容を伝え、公開の完了を報告してよい。

- [ ] `done` を報告し、progress.jsonl をコミット & push する
