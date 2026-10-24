# cycle-scan: 並行サイクルの確認

自分のほかに進行中のサイクルがあるので、今回のスコープとの重複を確かめる。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle list --active
```

- [ ] `cycle-scanner` エージェントを起動する
  - 渡す情報: 今回の `user-stories.md` のパス / 走行中サイクルのディレクトリ一覧 / `document-guide.md` のパス
  - 出力フォーマットは `${CLAUDE_PLUGIN_ROOT}/agents/cycle-scanner.md` を参照
- [ ] 重複が報告されたら、ユーザーに提示して方針を確認する（ask: overlap）
  - 設計を分ける / どちらかに寄せる / そのまま進める
- [ ] `done` を報告する

全走行サイクルの本文を本セッションで読むと、大規模リポジトリでコンテキストが破綻する。
だから軽量エージェントに委任し、返ってきた重複箇所だけを本セッションで扱う。
