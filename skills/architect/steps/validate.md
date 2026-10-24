# validate: 受け入れ基準の割り当てと記録の検証

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" validate {cycle}
```

- [ ] user-stories.md の受け入れ基準に番号があれば、`validate` はどのビルドにも割り当てられていない
  受け入れ基準を報告する。報告されたら、該当するビルドの「対応する受け入れ基準」に足すか、
  満たすビルドを追加する（`/hikyaku:build-manager {cycle}` を再度呼び出す。build-manager の手順は
  `step next architect {cycle} --skill build-manager` から始める）
- [ ] 報告が無くなったら `done` を報告する
- [ ] コミット & push する（progress.jsonl も含める）
