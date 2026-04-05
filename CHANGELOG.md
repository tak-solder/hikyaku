# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] - Unreleased

### Added
- `hikyaku-build-manager` スキルを追加 — ビルドの追加・更新・分割と依存グラフ管理を一元化 (#11)
- `hikyaku-retrospective` スキルを追加 — 各フェーズ末の振り返りを model-invocable スキルとして独立化 (#12)
- BP見積もりに影響ファイル数の加算要素を追加 (#11)
- README に「ビルドポイント（BP）」セクションを追加

### Changed
- builder の plan.md と test-spec.md の承認ステップを分離（個別承認に変更） (#13)
- builder テンプレートの issue.md 重複除去と handoff.md の棲み分けを明確化 (#13)
- bp-guide.md の構成を整理し、BP見積もり指標を改善 (#11)
- テンプレートのヘッダー例から `#` を除去し、二重見出しを防止 (#12)
- README のアウトライン構成を見直し

## [0.2.1] - 2026-03-28

### Changed
- ビルド分割時のリナンバリングを不要にする（末尾追加+依存グラフ方式） (#10)

## [0.2.0] - 2026-03-24

### Changed
- builder の承認ステップを統合（plan.md + test-spec.md 一括承認） (#9)

### Fixed
- `copilot-instruction.md` を `copilot-instructions.md` に修正 (#8)

## [0.1.2] - 2026-03-21

### Added
- スキルバージョン更新時にタグを自動作成する CI (#6, #7)
- スキルバージョンの統一性を検証する CI (#5)
- `copilot-instructions.md` を追加 (#6)

### Changed
- 用語統一: タスク→ビルド、プロジェクト→ワークフロー/リポジトリ、SP→BP に置き換え (#3)
- Agent Skills 仕様準拠: frontmatter 改善・references/ ディレクトリ整理 (#3, #4)
- SP見積もり精度を改善: API閾値調整・加算要素チェック必須化 (#2)
- builder の buildID 引数をオプション化（省略時は next） (#3)
- `instruction.md` によるワークフロー固有インストラクションをサポート
- retry-policy に同一原因の判定基準を追加 (#1)
- セッションの目安を明示

## [0.1.0] - 2026-03-18

### Added
- 初期リリース: `hikyaku-planner`, `hikyaku-architect`, `hikyaku-builder` の3スキル
- README.md を追加
