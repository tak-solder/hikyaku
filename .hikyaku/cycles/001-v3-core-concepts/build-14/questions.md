# Build 14: 質問と回答

## ask: branch — 作業ブランチ

- 状況: 現在のブランチ（hikyaku/001-v3-core-concepts/conductor）が、規則で期待するブランチ（hikyaku/001-v3-core-concepts/build-14）と一致しない
- 選択肢: 1. 規則に従い build-14 を作る（conductor から切るスタック。PR の base は conductor） / 2. 現在のブランチで作業する / 3. 別のブランチを指定する
- 回答（監督の委任された判断）: 1。hikyaku/001-v3-core-concepts/conductor から hikyaku/001-v3-core-concepts/build-14 を切る。PR の base は conductor
- 根拠: conductor の流れでは、各ビルドを conductor ブランチから切り、PR を conductor に向けて監督が取り込む。これまでのビルドもすべてこの形

## G8: plan.md の承認（test-spec は作らない）

- 回答（監督の委任された判断）: 承認する。test-spec を作らないことも含む
- 根拠: 文字列とコメントの置き換えだけで振る舞いは変わらず、issue.md の受け入れ基準（grep の列挙・tsc・npm test）は plan の実装ステップ 4・6 で確かめる。「残す用法」の4分類は、issue.md の「操作する人以外を指す『人間』は改めない」の範囲で、concepts.md の用語の定義と食い違わない。予測ピーク 250k は split_above 以下
- 進め方の注意: スキルのフロントマターの description（conductor の「取り返しのつかない判断だけを人間に上げる」など）も、操作する人を指していれば対象に含める。テスト名を直すときは名前だけを変え、期待値は変えない
