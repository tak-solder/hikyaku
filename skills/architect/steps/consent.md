# consent: 事後同意（PR を作る直前の同意ゲート）

設計フェーズのマージの前にユーザーが同意する項目（`when=merge@architect` の、ユーザーが決める受け入れた
リスク・異議）があるときだけ返る。同意なので、プロファイルに関わらずユーザーに尋ねる（ask: deferred-consent）。
あなたは決めない。監督や AI に付け替える手順も無い。

- [ ] 一覧を出してユーザーに示す。1項目3行の要約を示し、求められたら `--full` の全文を示す

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger consent-list architect {cycle}
```

- [ ] 項目ごとにユーザーの答えを記録する（`--input` にユーザーの答え）
  - 同意する: `--decision consented`。害が高の異議は、ユーザーが受け入れると自分の言葉で書いたことを `--accepts` に添える（AI が代わりに書かない）
  - 選択を改める: `--decision decided`
  - 退ける: `--decision rejected`。下の「退けたとき」に従って作り直す
  - 前に退けた項目の作り直しが済んだとユーザーが認めた: `--decision resolved`（PR 本文と `cycle status` の「未解決の退け」から消える）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger decide architect <ID> {cycle} --decision <decision> --by user --input "<ユーザーの答え>" [--accepts "<受け入れの言葉>"]
```

- [ ] 全項目に決定を記録したら `approved` を報告する（`--input` にユーザーの答えの要約）。決定の足りない項目が
  あれば CLI が承認を受け付けない

## 退けたとき

退けたら `step next` を呼び直す。戻り方は CLI が記録した作業単位から決め、directive の `args` に出す。

- `args.reworkFrom`（設計フェーズで記録した項目）: そのステップを作り直し、各ステップの指示どおりに `done` で
  報告し直す（`options` / `design-delta` は、上限を超える受け入れが残れば `--loses` を求められる）。そこから後ろは
  やり直しになり、このゲートに戻ってくると承認を受け付ける（`resolved` の前でも PR を作れる。項目は `resolved`
  まで「未解決の退け」として PR 本文に残る）
- `args.returns`（企画フェーズなど、前のフェーズで記録した項目）: 設計フェーズでは作り直せない。記録した
  フェーズで作り直す必要があることをユーザーに伝えて止まる。作り直しが済んだとユーザーが認めて `resolved` を
  記録するまで、このゲートも PR も進まない
