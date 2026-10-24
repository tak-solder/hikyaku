# 差し戻しからの再設計

`$ARGUMENTS[1]` に `build-{NN}` が指定された場合、または `cycle status` が
`building（差し戻し中: build-NN）` を返した場合は、builder から差し戻された設計の見直しとして
進める。差し戻しの記録は `cycles/{cycle}/return.md` にあり、差し戻し元のビルドのブランチにだけ
コミットされている。

## 進め方

差し戻し中は `step next` が止まる（`return.md` があるため）。`step next` / `step report` は使わず、
`${CLAUDE_PLUGIN_ROOT}/skills/architect/steps/` の指示ファイルを次の順に読んで行う。
各ファイルの「報告する」「progress.jsonl」の項目は読み飛ばす（記録しない）。
有効なゲート・レビューは `config --json` の `gates` / `reviews` で判断する。

| 順 | 指示ファイル | 行う条件 |
|---|---|---|
| 1 | `cycle-scan.md` | `cycle list --active` に他のサイクルがあるとき |
| 2 | `survey.md` | 既存の codebase-survey.md で足りないとき（崩れた前提に関わる範囲だけ調べ直す） |
| 3 | `G2.md` | `gates.codebaseSurvey` が true で、2 を行ったとき |
| 4 | `questions.md` | 常に |
| 5 | `options.md` | 常に（分岐する判断が無ければ 6・7 を行わない） |
| 6 | `G3.md` | `gates.designChoice` が true で、分岐する判断があるとき |
| 7 | `adr.md` | 分岐する判断があるとき |
| 8 | `design-delta.md` | 常に |
| 9 | `architecture-review.md` | `reviews.architecture` が true のとき |
| 10 | `G4.md` | `gates.architecture` が true のとき。フィードバックがあれば 4 に戻る |
| 11 | `build-split.md` | 常に（下の違いを参照） |
| 12 | `validate.md` | 常に |
| 13 | `retrospective.md` | `reviews.retrospective` が `skip` でないとき |

`pr.md` は行わない（下の違いを参照）。

## 通常の設計との違い

ここに書いていないことは、指示ファイルのとおりに行う。

- ブランチ: 差し戻し元のビルドのブランチ上で作業する。 architect 用のブランチは切らない。
  Step 0 のブランチ確認は `branch verify architect` ではなく `branch verify build-{NN} {cycle}` で行い、
  `ok: true` でなければブランチを作らずにユーザーに尋ねる（ask: branch）（差し戻し元のブランチに切り替えてもらう）。
  設計の変更はそのビルドの PR に入るので、積んでいる場合も連鎖が一直線のまま保てる。
  コミット前のブランチ確認も `branch verify build-{NN} {cycle}` で行う
- 入力: `return.md` と、差し戻し元のビルドの `questions.md` を必ず読む。何が崩れたか、
  何を決め直すかはそこに書かれている。企画成果物と既存の design-delta.md も通常どおり読む
- design-delta.md: 撤回した判断を残す。書き換えるだけでなく、どの判断を、なぜ撤回したかを
  1段落で書く（後からビルドの PR を読む人が、設計が変わった理由を追えるようにするため）
- ビルド分割（`build-split.md`）: 影響を受けるビルドは、追加よりも更新で扱う。 build-manager を呼び出し、
  差し戻し元の issue.md・BP・依存を改める。他のビルドに波及する場合はそれも更新する。
  build-manager も差し戻し中は `step next` が止まるので、指示ファイルを順に読んで進めるよう伝える
- 最後: PR を作らない。振り返りのあと、`return.md` と、差し戻し元のビルドの `plan.md` /
  `test-spec.md`（古い設計の上で書かれたもの）を削除してコミット & push する。この削除が差し戻しの
  解決の記録になる。`return.md` が消えれば、`cycle status` は差し戻し元のビルドの plan.md からの
  再開を返す
- 案内: `/hikyaku:builder {cycle} {NN}` を案内する。同じブランチで builder を起動し直せば、
  plan からやり直せる
