# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0]

### Added

- **issue保存先バックエンドの抽象化（`issue_backend`）**: `.hikyaku.config` に `issue_backend = "file" | "github" | "asana"` を設定することで、各ビルドの issue.md / plan.md / handoff.md の記録先を切り替えられるようになった
  - `file`（デフォルト）: 従来通りローカルファイルとして作成・コミットする
  - `github`: 対象リポジトリに tasklist 相当の親issueと各ビルドのsub-issueを作成し、plan.md/handoff.mdをコメントとして記録する。完了判定はsub-issueのopen/closeをライブ照会し、PRマージ時の `Closes #N` で自動close される
  - `asana`: `.hikyaku.config` の `asana.project_gid` で指定したプロジェクトに各ビルドをタスクとして作成する（ユーザー設定済みのAsana MCPツールを前提とする）
  - いずれのバックエンドでも `tasklist.md` の buildID/title/BP/dependencies はファイル管理のまま維持し、依存関係判定の唯一の真実とする。各ビルドの issue.md 相当を指す参照列（`issue`列/`asana`のみ`task`列）と `PR` 列も全バックエンド共通で存在し、値はすべてMarkdownリンク形式（`file`: `build-{NN}/issue.md`への相対リンク、`github`: issue URLへのリンク、`asana`: Asana task URLへのリンク）で統一する（詳細は `skills/build-manager/references/backends.md`）
  - `build-manager` がplan.md/handoff.mdの永続化も含む「ビルド記録I/O」全般の唯一の窓口になった（新操作: 記録の永続化）
  - architect のビルド分割は、ドラフト確定（書き込みなし）→ build-manager への一括委任（Step 5a/5b/5c）の2段階に変更し、外部システムでのissue/タスクの作成・削除の乱造を防ぐ
- **中間成果物レビュー（doc-reviewer）**: 新規エージェント `doc-reviewer` が、`user_stories_review` / `architecture_review` / `plan_review`（`.hikyaku.config`、デフォルトいずれも `true`）に応じて、承認前の user-stories.md / architecture配下ドキュメント / plan.md の整合性・網羅性を証拠ベースでレビューする
  - `architecture` / `plan` の2contextでは、設計・計画レベルでのセキュリティ考慮の欠落（セキュリティ設計漏れ / 非機能要件のセキュリティ未反映）も報告対象に含む。確定的な根拠までは無くても、高感度カテゴリに該当し具体箇所を指摘できる懸念は「確度: 要確認」ラベル付きで「確度が低い懸念」セクションに出す
- **DOC_ROOTレベルのconfig上書き**: `{DOC_ROOT}/.hikyaku.config` を配置すると、`doc_root` を除くキーをリポジトリルートの `.hikyaku.config` に対してキー単位で上書きできるようになった
- **プロジェクトディレクトリの自動初期化**: `/hikyaku:planner` の初回実行時、`{DOC_ROOT}/.gitignore`（`retrospective.md`/`test-spec.md`/`questions.md`/`design-questions.md` を除外）と `{DOC_ROOT}/.hikyaku.config` の雛形を冪等に自動生成するようになった
- **`issue_backend` が `file` 以外の場合の `build-{NN}/` 除外を明確化**: `issue.md`/`plan.md`/`handoff.md`は外部レコードが正、`test-spec.md`/`questions.md`/`retrospective.md`はbackendによらず常に除外のため、結果として`build-{NN}/`配下には残るファイルが無くなる。これを個別ファイルパターンではなく`build-*/`という単一の`.gitignore`パターンで明示するようにした。各フェーズスキル（planner/architect/builder）のディレクトリ構造説明にもこの挙動を明記した
- **security-reviewerの確度が低い懸念の報告**: 認証・認可、暗号、外部入力等の高感度カテゴリに該当する変更については、確定的な根拠（データフロー等）を示せなくても、具体的な箇所を指摘できる懸念であれば「確度: 要確認」ラベル付きで「確度が低い懸念」セクションに報告するようになった（false negativeのコストがfalse positiveより大きいというセキュリティ特有の非対称性を踏まえた変更）

### Removed

- **security-reviewerのエスカレーション判定を廃止**: builder Step 8 で `security-reviewer` が `/security-review` へのエスカレーションを判定・提案する挙動を削除した。`security-reviewer` はOWASP系パターンの指摘に専念する（高感度カテゴリの確度が低い懸念は上記の通り別枠で報告する）。`/security-review` スキル自体はユーザーが任意のタイミングで実行可能なまま変更なし

### Migration

- **破壊的変更**: `retrospective.md` / `test-spec.md` は `{DOC_ROOT}/.gitignore` の対象になり、以後コミットされなくなる。既存ワークフローでこれらをコミット済みの場合、次回コミットからは追跡対象外になる（既存のコミット履歴には影響しない）
- `issue_backend` を設定しない場合は `file` がデフォルトとなり、既存ワークフローの動作に変更はない
- `user_stories_review` / `architecture_review` / `plan_review` を設定しない場合はいずれも `true` となり、新たにレビューステップが各承認前に挟まる（従来より承認ラウンドが増えることはないが、レビュー実行分のセッション消費が増える点に注意）
- builderからの `/security-review` への自動エスカレーション提案が無くなるため、セキュリティ感度の高い変更を扱うプロジェクトでは `/security-review` を明示的に実行するタイミングを別途運用で定める必要がある
- `security-reviewer` / `doc-reviewer`（architecture・planコンテキスト）は「確度が低い懸念」を新たに報告するようになるため、従来より指摘件数が増える場合がある。ただし重要度: 高/中/低の指摘とは別枠で提示されるため、確定的な指摘との混同はしない

## [0.8.1]

### Added

- **`test_spec_review` 設定オプション**: `.hikyaku.config` に `test_spec_review = false` を設定すると、builder Step 5 での test-spec.md 承認ゲートをスキップできるようになった。plan.md 承認後の test-spec.md 作成がスムーズになり、承認ループを減らしたいプロジェクト向けのオプション（デフォルト: `true`）

### Migration

- 既存ワークフローへの影響なし。`.hikyaku.config` に `test_spec_review` を設定しない場合はデフォルト `true` となり、従来の承認ゲートが維持される

## [0.8.0]

### Added

- **`.hikyaku.config` による設定ファイルのサポート**: リポジトリルートに `.hikyaku.config`（TOML形式）を配置することで、スキル呼び出し時の引数省略や動作カスタマイズが可能になった。フォーマットの詳細は README の「設定ファイル」セクションを参照
  - `doc_root` — DOC_ROOT パスを固定し、`/hikyaku:planner`, `/hikyaku:architect`, `/hikyaku:builder` の引数を省略可能にする
  - `base_branch` — PRのベースブランチを指定。未設定時は `git remote show origin` でデフォルトブランチを自動検出する
  - `retrospective` — 振り返りの動作を `prompt`（デフォルト・毎回確認）/ `auto`（確認なし自動実行）/ `skip`（スキップ）で制御する
  - `bp_max` — ビルド分割のBP上限を変更する（デフォルト: 8）
  - `code_review` — `false` にすると builder Step 8 のコードレビューをスキップする（デフォルト: true）
  - `security_review` — `false` にすると builder Step 8 のセキュリティレビューをスキップする（デフォルト: true）

### Migration

- 既存ワークフローへの影響なし。`.hikyaku.config` を作成しない場合はすべての設定がデフォルト値となり、従来の動作が維持される
- planner / architect / builder の `argument-hint` を `[{DOC_ROOT}]` に変更（引数がオプションであることを明示）。内部スキル（build-manager / retrospective）は対象外。スキルの動作に影響なし

## [0.7.0]

### Added

- **企画フェーズの4項目サマリを永続化**: planner Step 3 ですり合わせる「実現したいこと / 背景・目的 / 対象画面・対象データ / 制約・要件」の4項目を、`planning/user-stories.md` 冒頭の「## 概要」セクション（各項目 h3 見出し）として記録するようテンプレートを拡張。これまで会話表示のみで揮発していた Discovery の合意内容が後段フェーズで参照できるようになる
- **設計判断ログ（ADR）の新設**: `architecture/decisions.md` を新規追加。architect Step 4a で「分岐あり」と判定された判断について、Step 4b 末尾で **決定 / 文脈 / 検討した案 / 採用理由 / トレードオフ** を1エントリ（`AD-N`）として記録する。トレードオフ欄に「特になし」は禁止（書きたくなる場合は分岐判定を見直す）
- **builder の判断追従**: builder Step 2（コンテキスト復元）で `architecture/decisions.md` を読み込む手順を追加。後続ビルドが採用案を意図せず覆さないようにする。覆す必要が生じた場合は新しい AD エントリの追記と handoff.md への記録を義務化

### Migration

- 既存ワークフローの `planning/`, `architecture/`, `build-NN/` の中身は変更不要
- 過去に作成済みの `user-stories.md` への「## 概要」追記は任意（新規ワークフローのみ義務）
- 過去ワークフローの `decisions.md` は不要。新規ワークフローで分岐ありの判断が出た時点で作成される

## [0.6.0]

### Added

- **サブエージェント定義の新設**: `agents/` 配下に `code-explorer` / `code-architect` / `code-reviewer` / `security-reviewer` の4エージェントを追加。architect / builder スキルから委任されて起動される
  - `code-explorer`: architect Step 2 で起動。担当観点に沿った既存コード調査と **Key Files リスト** を返す
  - `code-architect`: architect Step 4 で起動。指定された観点（Minimal / Clean / Pragmatic 等）に基づく単一の設計案を返す
  - `code-reviewer`: builder Step 8 で `security-reviewer` と並列起動。スコープ準拠・規約準拠・バグ・冗長性を **証拠ベース判定** で報告する（セキュリティ観点は security-reviewer の領域なので扱わない）
  - `security-reviewer`: builder Step 8 で `code-reviewer` と並列起動。OWASP 系のセキュリティパターン違反を証拠ベースで報告し、必要に応じて `/security-review` へのエスカレーション判定も出す
- **planner Step 3「目的とスコープのすり合わせ」を新設**: 質問ループ前に「何を実現したいか / 背景・目的 / 対象画面・対象データ / 制約・要件」の4項目を要約してユーザーと認識合わせを行う Discovery 確認ゲートを追加（旧 Step 3 は Step 4 に、旧 Step 4 は Step 5 に繰り下げ）
- **architect Step 2 を並列調査+Key Files 一次読解に拡張**: user-stories の規模に応じて `code-explorer` を複数並列で起動し、各エージェントが返す Key Files をメインセッションが直接 Read することで設計判断の解像度を上げる
- **architect Step 4 に「主要設計判断の特定と分岐評価」サブステップを追加**: 妥当な代替案が複数ある判断について、`code-architect` を2〜3並列で起動して trade-off 比較・推奨案提示・ユーザー選択を行うパターンを導入。分岐がない判断は従来通り単一案で確定する
- **builder Step 8「コードレビュー」を新設**: ローカル検証（lint / test / build）と申し送り作成の間に `code-reviewer` と `security-reviewer` を **並列起動** するレビューステップを追加。指摘ごとに「今修正 / 新ビルド化 / そのまま進める」をユーザーが選択できる。`security-reviewer` がエスカレーションを推奨した場合は `/security-review` の実行をユーザーに案内する（旧 Step 8〜10 は Step 9〜11 に繰り下げ）
- **証拠ベースの判定ルール**: `code-reviewer` と `security-reviewer` の判定基準を「信頼度80以上」という数値しきい値から、**根拠の種類** で報告/非報告を決める方式に変更。各指摘には根拠ラベル（ドキュメント不整合 / バグ / Injection / 認可漏れ 等）を必須化し、再現性と説明可能性を向上

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
