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
  - 退ける: `--decision rejected`。作り直しが済んでユーザーが `resolved` を記録するまで、このゲートも公開も進まない

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger decide {phase} <ID> {cycle} --decision <decision> --by user --input "<ユーザーの答え>" [--accepts "<受け入れの言葉>"]
```

- [ ] 全項目に決定を記録したら `approved` を報告する（`--input` にユーザーの答えの要約）。決定の足りない項目が
  あれば CLI が承認を受け付けない
