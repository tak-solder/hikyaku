# review: コードレビュー

機械的検証だけでは検出できない品質・規約・セキュリティ観点をレビューする。
レビューそのものは Claude Code / Codex に組み込みのレビュー機能が行う。
どのプロバイダ・モデル・エフォートで何回まで回すかは `[review]` の設定で決まり、
CLI が起動方法を解決する。

- [ ] コンテキストを確かめる（directive の `context` と `overruns`）
  - 目安を超えていたら、残りの作業（レビュー対応・PR 作成・振り返り）を見て、継続するか、
    handoff.md を書いて区切るかを自分で判断する
  - 継続するなら、**レビュー結果の提示で**、目安を超えていることと継続する理由を伝える。
    `overruns` に実装開始前の超過があれば、それも一緒に伝える。指摘が0件で提示が無ければ、
    完了の案内で伝える
- [ ] ローカルでコミットする（push はしない）
  - どちらのプロバイダのレビューも、コミット済みの差分を対象にするため
  - 未追跡のファイルも含め、実装したものは全てコミットに含める
- [ ] 起動方法を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve code build-{NN} {cycle} --self claude --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve security build-{NN} {cycle} --self claude --json
```

`--self` にはメインのセッションのプロバイダを渡す（`provider = "auto"` と `provider_for` の解決に使う）。
`enabled` は `code_review` / `security_review` の値、`maxRounds` は回数の上限（0 は無制限）、
対応確認と再レビューの要否は `review action` で解決する。`base.ref` が差分の基準で、
スタックしていればスタック元になる。**デフォルトブランチを決め打ちしない。**

- [ ] `code` の `enabled` が true なら（全プロファイル）、code のレビューを行う
- [ ] `security` の `enabled` で、security のレビューを行うか判定する

| 設定値 | 挙動 |
|---|---|
| `off`（既定では該当なし。個別キーで明示したときだけ） | 起動しない |
| `on`（thorough） | 常に起動する |
| `recommended`（express / economy / standard） | 判定基準に該当する場合のみ、起動するか確認する |

`recommended` の場合、対象ビルドの `issue.md` と実際の diff が、`config --json` の
`security.triggers` の基準に該当するか判定する。該当する場合は判定根拠を一行で示して確認する。
外れることがあるので、ユーザーが上書きできる形にする。

```
このビルドは「認証・認可」に該当する変更を含みます（auth/session.ts の権限判定を変更）。
security_review を起動しますか？ [Y/n]
```

- [ ] スコープ準拠を自分で確認する
  - 組み込みのレビュー機能には指示文を渡せず、plan.md を読まない。スコープの確認はここで行う
  - `git diff --stat $(git merge-base {base.ref} HEAD)..HEAD` の変更ファイルを、plan.md の
    実装ステップと issue.md のスコープ外と突き合わせる
  - 計画に無い変更・スコープ外の変更は、レビューの指摘と同じ扱いで下の統合に加える
- [ ] マージ時点のデータ安全を自分で確認する
  - 組み込みのレビュー機能は、このビルドの後に何がマージされるかを知らない。差分のうち
    スキーマ・マイグレーション・保存形式・API の契約・既存データを読み書きする処理を、
    plan.md の「マージ時点のデータ安全」と突き合わせる
  - 根拠が成り立たない箇所は、レビューの指摘と同じ扱いで下の統合に加える。issue.md に
    「マージ時点で残る危険」があれば、その範囲を超えているかで判定する
- [ ] レビューを実行する（ラウンド n。初回は 1）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run code build-{NN} {cycle} --self claude --round {n}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run security build-{NN} {cycle} --self claude --round {n}
```

  - 2つを **Bash の `run_in_background` で並列に実行する**（数分かかることがある。`timeout` は最大値）
  - 生の出力は `.git` の中に保存され、パスと本文が返る。コミットはしない
  - **終了コード 1 は失敗であって、パス（指摘0件）ではない。** 空の結果やタイムアウトも失敗になる。
    メッセージをユーザーに報告して判断を仰ぐ
- [ ] 指摘を統合する
  - 同一箇所への重複指摘は1件に統合し、security の指摘を優先する。
    同じプロバイダが同じ指摘を2回出力することもある
  - 「確度が低い懸念」は「確度: 要確認」ラベルを保持したまま別枠で提示する
  - 2ラウンド目以降は、前のラウンドの出力（返ったパスと同じディレクトリの `round-{n-1}-*.md`）と比べる
- [ ] 統合した指摘をコード・承認済み仕様・スコープに照らして判断する。不採用の指摘には理由を残す。
  前ラウンドの保留も確認し、未解決なら今回の指摘に含める
- [ ] 有効な種類ごとに、対応と次のラウンドを解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review action {code|security} build-{NN} {cycle} --round {n} {判定したフラグ} --json
```

妥当かつ承認済みスコープ内の指摘には `--has-findings`、自動修正できない懸念には `--uncertain`、
前回から繰り返した指摘には `--repeated` を添える。妥当性・重複は自分で判断し、回数の比較は CLI に任せる。

| action | すること |
|---|---|
| `done` | その種類のレビューを終える |
| `fix` | 妥当な指摘を修正し、verify と同じ検証を通してコミットする |
| `confirm` | 未解決の指摘を提示して対応を決める（ask: review-findings）。修正、新ビルド化、そのまま進める、から選ぶ |

- `deferUncertain` が true なら、自動修正できない懸念を保留する。`nextRound` があるあいだは次のレビューにも含める。
  `nextRound` が null なら、その種類のレビューを終え、handoff の「残したこと」に「確度: 要確認」と理由を残す。
  PR 本文と完了の案内では、その節へのリンクと要点を伝える（全文やチェックリストを転記しない）
- 修正して継続するときは、`nextRound` があればそのラウンドで再レビューし、無ければその種類を終える。
  全指摘を新ビルド化するか、そのまま進めると決めた場合も、その種類を終える
- 両方のレビューを終えたら `done` を報告する。保留・不採用・意図的に残した指摘は理由とともに handoff に残す
- 設計の前提が崩れた場合は、SKILL.md の「architect への差し戻し」に従う
