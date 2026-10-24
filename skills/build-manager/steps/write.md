# write: 書き込み

- [ ] `--dry-run` を外して同じコマンドを実行する
  - 循環依存や存在しない依存があればスクリプトが終了コード 2 で拒否する。その場合は書き込まれていないので、
    依存関係を修正し、`scope` を `done` で報告し直して整理からやり直す（G6 も取り直しになる）
- [ ] `issue.md` を作成・更新する（テンプレートは `${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/templates.md` を参照）
- [ ] 安全でない分割を使ったビルドがあれば、記録を検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" validate {cycle}
```

  「マージ時点で残る危険」の節があるのに安全でない分割が許されていない、「解消するビルド」が
  無い・依存していない、と報告されたら、issue.md か依存関係を直す
- [ ] `done` を報告する
- [ ] 成果物をコミット & push する（呼び出し元の progress.jsonl も含める）

成果物を1つ作るごとにコミット & push すること。コミットされていなければ、
中断時に他セッションから進捗が見えず、再開点を検出できない。
