# design-change: 設計の変更が要るかの判断（追加設計）

指摘からの追加設計の回（`step restart architect {cycle} --round add`）だけで返る。
並行サイクルの確認と既存コードの調査は済んでいるので行わない。

- [ ] 渡された指摘と、企画成果物・`codebase-survey.md`・`design-delta.md`・`tasklist.md` を読む。
  コードは指摘に関わるファイルだけを読む
- [ ] 指摘への対応に、設計（design-delta.md・ADR）の変更が要るかを判断する
  - 要る → `done` を報告する。続けて質問・設計案・G3・ADR・design-delta・レビュー・G4 が返る
  - 要らない → `skipped` を報告する（`--reason` に、設計を変えずに済む理由）。ビルドの追加へ進む
