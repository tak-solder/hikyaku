# Build 03: 未決事項と決定の記録（ledger の中核） テストシナリオ

## scripts/lib/jsonl.mts

### parseJsonl: 空行を読み飛ばして全レコードを返す
- 対応: —
- Given: `{"record":"open",...}\n\n{"record":"decide",...}\n` と、両方を受け入れる isRecord
- When: `parseJsonl(text, "build-03/decisions.jsonl", isRecord, labels)`
- Then: 2件の配列がファイル順で返る

### parseJsonl: JSON でない行は行番号つきでエラー
- 対応: —
- Given: 1行目が正しいレコード、2行目が `{"record":"open",` （途中で切れた行）
- When: `parseJsonl` を呼ぶ
- Then: HikyakuError が投げられ、メッセージに source と「2行目」が含まれる（黙って捨てない）

### parseJsonl: JSON として正しいが形の合わない行は行番号つきでエラー
- 対応: —
- Given: 1行目が正しいレコード、2行目が `{"record":"bogus"}`（isRecord が false）
- When: `parseJsonl` を呼ぶ
- Then: HikyakuError が投げられ、メッセージに source と「2行目」が含まれる

### readJsonl / appendJsonl: ファイルが無ければ空、追記でディレクトリを作る
- 対応: —
- Given: 存在しない `build-09/decisions.jsonl` のパス
- When: `readJsonl` を呼び、続けて `appendJsonl` で1件書いてから再度 `readJsonl`
- Then: 1回目は `[]`、追記後はディレクトリが作られ1件が読める

## scripts/lib/ledger.mts — 「いつ」（parseWhen / formatWhen）

### parseWhen: 語彙の5種を受け付ける
- 対応: US-19.2
- Given: tasklist に build-01・build-02 があるサイクル、opening=`build-02`
- When: `now` / `phase:architect` / `gate:G4` / `merge` / `close` を順に parseWhen
- Then: それぞれ `{kind:"now"}` / `{kind:"phase",phase:"architect"}` / `{kind:"gate",gate:"G4",unit:"architect"}` / `{kind:"merge",unit:"build-02"}` / `{kind:"close"}` が返る

### parseWhen: 語彙外の「いつ」を拒否する
- 対応: US-19.2
- Given: 同上のサイクル
- When: `2026-12-01`、`来週`、`after:build-01`、空文字を parseWhen
- Then: どれも HikyakuError（日付・自由文は受け付けない）

### parseWhen: 存在しないゲート ID を拒否する
- 対応: US-19.2
- Given: `--when "gate:G9"`（どのスキルの steps 定義にも G9 のゲートが無い）
- When: parseWhen
- Then: HikyakuError（参照先の不在）

### parseWhen: tasklist に無いビルド・サイクルに無い patch を参照すると拒否する
- 対応: US-19.2
- Given: tasklist に build-01・build-02 だけ、サイクルに `patches/202611/fix-typo/` だけがある
- When: `phase:build-07`、`merge@build-07`、`merge@patch-202611-other` を parseWhen
- Then: どれも HikyakuError。`merge@patch-202611-fix-typo` は受け付ける

### parseWhen: 固定フェーズのゲートは @unit 省略でそのフェーズを補う（解釈）
- 対応: US-19.2
- Given: opening=`build-02`
- When: `gate:G1`、`gate:G3`、`gate:G10` を parseWhen し formatWhen
- Then: それぞれ `gate:G1@plan`、`gate:G3@architect`、`gate:G10@close` として保存される

### parseWhen: 固定でないゲートは @unit 省略で記録した単位を補う（解釈）
- 対応: US-19.2
- Given: opening=`build-02`
- When: `gate:G8` を parseWhen
- Then: `{kind:"gate",gate:"G8",unit:"build-02"}`、formatWhen は `gate:G8@build-02`

### parseWhen: ゲートを担わない単位を指すとエラー（解釈）
- 対応: US-19.2
- Given: tasklist に build-01 がある
- When: `gate:G8@architect`、`gate:G2@build-01`、`gate:P1@build-01` を parseWhen
- Then: どれも HikyakuError（G を持つスキルがその unit を担わない）

### parseWhen: 内部スキルの G6 は呼び出し元の単位で受け付ける（解釈）
- 対応: US-19.2
- Given: tasklist に build-01 がある
- When: `gate:G6@architect`、`gate:G6@build-01`、`gate:G6@plan` を parseWhen
- Then: 前2つは受け付け、`@plan` は HikyakuError

## scripts/lib/ledger.mts — 「誰が」（parseWho / whoLabel）

### parseWho / whoLabel: 3種の「誰が」を受け付けて表示名に変換する
- 対応: US-19.3
- Given: なし
- When: `user`、`ai:build-03`、`supervisor` を parseWho し whoLabel
- Then: parseWho はそのままの値を返し、whoLabel は「ユーザー」/「AI（build-03）」/「監督」

### parseWho: 語彙外とフェーズでない ai を拒否する
- 対応: US-19.3
- Given: なし
- When: `human`、`ai`、`ai:`、`ai:reviewer`、`conductor` を parseWho
- Then: どれも HikyakuError

## scripts/lib/ledger.mts — 前提の参照（parsePremise / parsePremises）

### parsePremise: 書式の8種を受け付ける
- 対応: —
- Given: なし
- When: `app.exposure`、`app.data`、`app.impact`、`app.merge_gate`、`area:billing`、`constraints#no-external-send`、`adr:20261116-pending-items-ledger.md`、`assumption:外部公開はしない` を parsePremise
- Then: どれも受け付ける

### parsePremise: 書式に無い参照を拒否する
- 対応: —
- Given: なし
- When: `app.owner`、`area:`、`constraints`、`docs/foo.md`、`assumption:` を parsePremise
- Then: どれも HikyakuError

### parsePremises: カンマ区切りで配列にし、要素ごとに検査する（解釈）
- 対応: —
- Given: `--premises "app.exposure,adr:20261116-pending-items-ledger.md"`
- When: parsePremises
- Then: `["app.exposure","adr:20261116-pending-items-ledger.md"]`。`"app.exposure,app.bogus"` と `"assumption:社内向け,外部は無い"`（文中のカンマで区切られ `外部は無い` が書式外になる）は HikyakuError

## scripts/lib/ledger.mts — 付け替えの禁止（assertDecider）

### assertDecider: who=user の事項に supervisor の決定を拒否する
- 対応: US-19.7
- Given: `who:"user"` の OpenRecord
- When: `assertDecider(item, "supervisor", "OK")`
- Then: HikyakuError

### assertDecider: who=user の事項に ai の決定を拒否する
- 対応: US-19.7
- Given: `who:"user"` の OpenRecord
- When: `assertDecider(item, "ai:build-03", undefined)`
- Then: HikyakuError

### assertDecider: by=user は input が必須
- 対応: US-19.7
- Given: `who:"user"` の OpenRecord
- When: `assertDecider(item, "user", undefined)` と `assertDecider(item, "user", "その方針で進めて")`
- Then: 前者は HikyakuError、後者は通る

### assertDecider: ai の事項は ai か user が、supervisor の事項は supervisor か user が決められる（解釈）
- 対応: US-19.7
- Given: `who:"ai:architect"` と `who:"supervisor"` の OpenRecord
- When: ai の事項に `ai:architect`・`ai:build-02`・`user`（input あり）・`supervisor`、supervisor の事項に `supervisor`・`user`（input あり）・`ai:build-02`
- Then: ai の事項への `ai:build-02`（別のフェーズの AI。コードレビュー2回目の指摘で、同じフェーズだけに改めた）と `supervisor`、supervisor の事項への `ai:build-02` が HikyakuError。CLI では `--by ai:<フェーズ>` は決めた作業単位と同じフェーズだけ

## scripts/lib/ledger.mts — 読み書きと状態の導出

### openItem: 同じ ID の2回目の open を拒否する
- 対応: US-19.7
- Given: `build-02.1` の open が build-02/decisions.jsonl にある
- When: 同じ ID・`who:"supervisor"` の OpenRecord で openItem
- Then: HikyakuError、ファイルは変わらない（who を変える経路にならない）

### decideItem: 決定は決めた単位のファイルに書き、事項のファイルは変えない
- 対応: US-19.4
- Given: `design/decisions.jsonl` に `architect.1` の open
- When: unit=`build-02` の DecideRecord で decideItem
- Then: `build-02/decisions.jsonl` に1行追記され、`design/decisions.jsonl` のバイト列は変わらない

### readLedger: サイクルの全単位のファイルを読み ID で結ぶ
- 対応: US-19.4
- Given: 直下・planning・design・build-01・`patches/202611/fix-typo/` に decisions.jsonl があり、`plan.1` の decide が build-01 にある
- When: readLedger
- Then: `plan.1` の decisions に build-01 の decide が入り、全単位の事項が返る

### readLedger: 最新の decide で決まったかを導く
- 対応: US-19.4
- Given: `architect.1` に decide が3件（design/ に `decided`@09:00 と `rejected`@10:00、build-01/ に `resolved`@11:00）
- When: readLedger
- Then: latest は `at` が最も遅い `resolved`（ファイルの読み順ではなく `at` で決まる）

### readLedger: 同時刻の決定は読み順で後のものを最新とする（解釈）
- 対応: US-19.4
- Given: `architect.1` に同じ `at`（10:00）の decide が2件。design/ に `rejected`、build-02/ に `decided`。読み順はサイクル直下 → planning → design → build-NN（番号順）→ patches（パス順）
- When: readLedger
- Then: latest は build-02/ の `decided`。同じファイルに同時刻の2件があれば、行の後のもの

### readLedger: decide が無い事項は未決で、状態の列を持たない
- 対応: US-19.4
- Given: `plan.1` の open だけ
- When: readLedger
- Then: latest は undefined。レコードに status 等の状態の欄は無い

### summarize: rejected が最新なら未解決の退け、resolved で消える
- 対応: US-19.6
- Given: `build-02.1` の最新が `rejected`、`build-02.2` は `rejected` の後に `resolved`
- When: summarize
- Then: rejected に `build-02.1` だけが入る。どちらも due・open には入らない

## scripts/lib/ledger.mts — 期限の判定（timingOf）

### timingOf: now は記録した時点から来ていて過ぎない（解釈）
- 対応: US-19.5
- Given: `when:"now"` の未決の事項、どの単位にも事項より後の記録がある
- When: timingOf
- Then: `due`（`overdue` にはならない）

### timingOf: phase:plan は plan の記録で来て、architect の記録で過ぎた（解釈）
- 対応: US-19.6
- Given: create で記録した `phase:plan` の事項（at=09:00）
- When: planning に 09:10 の記録だけ / さらに design に 10:00 の記録 で timingOf
- Then: `due` / `overdue`

### timingOf: phase:close は close-cycle の記録で来て、active でなくなって過ぎた（解釈）
- 対応: US-19.6
- Given: build-02 で記録した `phase:close` の事項（at=09:00）
- When: 直下に事項より後の close-cycle の記録あり・cycles.md が active / active でない で timingOf
- Then: `due` / `overdue`

### timingOf: phase:architect は architect に事項より後の記録があれば来た（解釈）
- 対応: US-19.5
- Given: plan で記録した `phase:architect` の事項（at=10:00）、architect の progress に 10:05 の記録
- When: timingOf
- Then: `due`。architect の記録が 09:50 だけなら `pending`

### timingOf: phase:architect はいずれかの build-NN に記録があれば過ぎた（解釈）
- 対応: US-19.6
- Given: 同上の事項、build-01 に 11:00 の記録、決定なし
- When: timingOf
- Then: `overdue`

### timingOf: phase:build-NN はマージされたら過ぎた（解釈）
- 対応: US-19.6
- Given: `phase:build-02` の事項、build-02 に事項より後の記録、`merged` に build-02
- When: timingOf
- Then: `overdue`。`merged` が空なら `due`、undefined（directive）でも `due`

### timingOf: phase:patch は過ぎない（解釈）
- 対応: US-19.5
- Given: `phase:patch-202611-fix-typo` の事項、その patch に事項より後の完了まで含む記録
- When: timingOf
- Then: `due`（`overdue` にならない）

### timingOf: 回は事項の at より後の記録だけを見る（解釈）
- 対応: US-19.5
- Given: architect の add の回（11:00 に restart）で 12:00 に記録した `gate:G4@architect` の事項。restart の後に完了したのは survey（G4 より前）だけで、現在のステップは G4 より前。G4 の `approved` は前の回の 09:00 だけ
- When: timingOf
- Then: `pending`（前の回の承認で過ぎたにならない）

### timingOf: 前の回の pr の記録で merge が来たにならない（解釈）
- 対応: US-19.5
- Given: architect の add の回で 12:00 に記録した `merge@architect` の事項。pr の完了は前の回の 09:00 だけで、今の回の現在のステップは pr より前
- When: timingOf
- Then: `pending`

### timingOf: gate は現在のステップが G なら来た（解釈）
- 対応: US-19.5
- Given: `gate:G8@build-02` の事項、build-02 の現在のステップが G8
- When: timingOf
- Then: `due`

### timingOf: gate は G が approved で過ぎた（解釈）
- 対応: US-19.6
- Given: 同上の事項、事項より後に G8 の `approved` の記録、決定なし
- When: timingOf
- Then: `overdue`

### timingOf: 外れたゲートは後ろのステップの完了で過ぎた（解釈）
- 対応: US-19.6
- Given: `gate:G7@build-02` の事項、プロファイルで G7 が外れていて G7 の記録が無く、事項より後に G7 より後ろのステップ（G8）の完了の記録がある
- When: timingOf
- Then: `overdue`（外れたゲートの事項が埋もれない）

### timingOf: G6 は呼び出し元の単位の記録で来た・過ぎたを判定する（解釈）
- 対応: US-19.5
- Given: `gate:G6@build-02` の事項、build-02 の単位として数える build-manager の G6 の記録
- When: 事項より後に G6 の記録だけがあるときと、G6 の `approved` があるときに timingOf
- Then: 前者は `due`、後者は `overdue`

### timingOf: merge の区切りは pr（解釈）
- 対応: US-19.5
- Given: `merge@build-02` の事項、consent のステップが無い builder、`merged` は空
- When: build-02 の現在のステップが pr の手前 / pr / 完了のときに timingOf
- Then: `pending` / `due` / `due`

### timingOf: merge の区切りは consent があればそれ（解釈）
- 対応: US-19.5
- Given: ID `consent` のステップを pr の前に足した steps 定義、`merge@build-02` の事項
- When: 現在のステップが consent のときに timingOf
- Then: `due`

### timingOf: patch の merge の区切りは publish（解釈）
- 対応: US-19.5
- Given: `merge@patch-202611-fix-typo` の事項、patch の現在のステップが publish（実装より前）
- When: timingOf
- Then: `due`

### timingOf: merge は build-NN がマージされたら過ぎ、PR の記録では過ぎない（解釈）
- 対応: US-19.6
- Given: `merge@build-02` の事項、build-02 の pr の完了の記録
- When: `merged` が空 / `{build-02}` / undefined（directive）で timingOf
- Then: `due` / `overdue` / `due`

### timingOf: plan・architect・patch・close の merge は決まるまで来たのまま（解釈）
- 対応: US-19.6
- Given: `merge@architect` と `merge@patch-202611-fix-typo` の事項、どちらの単位も完了、`merged` に build-01・build-02
- When: timingOf
- Then: どちらも `due`（`overdue` にならず示され続ける）

### timingOf: close は close-cycle の記録で来て、active でなくなって過ぎた（解釈）
- 対応: US-19.6
- Given: `close` の事項
- When: 直下に記録が無い / 事項より後に close-cycle の記録あり・active / active でない で timingOf
- Then: `pending` / `due` / `overdue`

### cycleTimeline: 他の単位の現在のステップは最後の restart 後の完了の次（解釈）
- 対応: —
- Given: build-01 の progress に G7 完了、restart、その後に plan-review 完了（G7 より前）だけ
- When: cycleTimeline
- Then: build-01 の current は plan-review の次のステップ（restart 前の G7 は数えない）

### noticeLines: 期限が来た・過ぎた事項を1事項1行にする
- 対応: US-19.5
- Given: due の事項1件（`plan.1`、who=user）と overdue の事項1件（`architect.2`）
- When: `noticeLines(summarize(...))`
- Then: 2行。各行に ID・要約・「いつ」・「ユーザー」などの表示名・来た/過ぎたの区別が含まれる

## scripts/commands/ledger.mts（CLI 結合）

### ledger open: 記録して欄が show で読める
- 対応: US-19.3
- Given: サイクル 001 の build-02 が進行中の一時リポジトリ
- When: `ledger open build-02 --type risk --when merge --who user --summary "外部APIの退避" --premises "app.exposure,assumption:社内向け" --loses "安全側の再試行" --harm 高 --ask G8` の後 `ledger show build-02.1 --json`
- Then: build-02/decisions.jsonl に1行追記され、show に premises・loses・harm・ask・`when:"merge@build-02"`・step・session・hikyaku が出る

### ledger open: --dry-run は書き込まない
- 対応: —
- Given: 同上
- When: `ledger open build-02 ... --dry-run`
- Then: 終了コード0で記録予定が表示され、`snapshot` の前後でファイルが変わらない

### ledger open: 語彙外の値・存在しない参照先・書式外の前提を拒否する
- 対応: US-19.2
- Given: 同上（build-02/decisions.jsonl はまだ無い）
- When: `--when "gate:G9"`、`--when "after-review"`、`--who human`、`--premises app.owner`、`--harm 低`、`--ask nonexistent` をそれぞれ付けて open
- Then: どれも非0で終了し、decisions.jsonl は作られない

### ledger open: --ask は ASKS の ID とゲートの ID を受け付ける
- 対応: —
- Given: 上の拒否のシナリオの後の同じリポジトリ
- When: `--ask design-conflict`（ASKS）と `--ask P1`（ASKS に無いゲートの ID）でそれぞれ open
- Then: どちらも終了コード0で記録され、show の ask にその値が出る

### ledger open: サイクルに属さない patch は拒否する
- 対応: —
- Given: サイクルに属さない patch のブランチ
- When: `ledger open patch ... --when now --who user`
- Then: 非0で終了（スコープ外）

### ledger open: 外れたゲートを指すと記録して知らせる（解釈）
- 対応: US-19.6
- Given: プロファイルで G7 が外れている build-02
- When: `ledger open build-02 --when gate:G7 --who user ...`
- Then: 記録され、出力に「このゲートは今の設定では現れないので、後ろのステップに進むと期限を過ぎた事項になります」が含まれる

### ledger decide: 決定は決めた単位のファイルに書き、事項のファイルは変わらない
- 対応: US-19.4
- Given: `plan.1`（who=ai:plan）が planning/decisions.jsonl にある
- When: `ledger decide build-02 plan.1 --decision consented --by user --input "それでよい" --accepts "再試行が無いことを受け入れる"`
- Then: build-02/decisions.jsonl に decide が1行、planning/decisions.jsonl は変わらない。`ledger show plan.1 --json` で決定の input・accepts・by が読める

### ledger decide: --dry-run は書き込まない
- 対応: —
- Given: who=user の `build-02.1`
- When: `ledger decide build-02 build-02.1 --decision decided --by user --input "OK" --dry-run`
- Then: 終了コード0で記録予定が表示され、`snapshot` の前後でファイルが変わらない

### ledger decide: who=user の事項を supervisor / ai で決められない
- 対応: US-19.7
- Given: who=user の `build-02.1`
- When: `--by supervisor --input x`、`--by ai:build-02` でそれぞれ decide
- Then: どちらも非0、どのファイルにも追記されない

### ledger decide: --by user に --input が無いと拒否する
- 対応: US-19.7
- Given: who=user の `build-02.1`
- When: `ledger decide build-02 build-02.1 --decision decided --by user`
- Then: 非0、追記されない

### ledger decide: 2ブランチが同じ事項に決定を足してもマージで衝突しない
- 対応: US-19.4
- Given: main に `architect.1` の open（design/decisions.jsonl）をコミットし、ブランチ A（build-01）と B（build-02）を切る
- When: A で `ledger decide build-01 architect.1 ...`、B で `ledger decide build-02 architect.1 ...` をコミットし、main に A・B を順に `git merge`
- Then: どちらのマージも衝突せず、`ledger show architect.1 --json` に2件の決定が並び、latest は at の遅い方

### ledger list: 未決・期限・未解決の退けを示し、過ぎても示し続ける
- 対応: US-19.6
- Given: `phase:architect` の未決事項（plan で記録）、その後 build-01 の記録があり期限を過ぎた
- When: `ledger list --json`
- Then: due に timing=`overdue` で載り続ける。決定を足すと due・open から消える

## scripts/lib/steps/directive.mts（notices と Stop フック）

### buildDirective: step next の notices に期限が来た事項が載る
- 対応: US-19.5
- Given: build-02 が G8 にいて、`gate:G8@build-02` の未決事項がある
- When: `step next build-02 --json`
- Then: notices に `build-02.1` の行が1行入る

### buildDirective: 期限を過ぎた他の単位の事項も載り続ける
- 対応: US-19.6
- Given: `phase:architect` の事項（plan で記録）が overdue、build-02 を進行中
- When: `step next build-02 --json`
- Then: notices にその事項が「過ぎた」として載る。decisions.jsonl がどこにも無いサイクルでは notices は `[]`

### step hook stop / step where: 壊れた decisions.jsonl を読まず失敗しない
- 対応: —
- Given: build-02/decisions.jsonl に JSON でない行がある
- When: `step hook stop` と `step where` を実行
- Then: どちらも ledger のエラーにならず従来どおりの出力（notices: false の経路で読まない）。同じ状態で `step next` は止まらず、notices に「未決事項の記録を読めません」が載る（コードレビューの指摘で、step report が進捗を書いたあとに失敗しないように改めた）。`ledger list` は止まり、`cycle status --json` は `ledger.error` を返す

## scripts/commands/cycle.mts（status）

### cycle status --json: ledger の節を出す
- 対応: US-19.5
- Given: due の事項1件、未決で期限前の事項1件、rejected が最新の事項1件
- When: `cycle status 001 --json`
- Then: `ledger.due`・`ledger.open`・`ledger.rejected` があり、要素に id・unit・type・summary・when・who・timing（rejected は最新の決定）が入る。due の事項は `due` と `open` の両方に、期限前の事項は `open` だけに、rejected の事項は `rejected` だけに入る（open は未決の全件で、テキストの「未決の総数」はその件数）

### cycle status: マージ済みのビルドで merge の事項が過ぎたになる（解釈）
- 対応: US-19.6
- Given: build-01 がベースブランチへマージ済み（views.mergedIds に build-01）、`merge@build-01` の未決事項
- When: `cycle status 001 --json`
- Then: `ledger.due` に timing=`overdue` で載る

### cycle status: テキストの「未決事項」の節は事項が無ければ出さない
- 対応: —
- Given: decisions.jsonl が無いサイクルと、due の事項があるサイクル
- When: `cycle status 001`（テキスト）
- Then: 前者は「未決事項」の節が無く、後者は事項が1行ずつと未決の総数・未解決の退けが出る
