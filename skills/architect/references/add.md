# 指摘からの追加設計

`$ARGUMENTS[1]` が `add` の場合は、全ビルドを終えたあとに付いたレビューの指摘を受けて、
対応するビルドを足す設計として進める。`add` に続く引数の残り（改行以降も含む）が、対応する指摘の
内容。指摘が渡されていなければ、指摘を添えて `/hikyaku:architect {cycle} add {指摘}` で起動し直すよう
案内して終了する（推測で埋めない）。

手順は通常の設計と同じく `step next` が返す。回ごとの違い（並行サイクルの確認と調査を行わない・設計の変更が
要るときだけ設計を見直す・完了済みのビルドは更新せずビルドを足す）は、step が `round: add` として
ステップを選び、各ステップの指示に書いてある。ここに書くのは、step に入る前の準備だけ。

- 前提: `cycle status` が `building`（全ビルドが完了している）か `completed` であること。
  `closed` / `abandoned` なら何もせず終了する。完了していないビルドがあれば、指摘はそのビルドか、
  そのビルドの後に扱うよう案内して終了する
- ブランチ: `branch verify architect {cycle}` の `expected`（architect のブランチ）で作業する。
  無ければ、全ビルドを取り込んだブランチ（通常はデフォルトブランチ。conductor では conductor ブランチ）
  から作る
- 入力: 渡された指摘を必ず読む。企画成果物・`codebase-survey.md`・`design-delta.md`・`tasklist.md` も読む
- 回の区切り: design/progress.jsonl には通常の設計の記録が完了済みで残っているので、`step next` の前に
  追加設計の回を区切る。`--round add` が回の種類を表す。`--reason` には指摘の要約を書く

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step restart architect {cycle} --round add --reason "{指摘の要約}"
```

  既に architect のブランチがあり、`step status architect {cycle}` でこの回が途中まで進んでいれば、
  中断からの再開として区切り直さない
