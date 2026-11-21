# Build 05: 宣言の変更の見直し・記録のテンプレート・ポインタの検査 テストシナリオ

## scripts/lib/premises.mts（parseAcceptedSection）

### parseAcceptedSection: 太字の箇条書き形の節から拠り所つきの行を読む
- 対応: US-6.6
- Given: `- **受け入れたこと**:` の下に `  - 最上段の宣言では問いが増える（拠り所: \`app.exposure\`, \`app.data\`）` が1行ある Markdown（source は `.hikyaku/decisions/20261116-x.md`）
- When: parseAcceptedSection を呼ぶ
- Then: lines が1件で、`text` は `最上段の宣言では問いが増える`、`premises` は `["app.exposure", "app.data"]`、`line` はその行の1始まりの行番号、`source` は渡したパス。problems は空

### parseAcceptedSection: 見出し形の節を読む
- 対応: US-6.6
- Given: `## 受け入れたこと` の見出しの下に `- 上限を超える受け入れは止まる（拠り所: \`area:billing\`）` と `- 並行ビルドの事項はマージまで見えない` の2行、その後に `## 再評価条件` が続く Markdown
- When: parseAcceptedSection を呼ぶ
- Then: lines が2件で、1件目の premises は `["area:billing"]`、2件目の premises は空配列。`## 再評価条件` 以下の行は lines に含まれない

### parseAcceptedSection: 拠り所の無い行は照合の対象にせず警告もしない
- 対応: US-6.6
- Given: ADR の実例（`20261116-risk-ceiling-table.md`）と同じ形で、3件目が `- サイクルの中で宣言を緩める変更は、マージされるまで効かない`（拠り所なし）の節
- When: parseAcceptedSection を呼ぶ
- Then: その行は premises が空の AcceptedLine として返り、problems に出ない

### parseAcceptedSection: 実例の ADR を警告なしで読める
- 対応: US-6.6
- Given: `.hikyaku/decisions/20261116-risk-ceiling-table.md` の全文
- When: parseAcceptedSection を呼ぶ
- Then: lines が3件で、1件目の premises は `["app.exposure", "app.data", "app.impact"]`、2件目は `["assumption:3段で利用者の多くの状況を表せる"]`。problems は空

### parseAcceptedSection: 参照の書式に合わない拠り所を警告する
- 対応: US-13.5
- Given: 節の中に `- 公開範囲が変わると見直す（拠り所: \`app.region\`）` の行がある（`app.region` は parsePremise が受け付けないキー）
- When: parseAcceptedSection を呼ぶ
- Then: problems に source とその行番号つきで1件出て、message に `app.region` が含まれる。読み飛ばさずに警告として残る

### parseAcceptedSection: 拠り所が行末以外にある行を警告する
- 対応: US-13.5
- Given: 節の中に `- 問いが増える（拠り所: \`app.exposure\`）ので運用で補う` の行がある
- When: parseAcceptedSection を呼ぶ
- Then: problems にその行番号で1件出る。その行の premises は照合に使われない

### parseAcceptedSection: 箇条書きでない行を警告する
- 対応: US-13.5
- Given: `## 受け入れたこと` の直下に、箇条書き記号の無い段落 `並行ビルドの事項はマージまで見えない（拠り所: \`app.merge_gate\`）` がある
- When: parseAcceptedSection を呼ぶ
- Then: problems にその行番号で1件出て、lines には含まれない

### parseAcceptedSection: 深い字下げの続きの行は前の項目の続きとして扱う
- 対応: —
- Given: `  - 対話で答えたのが本人かは確かめない` の次の行が、項目（2スペース）より深い字下げ（4スペース）の `    既存の --input と同じ扱い（拠り所: \`assumption:利用者は自分で答える\`）`
- When: parseAcceptedSection を呼ぶ
- Then: problems は空で、lines は1件。その項目の premises は `["assumption:利用者は自分で答える"]`

### parseAcceptedSection: 太字の項目の同じ行に本文を書いた形を警告する
- 対応: US-13.5
- Given: `- **受け入れたこと**: 偽装は防げない（拠り所: \`app.merge_gate\`）` の1行だけの節
- When: parseAcceptedSection を呼ぶ
- Then: problems に1件出る。lines は空

## scripts/lib/premises.mts（idRanges）

### idRanges: 本文の ID の範囲を拾う
- 対応: US-8.2
- Given: 3行目が `詳細は AD-1〜AD-5 を参照` の Markdown
- When: idRanges を呼ぶ
- Then: `{ line: 3, text: "AD-1〜AD-5" }` を含む1件を返す（text は範囲の部分を含む）

### idRanges: 小数の ID の範囲を拾う
- 対応: US-8.2
- Given: 本文の行 `US-15.1〜15.3 を満たす`
- When: idRanges を呼ぶ
- Then: その行を1件返す

### idRanges: コードブロックとインラインコードの中は拾わない
- 対応: US-8.2
- Given: ``` で囲んだコードブロックの中の `X-1〜X-5` と、本文の `` `X-1〜X-5` ``（インラインコード）だけを持つ Markdown
- When: idRanges を呼ぶ
- Then: 空配列を返す

## scripts/lib/premises.mts（declarationChanges）

### declarationChanges: app のキーの変更を参照として返す
- 対応: US-13.5
- Given: 一時 Git リポジトリで main の `.hikyaku.config` が `[app] exposure = "internal"`、作業ブランチの HEAD で `exposure = "public"` に変えてコミット。`--changed-from main` 相当で from に `main` を渡す
- When: declarationChanges(config, "main") を呼ぶ
- Then: changed が `["app.exposure"]`、uncertain は false、bases に main の merge-base のコミットが入る

### declarationChanges: area の中身の変更・追加・削除を area:<name> で返す
- 対応: US-13.5
- Given: main に `[[app.areas]] name = "billing"`（paths `["src/billing/**"]`, impact `"medium"`）と `name = "admin"` があり、HEAD で billing の impact を `"high"` に変え、admin を消し、`name = "auth"` を足した
- When: declarationChanges(config, "main") を呼ぶ
- Then: changed が `area:billing`・`area:admin`・`area:auth` の3つを含み、変わっていない app のキーは含まない

### declarationChanges: 宣言が同じなら空
- 対応: —
- Given: main と HEAD の `[app]`・`[[app.areas]]` が同じで、ほかの設定（`[pr]`）だけが変わっている
- When: declarationChanges(config, "main") を呼ぶ
- Then: changed は空、uncertain は false

### declarationChanges: 既定の基準は baselines の読めたものの和を取る
- 対応: US-13.5
- Given: from を渡さない。origin/main では `impact = "low"`、ローカルの main では `impact = "low"` かつ `data = "none"`、HEAD は `impact = "medium"`, `data = "internal"`（effectiveDeclaration の baselines に main 系の2つが読める）
- When: declarationChanges(config) を呼ぶ
- Then: changed が `app.impact` と `app.data` の両方を含み（基準ごとの差分の和）、bases に読めた基準が並ぶ

### declarationChanges: 基準を1つも読めないときは宣言された参照をすべて変わったものとする
- 対応: US-13.5
- Given: origin を持たず main も無い（merge-base が無い浅い clone 相当の）一時リポジトリで、HEAD の宣言が `[app] exposure = "public"` と `[[app.areas]] name = "billing"`
- When: declarationChanges(config) を呼ぶ
- Then: uncertain が true、changed が `app.exposure` と `area:billing` を含み、notices に基準を読めない理由が1件以上出る

### declarationChanges: 基準を読めず、宣言がどこにも無ければ changed は空
- 対応: —
- Given: origin を持たず main も無い一時リポジトリで、HEAD の `.hikyaku.config` に `[app]` が無い
- When: declarationChanges(config) を呼ぶ
- Then: changed が空（uncertain の値に関わらず、見直す参照が無い）

### declarationChanges: 基準の宣言を読めないときも上げる向きに倒す
- 対応: US-13.5
- Given: main の `.hikyaku.config` が TOML として壊れている（`[app` で閉じていない）、HEAD は `[app] impact = "high"`
- When: declarationChanges(config, "main") を呼ぶ
- Then: uncertain が true、changed が `app.impact` を含み、notices に読めない理由が出る

### declarationChanges: `-` で始まる ref を拒む
- 対応: —
- Given: from に `--output=/tmp/x` を渡す
- When: declarationChanges(config, "--output=/tmp/x") を呼ぶ
- Then: git を呼ばずにエラー（HikyakuError）になる
## scripts/lib/premises.mts（ledgerAcceptances・persistentAcceptances）

### ledgerAcceptances: 受け入れの定義に合うものだけを返す
- 対応: US-13.5
- Given: サイクル 001 の decisions.jsonl に、premises 付きの risk が4件（未決 R-1、最新の決定が `consented` の R-2、`rejected` の R-3、`resolved` の R-4）と、premises 付きの objection が2件（最新の決定が `consented` の O-1、`decided` の O-2）
- When: ledgerAcceptances(config) を呼ぶ
- Then: items が R-1（decision は null）・R-2・O-1 の3件で、R-3・R-4・O-2 は含まれない

### ledgerAcceptances: 読めないサイクルの記録は problems に出して続ける
- 対応: —
- Given: サイクル 001 の decisions.jsonl は正常（premises 付き未決 risk 1件）、サイクル 002 の design/decisions.jsonl に JSON として壊れた行がある
- When: ledgerAcceptances(config) を呼ぶ
- Then: items にサイクル 001 の1件が入り、problems にサイクル 002 のファイルについて1件出る（例外は投げない）

### persistentAcceptances: document-guide の decisions・constraints のディレクトリの下の .md を再帰で読む
- 対応: US-6.6
- Given: document-guide.md の decisions が `.hikyaku/decisions/`、constraints が `docs/constraints.md`。decisions 直下に拠り所付きの行を持つ ADR が1つ、`.hikyaku/decisions/old/legacy.md`（サブディレクトリ）にも同じ形の行がある。`docs/constraints.md` の `## 受け入れたこと` の節に `- 個人情報は外部に送らない（拠り所: \`app.data\`）` の行がある
- When: persistentAcceptances(config) を呼ぶ
- Then: lines に直下の ADR の行、サブディレクトリの legacy.md の行、constraints.md の行が入り、source はリポジトリルートからの相対パス（コードレビュー2回目の指摘を受けた監督の判断で、サブディレクトリも読むよう改めた。questions.md の Q2）

## scripts/lib/premises.mts（premisesReview・declarationArgs）

### premisesReview: 変わった参照を拠り所にした受け入れだけを並べる
- 対応: US-13.5
- Given: HEAD で `app.exposure` だけが変わった。記録に premises `["app.exposure"]` の未決 risk R-1 と `["app.impact"]` の risk R-2、ADR に `（拠り所: \`app.exposure\`）` の行と `（拠り所: \`assumption:…\`）` の行がある
- When: premisesReview(config, "main") を呼ぶ
- Then: R-1 と ADR の `app.exposure` の行だけが対象として返り、R-2 と assumption の行は返らない

### premisesReview: 読めない行の警告を一緒に返す
- 対応: US-13.5
- Given: 宣言の変更が無く、constraints.md の「受け入れたこと」に箇条書きでない行が1つある
- When: premisesReview(config, "main") を呼ぶ
- Then: 対象の受け入れは空で、警告にその constraints.md の行番号つきの1件が入る

### declarationArgs: 宣言が変わったら参照をカンマ区切りで返す
- 対応: US-13.5
- Given: HEAD で `app.data` と `area:billing` が変わった一時リポジトリの StepContext
- When: declarationArgs(ctx) を呼ぶ
- Then: `declarationChanged` が `app.data` と `area:billing` をカンマ区切りで並べた文字列（例: `"app.data,area:billing"`）

### declarationArgs: 変更が無ければ false
- 対応: —
- Given: 宣言の変わっていないブランチの StepContext
- When: declarationArgs(ctx) を呼ぶ
- Then: `{ declarationChanged: false }` を返す

## scripts/commands/ledger.mts（ledger premises）

### ledger premises: 宣言を変えたブランチで拠り所にした受け入れを並べる
- 対応: US-13.5
- Given: 一時 Git リポジトリ。main に `[app] exposure = "internal"`、サイクル 001 の design/decisions.jsonl に premises `["app.exposure"]` の未決 risk、`.hikyaku/decisions/20261116-a.md` に `- 問いが増える（拠り所: \`app.exposure\`）`。作業ブランチで `exposure = "public"` に変えてコミット
- When: `hikyaku ledger premises --changed-from main --json` を実行する
- Then: 終了コード 0。JSON の変わった参照に `app.exposure` があり、受け入れに risk の ID とサイクル 001 の作業単位、ADR の `.hikyaku/decisions/20261116-a.md` と行番号が並ぶ

### ledger premises: 読めない行を警告に出す
- 対応: US-13.5
- Given: 上と同じリポジトリで、ADR の「受け入れたこと」に `（拠り所: \`app.region\`）` の行を足した
- When: `hikyaku ledger premises --changed-from main` を実行する
- Then: 終了コード 0。出力にファイル:行と書式不正の警告が含まれる

### ledger premises: `--format pr` は ID とファイル:行のポインタだけを出す
- 対応: US-13.5
- Given: 1件目のシナリオと同じリポジトリに、premises `["app.exposure"]` の未決 risk をさらに2件足した（同じ作業単位の連番の ID が3件）
- When: `hikyaku ledger premises --changed-from main --format pr` を実行する
- Then: 「宣言の変更」の見出しの節が出て、`app.exposure`、3件の risk の ID がそれぞれ1行ずつ、`.hikyaku/decisions/20261116-a.md:<行>` を含む。件数（「N件」）や ID の範囲（`〜`）に畳まれない
## scripts/commands/validate.mts

### validate: ID の範囲を警告し、終了コードは 0 のまま
- 対応: US-8.2
- Given: 問題の無いワークスペースで、進行中のサイクル 001 の design/design-delta.md に `AD-1〜AD-5 を参照` の行がある
- When: `hikyaku validate --json` を実行する
- Then: 終了コード 0。`problems` は空、`warnings` に design-delta.md と行番号を指す1件が入る

### validate: 永続ドキュメントの ID の範囲を警告する
- 対応: US-8.2
- Given: document-guide の overview に登録された `docs/overview.md` に `US-15.1〜15.3` の行がある
- When: `hikyaku validate` をテキスト出力で実行する
- Then: 終了コード 0。`! ` で始まる警告行に `docs/overview.md` が含まれる

### validate: glossary の文書は範囲の検査から除く
- 対応: —
- Given: document-guide の glossary に登録された `docs/concepts.md` の本文に `X-1〜X-5` の例がある
- When: `hikyaku validate --json` を実行する
- Then: `warnings` に `docs/concepts.md` の項目が無い

### validate: 「受け入れたこと」の読めない行を常に警告する
- 対応: US-13.5
- Given: `--base` を付けず、`.hikyaku/decisions/` の ADR の「受け入れたこと」に箇条書きでない行がある
- When: `hikyaku validate --json` を実行する
- Then: 終了コード 0。`warnings` に ADR のファイルと行番号つきの1件が入る

### validate: `--base` で拠り所にした受け入れを警告する
- 対応: US-13.5
- Given: ledger premises の1件目と同じリポジトリ（作業ブランチで `app.exposure` を変更）
- When: `hikyaku validate --base main --json` を実行する
- Then: 終了コード 0。`warnings` に `app.exposure` の変更と、それを拠り所にした risk と ADR の行が出る

### validate: problems があれば警告に関わらず終了コードは 0 以外
- 対応: —
- Given: 既存の検査で problems になる不整合（cycles.md に無いサイクルのディレクトリ等）と、ID の範囲の警告が両方ある
- When: `hikyaku validate --json` を実行する
- Then: 終了コードは 0 以外で、`problems` と `warnings` の両方が JSON に出る

## scripts/lib/steps（pr の args）と steps/pr.md

### pr の定義: 5スキルの pr が declarationArgs を持つ
- 対応: US-13.5
- Given: `scripts/lib/steps/{planner,architect,builder,close-cycle,patch}.mts`
- When: 宣言を変えたブランチで各スキルの pr ステップの directive を作る
- Then: どのスキルの directive の args にも `declarationChanged` があり、architect では既存の args のキーも残っている

### steps/pr.md: 5つの pr.md が declarationChanged のときに ledger premises の出力を貼る
- 対応: US-13.5
- Given: planner・architect・builder・close-cycle・patch の `steps/pr.md`
- When: `declarationChanged` と `ledger premises --changed-from` と `--format pr` を grep する
- Then: 5ファイルすべてに3つとも現れる

## 指示文・テンプレート

### ADR のテンプレート: 前提・判断・推奨・受け入れたこと・再評価条件・失う利点の欄がある
- 対応: US-6.1, US-6.2, US-6.3
- Given: `skills/architect/references/templates.md` の ADR の節
- When: 欄の見出しを grep する
- Then: 決定 / 文脈 / 外の前提 / 検討した案 / 推奨 / 採用理由 / 受け入れたこと / トレードオフ / 再評価条件 / 退けた推奨で失う利点 / 影響範囲 / 領域 がこの順で現れ、外の前提の欄に「事実か仮定か」と「確かめた日」を書く記述がある

### ADR のテンプレート: 受け入れたことの行が拠り所の書式を示す
- 対応: US-6.6
- Given: `skills/architect/references/templates.md` と `skills/architect/steps/adr.md`
- When: `（拠り所: ` と `assumption:` を grep する
- Then: どちらのファイルにも現れ、templates.md の例の行が parseAcceptedSection で problems なしに読める

### ADR と constraints のテンプレート: 領域の行を書ける
- 対応: US-5.5
- Given: `skills/architect/references/templates.md` と `skills/close-cycle/references/constraints-template.md`
- When: `- **領域**: \`` を grep する
- Then: 両方に1つ以上現れ、ADR は1ファイルに1行、constraints は `##` の項目ごとに1行と書かれている

### constraints のテンプレート: 新規作成され close-cycle の write から指される
- 対応: US-6.1, US-6.2
- Given: `skills/close-cycle/references/constraints-template.md` と `skills/close-cycle/steps/write.md`
- When: テンプレートの欄と write.md の参照を grep する
- Then: テンプレートに 前提・事実か仮定か・確かめた日・受け入れたこと・再評価条件・領域 の欄があり、write.md に `constraints-template.md` への参照がある

### design-questions のテンプレート: 選択肢・欠点・推奨・回答・失う利点の欄がある
- 対応: US-7.1, US-7.2
- Given: `skills/architect/references/templates.md` の design-questions の節と `skills/architect/steps/questions.md`
- When: 欄の見出しを grep する
- Then: 両方に 選択肢・各案の欠点・推奨・回答・失う利点 が現れる

### 指示文: ポインタに件数や範囲を添えさせる指示が残っていない
- 対応: US-8.1
- Given: `skills/build-manager/references/templates.md`、`skills/builder/references/templates.md`、`skills/close-cycle/steps/G10.md`・`collect.md`、`skills/init/steps/pr.md`・`triage-approval.md`、`skills/conductor/SKILL.md`、`skills/token-guide/steps/propose.md`
- When: `〜`・`件数`・`N件`・`範囲を添え` を grep する
- Then: ポインタに件数や ID の範囲を添えさせる指示に当たる行が無い（予測ピークの根拠の列挙は対象外として残る）

### 指示文: 外の前提と受け入れたリスクを AI が書き換え・削除する手順が無い（解釈）
- 対応: US-6.4
- Given: `skills/` 配下の全 .md と `agents/` 配下の全 .md
- When: 「外の前提」「受け入れたこと」を書き換え・削除させる指示（例: `受け入れたこと.*(消|削除|書き換え)`）を grep する
- Then: close-cycle の同意（G10）を経る手順以外に当たる行が無い

### docs: CI の例に validate --base と履歴の深さの前提がある
- 対応: —
- Given: `docs/operations/ci.md`
- When: `validate --base` と `fetch-depth: 0` を grep する
- Then: 両方が現れる
