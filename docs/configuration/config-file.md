# .hikyaku.config

TOML 形式の設定ファイルです。ドキュメントの所在は含みません（[document-guide.md](documents.md) が唯一の宣言先）。

## 設定を置ける場所

| 場所 | 役割 |
|---|---|
| リポジトリルート/`.hikyaku.config` | 必須。設定のベース。`hikyaku_root` の唯一の宣言先 |
| `{HIKYAKU_ROOT}/cycles/{NNN}-{slug}/.hikyaku.config` | 任意。そのサイクルだけキー単位で上書きする |

この2箇所だけです。`{HIKYAKU_ROOT}/.hikyaku.config` は読み込まれません。残っているとエラーになります（黙って無視すると「設定したのに効かない」という最も気づきにくい壊れ方をするため）。

マージはキー単位で、ネストしたテーブルも再帰的にマージされます。

## サイクル側で上書きできないキー

指定するとエラーになります。

| キー | 理由 |
|---|---|
| `hikyaku_root` / `base_branch` / `[branch]` / `[pr]` / `[session]` / `[external]` | リポジトリ全体の性質。とくにブランチ名は全サイクル横断で解析するため、サイクルごとに規則が変わると着手状態を導出できない |
| `profile` | サイクルの属性で `cycles.md` が唯一の正。2箇所に持つと必ず食い違う |

## 全体

```toml
hikyaku_root = "docs/hikyaku"   # リポジトリルートでのみ有効
profile = "standard"            # 作成時に提示する既定値。無条件には採用されない
base_branch = "main"            # 未設定ならデフォルトブランチを自動検出
bp_max = 8
```

| キー | 既定値 | 意味 |
|---|---|---|
| `hikyaku_root` | なし（必須） | HIKYAKU_ROOT のパス。リポジトリルートからの相対または絶対 |
| `profile` | `standard` | `create-cycle` が提示する既定値。express / economy / standard / thorough |
| `base_branch` | 自動検出 | デフォルトブランチ。未設定なら `origin/HEAD` から導出し、それも無ければ `null`（`main` と推測しない） |
| `bp_max` | `8` | ビルド分割の上限 BP。これを超えると分割必須 |

`profile` は推奨値の提示にすぎません。`create-cycle` は必ず明示的な選択を求めます。毎回意識して選ぶことを担保するためです。

## 承認ゲートとレビューの個別指定

プロファイルの既定値をキー単位で上書きします。値は真偽値です（`security_review` / `retrospective` / `validate` を除く）。

```toml
architecture_gate = false
plan_review = false
security_review = "on"
```

| キー | 型 | 対応するもの |
|---|---|---|
| `user_stories_gate` | bool | G1 user-stories 承認 |
| `codebase_survey_gate` | bool | G2 codebase-survey 確認 |
| `design_choice_gate` | bool | G3 設計案の選択 |
| `architecture_gate` | bool | G4 設計ドキュメント承認 |
| `plan_gate` | bool | G7 plan 単独の承認 |
| `user_stories_review` | bool | doc-reviewer（user-stories） |
| `architecture_review` | bool | doc-reviewer（architecture） |
| `plan_review` | bool | doc-reviewer（plan） |
| `code_review` | bool | code-reviewer |
| `security_review` | `off` / `recommended` / `on` | security-reviewer |
| `retrospective` | `skip` / `prompt` / `auto` | 振り返りの実行 |
| `validate` | `manual` / `phase` / `step` | `hikyaku validate` の実行タイミング |

プロファイルごとの既定値は [プロファイル](profiles.md) にあります。

## [branch]

```toml
[branch]
prefix = "hikyaku"
separator = "/"
```

ブランチ名は `{prefix}{separator}{cycle}{separator}{phase}` で構成されます。着手状態の導出にブランチ名を解析するため、構造は固定です。

`separator` に空文字は指定できません（サイクルとフェーズを切り出せなくなるため）。`-` にしても解析できます。フェーズが閉じた集合なので、prefix を前から、フェーズを後ろから剥がせばサイクルが残ります。

## [pr]

```toml
[pr]
title = "[hikyaku] {cycle}: {phase} {title}"
```

PR タイトルは表示専用で解析されないため、テンプレートは自由に組み立てられます。

| 変数 | 例 |
|---|---|
| `{cycle}` | `002-billing` |
| `{cycle_id}` | `002` |
| `{cycle_name}` | `billing` |
| `{phase}` | `init` / `create` / `plan` / `architect` / `build-01` / `close` |
| `{build_id}` | `01`（builder のみ） |
| `{title}` | ビルドのタイトル（他フェーズでは空） |

空になった変数は前後の区切り文字ごと詰められます。サイクルを持たない `init` で `[hikyaku] : init` のような出力にならないようにするためです。

## [session]

```toml
[session]
title = "{cycle} {phase} {title}"
```

セッション名のテンプレートです。変数は `[pr]` と共通です。**空文字にするとセッション名を変更しません。** 有効・無効のフラグは別に持たず、テンプレートが空かどうかで決まります。

セッション名の変更手段を持たない環境では、スキル側がスキップします。

## [review.security]

```toml
[review.security]
triggers = """
- 個人情報・秘密情報を扱う
- 認証・認可
- 決済
- このプロダクト固有: 診療記録テーブルに触れる変更
"""
```

`security_review = "recommended"` のときに起動を確認する判定基準です。設定すると既定値を丸ごと置き換えます。機微情報の定義はプロダクトごとに異なるため、自然言語で記述します。

未設定時の既定は次の3カテゴリです。

```
- 個人情報・秘密情報を扱う（氏名/住所/連絡先/生年月日、パスワード、トークン、APIキー）
- 認証・認可（ログイン、セッション、権限判定、アクセス制御）
- 決済（支払い、カード情報、請求、返金）
```

## [external]

```toml
[external]
target = "none"                 # none | github | asana
# github_repo = "owner/repo"
# asana_project_gid = "..."
```

外部システムへの片方向投影の設定です。詳細は [外部システムへの投影](external.md)。

## 確認する

マージ結果とプロファイルの展開結果は `config` で確認できます。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config 002-billing
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config 002-billing --profile thorough
```

`--profile` は what-if の確認用で、`cycles.md` の値より優先されます（設定ファイルは書き換えません）。
