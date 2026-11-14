# review: コードレビュー

機械的な検証では拾えない品質・規約・セキュリティの観点をレビューする。レビューそのものは
Claude Code（`/code-review`・`/security-review`）か Codex（`codex exec review`）に組み込みのレビュー機能が行い、どのプロバイダ・モデルで何回まで回すかは
`[review]` の設定で CLI が決める。

- [ ] ローカルでコミットする（push はしない）。未追跡のファイルも含め、実装したものは全てコミットに含める
- [ ] 起動方法を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve code {phase} {cycle} --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve security {phase} {cycle} --json
```

`base.ref` が差分の基準（統合ブランチから切っていればそのブランチ）。**デフォルトブランチを決め打ちしない。**

- [ ] `code` の `enabled` が true なら code のレビューを行う
- [ ] `security` の `enabled` が `on` なら常に、`recommended` なら差分が `config --json` の
  `security.triggers` に当たるときだけ、根拠を一行で示して起動するかを確かめる。`off` なら起動しない
- [ ] スコープ準拠を自分で確かめる。組み込みのレビュー機能は合意の内容を知らない。
  `git diff --stat $(git merge-base {base.ref} HEAD)..HEAD` の変更ファイルを P1 の合意（PR の本文）と
  突き合わせ、合意に無い変更はレビューの指摘と同じ扱いにする
- [ ] マージ時点のデータ安全を自分で確かめる。差分のうちスキーマ・マイグレーション・保存形式・API の契約・
  既存データを読み書きする処理を、scope で書いた根拠と突き合わせる
- [ ] レビューを実行する（ラウンド n。初回は 1）。2つを Bash の `run_in_background` で並列に実行する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run code {phase} {cycle} --round {n}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run security {phase} {cycle} --round {n}
```

  **終了コード 1 は失敗であって、指摘0件ではない。** メッセージをユーザーに報告して判断を仰ぐ
- [ ] 指摘を統合する。同一箇所への重複は1件にし、security を優先する。「確度: 要確認」の懸念は別枠にする。
  2ラウンド目以降は、前のラウンドの出力（同じディレクトリの `round-{n-1}-*.md`）と比べる
- [ ] 統合した指摘をコード・合意・スコープに照らして判断し、種類ごとに対応を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review action {code|security} {phase} {cycle} --round {n} {判定したフラグ} --json
```

妥当かつ合意の範囲内の指摘には `--has-findings`、自動修正できない懸念には `--uncertain`、
前回から繰り返した指摘には `--repeated` を添える。

| action | すること |
|---|---|
| `done` | その種類のレビューを終える |
| `fix` | 妥当な指摘を修正し、verify と同じ検証を通してコミットする |
| `confirm` | 未解決の指摘を提示して対応を決める。修正する、合意の範囲を変える（`scope` を報告し直す）、そのまま進める、から選ぶ |

- `deferUncertain` が true で `nextRound` が null なら、自動修正できない懸念を保留し、PR の本文の
  「残したこと」に「確度: 要確認」と理由を書く（publish で書く）
- 両方のレビューを終えたら `done` を報告し、コミットを push する。そのまま進めた指摘は理由とともに控えておく
  （publish で PR の本文の「残したこと」に書く）
