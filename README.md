# Hikyaku (飛脚)

Hikyaku は **PLAN → ARCHITECT → BUILD → CLOSE の4フェーズ**で構成される、AIエージェント協働開発ワークフローです。Claude Code のプラグインとして配布され、Agent Skills の仕様に準拠しています。

## 特徴

- **複数サイクルの並行実行** — 1リポジトリで複数のライン（サイクル）を同時に回せる
- **セッション分離** — 各フェーズは別の AI セッションが担当し、コンテキストウィンドウを効率的に使う
- **永続ドキュメントとサイクルドキュメントの分離** — 「実装済みの現実」と「これから作るもの」を混ぜない
- **リポジトリがマスター** — issue も設計判断もリポジトリ側に置き、外部システムへは片方向で投影するだけ
- **決定的な状態管理** — 状態は保存せず、ファイル・ブランチ・PR 列から導出する
- **プロファイル** — 承認ゲートとレビューの量をサイクルごとに選べる

## インストール

```bash
claude plugin marketplace add tak-solder/hikyaku
claude plugin install hikyaku@hikyaku
```

ローカルチェックアウトから試す場合:

```bash
claude --plugin-dir /path/to/hikyaku
```

インストール後はスキルが `/hikyaku:planner` のように **`hikyaku:` 名前空間付き**で呼び出せます。

### 動作要件

**Node.js v22.18.0 以上。** スクリプトは TypeScript のまま Node で直接実行します（型剥がしがフラグ無しで有効になる最小バージョンが v22.18.0 です）。実行時依存はゼロで、`npm install` もビルドも不要です。

環境の確認:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" doctor
```

## ワークフロー

```
/hikyaku:init            → ワークスペースを初期化（リポジトリにつき1回）
      ↓
/hikyaku:create-cycle    → サイクルを作成し profile を選択
      ↓
/hikyaku:planner         → planning/ を生成
      ↓
/hikyaku:architect       → design/ + tasklist.md + build-NN/issue.md を生成
      ↓
/hikyaku:builder         → build-01 を実装 → PR
/hikyaku:builder         → build-02 を実装 → PR   （依存が無ければ並行実行可）
      ↓
/hikyaku:close-cycle     → 永続ドキュメントへ昇格し、サイクルを closed に
```

`init` と `create-cycle` は明示的に制御したいときの入口で、**planner が必要に応じて代行します**。実質の最短経路は4フェーズです。

### Phase 1: `/hikyaku:planner` — 企画

チケットと既存の企画メモを読み込み、そのサイクルのユーザーストーリーとして構造化します。

- 不足・曖昧・矛盾する点を質問ループで解消
- **成果物**: `planning/questions.md`, `planning/user-stories.md`

### Phase 2: `/hikyaku:architect` — 設計

企画成果物と既存コードを入力に、**このサイクルの設計差分**とビルド分割を行います。

- 他に走行中のサイクルがあれば `cycle-scanner` で重複を検出
- `overview` がある場合、既存コード調査は**差分だけ**を行う（2周目以降のコストが下がる）
- 分岐評価で trade-off が非自明な判断は ADR に記録（`status: accepted`）
- **永続ドキュメントは書き換えない。** 作るのは `design-delta.md`
- **成果物**: `design/`, `tasklist.md`, `build-{NN}/issue.md`

### Phase 3: `/hikyaku:builder` — 実装

1ビルド = 1セッションでコード実装から PR 作成までを完結させます。

- 依存関係のないビルドは**並行実行できる**
- **永続ドキュメントは書き換えない。** 昇格が必要な内容は `handoff.md` に記録する
- **成果物**: 実装コード, `plan.md`, `test-spec.md`, `handoff.md`, PR

### Phase 4: `/hikyaku:close-cycle` — サイクル終了

実装済みの成果を**永続ドキュメントへ昇格**させ、サイクルを締めます。

- `handoff.md` / `retrospective.md` から昇格候補を抽出（サブエージェントに委任）
- 昇格内容の取捨選択はユーザーが承認する
- ADR の `status` を `accepted` → `implemented` に更新
- **成果物**: 永続ドキュメントの更新, `cycles.md` の更新, PR

## ディレクトリ構造

```
リポジトリルート/
├── .hikyaku.config            # 振る舞いの設定（ドキュメントの所在は含まない）
├── AGENTS.md                  # 永続ドキュメントの索引ブロックが埋め込まれる
├── docs/                      # 永続ドキュメント（所在はリポジトリ規約に従う）
│   ├── overview.md
│   ├── constraints.md
│   ├── learnings.md
│   └── adr/
└── docs/hikyaku/              # HIKYAKU_ROOT
    ├── .hikyaku.config        # このワークフロー固有の上書き（任意）
    ├── document-guide.md      # 永続ドキュメントの所在を宣言（必須）
    ├── cycles.md              # サイクル索引（必須）
    ├── instruction.md         # ワークフロー独自の指示（任意）
    └── cycles/
        ├── 001-user-auth/
        │   ├── planning/      # questions.md, user-stories.md
        │   ├── design/        # design-delta.md, codebase-survey.md, design-questions.md
        │   ├── tasklist.md
        │   ├── build-01/      # issue.md, plan.md, test-spec.md, handoff.md
        │   └── build-02/
        └── 002-billing/
```

**永続ドキュメントは HIKYAKU_ROOT の外**にあり、リポジトリ側の規約に従った場所に置きます。所在は `document-guide.md` が宣言します。

## 設計の考え方

### 永続ドキュメントは「コピーではなくポインタ」を持つ

何を書くかは **復元コスト ÷ 陳腐化速度** で決めます。

| | 復元コスト | 陳腐化速度 | 判定 |
|---|---|---|---|
| DBスキーマの全テーブル定義 | 低（マイグレーションを読めばよい） | 速い | **書かない** |
| 責務・境界・データフロー | 極めて高い（全ファイルを読んで推論） | 遅い | **書く** |

`overview` に「主要テーブル: users, orders」と書くと腐り、しかも腐っていることに誰も気づけません。「スキーマの正は `db/migrations/`」というポインタなら腐らず、**パスが消えれば `hikyaku validate` が検出できます**。

そのため `tech-stack` / `db-schema` / `interfaces` は Hikyaku が作りません。リポジトリにあれば読みますが、コードと矛盾したら常にコードを正とします。

### 状態は保存せず導出する

保存するのは `cycles.md` の `status`（`active` / `closed` / `abandoned`）だけです。これはサイクルの生涯で2回しか変わりません。

| 知りたいこと | 導出方法 |
|---|---|
| フェーズ（planning / architecting / building / completed） | ファイルの存在 |
| ビルドが着手中か | ブランチの存在（`git ls-remote`） |
| ビルドが完了したか | `tasklist.md` の `PR` 列が非空 |
| どこで中断したか | ブランチ上の成果物の有無 |

重複した状態は必ず腐り、しかも腐っていることに気づけないためです。

### 承認ゲートは「確認」と「同意」を分ける

profile で省略できるのは**確認**だけです。次の2つは**人間にしか下せない判断**なので、どのプロファイルでも省略しません。

- **設計案の選択**（architect）— トレードオフの選択
- **永続ドキュメント昇格の承認**（close-cycle）— 何を昇格させるかの取捨選択

## 設定ファイル（`.hikyaku.config`）

TOML 形式。すべての項目がオプションです。**ドキュメントの所在は含みません**（`document-guide.md` が唯一の宣言先）。

設定は2階層あり、**HIKYAKU_ROOT 側がリポジトリルート側をキー単位で上書き**します（`hikyaku_root` を除く）。

```toml
hikyaku_root = "docs/hikyaku"   # リポジトリルートでのみ有効

# サイクル作成時に提示する profile の既定値。
# 無条件には採用されず、create-cycle が必ず明示的な選択を求めます。
profile = "standard"

base_branch = "main"            # 未設定ならデフォルトブランチを自動検出
bp_max = 8

[branch]
# ブランチ名は {prefix}{separator}{cycle}{separator}{phase} で構成します。
# 着手状態の導出にブランチ名を解析するため、構造は固定です。
prefix = "hikyaku"
separator = "/"                 # 空文字は不可（解析できなくなるため）

[pr]
# PR タイトルは表示専用なので自由に組み立てられます。
# 変数: {cycle} {cycle_id} {cycle_name} {phase} {build_id} {title}
title = "[hikyaku] {cycle}: {phase} {title}"

[review.security]
# security_review を推奨する判定基準。設定すると既定値を丸ごと置き換えます。
# 機微情報の定義はプロダクトごとに異なるため、自然言語で記述します。
triggers = """
- 個人情報・秘密情報を扱う
- 認証・認可
- 決済
- このプロダクト固有: 診療記録テーブルに触れる変更
"""

[external]
target = "none"                 # none | github | asana
# github_repo = "owner/repo"
# asana_project_gid = "..."
```

## プロファイル

profile は**サイクルの属性**です。`create-cycle` で必ず明示的に選択し、`cycles.md` に記録されます。

|  | 人間の承認回数 | AIレビュー |
|---|---|---|
| **light** | **少** | 有 |
| **saving** | 多 | **無** |
| **standard** | 多 | 有 |
| **strict** | 最多 | 全部 |

- **light** = 人間の時間を節約する（承認は減らすが AI には見させる）
- **saving** = AI 実行コストを節約する（サブエージェントを起動しないが人間は見る）

「承認少 + レビュー無」の組み合わせは意図的に用意していません。

### 承認ゲート

| # | フェーズ | ゲート | light | saving | standard | strict |
|---|---|---|---|---|---|---|
| G1 | planner | user-stories 承認 | ✗ | ✓ | ✓ | ✓ |
| G2 | architect | codebase-survey 確認 | ✗ | ✗ | ✗ | ✓ |
| G3 | architect | **設計案の選択** | ✓ | ✓ | ✓ | ✓ |
| G4 | architect | 設計ドキュメント承認 | ✗ | ✓ | ✓ | ✓ |
| G6 | build-manager | tasklist / issue 変更承認 | ✓ | ✓ | ✓ | ✓ |
| G7 | builder | plan 単独の承認 | ✗ | ✗ | ✗ | ✓ |
| G8 | builder | plan + test-spec 承認 | ✓ | ✓ | ✓ | ✓ |
| G10 | close-cycle | **永続ドキュメント昇格の承認** | ✓ | ✓ | ✓ | ✓ |

### レビュー

| レビュー | light | saving | standard | strict |
|---|---|---|---|---|
| user_stories_review | ✓ | ✗ | ✓ | ✓ |
| architecture_review | ✓ | ✗ | ✓ | ✓ |
| plan_review | ✓ | ✗ | ✓ | ✓ |
| code_review | ✓ | ✓ | ✓ | ✓ |
| security_review | off | off | 推奨時のみ確認 | on |
| retrospective | skip | skip | prompt | auto |
| validate | 手動のみ | 手動のみ | 各フェーズ末 | 各ステップ |

個別キー（`architecture_gate`, `plan_review` など）で profile の既定値を上書きできます。

## CLI

決定的な処理はすべてスクリプトが担います。`hikyaku help` が使い方を持つため、SKILL.md には「いつ、なぜ使うか」だけを書きます。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" <command> [--root <path>] [--json] [--dry-run]
```

```
doctor / config / version / init / help
next / validate
docs      list / validate / link / scaffold
cycle     new / list / status / close
tasklist  read / add / update / done
branch    name
pr        title
external  sync
```

- **書き込みコマンドはすべて `--dry-run` に対応**します。承認は常に呼び出し元のスキルが取り、スクリプトは「何が起きるか」を返す責務だけを持ちます
- 終了コード: `0` 成功 / `1` エラー / `2` 検証失敗

### CI での利用

実行時依存がゼロなので、clone するだけで動きます。

```yaml
- run: |
    git clone --depth 1 --branch v2.0.0 https://github.com/tak-solder/hikyaku /tmp/hikyaku
    node /tmp/hikyaku/scripts/hikyaku.mts validate
```

スキル内の `validate` は Hikyaku が書いたものしか見ませんが、CI から呼べば人間が手で編集した内容の不整合も拾えます。

## ビルドポイント（BP）

BP は、AIエージェントとの1セッション（20万トークン目安）で実装が完了するかを判断する定量指標です。

| BP | 判定 |
|----|------|
| 1〜5 | 1セッションで完結見込み |
| 6〜8 | 分割推奨（分割コストが大きい場合のみ許容） |
| 9〜 | 分割必須 |

詳細は `skills/build-manager/references/bp-guide.md` を参照してください。

## 内部スキル

ユーザーが直接呼び出すものではなく、各フェーズのスキルが自動的に呼び出します。

- **`build-manager`** — BP見積もりと分割単位の判断、issue.md の作成、承認。tasklist.md の更新はスクリプトが行う
- **`retrospective`** — 振り返り。Hikyaku スキルへの改善提案と、リポジトリ固有の学び（close-cycle が `learnings` へ昇格させる）を分けて記録する

## エージェント

| エージェント | 用途 |
|---|---|
| `code-explorer` | 既存コード調査。`overview` が渡されると差分調査に切り替わる |
| `cycle-scanner` | 走行中の他サイクルの設計差分を読み、重複を報告する（軽量モデル） |
| `code-architect` | 指定観点の単一設計案を返す |
| `code-reviewer` | スコープ・規約・バグ・冗長性を証拠ベースで報告 |
| `security-reviewer` | OWASP 系のセキュリティ指摘 |
| `doc-reviewer` | 中間成果物の整合性・網羅性を証拠ベースで報告 |

## インストラクションの優先順位

1. **リポジトリ全体のインストラクション**（AGENTS.md, CLAUDE.md 等）
2. **ワークフロー用インストラクション**（`{HIKYAKU_ROOT}/instruction.md`）
3. **スキルの説明**（各 SKILL.md）

## プラグイン構成

```
./
├── .claude-plugin/
│   ├── plugin.json            # プラグインマニフェスト
│   └── marketplace.json       # マーケットプレイス定義
├── agents/                    # サブエージェント定義
├── scripts/                   # CLI（TypeScript を Node で直接実行、実行時依存ゼロ）
│   ├── hikyaku.mts
│   ├── lib/
│   └── commands/
└── skills/
    ├── init/                  # /hikyaku:init
    ├── create-cycle/          # /hikyaku:create-cycle
    ├── planner/               # /hikyaku:planner
    ├── architect/             # /hikyaku:architect
    ├── builder/               # /hikyaku:builder
    ├── close-cycle/           # /hikyaku:close-cycle
    ├── build-manager/         # 内部スキル
    └── retrospective/         # 内部スキル
```

## v1 からの移行

`/hikyaku:init` が v1 構造を検出し、**対話しながら**移行します。v1 ユーザーの状態は多様で、一律のルールでは捌けないためです。

移行の中心は「ファイルを動かすこと」ではなく「**既存ドキュメントを `document-guide.md` に `repo` 管理として登録すること**」です。これにより `AD-N` 形式の ADR もそのまま使い続けられ、形式変換は不要になります。

**進行中のサイクルがある場合は、プラグインのバージョンを固定して完走してから移行してください。**

破壊的変更の一覧は [CHANGELOG.md](CHANGELOG.md) を参照してください。
