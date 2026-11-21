# write: 永続ドキュメントの書き込みと検証

P2 で承認された内容だけを書く。承認されていない候補を足さない。

- [ ] 永続ドキュメントへ、追加・置き換え・削除を反映する
  - `repo` 管理の文書は既存の形式に合わせる。置き換えと削除は承認された記述だけに行い、周りを整理しない
- [ ] `workflow` が承認されていれば `{HIKYAKU_ROOT}/instructions.md` を更新する（無ければ新規作成する）
- [ ] スキルが承認されていれば `.claude/skills/{名前}/SKILL.md` を作る（書き方は close-cycle の
  `${CLAUDE_PLUGIN_ROOT}/skills/close-cycle/steps/write.md` の「スキル」と同じ）
- [ ] 新しく作った文書があれば `document-guide.md` の管理列とパス列を更新し、AGENTS.md の索引を確かめる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs link --dry-run
```

差分が出たら、ユーザーの承認を得てから `--dry-run` を外して実行する。

- [ ] 検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs validate
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" rules check
```

- [ ] `done` を報告し、変更と progress.jsonl をコミット & push する
