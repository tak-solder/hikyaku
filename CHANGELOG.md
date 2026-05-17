# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.6.0]

### Added

- **サブエージェント定義の新設**: `agents/` 配下に `code-explorer` / `code-architect` / `code-reviewer` の3エージェントを追加。architect / builder スキルから委任されて起動される
  - `code-explorer`: architect Step 2 で起動。担当観点に沿った既存コード調査と **Key Files リスト** を返す
  - `code-architect`: architect Step 4 で起動。指定された観点（Minimal / Clean / Pragmatic 等）に基づく単一の設計案を返す
  - `code-reviewer`: builder Step 8 で起動。信頼度80以上のコードレビュー指摘のみ報告する
- **planner Step 3「目的とスコープのすり合わせ」を新設**: 質問ループ前に「何を実現したいか / 背景・目的 / 対象画面・対象データ / 制約・要件」の4項目を要約してユーザーと認識合わせを行う Discovery 確認ゲートを追加（旧 Step 3 は Step 4 に、旧 Step 4 は Step 5 に繰り下げ）
- **architect Step 2 を並列調査+Key Files 一次読解に拡張**: user-stories の規模に応じて `code-explorer` を複数並列で起動し、各エージェントが返す Key Files をメインセッションが直接 Read することで設計判断の解像度を上げる
- **architect Step 4 に「主要設計判断の特定と分岐評価」サブステップを追加**: 妥当な代替案が複数ある判断について、`code-architect` を2〜3並列で起動して trade-off 比較・推奨案提示・ユーザー選択を行うパターンを導入。分岐がない判断は従来通り単一案で確定する
- **builder Step 8「コードレビュー」を新設**: ローカル検証（lint / test / build）と申し送り作成の間に `code-reviewer` を呼ぶレビューステップを追加。指摘ごとに「今修正 / 新ビルド化 / そのまま進める」をユーザーが選択できる（旧 Step 8〜10 は Step 9〜11 に繰り下げ）

### Migration

- 既存ワークフローの `planning/`, `architecture/`, `build-NN/` の中身は変更不要
- ステップ番号の変更（planner Step 4-5、builder Step 9-11）はスキル内部の参照番号のため、ユーザー側の対応は不要

## [0.5.1]

### Changed

- **BP閾値の統一**: `build-manager/SKILL.md`・`build-manager/references/bp-guide.md`・`README.md` に分散していたBP閾値を統一（分割推奨: 合計BP 6以上、分割必須: 合計BP 9以上）。互換性への影響なし
- **設計フェーズの承認順序を変更**: `architect` Step 5 で「設計ドキュメント承認 → build-manager 呼び出し」の順に変更。設計を確認してからビルド分割を承認する自然な流れに整理
- **実装フェーズに後続セッション開始タイミングの注意書きを追加**: `builder` Step 9 に「後続ビルドのセッションは PR マージ後に開始すること」の注記を追加

### Fixed

- `planner` の description にあった typo を修正（「読み込み、にユーザー」→「読み込み、ユーザー」）
- 各スキルのディレクトリ構造例で `plan.md` 行のインデントが他行と揃っていなかった点を修正

### Added

- `.claude-plugin/plugin.json` に `license` フィールド（MIT）を追加

## [0.5.0]

### Changed

- **BREAKING**: Claude Code プラグイン形式に対応 — `.claude-plugin/plugin.json` と `.claude-plugin/marketplace.json` を追加し、`claude plugin install hikyaku@hikyaku` で導入できるようにした
- **BREAKING**: スキル名から `hikyaku-` プレフィックスを除去 — プラグインの名前空間機能（`/<plugin>:<skill>`）と統合
  - `/hikyaku-planner` → `/hikyaku:planner`
  - `/hikyaku-architect` → `/hikyaku:architect`
  - `/hikyaku-builder` → `/hikyaku:builder`
  - 内部スキル: `hikyaku-build-manager` → `build-manager`、`hikyaku-retrospective` → `retrospective`
- スキルディレクトリも対応してリネーム（`skills/hikyaku-*/` → `skills/*/`）
- README にプラグインインストール手順を追加

### Migration

- 旧バージョン（0.4.x）のスタンドアロン構成を使っているユーザーは、`.claude/skills/` から旧 `hikyaku-*` スキルを削除し、新しいプラグインを `claude plugin install hikyaku@hikyaku` で導入する必要がある
- 既存の `{DOC_ROOT}/` 配下のドキュメント（`tasklist.md`, `planning/`, `architecture/`, `build-NN/`）は変更不要

## [0.4.1]

### Changed
- リトライポリシーの判定基準を「根本原因ベース」から「同一ファイルへの修正回数ベース」に変更 — AIが根本原因の変化を自己判断してカウントをリセットし、コンテキストを浪費する問題を防止

## [0.4.0]

### Changed
- 全スキルの作業ステップをチェックボックス形式に再構成 — 完了条件を明確化し、手順スキップを防止 (#16)
- 全スキルに Step 0（ファイル読み込み）を追加 — テンプレートやリファレンスの読み込み漏れを防止
- 承認ステップを作成ステップに統合し、フィードバックループを明確化（planner, architect, builder）
- mermaid フローチャート・冗長なリスト（「やること」「成果物」）を削除し、全体で約185行削減
- `$ARGUMENTS[0]` 表記を全スキルで統一
- plan.md テンプレートに BP 見積もりセクションを追加
- tasklist.md テンプレートに builder 呼び出しコマンドを追加

## [0.3.0] - 2026-04-06

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
