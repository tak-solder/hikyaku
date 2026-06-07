---
name: builder
description: "Hikyaku 実装フェーズ: 設計フェーズや依存する実装フェーズの成果物を入力として、実装計画・コード生成・検証・PR作成を出力する。"
compatibility: "Requires git and gh CLI."
user-invocable: true
disable-model-invocation: true
argument-hint: "[{DOC_ROOT}] [buildID|next]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "0.8.0"
---

# Hikyaku Builder

`$ARGUMENTS[0]` のワークフローパスから企画・設計ドキュメントを読み込み、実装フェーズを実行する。`$ARGUMENTS[1]` で buildID を指定できる（省略時は次のビルドを自動選択）。

## Hikyaku ワークフロー概要

Hikyakuは PLAN → ARCHITECT → BUILD の3フェーズで構成されるAIエージェント協働開発ワークフロー。

- 各フェーズは **別セッション（＝別のAI）** が担当する
   - フェーズごとに1セッション（20万トークン）が目安
- BUILDセッションは設計ドキュメント（architecture/）と、先行ビルドの申し送り（handoff.md）を読んでコンテキストを復元する
- 1ビルド＝1セッションで完結させる
- セッション間の情報引き継ぎはファイル（planning/, architecture/, handoff.md）で行う

### 全体フロー

```
/hikyaku:planner   → planning/ を生成（完了済み）
      ↓
/hikyaku:architect → architecture/ + tasklist.md + build-{NN}/issue.md を生成（完了済み）
      ↓
/hikyaku:builder   → build-01/ を実装 → handoff.md → PR
/hikyaku:builder   → build-02/ を実装 → handoff.md → PR  ← あなたはここ
  ...（ビルド数分繰り返し）
```

### ワークフローディレクトリ構造

```
$ARGUMENTS[0]/
├── tasklist.md               # ビルド一覧（ARCHITECT で作成済み、BUILD で PR列を更新）
├── planning/                  # 企画ドキュメント（PLAN で作成済み、参照のみ）
│   ├── questions.md           # 企画段階の質問と回答
│   ├── user-stories.md        # ユーザーストーリー
│   └── retrospective.md      # 振り返り（PLAN で作成）
├── architecture/              # 設計ドキュメント（ARCHITECT で作成済み、実装時に差分があれば更新）
│   ├── codebase-survey.md     # 既存コード調査結果（任意）
│   ├── design-questions.md    # 設計段階の質問と回答
│   ├── decisions.md           # 設計判断ログ（ADR、任意）
│   ├── tech-stack.md          # 技術選択（任意）
│   ├── db-schema.md           # DBスキーマ（任意）
│   ├── interfaces.md          # インターフェース定義（任意）
│   ├── conventions.md         # 共通規約（任意）
│   └── retrospective.md      # 振り返り（ARCHITECT で作成）
├── build-01/                  # 完了済みビルド
│   ├── issue.md               # ビルド定義（ARCHITECT で作成済み）
│   ├── plan.md                # 実装計画
│   ├── test-spec.md           # テストシナリオ
│   ├── handoff.md             # 申し送り → 後続ビルドが参照
│   └── retrospective.md      # 振り返り
├── build-02/                  # ← これから作業するビルド
│   ├── issue.md               # ビルド定義（ARCHITECT で作成済み）
│   ├── plan.md                # ← BUILD で作成
│   ├── test-spec.md           # ← BUILD で作成（テストシナリオ）
│   ├── questions.md           # （必要時のみ）
│   ├── handoff.md             # ← BUILD で作成
│   └── retrospective.md      # ← BUILD で作成
└── ...
```

### あなたの役割（実装フェーズ）

あなたは実装フェーズの1ビルドを担当する。企画・設計は別セッションで完了済み。
設計ドキュメント（architecture/）と先行ビルドの handoff.md を読んでコンテキストを復元し、実装→検証→申し送り→PRまでを完結させる。

**やらないこと:**
- 企画内容の変更（スコープ変更・優先度変更）
- 担当ビルド外のコード変更
- build-manager を通さずにビルドのスコープを直接変更すること

**設計ドキュメントの更新について:**
- 実装中に planning/ や architecture/ の内容と異なる判断が必要になった場合は、該当ドキュメントを直接更新する（ソースオブトゥルースを1箇所に保つ）

## 作業ステップ

### Step 0: ファイルの読み込みと設定の解決

作業の開始前に必ず以下を実行する。

- [ ] `<SKILL_ROOT>/references/templates.md`: 各種成果物のテンプレート（必須）
- [ ] `<SKILL_ROOT>/references/retry-policy.md`: エラー発生時のリトライ方針（必須）
- [ ] リポジトリルートの `.hikyaku.config` を読み込む（存在する場合のみ）
- [ ] **DOC_ROOT を決定する**
  - `$ARGUMENTS[0]` が指定されている場合 → その値を DOC_ROOT として使用する
  - `$ARGUMENTS[0]` が未指定で `.hikyaku.config` に `doc_root` が設定されている場合 → その値を DOC_ROOT として使用する
  - どちらも未設定の場合 → ユーザーに DOC_ROOT の指定を求めて終了する
- [ ] **BASE_BRANCH を決定する**
  - `.hikyaku.config` に `base_branch` が設定されている場合 → `origin/{base_branch}` を使用する
  - 未設定の場合 → `git remote show origin | grep 'HEAD branch'` でデフォルトブランチを検出し、`origin/{branch}` 形式で使用する
- [ ] **設定値のデフォルトを確認する**（`.hikyaku.config` で未設定の場合はデフォルト値を使用する）
  - `code_review`: デフォルト `true`
  - `security_review`: デフォルト `true`
- [ ] `{DOC_ROOT}/instruction.md`: ワークフロー独自のインストラクション（存在する場合のみ）

以降のステップでは DOC_ROOT を `$ARGUMENTS[0]` の代わりに、BASE_BRANCH を `origin/main` の代わりに使用する。

なお、インストラクションは次の優先順で適用する。上位の指示が下位と矛盾する場合は、上位を優先すること。

1. リポジトリ全体のインストラクション（AGENTS.md, CLAUDE.md 等）
2. ワークフロー独自のインストラクション
3. このスキルの説明（SKILL.md）

→ すべて読み込めたら Step 1 へ。必須ファイルが読み込めなかった場合はユーザーに報告して終了。

### Step 1: 対象ビルドの特定

- [ ] `$ARGUMENTS[0]/tasklist.md` を読み込む
- [ ] 対象ビルドの buildID を特定する
  - `$ARGUMENTS[1]` が数値の場合: 該当する buildID のビルドを対象とする
  - `$ARGUMENTS[1]` が省略または `next` の場合: PR列が空かつ、依存ビルド（dependencies列）のPR列がすべて埋まっているビルドの中から、最小のbuildIDを選択する
- [ ] 対象ビルドの依存ビルド（dependencies列）のPR列がすべて埋まっていることを確認する

**注意:** buildID の数値順は実行順序と一致しない場合がある（ビルド分割により後から追加されたビルドが、数値上は大きいが依存グラフ上は先に実行すべきケースがある）。必ず dependencies 列に基づいて判断すること。

→ すべて完了したら Step 2 へ。対象ビルドが見つからない、または依存ビルドが未完了の場合はユーザーに報告して終了。

### Step 2: コンテキスト復元

以下の順でドキュメントを読み込む:

- [ ] `$ARGUMENTS[0]/build-{NN}/issue.md` — 対象ビルドの定義（やること/やらないこと/受け入れ基準）
- [ ] `$ARGUMENTS[0]/build-{NN}/` に既存の成果物（plan.md, test-spec.md, handoff.md 等）がないか確認する
  - 存在する場合は過去のセッションで作業が途中まで進んでいるため、内容を読み込んで途中から再開する
- [ ] `$ARGUMENTS[0]/architecture/codebase-survey.md` — 既存コードの構成・規約・拡張ポイント（存在する場合）
- [ ] `$ARGUMENTS[0]/architecture/decisions.md` — 設計判断ログ（存在する場合）
  - 採用理由とトレードオフを把握し、実装中に判断を覆さないようにする
  - 覆す必要が生じた場合は新しい AD エントリを `decisions.md` に追記し、さらに `$ARGUMENTS[0]/build-{NN}/handoff.md` にも記録する
    - 記録項目: **覆した AD 番号** / **覆した理由** / **影響範囲（変更したコンポーネント・後続ビルドへの波及）**
- [ ] `$ARGUMENTS[0]/architecture/` — その他の関連する設計ドキュメントを参照
- [ ] 依存ビルドの `$ARGUMENTS[0]/build-{NN}/handoff.md` を読み込む
  - **直接依存するビルドの handoff.md のみ** 読み込む（全ビルド分は読まない）

→ すべて読み込めたら Step 3 へ。

### Step 3: ブランチ作成

- [ ] ビルド用のブランチを作成する

→ Step 4 へ。

### Step 4: 実装計画の作成と承認

- [ ] 実装計画を作成するにあたっての確認点や不明点がある場合は `$ARGUMENTS[0]/build-{NN}/questions.md` でユーザーに質問する
- [ ] すべての確認点や不明点が解消でき、ユーザーとすり合わせが出来たら `$ARGUMENTS[0]/build-{NN}/plan.md` を作成する
    - `NN`は buildID をゼロ埋め2桁にしたもの（例: buildID 3 → build-03）
    - テンプレートは [templates.md](references/templates.md) の「plan.md（実装計画）」を使用する
    - **plan.md に含めるもの:** 依存パッケージの選定、クラス設計（メソッドシグネチャ）、セキュリティ等の非機能要件
    - **plan.md に含めないもの:** 詳細な実装コード、テストコードの実装方法
- [ ] plan.md の内容をユーザーに提示し、承認を得る

→ 承認を得たら Step 5 へ。フィードバックがあれば plan.md に反映し、Step 4 の承認からやり直す。

### Step 5: テストシナリオ作成と承認

テストケースの洗い出し過程のコンテキスト消費を避けるため、メインセッションでは直接作成しない。

- [ ] **Agent に委任して** `$ARGUMENTS[0]/build-{NN}/test-spec.md` を生成させる
  - Agent に渡す情報: `plan.md`, `issue.md`, `architecture/` 配下の関連ドキュメント
  - Agent に渡すプロンプトに以下のフォーマット指定を必ず含めること
  - **承認時のユーザーの関心:** 受け入れ基準の網羅性、正常系・異常系・境界値のカバー範囲、不要・過剰なテストの有無

Agent に渡すフォーマット指定:

````
## フォーマット（必ず従うこと）

```markdown
# Build {NN}: {ビルド名} テストシナリオ

## {テスト対象クラス/モジュール名}

### {メソッド名}: {シナリオ名}
- Given: （前提条件）
- When: （操作）
- Then: （期待結果）
```

**記載ガイドライン:**
- 正常系・異常系・境界値を網羅する
- Given/When/Then は具体的な値を含める（例: `Given: メールアドレス "user@example.com" のユーザーが登録済み`）
- 1シナリオ = 1つの検証観点に絞る。表形式は使わないこと
````
- [ ] 生成された test-spec.md の内容を確認し、ユーザーに提示して承認を得る

→ 承認を得たら Step 6 へ。フィードバックがあれば test-spec.md に反映し、Step 5 の承認からやり直す。

### Step 6: コード生成

- [ ] plan.md の実装ステップに沿って実装する（実装ステップのチェックボックスを完了ごとに更新する）
- [ ] test-spec.md のシナリオに基づいてテストコードを生成する

→ Step 7 へ。

### Step 7: ローカル検証

**全ての項目がパスするまで Push しない。**

- [ ] リポジトリの規約に従い品質管理を実行する（lint, test, build 等）
- [ ] エラーがあれば修正して再実行する
  - [retry-policy.md](references/retry-policy.md) の試行回数上限に従う
  - 上限に達したらユーザーに報告して判断を仰ぐ
- [ ] すべての品質管理項目がパスしたことを確認する

→ Step 8 へ。

### Step 8: コードレビュー

機械的検証（lint / test / build）だけでは検出できない品質・規約・セキュリティ観点をレビューする。スコープ逸脱や規約違反、セキュリティ問題を申し送り作成前に潰す。

- [ ] `code_review` が `false` の場合はこのステップをスキップして Step 9 へ
- [ ] **`code-reviewer` と `security-reviewer` を並列起動する**（`security_review` が `false` の場合は `code-reviewer` のみ起動する）
  - 起動するエージェントに渡す情報: 対象ビルドのパス（`{DOC_ROOT}/build-{NN}/`）、`{DOC_ROOT}/build-{NN}/plan.md`, `{DOC_ROOT}/build-{NN}/issue.md`, `{DOC_ROOT}/architecture/conventions.md`（あれば）, `{DOC_ROOT}/architecture/codebase-survey.md`（あれば）
  - 各エージェントは以下のコマンドすべてで当該ブランチの変更を確認する（未追跡・staged・unstaged・コミット済みを漏らさないため）:
    - `git status` — 変更ファイル一覧（未追跡含む）
    - `git diff` — unstaged 差分
    - `git diff --cached` — staged 差分
    - `git diff $(git merge-base {BASE_BRANCH} HEAD)..HEAD` — base ブランチ（Step 0 で解決した BASE_BRANCH）からの **コミット済み差分**。再開セッションや途中コミットを含むビルドではこの差分にしか実装が現れない
    - 新規追加ファイル（未追跡）は Read tool で内容を読む
  - 担当範囲:
    - `code-reviewer`: スコープ準拠 / 規約準拠 / バグ・ロジック誤り / 冗長性
    - `security-reviewer`: OWASP 系のセキュリティパターン違反、および `/security-review` へのエスカレーション判定
  - 各エージェントは **証拠ベースの判定** で報告対象を絞る。出力フォーマットは `agents/code-reviewer.md` および `agents/security-reviewer.md` を参照
- [ ] 両エージェントから返ってきた指摘をメインセッションで統合する
  - 同一箇所への重複指摘は1件に統合し、`security-reviewer` の指摘を優先採用する
  - 各指摘の **根拠ラベル**（ドキュメント不整合 / バグ / Injection / 認可漏れ など）はそのまま残す
- [ ] 統合した指摘をユーザーに提示し、以下の選択肢で対応を決める
  - **今修正する** — 該当箇所を修正し、Step 7（ローカル検証）に戻る
  - **新ビルド化して後で対応** — `/hikyaku:build-manager $ARGUMENTS[0]` を呼び出して新ビルドを追加する。現在のビルドはそのまま進める
  - **そのまま進める** — 指摘を handoff.md の「既知の制約・注意点」に記録した上で次のステップへ
- [ ] **エスカレーション判定の処理**
  - `security-reviewer` のエスカレーション判定が「**推奨**」の場合、指摘一覧の最後に以下を提示する:

    ```
    ⚠️ security-reviewer は本ビルドを「セキュリティ感度の高い変更」と判定しました
    該当カテゴリ: （security-reviewer の出力をそのまま転記）
    より深い監査のため、Step 9（申し送り作成）に進む前に `/security-review` の実行を強く推奨します。
    ```
  - ユーザーに「**Step 9 に進む前に `/security-review` を実行するか**」を確認する
    - 実行する場合: ユーザーが別途 `/security-review` を実行する（builder からは自動起動しない）。完了したらユーザーが手動で本セッションに戻り、Step 9 へ進む
    - 実行しない場合: handoff.md の「既知の制約・注意点」に「security-reviewer がエスカレーションを推奨したが /security-review を実行せずに完了」と記録する
  - エスカレーション判定が「不要」の場合は、この処理をスキップして Step 9 へ進む
- [ ] 両エージェントが「指摘なし」かつエスカレーション判定が「不要」の場合は、そのまま Step 9 へ進む

→ ユーザー選択に応じて対応後、Step 9 へ。

### Step 9: 申し送り作成

- [ ] 実装中に planning/ や architecture/ と異なる判断をした場合は、該当する設計ドキュメントを直接更新する
  - 設計ドキュメントがソースオブトゥルースであり、handoff.md には設計ドキュメントに収まらない実装固有の文脈のみ残す
- [ ] `$ARGUMENTS[0]/build-{NN}/handoff.md` を作成する
  - テンプレートは [templates.md](references/templates.md) の「handoff.md（申し送り）」を使用する
  - 後続ビルドがコンテキストを復元するため、以下を正確に記録する:
    - 公開インターフェース — architecture/interfaces.md に反映済みの内容は省略し、差分・補足のみ
    - 技術的判断の記録（ADR）— 実装中に行った判断とその理由
    - 環境変更 — 新しい環境変数、DBマイグレーション、設定ファイル等
    - 既知の制約・注意点 — 後続ビルドが知るべき前提や制約（Step 8 で「そのまま進める」を選んだ指摘もここに記録する）

→ Step 10 へ。

### Step 10: Push + PR作成

- [ ] 変更を Push する
- [ ] PR を作成する
- [ ] `$ARGUMENTS[0]/tasklist.md` のPR列を更新し、Pushする

**注意:** 後続ビルドのセッションは、このPRがマージされてから開始すること。後続ビルドは main ブランチの `tasklist.md` を参照して依存ビルドの完了を確認するため、マージ前に開始すると依存が未完了と判定される。

→ Step 11 へ。

### Step 11: 振り返り

- [ ] `/hikyaku:retrospective $ARGUMENTS[0] build-{NN}` を呼び出して振り返りを実施する
- [ ] 振り返り完了後（またはスキップ後）、以下を案内する

```
Build {NN} が完了しました。

次のビルドを開始するには、新しいセッションで以下を実行してください:
/hikyaku:builder $ARGUMENTS[0]
```

---

## ビルド管理（タスクの追加・変更）

実装中に以下の状況が発生した場合、`/hikyaku:build-manager $ARGUMENTS[0]` を呼び出してビルドの追加・変更を行う。
build-manager がユーザー承認を含むビルド管理の全手順を実行する。

**呼び出しタイミング:**
- **Step 4（計画作成と承認）後** — issue.md のスコープが実際にはBP超過と判明 → ビルドの分割
- **Step 6（コード生成）中** — 想定外の複雑さや未定義の依存が判明 → ビルドの追加・更新
- **Step 8（コードレビュー）時** — 指摘の「新ビルド化して後で対応」を選択 → 新ビルドの追加
- **Step 9（申し送り作成）時** — 意図的に先送りした作業を新ビルドとして記録 → ビルドの追加

**build-manager 呼び出し後の対応:**
- 現在のビルドのスコープが変更された場合: plan.md を修正し、Step 4 の承認からやり直す（承認後、Step 5 で test-spec.md を再生成する）
- 新ビルドが追加されただけの場合: 現在の作業を続行する

---

## PRレビュー指摘への対応

PRレビューで指摘を受けた場合、同じセッションまたは新しいセッションで以下の手順で修正する:

- [ ] PRのレビューコメントを確認する
- [ ] `$ARGUMENTS[0]/build-{NN}/plan.md` を参照してコンテキストを復元する
- [ ] 指摘内容に基づいて修正を実装する
- [ ] ローカル検証を実行する（Step 7 と同じ）
- [ ] ドキュメント更新チェック — 修正内容に応じて以下を更新する:
  - `$ARGUMENTS[0]/build-{NN}/` 配下 — plan.md, issue.md, test-spec.md, handoff.md
  - `$ARGUMENTS[0]/architecture/` 配下 — interfaces.md, db-schema.md 等
  - `$ARGUMENTS[0]/planning/` 配下 — 企画レベルの変更があった場合（稀）
- [ ] Push する
- [ ] `/hikyaku:retrospective $ARGUMENTS[0] build-{NN}` を呼び出す（既に retrospective.md が存在する場合は追記モードで動作する）