# external-sync: 外部システムへの投影

`[external] target` が `none` 以外（値 `target`）のときに返る。書き込み後に投影を試みる。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
```

投影の単位は「サイクルに1つの親 issue」と「各ビルドの子 issue」。
親が無ければスクリプトが先に作る。親には tasklist へのリンクとビルド一覧が入る。

投影は片方向で、マスターは常にファイル側。失敗してもワークフローは止めず、
警告だけ出して `done` を報告する。読み取りと完了判定に外部システムを使うことは無い。

gh CLI が無い環境では、スクリプトは投影内容だけを返す（`applied: false` /
`reason: "gh-not-found"`）。その場合は GitHub MCP ツールで適用する。

1. 親（サイクル）→ 子（各ビルド）の順に作成・更新する
2. 可能であれば子を親の sub-issue として紐づける
3. 参照を記録する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle link {cycle} --external {親issueのURL}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist link {cycle} --id {buildID} --issue {子issueのURL}
```

Asana も同じ形で、反映は Asana MCP ツールを持つスキル側が行う。

- [ ] `done` を報告する
- [ ] 参照を記録したら、progress.jsonl と一緒にコミット & push する
