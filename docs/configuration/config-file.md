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

サイクル設定に書けないのは次の2つだけで、指定するとエラーになります。それ以外のキーは、ブランチの命名規則や PR タイトル、投影先を含めてすべてサイクルごとに変えられます。

| キー | 理由 |
|---|---|
| `hikyaku_root` | ワークスペースの所在そのもの。サイクルごとに動かせるようにすると、そのサイクル設定をどこから読むかが決まらない（自己参照になる） |
| `profile` | サイクルの属性で `cycles.md` が唯一の正。2箇所に持つと必ず食い違う |

サイクルごとに `[branch]` を変えても、対象サイクルの決定は壊れません。現在のブランチからサイクルを引くとき、Hikyaku は「1つの規則で解析して名前を引く」のではなく、サイクルを1件ずつ、そのサイクル自身の規則で解析して、結果が自分を指しているかを確かめます。他サイクルの規則で偶然解析できても、取り出したサイクル名が一致しなければ採用されません。

裏を返すと、あるサイクルの規則で解析できないブランチは、そのサイクルのものとは見なされません。`002-beta` の `prefix` を `feat` に変えたなら、`hikyaku/002-beta/plan` に居ても `002-beta` は選ばれず、サイクルを引数で明示するよう求められます。既に切ってあるブランチがある状態で `[branch]` を変えるときは、ブランチ名も揃えてください。

## サイクルごとに変える

たとえば「このサイクルだけリリースブランチに向ける」「このサイクルだけ別リポジトリの issue へ投影する」といった使い分けができます。`{HIKYAKU_ROOT}/cycles/002-billing/.hikyaku.config` に書いたキーだけがルートの設定に重なり、書かなかったキーはルートの値のままです。

```toml
base_branch = "release/2.x"

[branch]
prefix = "release-2.x"

[pr]
title = "[2.x] {cycle}: {phase} {title}"

[external]
target = "github"
github_repo = "acme/backport"
```

この例では `separator` を書いていないので、ルートの値がそのまま使われます。マージはキー単位なので、テーブルを丸ごと書き直す必要はありません。

## サイクル作成時に決める

サイクルごとに変えたいが、値は作るときまで決まらない、という場合があります。ベースブランチや外部システムの投影先が典型で、ルート設定に固定値を書いても意味がなく、かといって毎回サイクルディレクトリに手でファイルを置くのも忘れます。

ルート設定の `ask` にキー名を並べると、`create-cycle` がその値をユーザーに尋ね、答えをそのサイクルの `.hikyaku.config` に記録します。

```toml
ask = ["base_branch", "external.target"]

base_branch = "main"    # 尋ねるときの既定として提示される

[external]
target = "none"         # 同上
```

`profile` と同じ考え方です。設定ファイルに書いた値は推奨として提示されるだけで、採用するかどうかは作成時に決めます。**値そのものは「尋ねる」の合図にはしません。** `base_branch = "ask"` のような番兵にすると、`ask` という名前のブランチと区別できなくなるためです。宣言を分けたおかげで、値のほうは既定の提示として使えます。

`ask` に書けるのは次の6つで、リポジトリルートの `.hikyaku.config` でのみ意味を持ちます。サイクル設定に書くとエラーです（サイクルが存在する時点で、尋ねる相手もタイミングもないため）。書き間違えたキー名もエラーにします。黙って捨てると、尋ねるはずのキーが尋ねられないまま気づけません。

| キー | `create-cycle` に渡すオプション |
|---|---|
| `base_branch` | `--base-branch <name>` |
| `branch.prefix` | `--branch-prefix <text>` |
| `branch.separator` | `--branch-separator <text>` |
| `pr.title` | `--pr-title <template>` |
| `session.title` | `--session-title <template>` |
| `external.target` | `--external <none\|github\|asana>` / `--external-repo` / `--external-project` |

**答えなくても壊れません。** `hikyaku cycle new` をスキルを通さず直接叩いて値を渡さなくても、エラーにはならずルート設定の値がそのまま使われます。答えていないキーは `hikyaku config <cycle>` に「未回答」として出ます。

## 全体

```toml
hikyaku_root = "docs/hikyaku"   # リポジトリルートでのみ有効
profile = "standard"            # 作成時に提示する既定値。無条件には採用されない
base_branch = "main"            # 未設定ならデフォルトブランチを自動検出
bp_max = 8
```

| キー | 既定値 | 意味 |
|---|---|---|
| `hikyaku_root` | なし（必須） | HIKYAKU_ROOT のパス。リポジトリルートからの相対または絶対。リポジトリルート自身（`.`）は指定できません |
| `profile` | `standard` | `create-cycle` が提示する既定値。express / economy / standard / thorough |
| `base_branch` | 自動検出 | そのサイクルが向かうブランチ。未設定なら `origin/HEAD` から導出し、それも無ければ `null`（`main` と推測しない） |
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
| `tasklist_review` | bool | doc-reviewer（tasklist） |
| `plan_review` | bool | doc-reviewer（plan） |
| `test_spec_review` | bool | doc-reviewer（test-spec） |
| `code_review` | bool | コードレビュー（[review]） |
| `security_review` | `off` / `recommended` / `on` | セキュリティレビュー（[review]） |
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

サイクルごとに変えられます。そのときの対象サイクルの決まり方は [サイクル側で上書きできないキー](#サイクル側で上書きできないキー) を参照してください。

## [pr]

```toml
[pr]
title = "[hikyaku] {cycle}: {phase} {title}"
reviewers = []        # PR を作った直後にレビューを依頼する相手
reviewers_skip = []   # アサインをオフにするスキル
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

`reviewers` には、PR を作る各スキルが PR を作った直後に、レビューを依頼する相手を書きます。人は login、チームは `org/team`、Copilot は `@copilot` で、1要素に1つずつ書きます。空（既定）なら何も依頼しません。依頼は `hikyaku pr request-reviewers` が行い、PR の作成者本人、すでに依頼した相手、すでにレビューした相手には依頼しません（GitHub は作成者本人を依頼先にできず、`gh` はレビュー済みの相手にも再依頼してしまうためです）。

`reviewers_skip` には、アサインをオフにするスキルを `init` / `bp-guide` / `create` / `plan` / `architect` / `build` / `close` / `conductor` のフェーズ名で並べます。`build` は全てのビルドの PR にあたり、`conductor` は監督が作る最後の PR にあたります。たとえば PLAN と ARCHITECT のドキュメントだけの PR にはレビューを求めず、BUILD の PR にだけ求めるなら、`reviewers_skip = ["init", "bp-guide", "create", "plan", "architect", "close"]` と書きます。名前のタイプミスはエラーになります。この設定は [conductor] の `phase_reviewers` にも効きます。

[conductor](../workflow/conductor.md) のフェーズの PR（conductor ブランチ向け）には、`reviewers` ではなく `[conductor] phase_reviewers` が使われます。向き先は PR の実際のマージ先から決まります。

## [session]

```toml
[session]
title = "{cycle} {phase} {title}"
```

セッション名のテンプレートです。変数は `[pr]` と共通です。**空文字にするとセッション名を変更しません。** 有効・無効のフラグは別に持たず、テンプレートが空かどうかで決まります。

セッション名の変更手段を持たない環境では、スキル側がスキップします。

## [review]

```toml
[review]
provider = "auto"   # auto | claude | codex
max_rounds = 1      # 0 は無制限。未設定ならプロファイルの既定
auto_fix = false
timeout = 30        # レビューのプロセス1回あたりの上限（分）

[review.provider_for]  # メインのセッションのプロバイダ → レビューの実行先
claude = "codex"
codex = "claude"

[review.claude]
model = ""          # 空ならそのプロバイダの既定
effort = ""

[review.codex]
model = ""
effort = ""

[review.code]       # 種類ごとの上書き。security / doc も同じ形
provider = "codex"
max_rounds = 3

[review.code.codex] # 種類 × プロバイダの上書き
effort = "high"
```

コードレビューとセキュリティレビューは、Claude Code と Codex に組み込みのレビュー機能が行います。Claude なら `/code-review` と `/security-review`、Codex なら `codex exec review` です。`[review]` はそれをどちらのプロバイダで、どのモデルとエフォートで、何回まで回すかを決めます。ドキュメントのレビュー（doc-reviewer）の起動先もここで選べます。

`provider` の `auto` は、メインのセッションと同じプロバイダを使うという意味です。`claude` や `codex` を指定すると、Claude Code で開発しながら Codex にレビューさせる、あるいはその逆ができます。コードとセキュリティのレビューは、同じプロバイダでも常に別のプロセスとして起動します。実装したセッションのコンテキストからレビューを切り離すためです。ドキュメントのレビューは、メインと同じプロバイダなら従来どおりサブエージェントで動き、別のプロバイダを選んだときだけ別のプロセスになります。

「Claude で開発しているときは Codex で、Codex で開発しているときは Claude でレビューする」のように、メインのプロバイダによって実行先を変えたいときは `[review.provider_for]` を使います。キーがメインのプロバイダ、値がレビューの実行先です。「もう一方」のような相対の指定を用意していないのは、プロバイダが増えたときに意味が決まらなくなるためです。メインのプロバイダの行が無ければ `provider` の値が使われるので、片方だけ書くこともできます。種類ごとに `[review.code.provider_for]` のようにも書けます。

プロバイダは次の順に決まり、最初に決まったものが使われます。

1. クラウド環境の判定（`CLAUDE_CODE_REMOTE=true` なら `claude`、`CODEX_ENVIRONMENT_ID` があれば `codex`）
2. 環境変数 `HIKYAKU_REVIEW_PROVIDER`
3. `[review.<種類>.provider_for]` のメインのプロバイダの行
4. `[review.<種類>]` の `provider`
5. `[review.provider_for]` のメインのプロバイダの行
6. `[review]` の `provider`
7. 既定の `auto`

`model` と `effort` はプロバイダごとのテーブルに書きます。モデル名もエフォートの値もプロバイダ間で互換性がないので、`provider` だけを切り替えても、もう一方の値が渡らないようにしてあります。値は `[review.<種類>.<プロバイダ>]`、`[review.<プロバイダ>]`、プロバイダの既定の順に決まり、空文字はキーが無いのと同じです。Claude の `effort` は `low` / `medium` / `high` / `xhigh` / `max` のどれかで、それ以外はエラーになります。Codex の `effort` は使える値がモデルによって変わるため、検証せずにそのまま渡します。

`max_rounds` はコードとセキュリティのレビューを何回まで回すかです。`1` なら1回だけ、`n` なら指摘がなくなるまで最大 n 回、`0` なら無制限です。未設定のときは [プロファイル](profiles.md#レビュー) の既定に従います。無制限でも、前の回と同じ指摘が繰り返されたら builder はそこで止めて対応を尋ねます。`auto_fix = true` にすると、2回目以降は指摘への対応を確認せずに直します。ただし確度の低い懸念と、打ち切りにあたる場面では確認します。ドキュメントのレビューは1回だけで、`[review.doc]` には `max_rounds` と `auto_fix` を書けません。

組み込みのレビュー機能には指示文を渡せないため、plan.md のスコープから外れていないかは builder 自身が確かめます。また Claude の `/security-review` は origin のデフォルトブランチとの差分しか見ないので、スタックしたビルドや origin/HEAD が無いリポジトリでは使いません。その場合と Codex のセキュリティレビューでは、観点を書いた指示文を渡す形に切り替わります。どの形で起動されるかは `hikyaku review resolve` で確認できます。

未知のキーやテーブル名はエラーになります。

各プロバイダのクラウド環境には、もう一方のプロバイダの CLI がありません。そのため Claude Code のクラウド環境（環境変数 `CLAUDE_CODE_REMOTE` が `true`）ではプロバイダを `claude` に、Codex のクラウド環境（環境変数 `CODEX_ENVIRONMENT_ID` が空でない）では `codex` に固定します。この判定は設定ファイルにも `HIKYAKU_REVIEW_PROVIDER` にも優先するので、`provider = "codex"` のまま Claude Code のクラウド環境で動かしても、レビューは Claude で行われます。

ローカルでも、設定したプロバイダの CLI が入っていないことがあります。そうした環境では、環境変数 `HIKYAKU_REVIEW_PROVIDER`（`claude` / `codex` / `auto`）を設定すると、設定ファイルのどの `provider` と `provider_for` よりも優先されます。全種類のレビューにまとめて効き、モデルとエフォートは切り替え先のプロバイダのテーブルから取られます。値がどこから来たかは `hikyaku review resolve` と `hikyaku config` に表示されます。変数は Claude Code を起動した環境に設定してください。conductor の子のセッションにもそのまま渡ります。

CLI を起動できなかったときに、Hikyaku が黙って別のプロバイダに切り替えることはしません。設定したつもりのプロバイダでレビューされていないことに気づけなくなるためです。レビューは失敗として報告され、そのメッセージで `HIKYAKU_REVIEW_PROVIDER` が案内されます。

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

`security_review = "recommended"` のときに起動を確認する判定基準です。セキュリティレビューを指示文の形で起動するときは、その指示文にも含まれます。設定すると既定値を丸ごと置き換えます。機微情報の定義はプロダクトごとに異なるため、自然言語で記述します。

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

## [conductor]

```toml
[conductor]
escalate = []        # 既定では監督が答える問いのうち、人間に上げるものの ID
delegate = []        # 既定では人間に上げる問いのうち、監督に任せるものの ID
allowed_tools = []   # 子セッションに許可するツール（既定に追加される）
budget_per_run = 0   # 子の呼び出し1回ごとの費用の上限（USD）。0 なら上限なし
require_approval = false  # true なら、PR を conductor ブランチに取り込む条件に承認（Approve）を加える
phase_reviewers = []      # conductor ブランチ向けのフェーズの PR にアサインするレビュアー
review_timeout = 15       # レビューの依頼や CI を待つ上限（分）。0 なら待たずにその場で判定する
# model = "sonnet"   # 子のモデル（全フェーズの既定）。未指定なら Claude Code の既定

[conductor.models]   # フェーズごとのモデル。model より優先する
# architect = "opus"
# builder = "sonnet"
# close-cycle = "sonnet"
```

[conductor](../workflow/conductor.md) で子セッションを動かすときの設定です。使わないなら書く必要はありません。

`escalate` と `delegate` には問いの ID（`G8`、`review-findings` など）を並べます。使える ID と現在の振り分けは `hikyaku conductor asks <cycle>` で確認できます。表に無い ID や、同じ ID を両方に書いた場合はエラーになります。サイクルの中止（`abandon`）と ID の無い問い（`other`）は常に人間に上げるので、`delegate` には書けません。

`allowed_tools` は `--allowedTools` に渡す書式で書きます（`"Bash(npm test:*)"` など）。子はこの設定を起動のたびに読むので、作業ツリーで一時的に足すのではなくコミットしておいてください。

`phase_reviewers` には、conductor ブランチに向かうフェーズの PR にアサインするレビュアーを書きます。Copilot のような Bot を入れておくと、取り込みの前にレビューが付くのを待てます。人間のレビュアーを入れると、レビューが付くまで取り込みが止まるので、フェーズごとの確認が重くなります。`review_timeout` を超えても依頼が残っていれば、監督は人間に確認します。

`require_approval` を `true` にすると、監督がフェーズの PR を取り込む条件に、1人以上の承認があり、変更の要求が残っていないことが加わります。承認の有無は、レビュアーごとに承認・変更の要求・取り下げのうち最新のもので判定します。コメントだけのレビューは判定を変えません。子の PR はあなたの `gh` の認証で作られるので、承認できるのはあなた以外のレビュアーです。

`model` と `[conductor.models]` の値は、`claude --model` に渡すモデル名（`opus` / `sonnet` のような別名か、正式なモデル名）です。`[conductor.models]` のキーは `architect` / `builder` / `close-cycle` だけで、それ以外はエラーになります。`models = "opus"` のようにテーブル以外で書いた場合もエラーになります。効くのは子のセッション本体だけです。子の中で起動されるサブエージェントは、環境変数 `CLAUDE_CODE_SUBAGENT_MODEL` を設定していればそのモデルで、していなければ子のセッションと同じモデルで動きます。ただし cycle-scanner だけは haiku に固定しています。

配列はキー単位で上書きされます。サイクル設定に `escalate` を書くと、ルートの `escalate` に足されるのではなく置き換わります。

## 確認する

マージ結果とプロファイルの展開結果は `config` で確認できます。

```bash
hikyaku config 002-billing
hikyaku config 002-billing --profile thorough
```

`--profile` は what-if の確認用で、`cycles.md` の値より優先されます（設定ファイルは書き換えません）。
