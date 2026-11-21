# link-approval: AGENTS.md への索引の承認

AGENTS.md（無ければ CLAUDE.md）に、document-guide.md から生成した索引を書き込む前に承認を得る。

AGENTS.md はリポジトリ全体の AI 設定であり、チーム全体に影響する。マーカーで
囲むので人間が書いた部分は保持されるが、書き換える以上は承認を取る。
この索引が無いと、Hikyaku 以外のセッション（通常の Claude Code、Copilot、Cursor）は
永続ドキュメントの存在に気づけない。

- [ ] 差分を提示して承認を求める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs link --dry-run
```

- [ ] 直す指示があれば、document-guide.md を直してから提示し直す
