# 指摘からの追加設計

`$ARGUMENTS[1]` が `add` の場合は、全ビルドを終えたあとに付いたレビューの指摘を受けて、
対応するビルドを足す設計として進める。`add` に続く引数の残り（改行以降も含む）が、対応する指摘の
内容。指摘が渡されていなければ、指摘を添えて `/hikyaku:architect {cycle} add {指摘}` で起動し直すよう
案内して終了する（推測で埋めない）。

## 進め方

通常の設計の記録（design/progress.jsonl）は完了済みとして残っているので、`step next` は `done` を返す。
`step next` / `step report` は使わず、`${CLAUDE_PLUGIN_ROOT}/skills/architect/steps/` の指示ファイルを
次の順に読んで行う。各ファイルの「報告する」の項目は読み飛ばす（architect としては記録しない）。
有効なゲート・レビューは `config --json` の `gates` / `reviews` で判断する。

| 順 | 指示ファイル | 行う条件 |
|---|---|---|
| 1 | `questions.md` | 指摘への対応に設計の変更が要るとき |
| 2 | `options.md` | 同上（分岐する判断が無ければ 3・4 を行わない） |
| 3 | `G3.md` | 同上で、`gates.designChoice` が true かつ分岐する判断があるとき |
| 4 | `adr.md` | 同上で、分岐する判断があるとき |
| 5 | `design-delta.md` | 同上 |
| 6 | `architecture-review.md` | 同上で、`reviews.architecture` が true のとき |
| 7 | `G4.md` | 同上で、`gates.architecture` が true のとき。フィードバックがあれば 1 に戻る |
| 8 | `build-split.md` | 常に（下の違いを参照） |
| 9 | `validate.md` | 常に |
| 10 | `retrospective.md` | `reviews.retrospective` が `skip` でないとき |
| 11 | `pr.md` | 常に |

`cycle-scan.md`・`survey.md`・`G2.md` は行わない（調査は済んでいる）。

## 通常の設計との違い

ここに書いていないことは、指示ファイルのとおりに行う。

- 前提: `cycle status` が `building`（全ビルドが完了している）か `completed` であること。
  `closed` / `abandoned` なら何もせず終了する。完了していないビルドがあれば、指摘はそのビルドか、
  そのビルドの後に扱うよう案内して終了する
- ブランチ: `branch verify architect {cycle}` の `expected`（architect のブランチ）で作業する。
  無ければ、全ビルドを取り込んだブランチ（通常はデフォルトブランチ。conductor では conductor ブランチ）
  から作る。既にあれば中断からの再開として、ブランチ上の差分から済んだ手順を飛ばす
- 入力: 渡された指摘を必ず読む。企画成果物・`codebase-survey.md`・`design-delta.md`・`tasklist.md` も読む。
  コードは指摘に関わるファイルだけを読む
- 設計を変えたら、`design-delta.md` にどの指摘を受けて何を変えたかを1段落で残す
- ビルド分割（`build-split.md`）: 指摘に対応するビルドを build-manager で追加する。既存のビルドは完了しているので
  更新しない。issue.md の「やること」に、対応する指摘（PR のコメントの URL があればそれも）を書く。
  build-manager は通常どおり `step next architect {cycle} --skill build-manager` から始める
  （前回の記録のあとから数えるので、最初の手順から返る）
- PR: 通常どおり作る。向き先は `pr base` に従う（conductor では conductor ブランチ）
