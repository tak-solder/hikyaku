# Build 09 の質問と回答

## G8: plan.md と test-spec.md の承認（委任された判断）

- 問い: plan.md と test-spec.md を承認するか。AI が解釈で決めた3点（すべての `<hikyaku-blocked>` を検査する / `gh pr ready` 自体の失敗も `--for-merge` 以外では止めない / 欠けのある差し戻しの blocked は conductor ではユーザーに上がる）を含む
- 回答: 承認（実装に進む）。監督による委任された判断
- 根拠（監督、G8）: issue.md の受け入れ基準 US-3.1〜3.4・US-18.1・18.2 はすべて test-spec.md のシナリオに対応している。blocked をすべて検査する点と、欠けのある差し戻しの blocked をユーザーに上げる点は、ユーザーに上げる側に倒れる判断で、ADR escalation-report-check と矛盾しない。`gh pr ready` 自体の失敗を `--for-merge` 以外で止めない点は design-delta.md 11節（pr-ready の gh の呼び出しも同じ扱い）どおりで、監督が取り込む前の `--for-merge` は従来どおり失敗で止まるので、取り込み前の検証は弱まらない。`tests/pr-ready.test.mts` の期待値の変更はこの範囲で受け入れる

## review-findings: コードレビューの未解決の指摘（委任された判断）

- 問い: 2ラウンド後に残った指摘4件（1. すべての blocked を検査する / 2. 子の pr ready が PR の実在を確かめない / 3. gh が無いことの判定が包んだエラーの文面に頼る / 4. return.md の欠けのメッセージが3か所に分かれている）をどうするか
- 回答: A. このまま進める（1と2は設計どおりとして不採用、3と4は handoff の「残したこと」に書く）。監督による委任された判断
- 根拠（監督）: 1 は G8 で承認した解釈どおりで、欠けた blocked は violation を経てユーザーに上がる安全側。2 は子では Ready にしない意図した変更で、PR の実在と状態は監督が取り込む前の --for-merge と check-pr で確かめる。3・4 は取り違えても手順が止まらず reason の表示が変わるだけの品質の改善で、利用者への害がない。新ビルド化はスコープを広げるので選ばない
