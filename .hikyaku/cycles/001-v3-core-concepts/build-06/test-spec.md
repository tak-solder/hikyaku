# Build 06: 事後同意（PR を作る直前の同意ゲート） テストシナリオ

前提の共通値: 一時 Git リポジトリで `init --root docs/hikyaku` と `cycle new test --profile standard` を済ませ、サイクルは `001-test`（ディレクトリ `docs/hikyaku/cycles/001-test`）、tasklist.md に `build-01` と `build-02` がある。単体テストの事項は `OpenRecord`（`record: "open"`, `at: "2026-11-16T00:00:00.000Z"`, `unit`, `type`, `summary`, `when`, `who`, `premises`, `loses`, `harm`）と `DecideRecord`（`record: "decide"`, `at`, `id`, `unit`, `decision`, `by`, `input`, `accepts`）で組み立てる。環境変数 `HIKYAKU_CONDUCTOR_CHILD` は明記したシナリオ以外では設定しない。

## lib/ledger.mts（同意の対象）

### isConsentItem: when=merge@その単位で who=user の risk は対象になる
- 対応: US-20.5
- Given: 事項 `{ type: "risk", who: "user", when: "merge@build-01", unit: "build-01" }`
- When: `isConsentItem(item, "build-01")` を呼ぶ
- Then: `true` を返す

### isConsentItem: when=merge@その単位で who=user の objection は対象になる
- 対応: US-20.5
- Given: 事項 `{ type: "objection", who: "user", when: "merge@build-01", harm: "高" }`
- When: `isConsentItem(item, "build-01")` を呼ぶ
- Then: `true` を返す

### isConsentItem: question と provisional は対象にならない
- 対応: —
- Given: `when: "merge@build-01"`・`who: "user"` で `type` が `"question"` の事項と `"provisional"` の事項
- When: それぞれ `isConsentItem(item, "build-01")` を呼ぶ
- Then: どちらも `false` を返す

### isConsentItem: who がユーザーでなければ対象にならない
- 対応: —
- Given: `type: "risk"`・`when: "merge@build-01"` で `who` が `"ai:architect"` の事項と `"supervisor"` の事項
- When: それぞれ `isConsentItem(item, "build-01")` を呼ぶ
- Then: どちらも `false` を返す

### isConsentItem: 別の単位のマージや merge 以外の「いつ」は対象にならない
- 対応: —
- Given: `type: "risk"`・`who: "user"` で `when` が `"merge@build-02"`・`"gate:G8@build-01"`・`"close"`・`"now"` の4事項
- When: それぞれ `isConsentItem(item, "build-01")` を呼ぶ
- Then: すべて `false` を返す

### isConsentItem: 記録した作業単位は問わない
- 対応: US-20.5
- Given: architect で記録した事項 `{ unit: "architect", type: "risk", who: "user", when: "merge@build-01" }`
- When: `isConsentItem(item, "build-01")` を呼ぶ
- Then: `true` を返す

### consentItemsOf: サイクル全体の記録から、その単位の対象だけを記録順に返す
- 対応: US-20.5
- Given: Ledger に `architect.1-aaaa`（risk, merge@build-01, user）、`build-01.1-bbbb`（objection, merge@build-01, user）、`build-01.2-cccc`（question, merge@build-01, user）、`build-02.1-dddd`（risk, merge@build-02, user）がある
- When: `consentItemsOf(ledger, "build-01")` を呼ぶ
- Then: ID の並びが `["architect.1-aaaa", "build-01.1-bbbb"]` になる

### undecidedConsentItems: 決定が無い項目は決定が足りない
- 対応: US-20.8
- Given: risk の事項 `a` に決定の記録が無い
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: `a` を含む一覧を返す

### undecidedConsentItems: ユーザーの consented / decided / resolved は決定として数える
- 対応: US-20.8
- Given: risk の事項 `a`・`b`・`c` の最新の決定がそれぞれ `{ decision: "consented", by: "user", input: "受け入れる" }`・`{ decision: "decided", by: "user", input: "安全側に改める" }`・`{ decision: "resolved", by: "user", input: "作り直した" }`
- When: `undecidedConsentItems([a, b, c])` を呼ぶ
- Then: 空の一覧を返す

### undecidedConsentItems: 最新の決定が rejected の項目は決定として数えない
- 対応: US-20.8
- Given: risk の事項 `a` の最新の決定が `{ decision: "rejected", by: "user", input: "このリスクは受け入れない" }`
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: `a` を含む一覧を返す

### undecidedConsentItems: ユーザー以外の決定は数えない
- 対応: —
- Given: risk の事項 `a`（who=user）の最新の決定が `{ decision: "consented", by: "supervisor" }`（記録を直接組み立てる）
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: `a` を含む一覧を返す

### undecidedConsentItems: 最新の決定で判定する（consented のあとの rejected）
- 対応: US-20.8
- Given: risk の事項 `a` に `at: "2026-11-16T01:00:00Z"` の consented（by=user）と `at: "2026-11-16T02:00:00Z"` の rejected（by=user）がある
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: `a` を含む一覧を返す

### undecidedConsentItems: rejected のあとの resolved で片づく
- 対応: US-20.8
- Given: risk の事項 `a` に `at: "2026-11-16T01:00:00Z"` の rejected と `at: "2026-11-16T03:00:00Z"` の resolved（どちらも by=user）がある
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: 空の一覧を返す

### undecidedConsentItems: 害が高の異議は受け入れの言葉の無い consented を数えない
- 対応: US-20.8
- Given: objection（harm=高）の事項 `a` の最新の決定が `{ decision: "consented", by: "user", input: "進める" }`（`accepts` なし）
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: `a` を含む一覧を返す

### undecidedConsentItems: 害が高の異議は空白だけの accepts でも数えない
- 対応: —
- Given: objection（harm=高）の事項 `a` の最新の決定が `{ decision: "consented", by: "user", input: "進める", accepts: "  " }`
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: `a` を含む一覧を返す

### undecidedConsentItems: 害が高の異議は accepts 付きの consented で片づく
- 対応: US-20.8
- Given: objection（harm=高）の事項 `a` の最新の決定が `{ decision: "consented", by: "user", input: "進める", accepts: "ログに個人情報が残ることを受け入れる" }`
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: 空の一覧を返す

### undecidedConsentItems: 異議でも resolved は片づきとして数える
- 対応: —
- Given: objection（harm=高）の事項 `a` の最新の決定が `{ decision: "resolved", by: "user", input: "作り直した" }`（accepts なし）
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: 空の一覧を返す

### undecidedConsentItems: risk は accepts の無い consented でも決定として数える
- 対応: —
- Given: risk の事項 `a` の最新の決定が `{ decision: "consented", by: "user", input: "受け入れる" }`（accepts なし）
- When: `undecidedConsentItems([a])` を呼ぶ
- Then: 空の一覧を返す

### unitHasConsentItems: その単位のファイルに対象があれば true
- 対応: —
- Given: 一時ディレクトリの `decisions.jsonl` に `{ type: "risk", who: "user", when: "merge@build-01" }` の open レコードが1件ある
- When: `unitHasConsentItems(directory, "build-01")` を呼ぶ
- Then: `true` を返す

### unitHasConsentItems: ファイルが無ければ false
- 対応: —
- Given: `decisions.jsonl` の無い一時ディレクトリ
- When: `unitHasConsentItems(directory, "build-01")` を呼ぶ
- Then: `false` を返す

### unitHasConsentItems: 対象でない事項だけなら false
- 対応: —
- Given: `decisions.jsonl` に `{ type: "question", who: "user", when: "merge@build-01" }` と `{ type: "risk", who: "user", when: "merge@build-02" }` の2件がある
- When: `unitHasConsentItems(directory, "build-01")` を呼ぶ
- Then: `false` を返す

### unitHasConsentItems: 壊れたファイルは安全側で true
- 対応: —
- Given: `decisions.jsonl` の1行目が `{not json`
- When: `unitHasConsentItems(directory, "build-01")` を呼ぶ
- Then: 例外を投げずに `true` を返す

## steps/consent.mts（同意ゲート）

### consentStep: ゲートの定義の形
- 対応: —
- Given: なし
- When: `consentStep("builder")` を呼ぶ
- Then: `id` が `"consent"`、`kind` が `"gate"`、`ask` が `"deferred-consent"` で、`consent(ctx)` が `{ timing: "now", reason: "上限を超えるリスクの受け入れ（事後同意）" }` を返し、`accepts` と `reopens` を持つ

### consentStep: step lint と conductor lint を通る
- 対応: —
- Given: architect・builder・patch に同意ゲートを置き、`ASKS` に `deferred-consent` を足したリポジトリ
- When: `hikyaku step lint` と `hikyaku conductor lint` を実行する
- Then: どちらも終了コード 0 で、問題を出さない

### consentStep: builder の手順で retrospective と pr の間に並ぶ
- 対応: —
- Given: `BUILDER_STEPS` の定義
- When: ステップの ID の並びを読む
- Then: `"retrospective"`, `"consent"`, `"pr"`, `"publish"` の順に並ぶ

### consentStep: architect の手順で pr の直前に並ぶ
- 対応: —
- Given: `ARCHITECT_STEPS` の定義
- When: ステップの ID の並びを読む
- Then: `"consent"` が `"pr"` の直前にある

### consentStep: patch の手順で publish の直前に並ぶ
- 対応: —
- Given: patch の steps 定義
- When: ステップの ID の並びを読む
- Then: `"consent"` が `"publish"` の直前にあり、`"pr"`（Draft PR）の前には無い

### consentStep: planner と close-cycle には同意ゲートが無い
- 対応: —
- Given: planner と close-cycle の steps 定義
- When: ステップの ID の一覧を読む
- Then: どちらにも `"consent"` が無い

### consentStep(when): build-01 に対象があると、pr の前に同意ゲートが現れる
- 対応: US-19.5
- Given: サイクル `001-test` の build-01 で retrospective まで完了し、`ledger open build-01 --type risk --when merge --who user --summary "キャッシュの無効化を遅らせる" --premises app.data --loses "古いデータを返さない"` で事項を記録済み
- When: `hikyaku step next build-01 --json` を実行する
- Then: 現在のステップが `consent`（gate、ask `deferred-consent`、同意）になり、`args.items` に記録した事項の ID が入る

### consentStep(when): 対象が無ければ同意ゲートは現れない
- 対応: US-19.5
- Given: build-01 で retrospective まで完了し、`decisions.jsonl` に `when=merge@build-01` の `question`（who=user）だけがある
- When: `hikyaku step next build-01 --json` を実行する
- Then: 現在のステップが `pr` になり、`step status build-01` にも `consent` が出ない

### consentStep(when): architect の通常の回で対象があると、pr の前に同意ゲートが現れる
- 対応: US-19.5
- Given: architect の通常の回で retrospective まで完了し、`ledger open architect --type risk --when merge --who user --summary "移行を後回しにする" --premises app.data --loses "移行の検証"` で `architect.1-xxxx` を記録済み
- When: `hikyaku step next architect 001 --json` を実行する
- Then: 現在のステップが `consent`（ask `deferred-consent`）になり、`args.items` に `architect.1-xxxx` が入る

### consentStep(when): サイクルに属す patch で対象があると、publish の前に同意ゲートが現れる
- 対応: US-19.5
- Given: サイクル `001-test` に属す patch の作業単位 `patch-202611-fix-x`（ディレクトリ `docs/hikyaku/cycles/001-test/patches/202611/fix-x/`）で persist まで完了し（P2・write はサイクルに属すので外れる）、その単位の `decisions.jsonl` に `{ type: "risk", who: "user", when: "merge@patch-202611-fix-x" }` の `patch-202611-fix-x.1-aaaa` がある
- When: `hikyaku step next patch-202611-fix-x 001 --json` を実行する
- Then: 現在のステップが `consent` で、`args.items` に `patch-202611-fix-x.1-aaaa` が入る

### consentStep(when): サイクルに属さない patch には現れない
- 対応: —
- Given: サイクルに属さない patch の作業単位 `patch-202611-fix-y`（ディレクトリ `docs/hikyaku/patches/202611/fix-y/`）で persist まで完了し、P2 は承認・write は done
- When: `hikyaku step next patch-202611-fix-y --json` を実行する
- Then: 現在のステップが `publish` で、手順に `consent` が無い

### consentStep(when): 差し戻しの回の architect には現れない
- 対応: —
- Given: `step restart architect --round return` で始めた回で、architect の `decisions.jsonl` に `{ type: "risk", who: "user", when: "merge@architect" }` がある
- When: `hikyaku step status architect --json` を実行する
- Then: ステップの一覧に `consent` も `pr` も無い

### consentStep(when): conductor の子では現れない
- 対応: —
- Given: 「build-01 に対象があると、pr の前に同意ゲートが現れる」と同じ記録
- When: 環境変数 `HIKYAKU_CONDUCTOR_CHILD=1` を付けて `hikyaku step next build-01 --json` を実行する
- Then: 現在のステップが `pr` になり、手順に `consent` が無い

### consentStep(when): 作業単位のファイルが壊れていれば安全側で手順に入れる
- 対応: —
- Given: build-01 の `decisions.jsonl` の末尾に `{broken` の行がある
- When: `hikyaku step where --json` で build-01 の手順の位置を読む
- Then: 例外で落ちず、build-01 の手順に `consent` が含まれる

### consentStep(when): 別の単位で記録した merge@build-01 の事項だけでは現れない
- 対応: —
- Given: architect の `decisions.jsonl` にだけ `{ type: "risk", who: "user", when: "merge@build-01" }` があり、build-01 のファイルには無い。build-01 は retrospective まで完了
- When: `hikyaku step next build-01 --json` を実行する
- Then: 現在のステップが `pr` で、`consent` は手順に無い（止めるのは pr の accepts。下の pr のシナリオで確かめる）

### consentStep(args): 手順の位置だけを読む経路では items が空
- 対応: —
- Given: build-01 に対象の事項 `build-01.1-aaaa` があり、build-02 の `decisions.jsonl` の末尾に `{broken` の行がある。build-01 は retrospective まで完了
- When: `positionOnly: true` の StepContext で consent の `args` を評価する（Stop フック・`step where`・conductor parse は共通に `positionOnly` の評価を通るので、経路はこの1つで代表する）
- Then: `args.items` が空の一覧で、例外を投げない

### consentStep(when): step where は他の単位の記録が壊れていても build-01 の consent を位置として返す
- 対応: —
- Given: 上と同じ記録（build-02 の `decisions.jsonl` が壊れている）
- When: build-01 のブランチで `hikyaku step where --json` を実行する
- Then: 終了コード 0 で、現在のステップが `consent`

### consentStep(accepts): 決定の無い項目があると承認を受け付けない
- 対応: US-20.8
- Given: build-01 の現在地が `consent` で、事項 `build-01.1-aaaa` に決定が無い
- When: `hikyaku step report build-01 consent --result approved --input "一覧を確認した"` を実行する
- Then: 終了コードが 0 以外で、エラーに `build-01.1-aaaa` と `skills/builder/steps/consent.md` が含まれ、`ledger decide` のコマンドは含まれない。progress.jsonl に approved が増えない

### consentStep(accepts): 最新が rejected の項目があると承認を受け付けない
- 対応: US-20.8
- Given: 事項 `build-01.1-aaaa` に `ledger decide build-01 build-01.1-aaaa --decision rejected --by user --input "受け入れない"` を記録済み
- When: `hikyaku step report build-01 consent --result approved --input "一覧を確認した"` を実行する
- Then: 終了コードが 0 以外で、エラーに `build-01.1-aaaa` が含まれる

### consentStep(accepts): 全項目にユーザーの決定があれば承認できる
- 対応: US-20.8
- Given: 事項 `build-01.1-aaaa`（risk）に `--decision consented --by user --input "受け入れる"`、`build-01.2-bbbb`（objection, 高）に `--decision consented --by user --input "進める" --accepts "ログに残ることを受け入れる"` を記録済み
- When: `hikyaku step report build-01 consent --result approved --input "一覧を確認した"` を実行する
- Then: 終了コード 0 で、`step next build-01` の現在地が `pr` になる

### consentStep(accepts): 高の異議に受け入れの言葉が無いと承認を受け付けない
- 対応: US-20.8
- Given: 事項 `build-01.1-aaaa`（objection, harm=高, merge@build-01, user）に `--decision consented --by user --input "進める"`（`--accepts` なし）を記録済み
- When: `hikyaku step report build-01 consent --result approved --input "一覧を確認した"` を実行する
- Then: 終了コードが 0 以外で、エラーに `build-01.1-aaaa` が含まれる

### consentStep(accepts): 別の単位で記録した merge@build-01 の事項も検査する
- 対応: —
- Given: build-01 に対象 `build-01.1-aaaa`（consented 済み）があり、architect にも `architect.1-cccc`（risk, merge@build-01, user, 決定なし）がある
- When: `hikyaku step report build-01 consent --result approved --input "一覧を確認した"` を実行する
- Then: 終了コードが 0 以外で、エラーに `architect.1-cccc` が含まれる

### consentStep(reopens): 承認のあとに決定の無い対象が足されると現在地に戻る
- 対応: US-19.6
- Given: build-01 の consent を承認済みで、そのあと `ledger open build-01 --type risk --when merge --who user --summary "再試行を省く"` で新しい事項を記録した
- When: `hikyaku step next build-01 --json` を実行する
- Then: 現在のステップが `consent` に戻り、note に戻った理由が示される

### consentStep(reopens): 承認のあとに足された事項に決定があれば戻らない
- 対応: —
- Given: build-01 の consent を承認済みで、そのあと記録した対象の事項にユーザーの consented を記録した
- When: `hikyaku step next build-01 --json` を実行する
- Then: 現在のステップが `pr` のまま

### consentStep(reopens): 対象でない事項が足されても戻らない
- 対応: —
- Given: build-01 の consent を承認済みで、そのあと `--type question --when merge --who user` の事項を記録した
- When: `hikyaku step next build-01 --json` を実行する
- Then: 現在のステップが `pr` のまま

### consentProblem: サイクルが無ければ問題なし
- 対応: —
- Given: `ctx.cycle` が undefined の StepContext（サイクルに属さない patch）
- When: `consentProblem(ctx)` を呼ぶ
- Then: `undefined` を返す

### consentProblem: サイクルの記録が読めなければ受け付けない
- 対応: —
- Given: build-01 の `decisions.jsonl` は正常で、build-02 の `decisions.jsonl` が壊れている
- When: build-01 の ctx で `consentProblem(ctx)` を呼ぶ
- Then: `readUnitLedger` に倒さず、読めないことを理由にした文字列を返す（undefined ではない）

### consentProblem: 決定が足りなければ ID と consent.md の案内を返す
- 対応: US-20.8
- Given: build-01 に決定の無い対象 `build-01.1-aaaa` と `build-01.2-bbbb` がある
- When: `consentStep("builder")` の ctx で `consentProblem(ctx)` を呼ぶ
- Then: 返す文字列に `build-01.1-aaaa`・`build-01.2-bbbb`・`skills/builder/steps/consent.md` が含まれる

## 各スキルの pr / publish の accepts

### builder pr: 決定の無い対象があると done を受け付けない
- 対応: US-20.8
- Given: build-01 に決定の無い対象 `build-01.1-aaaa` がある（同意ゲートは承認しないままの状態を、記録の並びで作る）
- When: `hikyaku step report build-01 pr --result done --pr 12` を実行する
- Then: 終了コードが 0 以外で、エラーに「pr の完了の条件を満たしていません」と `build-01.1-aaaa` が含まれる

### builder pr: 最新が rejected の対象があると done を受け付けない
- 対応: US-20.8
- Given: build-01 の対象 `build-01.1-aaaa` に by=user の consented のあと、より新しい by=user の rejected がある（conductor の子で consent を外し、pr を現在地にする）
- When: `HIKYAKU_CONDUCTOR_CHILD=1` を付けて `hikyaku step report build-01 pr --result done --pr 12` を実行する
- Then: 終了コードが 0 以外で、エラーに `build-01.1-aaaa` が含まれる

### builder pr: 別の単位で記録した merge@build-01 の事項を止める
- 対応: —
- Given: build-01 のファイルには対象が無く（同意ゲートは現れない）、architect に決定の無い `architect.1-cccc`（risk, merge@build-01, user）がある
- When: `hikyaku step report build-01 pr --result done --pr 12` を実行する
- Then: 終了コードが 0 以外で、エラーに `architect.1-cccc` が含まれる

### builder pr: 対象が無ければ従来どおり done できる
- 対応: —
- Given: サイクルに `when=merge@` の risk・objection が1件も無い。build-01 は retrospective まで完了
- When: `hikyaku step report build-01 pr --result done --pr 12` を実行する
- Then: 終了コード 0 で完了を記録する

### builder pr: conductor の子でも accepts は外れない
- 対応: —
- Given: build-01 に決定の無い対象 `build-01.1-aaaa` がある
- When: `HIKYAKU_CONDUCTOR_CHILD=1` を付けて `hikyaku step report build-01 pr --result done --pr 12` を実行する
- Then: 終了コードが 0 以外で、エラーに `build-01.1-aaaa` が含まれる

### builder pr: conductor の子でも全項目に決定があれば done できる
- 対応: —
- Given: build-01 の対象 `build-01.1-aaaa` に by=user の consented がある
- When: `HIKYAKU_CONDUCTOR_CHILD=1` を付けて `hikyaku step report build-01 pr --result done --pr 12` を実行する
- Then: 終了コード 0 で完了を記録する

### architect pr: 決定の無い merge@architect の対象があると done を受け付けない
- 対応: —
- Given: architect の `decisions.jsonl` に決定の無い `architect.1-aaaa`（risk, merge@architect, user）がある
- When: `hikyaku step report architect pr --result done --pr 5` を実行する
- Then: 終了コードが 0 以外で、エラーに `architect.1-aaaa` が含まれる

### patch publish: 決定の無い対象があると done を受け付けない
- 対応: —
- Given: サイクル `001-test` に属す patch の作業単位 `patch-202611-fix-x` に、決定の無い対象 `patch-202611-fix-x.1-aaaa`（risk, merge@patch-202611-fix-x, user）があり、conductor の子で consent を外して publish を現在地にしている
- When: `HIKYAKU_CONDUCTOR_CHILD=1` を付けて `hikyaku step report patch-202611-fix-x publish 001 --result done` を実行する
- Then: 終了コードが 0 以外で、エラーに事項の ID と `skills/patch/steps/consent.md` が含まれる

### planner pr: merge@plan の who=user の対象が決定なしなら done を受け付けない
- 対応: —
- Given: planning の `decisions.jsonl` に決定の無い `plan.1-aaaa`（risk, merge@plan, user）がある
- When: `hikyaku step report plan pr --result done --pr 3` を実行する
- Then: 終了コードが 0 以外で、エラーに `plan.1-aaaa` と、その場でユーザーに示して決定を記録する旨が含まれ、consent.md への案内は含まれない

### close-cycle pr: merge@close の対象が決定なしなら done を受け付けない
- 対応: —
- Given: サイクル直下の `decisions.jsonl` に決定の無い `close.1-aaaa`（objection, harm=高, merge@close, user）がある
- When: `hikyaku step report close pr --result done --pr 40` を実行する
- Then: 終了コードが 0 以外で、エラーに `close.1-aaaa` が含まれる

### step.mts: gate の approved で accepts を持たないゲートは従来どおり
- 対応: —
- Given: build-01 の現在地が `G8`（accepts を持たない gate）
- When: `hikyaku step report build-01 G8 --result approved` を実行する
- Then: 終了コード 0 で承認を記録する

### step.mts: gate の rejected では accepts を確かめない
- 対応: —
- Given: build-01 の現在地が `consent` で、決定の無い対象 `build-01.1-aaaa` がある
- When: `hikyaku step report build-01 consent --result rejected --input "一覧を見直したい"` を実行する
- Then: 終了コード 0 で rejected を記録する

## ledger consent-list

### consent-list: 1項目を3行で示す
- 対応: US-20.7
- Given: build-01 に `build-01.1-aaaa`（risk, summary "キャッシュの無効化を遅らせる", premises `app.data`, loses "古いデータを返さない", 決定なし）がある
- When: `hikyaku ledger consent-list build-01` を実行する
- Then: ID と決定の状態（決定なし）の見出しの下に、「受け入れたリスク: キャッシュの無効化を遅らせる」「拠り所の前提: app.data」「失うもの: 古いデータを返さない」の3行が出て、根拠・害・いつの行は出ない

### consent-list: --full で根拠・害・いつ・決定の記録まで示す
- 対応: US-20.7
- Given: build-01 に `build-01.1-aaaa`（objection, basis "app.data=personal と食い違う", harm 高, when merge@build-01）と、その決定 `consented`（by user, input "進める", accepts "ログに残ることを受け入れる"）がある
- When: `hikyaku ledger consent-list build-01 --full` を実行する
- Then: 3行に加えて「app.data=personal と食い違う」「高」「merge@build-01」と、決定の記録（consented・ユーザー・「ログに残ることを受け入れる」）が出る

### consent-list: 決定の状態を見出しに示す
- 対応: US-20.8
- Given: build-01 に、決定なしの `build-01.1-aaaa`、consented の `build-01.2-bbbb`、最新が rejected の `build-01.3-cccc` がある
- When: `hikyaku ledger consent-list build-01` を実行する
- Then: 3項目がそれぞれ ID と、決定なし・consented・rejected を区別できる状態の見出しで出る

### consent-list: 別の単位で記録した merge@build-01 の事項も含める
- 対応: US-20.5
- Given: architect に `architect.1-aaaa`（risk, merge@build-01, user）、build-01 に `build-01.1-bbbb`（risk, merge@build-01, user）がある
- When: `hikyaku ledger consent-list build-01` を実行する
- Then: 両方の ID が出る

### consent-list: 対象外の事項は出さない
- 対応: —
- Given: build-01 に `question`（merge@build-01, user）と `risk`（merge@build-02, user）と `risk`（merge@build-01, ai:build-01）だけがある
- When: `hikyaku ledger consent-list build-01` を実行する
- Then: どの事項も出ない（終了コード 0）

### consent-list: --json で項目と決定を機械可読で返す
- 対応: US-20.7
- Given: build-01 に `build-01.1-aaaa`（risk, premises `app.data`, loses "古いデータを返さない", 決定なし）がある
- When: `hikyaku ledger consent-list build-01 --json` を実行する
- Then: JSON として解釈でき、項目の `id` が `"build-01.1-aaaa"`、`summary`・`premises`・`loses` を含み、`latest` が `null` になる

### consent-list: 書き込まない
- 対応: —
- Given: build-01 に対象の事項がある
- When: `snapshot` を取ってから `hikyaku ledger consent-list build-01 --full` を実行し、もう一度 `snapshot` を取る
- Then: 2つの snapshot が一致する

## ledger pr-section

### pr-section: 決定のある対象を「受け入れたリスク（事後同意）」に出す
- 対応: US-20.5
- Given: build-01 の対象 `build-01.1-aaaa`（risk, summary "キャッシュの無効化を遅らせる"）に by=user の consented（input "受け入れる"）がある
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: Markdown の「受け入れたリスク（事後同意）」の節に `build-01.1-aaaa`、「キャッシュの無効化を遅らせる」、consented の決定が出る

### pr-section: 決定の無い対象は「受け入れた」の見出しの下に出さない
- 対応: US-20.5
- Given: build-01 に決定の無い対象 `build-01.2-bbbb` と、consented の対象 `build-01.1-aaaa` がある
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: `build-01.2-bbbb` は「同意の決定が無い項目」として別に出て、「受け入れたリスク（事後同意）」の節の項目には含まれない

### pr-section: 最新が rejected の事項を「未解決の退け」に出す
- 対応: US-20.10
- Given: build-01 の対象 `build-01.1-aaaa` の最新の決定が rejected（by user, input "受け入れない"）
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: 「未解決の退け」の節に `build-01.1-aaaa` が出て、「受け入れたリスク（事後同意）」の受け入れた項目には含まれない

### pr-section: 未解決の退けはサイクル全体から後のフェーズでも出し続ける
- 対応: US-20.10
- Given: architect の事項 `architect.1-aaaa`（provisional, when gate:G4@architect）の最新の決定が rejected で、build-02 には対象が無い
- When: `hikyaku ledger pr-section build-02` を実行する
- Then: 「未解決の退け」の節に `architect.1-aaaa` が出る

### pr-section: resolved を記録すると未解決の退けから消える
- 対応: US-20.10
- Given: 「最新が rejected の事項を未解決の退けに出す」の記録のあとに、`build-01.1-aaaa` へ by=user の resolved（input "作り直した"）を記録した
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: 「未解決の退け」の節が出ない

### pr-section: when=merge@その単位の未決の question・provisional を「マージの前に決める事項」に出す
- 対応: US-19.5
- Given: build-01 に `build-01.1-aaaa`（question, merge@build-01, user, 決定なし）と `build-01.2-bbbb`（provisional, merge@build-01, ai:build-01, 決定なし）がある
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: 「マージの前に決める事項」の節に両方の ID が出る

### pr-section: マージの前に決める事項から決定済みと別の単位のものを外す
- 対応: —
- Given: build-01 に `build-01.1-aaaa`（question, merge@build-01, 決定 decided）と `build-01.2-bbbb`（question, merge@build-02, 決定なし）がある
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: 「マージの前に決める事項」の節が出ない

### pr-section: 期限を過ぎた未決の事項をサイクル全体から出す
- 対応: US-19.6
- Given: plan の事項 `plan.1-aaaa`（question, when phase:architect, user, 決定なし）を記録し、その後 build-01 の progress.jsonl に記録がある（`timingOf` が `overdue` を返す）
- When: `hikyaku ledger pr-section build-02` を実行する
- Then: 「期限を過ぎた事項」の節に `plan.1-aaaa` が出る

### pr-section: 期限が来ていない未決の事項は期限を過ぎた事項に出さない
- 対応: US-19.6
- Given: `build-01.1-aaaa`（question, when close, user, 決定なし）があり、サイクルは active で close-cycle の記録が無い（`timingOf` が `pending`）
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: 「期限を過ぎた事項」の節が出ない

### timingOf: 同意ゲートのある builder では、merge@build-01 の期限が consent に来たときに「期限が来た」になる
- 対応: US-19.6
- Given: build-01 で `when=merge@build-01`・who=user の未決の question `build-01.2-bbbb` と、決定の無い risk の対象があり、build-01 は retrospective まで完了（現在地が consent）
- When: `hikyaku ledger list 001 --json` を実行する
- Then: `build-01.2-bbbb` の `timing` が `due`。retrospective より前（現在地が handoff）の時点では `pending`

### pr-section: どの節も中身が無ければ空を出す
- 対応: —
- Given: サイクルに decisions.jsonl が1件も無い
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: 終了コード 0 で、標準出力が空文字列

### pr-section: 中身のある節だけを出す
- 対応: —
- Given: 最新が rejected の事項だけがあり、ほかの節の対象が無い
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: 「未解決の退け」の見出しだけが出て、「受け入れたリスク（事後同意）」「マージの前に決める事項」「期限を過ぎた事項」の見出しは出ない

### pr-section: 4節がそろうときの並び
- 対応: US-20.5
- Given: 4節それぞれに当たる事項（consented の対象・rejected の事項・merge@build-01 の未決の question・overdue の未決の事項）がある
- When: `hikyaku ledger pr-section build-01` を実行する
- Then: 「受け入れたリスク（事後同意）」「未解決の退け」「マージの前に決める事項」「期限を過ぎた事項」の4つの見出しがこの順に出る

### pr-section: --json で節ごとの項目を返す
- 対応: —
- Given: 「4節がそろうときの並び」と同じ記録
- When: `hikyaku ledger pr-section build-01 --json` を実行する
- Then: JSON として解釈でき、4節それぞれの項目の ID を区別して取り出せる

### pr-section: 書き込まない
- 対応: —
- Given: 「4節がそろうときの並び」と同じ記録
- When: `snapshot` を取ってから `hikyaku ledger pr-section build-01` を実行し、もう一度 `snapshot` を取る
- Then: 2つの snapshot が一致する
