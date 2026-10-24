# options: 設計判断の特定と、分岐がある判断の案の生成

## 主要な設計判断の特定と分岐評価

- [ ] 設計に反映する主要な技術判断を列挙する（認証方式、状態管理戦略、データ同期方式など）
- [ ] 各判断について、妥当な代替案が複数あり trade-off が非自明かを評価する
  - 既存規約から自明 / 単一の合理的選択肢しかない → 分岐なし
  - 複数案で trade-off が異なり、ユーザーの判断が必要 → 分岐あり

分岐がある判断が1つも無ければ、`skipped` を報告する（`--reason` に「分岐する判断なし」など）。
このとき G3 と ADR の追記は行わない（記録対象は分岐ありの判断のみ）。

## 分岐がある判断の案の生成

- [ ] 各判断について `code-architect` を2〜3並列で起動し、異なる観点の案を生成させる
  - 委任プロンプトに以下の絶対パスを明示する:
    - 要件: `cycles/{cycle}/planning/user-stories.md`
    - 設計質問の回答: `cycles/{cycle}/design/design-questions.md`（存在する場合）
    - 既存コード調査: `cycles/{cycle}/design/codebase-survey.md`（存在する場合）
    - 永続ドキュメント: `overview` / `constraints` / `decisions` のパス
  - 観点の例: Minimal（既存資産の最大活用・低リスク）/ Clean（関心分離・長期保守性）/ Pragmatic（中間）
  - 各案に「影響ファイル」「主要コンポーネントの責務」「Trade-off」を返させる
- [ ] trade-off表にまとめ、推奨案と理由を明記する
- [ ] 値 `designChoiceGate` が false（express）なら、推奨案をそのまま採用し、ユーザーに確認を求めない
  - trade-off表と推奨理由は破棄せず、`adr` で ADR の「検討した案」「採用理由」に残す
    （承認を省いた以上、判断を後から追える場所は ADR だけになる）
- [ ] `done` を報告する。trade-off表と推奨案は G3 の提示・ADR・PR 本文で使うので、このセッションに残しておく
