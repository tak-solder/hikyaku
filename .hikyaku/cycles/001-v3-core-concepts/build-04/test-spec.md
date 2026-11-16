# Build 04: 異議と、各フェーズが未決事項を記録する手順 テストシナリオ

## scripts/lib/ledger.mts — 異議（unacceptedObjections）

### unacceptedObjections: 決定の無い高の異議を返す
- 対応: US-1.4
- Given: build-02/decisions.jsonl に `{record:"open", id:"build-02-1", unit:"build-02", step:"G8", type:"objection", harm:"高", when:"now", who:"user"}` だけがある ledger
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: `build-02-1` の1件が返る

### unacceptedObjections: accepts 付きの consented で片づく
- 対応: US-1.4
- Given: 上の事項に `{record:"decide", id:"build-02-1", decision:"consented", by:"user", input:"このまま進める", accepts:"個人データを平文でログに残すことを受け入れる"}` が続く
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: 空配列が返る

### unacceptedObjections: accepts の無い consented では片づかない
- 対応: US-1.4
- Given: 高の異議 `build-02-1` に、`ledger decide` で書かれた `decision:"consented", by:"user", input:"進めて"`（accepts 無し）の決定だけがある
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: `build-02-1` が返る

### unacceptedObjections: accepts が空白だけの consented では片づかない
- 対応: US-1.4
- Given: 高の異議 `build-02-1` に `decision:"consented", by:"user", accepts:"   "` の決定がある
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: `build-02-1` が返る

### unacceptedObjections: ユーザーが選択を改めた decided で片づく（解釈）
- 対応: US-1.4
- Given: 高の異議 `build-02-1` に `decision:"decided", by:"user", input:"暗号化する案に変える"`（accepts 無し）の決定がある
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: 空配列が返る

### unacceptedObjections: ユーザー以外の決定では片づかない
- 対応: US-1.4
- Given: 高の異議 `build-02-1` に `decision:"consented", by:"supervisor", accepts:"受け入れる"` の決定だけがある
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: `build-02-1` が返る（受け入れはユーザーのもの）

### unacceptedObjections: ユーザー以外の decided では片づかない
- 対応: US-1.4
- Given: 高の異議 `build-02-1` に `decision:"decided", by:"supervisor"` の決定だけがある
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: `build-02-1` が返る（選択を改めたのがユーザーでなければ片づかない）

### unacceptedObjections: 最新の決定で判定する
- 対応: US-1.4
- Given: 高の異議 `build-02-1` に、先に accepts 付き consented、後に accepts 無しの consented の決定がある
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: `build-02-1` が返る（最新の決定が片づいていない）

### unacceptedObjections: 中の異議は数えない
- 対応: US-1.3
- Given: `harm:"中"` の objection `build-02-1`（step:"G8"）に決定が無い
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: 空配列が返る

### unacceptedObjections: 別のステップ・別の作業単位の異議は数えない
- 対応: US-1.4
- Given: 決定の無い高の異議が、build-02 の step:"plan-review" と build-03 の step:"G8" に1件ずつある
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: 空配列が返る

### unacceptedObjections: objection 以外の型は数えない
- 対応: —
- Given: build-02 の step:"G8" に、決定の無い `type:"risk", harm:"高"` の事項がある
- When: `unacceptedObjections(ledger, "build-02", "G8")`
- Then: 空配列が返る

### isRecord: basis の無い既存の open も読める
- 対応: —
- Given: build-03 の形の open（basis 欄なし）と、`basis:"[app] data = \"personal\""` を持つ open の2行がある decisions.jsonl
- When: `readLedger(cycleDirectory)`
- Then: 2件とも事項として読め、後者の `open.basis` が `[app] data = "personal"` になる

## scripts/lib/ledger.mts — 割り込みのきっかけ（latestOpenAt）

### latestOpenAt: 条件に合う事項の最新の at を返す
- 対応: US-14.2
- Given: build-02/decisions.jsonl に `ask:"design-conflict"` の open が at=`2026-11-16T01:00:00Z` と `2026-11-16T03:00:00Z`、`ask` 無しの open が at=`2026-11-16T05:00:00Z` にある
- When: `latestOpenAt(build02Dir, (r) => r.ask === "design-conflict")`
- Then: `2026-11-16T03:00:00Z` が返る

### latestOpenAt: 記録のファイルが無ければ undefined
- 対応: US-14.2
- Given: build-02/decisions.jsonl が無い
- When: `latestOpenAt(build02Dir, (r) => r.ask === "design-conflict")`
- Then: `undefined` が返る

### latestOpenAt: 条件に合う事項が無ければ undefined
- 対応: US-14.2
- Given: build-02/decisions.jsonl に `ask` の無い open だけがある
- When: `latestOpenAt(build02Dir, (r) => r.ask === "design-conflict")`
- Then: `undefined` が返る

### latestOpenAt: 記録が壊れていたら UNREADABLE_AT を返し、例外を投げない
- 対応: US-14.2
- Given: build-02/decisions.jsonl の2行目が `{"record":"open",`（途中で切れた行）
- When: `latestOpenAt(build02Dir, () => true)`
- Then: 例外にならず `UNREADABLE_AT`（空文字）が返る

### latestOpenAt: その作業単位のファイルだけを読む
- 対応: —
- Given: design/decisions.jsonl にだけ `ask:"design-conflict"` の open がある
- When: `latestOpenAt(build02Dir, (r) => r.ask === "design-conflict")`
- Then: `undefined` が返る

## scripts/commands/ledger.mts — ledger object

### ledger object: 異議と決定を同じ作業単位のファイルに対で書く（害が中は --accepts・--premises が要らない）
- 対応: US-1.5, US-1.3
- Given: build-02 の G8 を提示している一時ワークスペース（`step next build-02` の現在地が G8）
- When: `ledger object build-02 --summary "ログに個人データを残す" --basis "[app] data = \"personal\"" --loses "ログからの漏えいを防げない" --harm 中 --decision consented --input "そのままでよい"`
- Then: build-02/decisions.jsonl に2行が追記され、1行目は `record:"open", type:"objection", when:"now", who:"user", step:"G8", basis, loses, harm:"中"`、2行目は同じ id の `record:"decide", decision:"consented", by:"user", input:"そのままでよい"`

### ledger object: 事項の step は記録したときの現在のステップになる
- 対応: US-1.5
- Given: build-02 の現在地が plan-review の一時ワークスペース
- When: `ledger object build-02 --summary s --basis b --loses l --harm 中 --decision consented --input i`
- Then: open の `step` が `plan-review` になる

### ledger object: 異議と決定が US-19 の記録に載り ledger list で追える
- 対応: US-1.6
- Given: 上の `ledger object` を実行したワークスペース
- When: `ledger list 001-xxx --json`
- Then: `type:"objection"` の事項が1件あり、最新の決定が `consented`（by user）として導かれる（ほかの事項と同じ一覧に並ぶ）

### ledger object: 害が高・consented で --accepts が無ければ拒否する
- 対応: US-1.4
- Given: build-02 の現在地が G8
- When: `ledger object build-02 --summary s --basis b --loses l --harm 高 --decision consented --input "進めて" --premises "app.data"`（--accepts なし）
- Then: 終了コードが非0、メッセージに `--accepts` が含まれ、build-02/decisions.jsonl は作られない

### ledger object: 害が高・consented で --accepts が空白だけなら拒否する
- 対応: US-1.4
- Given: 同上
- When: `--accepts "  " --premises "app.data"` を付けて同じコマンドを実行
- Then: 終了コードが非0で、何も書かれない

### ledger object: 害が高・consented で --premises が無ければ拒否する
- 対応: US-1.5
- Given: 同上
- When: `ledger object build-02 --summary s --basis b --loses l --harm 高 --decision consented --input "進めて" --accepts "漏えいの危険を受け入れる"`（--premises なし）
- Then: 終了コードが非0、メッセージに `--premises` が含まれ、何も書かれない

### ledger object: 害が高の受け入れは前提と結び付けて残る
- 対応: US-1.5
- Given: 同上
- When: `--harm 高 --decision consented --accepts "漏えいの危険を受け入れる" --premises "app.data"` を付けて実行
- Then: open に `premises`（`app.data` を表す参照）と `harm:"高"`、decide に `accepts:"漏えいの危険を受け入れる"` が残る

### ledger object: 害が高で decided でも、ユーザーの言葉（--input）が無ければ拒否する
- 対応: US-1.4
- Given: build-02 の G8 を提示している一時ワークスペース
- When: `ledger object build-02 --summary "s" --basis "b" --loses "l" --harm 高 --decision decided --premises app.data`（--input なし）と、`--input "  "`（空白だけ）で実行
- Then: どちらも終了コード1で拒否され、decisions.jsonl に何も書かれない

### ledger object: 害が高でも decided なら --accepts を求めない（解釈）
- 対応: US-1.4
- Given: 同上
- When: `ledger object build-02 --summary s --basis b --loses l --harm 高 --decision decided --input "暗号化する案に変える"`（--accepts・--premises なし）
- Then: 終了コード0で、decide に `decision:"decided"` が残り、accepts 欄は無い

### ledger object: --decision の語彙外を拒否する
- 対応: —
- Given: 同上
- When: `--decision approved` と `--decision rejected` で実行
- Then: どちらも終了コードが非0、メッセージに `consented / decided` が含まれ、何も書かれない

### ledger object: --harm の語彙外を拒否する
- 対応: —
- Given: 同上
- When: `--harm 低` で実行
- Then: 終了コードが非0、メッセージに `高 / 中` が含まれる

### ledger object: 必須の欄が欠けたら欄名を示して拒否する
- 対応: —
- Given: 同上
- When: `--basis` を外したもの、`--input` を外したものをそれぞれ実行
- Then: どちらも終了コードが非0で、メッセージに欠けた欄名（`--basis` / `--input`）が含まれる

### ledger object: --dry-run は書かない
- 対応: —
- Given: 同上
- When: 正しい引数に `--dry-run` を付けて実行
- Then: 終了コード0、出力に「--dry-run のため書き込みません」が含まれ、build-02/decisions.jsonl は作られない

### ledger show: 異議の根拠・失うもの・害の重さが出る
- 対応: US-1.1
- Given: `--basis "[app] data = \"personal\"" --loses "漏えいを防げない" --harm 中` で ledger object を書いたワークスペース
- When: `ledger show <事項の ID>`
- Then: 出力に「根拠」と `[app] data = "personal"`、「失うもの」、「害の重さ 中」、決定 consented が含まれる

## scripts/commands/step.mts — ゲートの承認と高の異議

### step report: 決定の無い高の異議があるとそのゲートの approved を拒否する
- 対応: US-1.4
- Given: build-02 の現在地が G8 で、`ledger open build-02 --type objection --harm 高 --when now --who user --summary "テストを削る"` を記録済み（決定なし）
- When: `step report build-02 G8 --result approved --input "OK"`
- Then: 終了コードが非0、メッセージに事項の ID と `ledger decide` の呼び方が含まれ、progress.jsonl に approved が書かれない

### step report: accepts 付きの consented を足すと approved を受け付ける
- 対応: US-1.4
- Given: 上の状態に `ledger decide build-02 <ID> --decision consented --by user --input "進める" --accepts "回帰を見逃す危険を受け入れる"` を足した
- When: `step report build-02 G8 --result approved --input "OK"`
- Then: 終了コード0で、`step next build-02` の現在地が G8 の次に進む

### step report: 高でも decided で決めた異議はゲートを止めない（解釈）
- 対応: US-1.4
- Given: build-02 の G8 で `ledger object build-02 ... --harm 高 --decision decided --input "テストを残す案に変える"` を記録済み
- When: `step report build-02 G8 --result approved --input "OK"`
- Then: 終了コード0で受け付ける

### step report: 中の異議はゲートを止めない
- 対応: US-1.3
- Given: build-02 の G8 で `ledger open build-02 --type objection --harm 中 ...` を記録済み（決定なし）
- When: `step report build-02 G8 --result approved --input "OK"`
- Then: 終了コード0で受け付ける

### step report: 別のステップの高の異議は止めない
- 対応: US-1.4
- Given: build-02 の plan-review の最中に記録した決定の無い高の異議（step:"plan-review"）があり、現在地は G8
- When: `step report build-02 G8 --result approved --input "OK"`
- Then: 終了コード0で受け付ける

### step report: 別の作業単位の高の異議は止めない
- 対応: US-1.4
- Given: build-03 の G8 で記録した決定の無い高の異議があり、build-02 の現在地は G8
- When: `step report build-02 G8 --result approved --input "OK"`
- Then: 終了コード0で受け付ける

### step report: 内部スキルのゲート（build-manager の G6）でも同じく拒否する
- 対応: US-1.4
- Given: architect から build-manager を呼び、`step next architect --skill build-manager` の現在地が G6。その最中に `ledger open architect --type objection --harm 高 ...` を記録（step:"G6"、決定なし）
- When: `step report architect G6 --skill build-manager --result approved --input "OK"`
- Then: 終了コードが非0で受け付けない

### step report: rejected は高の異議があっても受け付ける
- 対応: —
- Given: build-02 の G8 に決定の無い高の異議がある
- When: `step report build-02 G8 --result rejected --input "直して"`
- Then: 終了コード0で受け付ける（止めるのは承認だけ）

### step report: 記録が壊れていたら approved を拒否する
- 対応: US-1.4
- Given: build-02 の現在地が G8 で、build-02/decisions.jsonl に壊れた行がある
- When: `step report build-02 G8 --result approved --input "OK"`
- Then: 終了コードが非0で受け付けない（安全側）

## scripts/lib/steps/directive.mts — 異議の指示

### directive: サイクルに属す作業単位の gate に objection が載る
- 対応: US-1.1
- Given: build-02 の現在地が G8 のワークスペース（document-guide.md に `constraints` と `decisions` のパスを登録済み）
- When: `step next build-02 --json`
- Then: `objection.guide` が空でなく、`objection.pointers` に `config`（`[app]`・`[[app.areas]]`・`[boundaries]`）、`constraints:`・`decisions:` のパス、`tasklist.md`、`ledger list` が含まれ、`objection.command` が `ledger object build-02 <cycle>` で始まる

### directive: 好みの違いには唱えないことが guide に載る
- 対応: US-1.2
- Given: 同上
- When: `step next build-02 --json`
- Then: `objection.guide` のいずれかの行に「好みの違い」と「唱えない」が含まれる

### directive: 害の重さの扱い（中は指摘、高は受け入れの言葉まで報告しない）が guide に載る
- 対応: US-1.3
- Given: 同上
- When: `step next build-02 --json`
- Then: `objection.guide` に「中は指摘にとどめ」を含む行と、「高は、ユーザーが何を受け入れるかを自分の言葉で書くまで承認を報告しない」を含む行がある

### directive: 未登録の文書はポインタに載らない
- 対応: —
- Given: document-guide.md に `decisions` だけを登録し、`constraints` は無い
- When: `step next build-02 --json`
- Then: `objection.pointers` に `decisions:` はあり、`constraints:` は無い

### directive: 未作成・対象外で登録した文書はポインタに載らない
- 対応: —
- Given: document-guide.md で `constraints` を「未作成」、`overview` を「対象外」、`decisions` を `hikyaku` のパス付きで登録している
- When: `step next build-02 --json`
- Then: `objection.pointers` に `decisions:` だけがあり、`constraints:` は無い

### directive: テキストの描画に「異議:」の行が出る
- 対応: US-1.1
- Given: build-02 の現在地が G8
- When: `step next build-02`（テキスト出力）
- Then: 出力に `異議:` と `記録: hikyaku ledger object` の行が含まれる

### directive: run のステップには objection が載らない
- 対応: —
- Given: build-02 の現在地が implement
- When: `step next build-02 --json`
- Then: `objection` 欄が無い

### directive: サイクルに属さない patch の P1 には載らない（解釈）
- 対応: —
- Given: サイクルに属さない patch のブランチで、`step next` の現在地が P1
- When: `step next patch --json`
- Then: kind は gate だが `objection` 欄が無い

## scripts/lib/steps/engine.mts — 割り込みのゲート（lint）

### lintApproval: interrupt を gate 以外が持つと問題を返す
- 対応: —
- Given: `{ id: "x", kind: "run", interrupt: () => "2026-11-16T00:00:00Z" }` を含むテスト用の SkillSteps
- When: `lintApproval(skill)`
- Then: 「x は gate でないのに interrupt を持っています」を含む問題が返る

### step lint: 同梱のステップ定義は問題なし
- 対応: —
- Given: リポジトリの steps 定義（builder・architect の delegation を含む）
- When: `node scripts/hikyaku.mts step lint`
- Then: 終了コード0

## scripts/lib/steps/builder.mts — delegation（割り込み）

### delegation: design-conflict の事項が無ければ手順に入らない
- 対応: US-14.2
- Given: build-02 のブランチ、build-02/decisions.jsonl が無い
- When: `step next build-02 --json`
- Then: 現在地は plan、steps の delegation は `off`

### delegation: implement の最中に design-conflict を記録すると gate delegation が出る
- 対応: US-14.2
- Given: build-02 の plan・plan-review・G8 を完了し、現在地が implement
- When: `ledger open build-02 --type question --ask design-conflict --when now --who user --summary "設計どおりでは US-3.2 を満たせない"` のあと `step next build-02 --json`
- Then: `kind:"gate", step:"delegation", ask:"delegation", approval:"consent"` が返る

### delegation: 未承認の間は implement の報告を拒否する
- 対応: US-14.2
- Given: 上の状態（delegation が現在地）
- When: `step report build-02 implement --result done`
- Then: 終了コードが非0で受け付けない

### delegation: 承認のあとは implement に戻り、それまでの完了をやり直さない
- 対応: US-14.2
- Given: 上の状態
- When: `step report build-02 delegation --result approved --input "このまま委任する"` のあと `step next build-02 --json`
- Then: 現在地が implement に戻り、steps の plan・plan-review・G8 は complete のまま、delegation は complete

### delegation: rejected なら答えを revise に返して提示し直す
- 対応: US-14.2
- Given: delegation が現在地
- When: `step report build-02 delegation --result rejected --input "差し戻しを検討したい"` のあと `step next build-02 --json`
- Then: 現在地は delegation のままで、`revise` が `差し戻しを検討したい`、note に「差し戻されています」が含まれる

### delegation: 2回目の design-conflict を記録するとまた出る
- 対応: US-14.2
- Given: 1回目の delegation を approved で通し、現在地が verify
- When: もう一度 `ledger open build-02 --type question --ask design-conflict ...` を記録して `step next build-02 --json`
- Then: 現在地が delegation になる（前回の承認はきっかけより前なので数えない）

### delegation: 同じ出来事で二度は出ない
- 対応: US-14.2
- Given: design-conflict を1回記録し、delegation を approved で通した
- When: design-conflict 以外の事項（`--type question` の ask 無し）を記録して `step next build-02 --json`
- Then: 現在地は delegation にならない

### delegation: 差し戻しと再設計のあと builder に戻っても、同じ出来事でもう一度は出ない
- 対応: US-14.2
- Given: build-02 で design-conflict を記録し、delegation を approved で通したあと、return.md を作り、architect の再設計の回（step restart --round return）で return.md を消した
- When: builder の `step next build-02 --json`
- Then: 現在地は delegation ではなく、plan.md の無い plan になる

### delegation: decisions.jsonl が壊れていると delegation が出る
- 対応: US-14.2
- Given: build-02 の現在地が implement で、build-02/decisions.jsonl に壊れた行を書いた
- When: `step next build-02 --json`
- Then: 現在地が delegation（approval: consent）になり、notices に記録の壊れが出る

### Stop フック: delegation で止まっているときは引き止めない
- 対応: —
- Given: build-02 の現在地が delegation（design-conflict を記録した直後）
- When: Stop フック（`hook stop`）を build-02 のブランチで実行
- Then: 引き止めの出力（block）を返さない（gate はユーザーの答えを待つため）

## scripts/lib/steps/architect.mts — delegation（再設計の回）

### delegation: 差し戻しからの再設計の回の先頭で出る
- 対応: US-14.2
- Given: build-02 のブランチに return.md があり、`step restart architect <cycle> --round return --reason "build-02 からの差し戻し"` を実行済み
- When: `step next architect --json`
- Then: `kind:"gate", step:"delegation", ask:"delegation", approval:"consent"` が返る

### delegation: 承認すると再設計の次のステップに進む
- 対応: US-14.2
- Given: 上の状態
- When: `step report architect delegation --result approved --input "委任を続ける"` のあと `step next architect --json`
- Then: 現在地が survey（ほかに進行中のサイクルが無いので cycle-scan は外れる）になる

### delegation: 通常の設計の回には出ない
- 対応: US-14.2
- Given: planning を終えたサイクルで、architect の最初の回（restart なし）
- When: `step next architect --json`
- Then: delegation は `off` で、現在地は通常の最初のステップ

### delegation: 追加設計の回には出ない
- 対応: US-14.2
- Given: `step restart architect <cycle> --round add --reason "ビルドの追加"` を実行済み
- When: `step next architect --json`
- Then: delegation は `off` で、現在地は design-change

## scripts/lib/steps/planner.mts — G1

### G1: directive の args に profile が入る
- 対応: US-14.1
- Given: profile = `standard` のサイクルで、planner の現在地が G1
- When: `step next plan --json`
- Then: `step:"G1"` で `args.profile` が `standard`

### G1: profile を変えると args も変わる
- 対応: US-14.1
- Given: profile = `thorough` のサイクルで、現在地が G1
- When: `step next plan --json`
- Then: `args.profile` が `thorough`

### G1.md: プロファイルの確認を出す指示がある
- 対応: US-14.1
- Given: `skills/planner/steps/G1.md`
- When: 本文を読む
- Then: args の profile を示し「このプロファイルのままでよいか」を確かめる行がある

## scripts/lib/conductor.mts — delegation の問い

### resolveAsk: delegation はユーザーに固定される
- 対応: US-14.2
- Given: 既定の ConductorConfig（escalate・delegate とも空）
- When: `resolveAsk("delegation", config, settings)`
- Then: `category:"consent", handler:"user", source:"fixed"`

### resolveAsk: directive の approval に consent を渡してもユーザーに固定される
- 対応: US-14.2
- Given: 既定の ConductorConfig
- When: `resolveAsk("delegation", config, settings, "consent")`
- Then: `handler:"user", source:"fixed"`

### checkConductorAsks: delegate に delegation を書くとエラー
- 対応: US-14.2
- Given: `.hikyaku.config` の `[conductor] delegate = ["delegation"]`
- When: 設定を読み込む（`checkConductorAsks(config, "[conductor]")`）
- Then: HikyakuError「[conductor].delegate に delegation は指定できません」

### conductor lint: タグと ASKS が一致して通る
- 対応: —
- Given: `skills/architect/steps/delegation.md`・`skills/builder/steps/delegation.md` に `（ask: delegation）`、ASKS に `delegation`
- When: `node scripts/hikyaku.mts conductor lint`
- Then: 終了コード0

## 指示ファイル — 記録する側の ledger open

### planner/steps/user-stories.md: 未回答の質問を ledger open で記録する
- 対応: US-19.1
- Given: `skills/planner/steps/user-stories.md`
- When: 本文を読む
- Then: `ledger open` と `--type question` の呼び方があり、`--when` に `gate:G1` か `phase:architect` を示している

### architect/steps/adr.md・design-delta.md: 暫定の設計判断を ledger open で記録する
- 対応: US-19.1
- Given: `skills/architect/steps/adr.md` と `design-delta.md`
- When: 本文を読む
- Then: 両方に `ledger open` と `--type provisional` の呼び方がある

### build-manager/steps/G6.md: G6 での受け入れを open と decide で記録する
- 対応: US-19.1
- Given: `skills/build-manager/steps/G6.md`
- When: 本文を読む
- Then: `ledger open`（`--type risk`）と、`ledger decide`（`--by user --decision consented --accepts`）の呼び方がある

### builder/steps/handoff.md・references/templates.md: 残したことを事項にし ID で指す
- 対応: US-19.1
- Given: `skills/builder/steps/handoff.md` と `references/templates.md`
- When: 本文を読む
- Then: handoff.md に `ledger open` の呼び方があり、templates.md の「残したこと」が事項の ID のポインタの書式になっている

### builder/steps/review.md・pr.md: 確度が要確認の指摘を事項にする
- 対応: US-19.1
- Given: `skills/builder/steps/review.md` と `pr.md`
- When: 本文を読む
- Then: review.md に `ledger open` の呼び方があり、pr.md に PR 本文へ事項の ID と要点を載せる指示がある

### builder/references/return.md: design-conflict を記録してから delegation に進む
- 対応: US-14.2
- Given: `skills/builder/references/return.md`
- When: 本文を読む
- Then: `ledger open --type question --ask design-conflict` の呼び方があり、その後に `step next`（delegation）が続く順で書かれている

### patch/steps/persist.md: サイクルに属す patch の未決を記録する
- 対応: US-19.1
- Given: `skills/patch/steps/persist.md`
- When: 本文を読む
- Then: サイクルに属す patch のときに `ledger open`（`--when merge` か `close`）を呼ぶ指示がある

### close-cycle/steps/collect.md・G10.md: close 期限の事項を示して決定を記録する
- 対応: US-19.1
- Given: `skills/close-cycle/steps/collect.md` と `G10.md`
- When: 本文を読む
- Then: close 期限の事項を示す手順と、`ledger decide` の `--by user --input` の呼び方がある

### conductor/references/headless-protocol.md: 監督の判断を decisions.jsonl に記録する
- 対応: US-19.1
- Given: `skills/conductor/references/headless-protocol.md`
- When: 本文を読む
- Then: `ledger open --who supervisor` と `ledger decide --by supervisor` の呼び方がある

## 結合 — 記録する側の作業単位とステップ

### planner: user-stories のステップ中の ledger open が planning に入る
- 対応: US-19.1
- Given: 一時ワークスペースのサイクルで、planner の現在地が user-stories
- When: `ledger open plan --type question --when gate:G1 --who user --summary "対象ブラウザは?"`
- Then: planning/decisions.jsonl に `unit:"planning"`（plan の作業単位）・`step:"user-stories"`・`when:"gate:G1@plan"` の open が1行入る

### builder: handoff のステップ中の ledger open が build-NN に入る
- 対応: US-19.1
- Given: build-02 の現在地が handoff
- When: `ledger open build-02 --type question --when close --who user --summary "古い API の削除は close で決める"`
- Then: build-02/decisions.jsonl に `unit:"build-02"`・`step:"handoff"`・`when:"close"` の open が1行入る
