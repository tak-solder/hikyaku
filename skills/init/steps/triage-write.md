# triage-write: 振り分けの書き込みと、document-guide.md の更新

承認された内容だけを書く。

- [ ] 移す項目を、承認された置き場へ書く
  - rule は glob ごとにファイルを分け、frontmatter には `paths` だけを書く。1件を2〜3文
    （再現条件 → 起きること → 回避策）に縮める。既存の広い rule には追記しない
    （書き方は `${CLAUDE_PLUGIN_ROOT}/skills/close-cycle/references/persistence.md` の「rule の書き方」）
  - 永続ドキュメント（`constraints` / `conventions` / `overview`）へは、既存の形式に合わせて書く
  - その場のコメントは、該当の箇所に書く
- [ ] rule を書いたら、広さと大きさを確かめる。警告が出たら glob を狭めるか分ける

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" rules check
```

- [ ] `document-guide.md` から、廃止した論理名の行を外す。元のファイルは、承認のとおりに削除するか残す
  - 残す場合、AGENTS.md などからの参照が切れていないか確かめる（Hikyaku の索引からは消える）
- [ ] 検証する。廃止した論理名が残っていると、このステップの完了を受け付けない

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs validate
```
