# Build 09 の質問と回答

## G8: plan.md と test-spec.md の承認（委任された判断）

- 問い: plan.md と test-spec.md を承認するか。AI が解釈で決めた3点（すべての `<hikyaku-blocked>` を検査する / `gh pr ready` 自体の失敗も `--for-merge` 以外では止めない / 欠けのある差し戻しの blocked は conductor ではユーザーに上がる）を含む
- 回答: 承認（実装に進む）。監督による委任された判断
- 根拠（監督）: issue.md の受け入れ基準 US-3.1〜3.4・US-18.1・18.2 はすべて test-spec.md のシナリオに対応している。blocked をすべて検査する点と、欠けのある差し戻しの blocked をユーザーに上げる点は、ユーザーに上げる側に倒れる判断で、ADR escalation-report-check と矛盾しない。`gh pr ready` 自体の失敗を `--for-merge` 以外で止めない点は design-delta.md 11節（pr-ready の gh の呼び出しも同じ扱い）どおりで、監督が取り込む前の `--for-merge` は従来どおり失敗で止まるので、取り込み前の検証は弱まらない。`tests/pr-ready.test.mts` の期待値の変更はこの範囲で受け入れる
