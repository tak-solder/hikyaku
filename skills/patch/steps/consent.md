# consent: 事後同意（PR を公開する直前の同意ゲート）

サイクルに属す patch で、マージの前にユーザーが同意する項目（`when=merge@{phase}` の、ユーザーが決める
受け入れたリスク・異議）があるときだけ返る。同意なので、プロファイルに関わらずユーザーに尋ねる
（ask: deferred-consent）。あなたは決めない。監督や AI に付け替える手順も無い。

- [ ] 一覧を出してユーザーに示す。1項目3行の要約を示し、求められたら `--full` の全文を示す

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger consent-list {phase} {cycle}
```

- [ ] 項目ごとにユーザーの答えを記録する（`--input` にユーザーの答え）
  - 同意する: `--decision consented`。害が高の異議は、ユーザーが受け入れると自分の言葉で書いたことを `--accepts` に添える（AI が代わりに書かない）
  - 選択を改める: `--decision decided`
  - 退ける: `--decision rejected`。下の「退けたとき」に従って作り直す
  - 前に退けた項目の作り直しが済んだとユーザーが認めた（ask: deferred-consent）: `--decision resolved`（PR 本文と `cycle status` の「未解決の退け」から消える）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger decide {phase} <ID> {cycle} --decision <decision> --by user --input "<ユーザーの答え>" [--accepts "<受け入れの言葉>"]
```

- [ ] 全項目に決定を記録したら `approved` を報告する（`--input` にユーザーの答えの要約）。決定の足りない項目が
  あれば CLI が承認を受け付けない

## 退けたとき

退けたら `step next` を呼び直す。戻り方は CLI が記録した作業単位から決め、directive の `args` に出す。

- `args.reworkFrom`（この patch で記録した項目）: そのステップを作り直し、各ステップの指示どおりに `done` で
  報告し直す。そこから後ろはやり直しになり、このゲートに戻ってくると承認を受け付ける（`resolved` の前でも
  公開できる。項目は `resolved` まで「未解決の退け」として PR 本文に残る）。`scope` まで戻ると `pr` もやり直しに
  なるが、Draft PR は作り直さない（`pr.md` の作り直しの回）
- `args.returns`（前のフェーズで記録した項目）: この patch では作り直せない。記録したフェーズで作り直す必要が
  あることをユーザーに伝えて止まる。作り直しが済んだとユーザーが認めて `resolved` を記録するまで、このゲートも
  公開も進まない
