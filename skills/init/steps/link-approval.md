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

- [ ] 承認されたら `approved` を報告する（`--input` にユーザーの答え）。承認は document-guide.md の
  ハッシュに結びつくので、承認後に guide を直すと取り直しになる
- [ ] 直す指示があれば `rejected` を報告し（`--input` にユーザーの答え）、document-guide.md を直してから
  `step next` に従って提示し直す
