# dry-run: 差分の取得

**承認前に書き込みを行わない。** `--dry-run` で差分だけを取得する。

- [ ] スクリプトに `--dry-run` を付けて実行し、変更後の一覧と依存グラフを取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist add {cycle} \
  --title "..." --bp 3 --deps 1,2 --dry-run
```

  更新は `tasklist update` に `--dry-run` を付ける。分割は「元ビルドの update + 新ビルドの add」で表す
- [ ] issue.md の本文（新規なら全文、更新なら変更箇所）を、まだ書き込まずに用意する
- [ ] `done` を報告する。`--dry-run` の出力と issue.md の本文は、レビューと G6 の提示で使うので
  このセッションに残しておく
