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
`autoFix` は2ラウンド目以降の確認を省くかどうか。`base.ref` が差分の基準で、
スタックしていればスタック元になる。**デフォルトブランチを決め打ちしない。**

- [ ] `code` の `enabled` が true なら（全プロファイル）、code のレビューを行う
- [ ] `security` の `enabled` で、security のレビューを行うか判定する

| 設定値 | 挙動 |
|---|---|
| `off`（既定では該当なし。個別キーで明示したときだけ） | 起動しない |
| `on`（thorough） | 常に起動する |
| `recommended`（express / economy / standard） | 判定基準に該当する場合のみ、起動するか確認する |

`recommended` の場合、対象ビルドの `issue.md` と実際の diff を見て、
`[review.security].triggers` に該当するか判定する。`config --json` の
`security.triggers` に基準が入っている（未設定なら既定の3カテゴリ）。

```
- 個人情報・秘密情報を扱う（氏名/住所/連絡先/生年月日、パスワード、トークン、APIキー）
- 認証・認可（ログイン、セッション、権限判定、アクセス制御）
- 決済（支払い、カード情報、請求、返金）
```

該当する場合は判定根拠を一行で示して確認する。ヒューリスティックである以上
外れるので、ユーザーが上書きできる形にする。

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
- [ ] 指摘が0件なら、パスとして `done` を報告する
- [ ] 統合した指摘をユーザーに提示し、対応を決める（ask: review-findings）
  - 今修正する — 修正し、verify と同じ検証を通し、追加でコミットして、ラウンド n+1 のレビューへ
  - 新ビルド化して後で対応 — `/hikyaku:build-manager` を呼び出して新ビルドを追加する
  - そのまま進める — 指摘を `handoff.md` の「意図的に残した未対応」に記録する
  - `autoFix` が true で2ラウンド目以降なら、確認を省いて「今修正する」として扱う。
    ただし「確度: 要確認」の懸念と、次の打ち切りに当たる場合は確認する
- [ ] 次のラウンドへ進む前に、打ち切るか判定する
  - `maxRounds` が 0 でなく、n が `maxRounds` に達した — 残った指摘を示して対応を決める（ask: review-findings）。
    選べるのは「修正して再レビューせずに進める」「新ビルド化」「そのまま進める」
  - 前のラウンドと同じ指摘が繰り返された — 修正しても解消していない。`maxRounds` が 0（無制限）でも
    打ち切り、その指摘を示して対応を決める（ask: review-findings）
- [ ] 残った指摘すべてで「新ビルド化」か「そのまま進める」を選んだら、パスとして `done` を報告する
