# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

各エントリには「何が変わったか」と「利用者に必要な対応」を書きます。設計判断の経緯は issue と `docs/` を参照してください。

## [2.0.0]

複数サイクルの並行実行、ファイル正への一本化、決定的な処理のスクリプト化を軸とした大規模改修。設計の経緯と判断理由は [issue #26](https://github.com/tak-solder/hikyaku/issues/26) に記録している。

### Added

- **CLOSE フェーズ（`/hikyaku:close-cycle`）**: 実装済みの成果を永続ドキュメントへ昇格させ、サイクルを締める。永続ドキュメントを書けるのはこのスキルだけになった（ADR の追記のみ architect が例外）
- **`/hikyaku:init`**: ワークスペースを初期化し、リポジトリ既存の設計ドキュメントを `document-guide.md` に登録する。v1 からの移行もここで行う
- **`/hikyaku:create-cycle`**: サイクルを作成する。`--profile` は必須で、config の値は推奨として提示するだけ
- **`document-guide.md`（必須）**: 永続ドキュメントの所在と管理主体を宣言する。**存在しなければ Hikyaku は動作しない**。管理列（`hikyaku` / `repo` / `未作成` / `対象外`）が「誰の持ち物か」を示し、`repo` なら既存形式が正で Hikyaku は追記しかしない
- **`cycles.md`（必須）**: サイクル索引。並行サイクル検出の起点で、`hikyaku` 列に作成時のバージョンを記録する
- **CLI（`scripts/hikyaku.mts`）**: 決定的な処理をすべてスクリプトへ移した。**Node v22.18.0 以上が必要**。実行時依存ゼロで、CI では clone するだけで動く
  - 書き込みコマンドはすべて `--dry-run` に対応。終了コードは `0` 成功 / `1` エラー / `2` 検証失敗
- **profile（express / economy / standard / thorough）**: 承認ゲートとレビューの量をサイクル単位で選べる。`cycles.md` に記録され、作成後は変わらない（→ [プロファイル](docs/configuration/profiles.md)）
  - G1（user-stories 承認）/ G6（tasklist 変更）/ G8（plan + test-spec）/ G10（永続ドキュメント昇格）はどの profile でも省略しない
  - `code_review` も全 profile で実行する。`security_review` の既定は `recommended` で、`off` にはしない
- **サイクル固有の設定（`{HIKYAKU_ROOT}/cycles/{NNN}-{slug}/.hikyaku.config`）**: そのサイクルだけキー単位で上書きする。`hikyaku_root` / `base_branch` / `[branch]` / `[pr]` / `[session]` / `[external]` / `profile` は指定するとエラーになる
- **`hikyaku context <phase> [<cycle>]`**: そのフェーズで読むべきドキュメントの候補を返す。フェーズ→論理名の対応はこのコマンドが唯一の正
- **ブランチ命名規則と `hikyaku branch verify`**: `{prefix}{separator}{cycle}{separator}{phase}`。今いるブランチを規則と突き合わせ、不一致なら期待する名前と切り替えコマンドを返す
- **`[session] title`**: セッション名のテンプレート。空文字なら変更しない
- **`.hikyaku.local`**: このチェックアウトで最後に作業したサイクルを記録する（git 管理対象外）。サイクル省略時の対象決定にだけ使う
- **外部システムへの親 issue**: サイクルに1つの親と、各ビルドの子を投影する。参照は作成後に自動で記録される（親は `cycles.md` の外部列、子は `tasklist.md` の issue 列）
- **`hikyaku external ref`**: PR 本文へ入れる参照行を返す（build-NN と close は `Closes`、他フェーズは `Refs`）
- **`hikyaku cycle link` / `hikyaku tasklist link`**: gh CLI が使えない環境で、スキルが MCP ツール経由で投影した参照を記録する
- **`[review.security].triggers`**: `security_review` を推奨する判定基準を自然言語で記述できる
- **`cycle-scanner` エージェント**: 走行中の他サイクルの設計差分を読み、重複を報告する（軽量モデル）
- **利用ドキュメント（`docs/`）**: Getting Started・概念・各フェーズ・設定リファレンス・運用ガイド・CLI リファレンス・移行ガイドを追加した。README.md は入口に縮小し、詳細は `docs/` を唯一の正とした

### Changed

- **スキルは HIKYAKU_ROOT を引数に取らなくなった**: `.hikyaku.config` から解決する。サイクルの指定も任意で、省略時は 現在のブランチ → `.hikyaku.local` → 唯一の進行中サイクル の順に決まる。決められないときはユーザーに尋ねる
- **設定を置ける場所をリポジトリルートとサイクルディレクトリの2箇所にした**: ルートの `.hikyaku.config` が必須になり、`{HIKYAKU_ROOT}/.hikyaku.config` は読み込まれない（残っているとエラー）
- **`create-cycle` から PLAN へそのまま続けられるようになった**: 既定は「続ける」。続ける場合は PLAN のブランチで作業し、PR を1本に畳む
- **gh CLI が無い場合も投影内容を返すようになった**: `reason: "gh-not-found"` とともに内容を出し、スキル側が GitHub MCP ツールで適用する
- **`tasklist.md` の `PR` 列を `[#12](URL)` 形式に整えるようになった**: 生の URL だと表が横に伸びるため。完了判定は「非空かどうか」の一点なので判定には影響しない
- **`{HIKYAKU_ROOT}/.gitignore` は `.hikyaku.local` の1行だけになった**: サイクル文書はすべてコミット対象になる。close-cycle が `retrospective.md` を昇格素材として読むため
- **サイクル構造**: `{HIKYAKU_ROOT}/cycles/{NNN}-{slug}/` にまとめ、永続ドキュメントは HIKYAKU_ROOT の外に置く
- **`DOC_ROOT` → `HIKYAKU_ROOT`**: 永続ドキュメントが外に出たため
- **状態を保存せず導出するようになった**: 保存するのは `cycles.md` の `status` 3値のみ。フェーズはファイルの存在、着手中はブランチの存在、完了は `tasklist.md` の `PR` 列から導出する
  - ビルドに `status` 列は無い。完了判定はデフォルトブランチの tree から読む（作業ツリーを見ると自分の PR 列が見えて誤判定するため）
- **architect が永続ドキュメントを書かなくなった**: 作るのは `design-delta.md` のみ。ADR だけが例外で `status: accepted` で追記する
- **builder が永続ドキュメントを書かなくなった**: 設計とのズレは `handoff.md` に記録し、close-cycle が昇格させる
- **全スキルが PR を作るようになった**: デフォルトブランチに入っていない情報は他サイクルから見えないため。フェーズ PR はドキュメントのみで、速やかにマージすることを想定する
- **成果物を1つ作るごとにコミット & push するようになった**: コミットされていないと中断検出が機能しないため
- **振り返りの改善提案に行き先ができた**: 分類が `doc:{論理名}` / `workflow` / `記録のみ` の3つになり、close-cycle が永続ドキュメントか `instructions.md` へ反映する。R-N は以後の取り決め、L-N は踏んだ地雷（`learnings` 行き）
- **`{HIKYAKU_ROOT}/instruction.md` → `instructions.md`**: `git mv` で改名するだけでよく、中身の変換は不要
- **`<SKILL_ROOT>` → `${CLAUDE_PLUGIN_ROOT}`**: 前者は公式の置換変数ではなかった
- **G4 の承認観点を「反映の正しさ」に限定した**: 技術選定は G3 で決着済みのため

### Removed

- **`issue_backend` の抽象化を廃止**: ファイルが常にマスターになり、外部システムへは `[external]` による冪等な片方向投影のみを行う。読み取りと完了判定は常にファイル
  - v1 では `github`/`asana` を選ぶと `build-*/` が丸ごと `.gitignore` され、リポジトリからビルドの中身が見えなくなっていた
- **G5（ビルド分割ドラフト承認）を廃止**: 外部システムでの issue 乱造を防ぐためのゲートだったため、ファイル正に変えた時点で理由が消えた
- **`tech-stack` / `db-schema` / `interfaces` を Hikyaku が作らなくなった**: 正はコード側（lockfile / マイグレーション / OpenAPI）にあり、写すと必ず腐るため。リポジトリにあれば参考として読むが、コードと矛盾したらコードを正とする
- **`test_spec_review` 設定を廃止**: G8（plan + test-spec の承認）として全 profile で常に有効になった

### Migration

**進行中のサイクルがある場合は、プラグインのバージョンを固定して完走してから移行してください。** `/hikyaku:init` が v1 構造を検出し、対話しながら移行します。手順は [v1 → v2 移行ガイド](docs/migration/v1-to-v2.md) にあります。

| 対応が必要なもの | 内容 |
|---|---|
| **Node.js** | v22.18.0 以上が必要になりました。`hikyaku doctor` で確認できます |
| **`doc_root`** | `hikyaku_root` へリネームしてください。当面は旧キーも読みます |
| **`issue_backend`** | **エラーになります。** `[external] target` へ移行してください。完了判定がライブ照会から `PR` 列に変わり挙動が変わるため、黙って読み替えることはしません |
| **`test_spec_review`** | 廃止されました。G8 として常に有効です |
| **ディレクトリ構造** | `planning/` `tasklist.md` `build-NN/` は `cycles/{NNN}-{slug}/` 配下へ移動します（`cycles/001-legacy/` へのアーカイブが第一候補） |
| **`architecture/` 配下** | 移動しません。`document-guide.md` に `repo` 管理として登録します |
| **`retrospective.md` 等** | コミット対象になります。v1 では `.gitignore` されていたため、サイクルをまたいで学びが蓄積しませんでした |
| **リポジトリルートの `.hikyaku.config`** | 必須になりました。`hikyaku_root` はここでのみ宣言できます |
| **`{HIKYAKU_ROOT}/.hikyaku.config`** | 読み込まれません。**残っているとエラーになります。** 内容をリポジトリルートへ移して削除してください |
| **`{HIKYAKU_ROOT}/instruction.md`** | `instructions.md` へ改名してください。`hikyaku validate` が旧名の残存を検出します |
| **スキルの引数** | `{HIKYAKU_ROOT}` を渡さなくなりました。`/hikyaku:planner 002-billing` のようにサイクルだけを渡すか、省略します |

移行の中心は「ファイルを動かすこと」ではなく、**既存ドキュメントを `document-guide.md` に `repo` 管理として登録すること**です。`AD-N` 形式の ADR もそのまま使い続けられ、形式変換は不要です。

`overview` が空の状態から始まるため、初回サイクルの architect は差分調査ができず全体調査になります（v1 と同じコスト）。初回の close-cycle で `overview` が作られ、2周目から差分調査が効きます。

## [1.0.0] - 2026-07-07

### Added

- **issue 保存先バックエンドの抽象化（`issue_backend`）**: `.hikyaku.config` に `file`（既定）/ `github` / `asana` を設定すると、各ビルドの issue.md / plan.md / handoff.md の記録先を切り替えられる
  - `github` では完了判定が sub-issue の open/close のライブ照会になり、PR マージ時の `Closes #N` で自動クローズされる
  - `tasklist.md` の buildID / title / BP / dependencies はどのバックエンドでもファイル管理のまま、依存関係判定の唯一の真実として維持する
  - `file` 以外では `build-*/` が丸ごと `.gitignore` の対象になる（外部レコードが正になるため、配下に残るファイルが無くなる）
  - `build-manager` がビルド記録 I/O 全般の唯一の窓口になった
- **中間成果物レビュー（`doc-reviewer`）**: `user_stories_review` / `architecture_review` / `plan_review`（既定いずれも `true`）に応じて、承認前の user-stories / architecture / plan をレビューする
  - `architecture` / `plan` ではセキュリティ設計の考慮漏れも報告対象に含む
- **DOC_ROOT レベルの config 上書き**: `{DOC_ROOT}/.hikyaku.config` で `doc_root` を除くキーをキー単位で上書きできる
- **プロジェクトディレクトリの自動初期化**: `/hikyaku:planner` の初回実行時に `{DOC_ROOT}/.gitignore` と `{DOC_ROOT}/.hikyaku.config` の雛形を冪等に生成する
- **`security-reviewer` の確度が低い懸念の報告**: 高感度カテゴリ（認証・認可、暗号、外部入力等）では、確定的な根拠が無くても具体箇所を指摘できる懸念を「確度: 要確認」ラベル付きで別枠報告する

### Removed

- **`security-reviewer` のエスカレーション判定を廃止**: `/security-review` への誘導をやめ、OWASP 系パターンの指摘に専念する。`/security-review` スキル自体は変更なく、任意のタイミングで実行できる

### Migration

- **破壊的変更**: `retrospective.md` / `test-spec.md` / `design-questions.md` / `build-{NN}/questions.md` が `.gitignore` の対象になり、以後コミットされません（`planning/questions.md` は architect の必須入力のため対象外）。既存のコミット履歴には影響しません
- `issue_backend` を設定しなければ `file` が既定となり、既存ワークフローの動作は変わりません
- `user_stories_review` / `architecture_review` / `plan_review` は既定 `true` のため、各承認前にレビューステップが挟まります。承認ラウンドは増えませんが、レビュー実行分のセッション消費が増えます
- builder からの `/security-review` 自動エスカレーションが無くなるため、セキュリティ感度の高い変更を扱う場合は実行タイミングを運用で決めてください
- 「確度が低い懸念」の報告により指摘件数が増える場合があります（重要度: 高/中/低とは別枠で提示されます）

## [0.8.1] - 2026-06-21

### Added

- **`test_spec_review` 設定オプション**: `false` にすると builder の test-spec.md 承認ゲートをスキップできる（既定: `true`）

### Migration

- 既存ワークフローへの影響はありません。未設定なら既定 `true` で従来の承認ゲートが維持されます

## [0.8.0] - 2026-06-07

### Added

- **`.hikyaku.config`（TOML）のサポート**: リポジトリルートに配置すると、スキル呼び出し時の引数省略や動作カスタマイズができる
  - `doc_root` — DOC_ROOT を固定し、各スキルの引数を省略可能にする
  - `base_branch` — PR のベースブランチ。未設定時は `git remote show origin` で自動検出する
  - `retrospective` — 振り返りを `prompt`（既定）/ `auto` / `skip` で制御する
  - `bp_max` — ビルド分割の BP 上限（既定: 8）
  - `code_review` / `security_review` — `false` で builder のレビューをスキップする（既定: `true`）

### Migration

- 既存ワークフローへの影響はありません。`.hikyaku.config` を作らなければすべて既定値です
- planner / architect / builder の `argument-hint` を `[{DOC_ROOT}]` に変更しました（引数がオプションであることの明示のみで、動作に影響はありません）

## [0.7.0] - 2026-05-20

### Added

- **企画フェーズの4項目サマリを永続化**: 「実現したいこと / 背景・目的 / 対象画面・対象データ / 制約・要件」を `planning/user-stories.md` の「## 概要」に記録する。会話表示のみで揮発していた合意内容を後段フェーズから参照できる
- **設計判断ログ（ADR）の新設**: `architecture/decisions.md` に、分岐ありと判定された判断を 決定 / 文脈 / 検討した案 / 採用理由 / トレードオフ の1エントリ（`AD-N`）として記録する
- **builder の判断追従**: builder が `architecture/decisions.md` を読み、採用案を意図せず覆さないようにした。覆す場合は新エントリの追記と handoff.md への記録を義務づける

### Migration

- 既存の `planning/`, `architecture/`, `build-NN/` の中身は変更不要です
- 作成済み `user-stories.md` への「## 概要」追記は任意です（新規ワークフローのみ義務）
- `decisions.md` は分岐ありの判断が出た時点で作成されます

## [0.6.0] - 2026-05-19

### Added

- **サブエージェント定義の新設**: `agents/` に `code-explorer` / `code-architect` / `code-reviewer` / `security-reviewer` を追加し、architect / builder から委任する
- **planner に「目的とスコープのすり合わせ」ステップを追加**: 質問ループの前に4項目を要約して認識を合わせる
- **architect の既存コード調査を並列化**: 規模に応じて `code-explorer` を複数起動し、返された Key Files はメインセッションが直接読む
- **architect に「主要設計判断の特定と分岐評価」を追加**: 代替案が複数ある判断で `code-architect` を2〜3並列起動し、trade-off 比較と推奨案提示を行う
- **builder に「コードレビュー」ステップを追加**: `code-reviewer` と `security-reviewer` を並列起動し、指摘ごとに「今修正 / 新ビルド化 / そのまま進める」を選べる
- **証拠ベースの判定ルール**: レビューの判定基準を数値しきい値から根拠の種類に変更し、各指摘に根拠ラベルを必須化した

### Migration

- 既存の `planning/`, `architecture/`, `build-NN/` の中身は変更不要です
- ステップ番号の変更はスキル内部の参照のため、対応は不要です

## [0.5.1] - 2026-05-11

### Added

- `.claude-plugin/plugin.json` に `license` フィールド（MIT）を追加

### Changed

- **BP 閾値を統一**: 複数ファイルに分散していた値を「分割推奨: 合計 BP 6以上 / 分割必須: 9以上」に揃えた。互換性への影響なし
- **設計フェーズの承認順序を変更**: 設計ドキュメントの承認を先に、ビルド分割を後にした
- builder に「後続ビルドのセッションは PR マージ後に開始する」注記を追加

### Fixed

- planner の description の typo を修正
- ディレクトリ構造例のインデントを揃えた

## [0.5.0] - 2026-05-11

### Changed

- **BREAKING**: Claude Code プラグイン形式に対応し、`claude plugin install hikyaku@hikyaku` で導入できるようにした
- **BREAKING**: スキル名から `hikyaku-` プレフィックスを除去した（プラグインの名前空間機能と統合）
  - `/hikyaku-planner` → `/hikyaku:planner`、`/hikyaku-architect` → `/hikyaku:architect`、`/hikyaku-builder` → `/hikyaku:builder`
  - 内部スキル: `hikyaku-build-manager` → `build-manager`、`hikyaku-retrospective` → `retrospective`

### Migration

- 0.4.x のスタンドアロン構成を使っている場合は、`.claude/skills/` から旧 `hikyaku-*` スキルを削除し、プラグインを導入し直してください
- 既存の `{DOC_ROOT}/` 配下のドキュメントは変更不要です

## [0.4.1] - 2026-04-12

### Changed

- **リトライポリシーの判定基準を変更**: 「根本原因ベース」から「同一ファイルへの修正回数ベース」にした。AI が原因の変化を自己判断してカウントをリセットし、コンテキストを浪費する問題を防ぐ

## [0.4.0] - 2026-04-11

### Changed

- **全スキルの作業ステップをチェックボックス形式に再構成**: 完了条件を明確にし、手順のスキップを防ぐ (#16)
- 全スキルに Step 0（ファイル読み込み）を追加し、テンプレートの読み込み漏れを防いだ
- 承認ステップを作成ステップに統合し、フィードバックループを明確にした
- mermaid フローチャートと冗長なリストを削除し、全体で約185行削減した
- plan.md テンプレートに BP 見積もりセクション、tasklist.md テンプレートに builder 呼び出しコマンドを追加

## [0.3.0] - 2026-04-06

### Added

- `hikyaku-build-manager` スキル: ビルドの追加・更新・分割と依存グラフ管理を一元化 (#11)
- `hikyaku-retrospective` スキル: 各フェーズ末の振り返りを独立したスキルにした (#12)
- BP 見積もりに影響ファイル数の加算要素を追加 (#11)

### Changed

- builder の plan.md と test-spec.md の承認ステップを分離した (#13)
- issue.md の重複を除き、handoff.md との棲み分けを明確にした (#13)
- テンプレートのヘッダー例から `#` を除去し、二重見出しを防いだ (#12)

## [0.2.1] - 2026-03-28

### Changed

- **ビルド分割時のリナンバリングを不要にした**: 末尾追加 + 依存グラフ方式へ変更 (#10)

## [0.2.0] - 2026-03-24

### Changed

- builder の承認ステップを統合した（plan.md + test-spec.md の一括承認） (#9)

### Fixed

- `copilot-instruction.md` を `copilot-instructions.md` に修正 (#8)

## [0.1.2] - 2026-03-21

### Added

- スキルバージョン更新時にタグを自動作成する CI (#6, #7)
- スキルバージョンの統一性を検証する CI (#5)
- `copilot-instructions.md` (#6)
- `instruction.md` によるワークフロー固有インストラクションのサポート

### Changed

- **用語を統一**: タスク → ビルド、プロジェクト → ワークフロー/リポジトリ、SP → BP (#3)
- Agent Skills 仕様に準拠（frontmatter の改善、`references/` の整理） (#3, #4)
- BP 見積もりの精度を改善（API 閾値の調整、加算要素チェックの必須化） (#2)
- builder の buildID 引数をオプションにした（省略時は next） (#3)
- retry-policy に同一原因の判定基準を追加 (#1)

## [0.1.0] - 2026-03-18

### Added

- 初期リリース: `hikyaku-planner`, `hikyaku-architect`, `hikyaku-builder` の3スキル
