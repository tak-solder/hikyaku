# Build 07: conductor の走りきりと、監督は安全側にだけ倒すこと テストシナリオ

## lib/conductor.mts（SAFE_ANSWERS・safeAnswerOf）

### SAFE_ANSWERS: 確認ゲートは承認と差し戻しの両方が safe で、既定は差し戻し（解釈）
- 対応: US-15.1
- Given: 確認ゲートの ID `G2`・`G4`・`G6`・`G7`・`G8`・`G10`・`docs-link`
- When: それぞれ `safeAnswerOf(id)` を呼ぶ
- Then: どれも `choices` のキーが `approved`・`rejected` の2つ、`safe` が `["approved", "rejected"]`、`default` が `"rejected"` になる

### SAFE_ANSWERS: G3 は推奨以外の案が safe に入らない
- 対応: US-15.2
- Given: 問い `G3`
- When: `safeAnswerOf("G3")` を呼ぶ
- Then: `choices` のキーが `recommended`・`other`・`rejected`、`safe` が `["recommended", "rejected"]`（`other` を含まない）、`default` が `"recommended"` になる

### SAFE_ANSWERS: design-conflict・unsafe-split・retrospective は安全側の1つだけが safe
- 対応: US-15.1
- Given: 問い `design-conflict`・`unsafe-split`・`retrospective`
- When: それぞれ `safeAnswerOf(id)` を呼ぶ
- Then: `safe` がそれぞれ `["return"]`・`["merge"]`・`["run"]` で、`conform`・`adjust`・`redesign`・`unsafe`・`skip` は `choices` にあっても `safe` に無い

### SAFE_ANSWERS: review-findings は3つとも safe
- 対応: —
- Given: 問い `review-findings`
- When: `safeAnswerOf("review-findings")` を呼ぶ
- Then: `safe` が `fix`・`new-build`・`proceed` の3つを含む

### SAFE_ANSWERS: 表に無い問いは undefined
- 対応: —
- Given: 自由文で答える問い `questions` と、存在しない ID `no-such-ask`
- When: `safeAnswerOf("questions")`・`safeAnswerOf("no-such-ask")` を呼ぶ
- Then: どちらも `undefined` を返す

## lib/conductor.mts（resolveAsk）

### resolveAsk: safe と declaresRisk を埋める
- 対応: US-15.1
- Given: 既定の conductor 設定と、テストの `settings`
- When: `resolveAsk("G3", …)`・`resolveAsk("questions", …)`・`resolveAsk("review-findings", …)`・`resolveAsk("G8", …)` を呼ぶ
- Then: G3 の `safe` は `safeAnswerOf("G3")` と同じ値で `declaresRisk` は false、questions の `safe` は null で `declaresRisk` は true、review-findings の `declaresRisk` は true、G8 の `declaresRisk` は false になる

## CLI: conductor parse・conductor asks（safe と declaresRisk）

### conductor parse: gate の ask に safe と declaresRisk を出す
- 対応: US-15.1
- Given: 結果ファイル `r.json` の本文が `<hikyaku-gate id="G3">` のゲート
- When: `conductor parse r.json 001 --expect-digest <digest> --json` を実行する
- Then: `ask.safe.safe` が `["recommended", "rejected"]`、`ask.safe.default` が `"recommended"`、`ask.declaresRisk` が false になる

### conductor asks: 各問いに safe と declaresRisk を出す
- 対応: —
- Given: 既定の conductor 設定のワークスペース
- When: `conductor asks 001 --json` を実行する
- Then: `questions` の問いは `safe` が null で `declaresRisk` が true、`design-conflict` の問いは `safe.safe` が `["return"]` で `declaresRisk` が false になる

## lib/conductor.mts（parseFinalText・parseResultJson の waiting）

### parseFinalText: 実在する未決の事項を指す waiting は検査を外す
- 対応: US-21.4
- Given: 本文が `blocked` で、行頭に `waiting: Q-3` を持ち、行き詰まりの報告の節を持たないテキストと、`isWaitingItem: (id) => id === "Q-3"`
- When: `parseFinalText(text, { isWaitingItem })` を呼ぶ
- Then: outcome は `blocked`、`waiting` は `["Q-3"]` で、violation にならない

### parseFinalText: waiting が複数で1つでも指す先が無ければ従来どおり検査する
- 対応: —
- Given: 本文が `blocked` で `waiting: Q-3` と `waiting: Q-9` の2行を持ち、行き詰まりの報告の節を持たないテキストと、`Q-3` だけ true を返す `isWaitingItem`
- When: `parseFinalText(text, { isWaitingItem })` を呼ぶ
- Then: 行き詰まりの報告の検査が働き、violation になる

### parseFinalText: waiting の行が無い blocked は従来どおり検査する
- 対応: —
- Given: 本文が `blocked` で `waiting:` の行も行き詰まりの報告の節も持たないテキストと、常に true を返す `isWaitingItem`
- When: `parseFinalText(text, { isWaitingItem })` を呼ぶ
- Then: violation になり、`waiting` は返らない

### parseFinalText: isWaitingItem を渡さなければ waiting を信じない
- 対応: —
- Given: 本文が `blocked` で `waiting: Q-3` を持ち、行き詰まりの報告の節を持たないテキスト
- When: オプション無しで `parseFinalText(text)` を呼ぶ
- Then: 検査が外れず violation になる

### parseFinalText: 行頭でない waiting は拾わない
- 対応: —
- Given: 本文が `blocked` で、文中に「前回は waiting: Q-3 でした」とだけ書いたテキストと、常に true を返す `isWaitingItem`
- When: `parseFinalText(text, { isWaitingItem })` を呼ぶ
- Then: `waiting` は返らず、violation になる

### parseResultJson: 結果の JSON からも waiting を返す
- 対応: —
- Given: `result` が `blocked` と `waiting: Q-3` を持つ `claude -p` の結果の JSON と、`Q-3` に true を返す `isWaitingItem`
- When: `parseResultJson(raw, { isWaitingItem })` を呼ぶ
- Then: `ParsedResult.outcome` が `blocked`、`waiting` が `["Q-3"]` になる

## CLI: conductor parse（waiting）

### conductor parse: 記録にある未決の who=user・when=now の question を指せば blocked のまま waiting を返す
- 対応: US-21.4
- Given: `ledger open build-01 001 --type question --who user --when now --ask G8 --summary "既存の API を残すか"` で記録した ID を `waiting:` に置いた blocked の結果ファイル
- When: `conductor parse r.json 001 --expect-digest <digest> --json` を実行する
- Then: `outcome` が `blocked`、`waiting` にその ID が入り、violation にならない

### conductor parse: 決定済みの事項を指す waiting は検査を外さない
- 対応: —
- Given: 上の question を `ledger decide` で決定済みにした記録と、その ID を `waiting:` に置いた blocked の結果ファイル（行き詰まりの報告の節なし）
- When: `conductor parse r.json 001 --json` を実行する
- Then: violation になる

### conductor parse: who=ai や when=merge の事項を指す waiting は検査を外さない
- 対応: —
- Given: `--who ai:builder --when now` の question と、`--who user --when merge` の question をそれぞれ `waiting:` に置いた blocked の結果ファイル（行き詰まりの報告の節なし）
- When: それぞれ `conductor parse r.json 001 --json` を実行する
- Then: どちらも violation になる

### conductor parse: question でない種類の事項を指す waiting は検査を外さない
- 対応: —
- Given: `--type risk --who user --when now` の事項の ID を `waiting:` に置いた blocked の結果ファイル（行き詰まりの報告の節なし）
- When: `conductor parse r.json 001 --json` を実行する
- Then: violation になる

## CLI: conductor launch（答えの出どころ）

### conductor launch: 回答を渡す再開は --from が必須
- 対応: US-19.7
- Given: tasklist に build-01 があるワークスペースと回答ファイル `answer.txt`
- When: `conductor launch builder 001 1 --resume s-1 --message answer.txt --expect-digest <digest>` を `--from` 無しで実行する
- Then: 終了コード 1 で、`--from` を求める案内が出る

### conductor launch: --from user は子のコマンドに HIKYAKU_ANSWER_FROM=user を置く
- 対応: US-19.7
- Given: 同じワークスペース
- When: `conductor launch builder 001 1 --resume s-1 --message answer.txt --from user --json` を実行する
- Then: `command` が `HIKYAKU_ANSWER_FROM=user` で始まる子のコマンドを含む

### conductor launch: 回答の無い初回の起動には HIKYAKU_ANSWER_FROM を置かない
- 対応: —
- Given: 同じワークスペース
- When: `conductor launch builder 001 1 --json` を実行する
- Then: `command` に `HIKYAKU_ANSWER_FROM` が含まれない

### conductor launch: 初回の起動でも --from を添えれば --message を渡せる
- 対応: —
- Given: session-id が無い状態と回答ファイル `answer.txt`（「既存の API は残す」）
- When: `conductor launch builder 001 1 --message answer.txt --from user --json` を実行する
- Then: 成功し、`resumed` が false、`argv[2]` がプロンプトの後ろに回答を続け、`command` が `HIKYAKU_ANSWER_FROM=user` を含む。`--from` を外すと終了コード 1 になる

### conductor launch: --closes の ID を閉じる固定文を回答の先頭に足す
- 対応: US-21.3
- Given: 回答ファイル `answer.txt`（「既存の API は残す」）と、待ちの事項 `Q-3`
- When: `conductor launch builder 001 1 --resume s-1 --message answer.txt --from user --closes Q-3 --json` を実行する
- Then: `argv[2]` の先頭に `ledger decide build-01 Q-3 --decision decided --by user --input "既存の API は残す"` を記録する固定文があり、その後に回答が続く

## CLI: conductor launch（監督の答えの検査）

### conductor launch: handler が user の問いへの --from supervisor を拒む
- 対応: US-15.3
- Given: `[conductor] escalate = ["G8"]` の設定
- When: `conductor launch builder 001 1 --resume s-1 --message answer.txt --from supervisor --ask G8 --choice approved` を実行する
- Then: 終了コード 1 で、ユーザーに上げる（`--escalate`）案内が出る

### conductor launch: 中止の問いは監督が答えられない
- 対応: US-21.4
- Given: 既定の conductor 設定
- When: `conductor launch builder 001 1 --resume s-1 --message answer.txt --from supervisor --ask abandon` を実行する
- Then: 終了コード 1 で拒否される

### conductor launch: 子の位置が同意の回のゲートなら --from supervisor を拒む
- 対応: US-15.3
- Given: session-id `s-1` の子の手順の位置が G10 の同意の回（decisions の変更を含む）で止まっているワークスペース
- When: `conductor launch close-cycle 001 --resume s-1 --message answer.txt --from supervisor --ask G10 --choice approved` を実行する
- Then: 終了コード 1 で拒否される

### conductor launch: 回で同意になるゲートで位置を確かめられなければ同意に倒して拒む
- 対応: US-15.3
- Given: `locateSession` で見つからない session-id `s-unknown`
- When: `conductor launch close-cycle 001 --resume s-unknown --message answer.txt --from supervisor --ask G10 --choice approved` を実行する
- Then: 終了コード 1 で拒否される（確認の回として受け付けない）

### conductor launch: --from supervisor は --ask が必須
- 対応: —
- Given: 回答ファイル `answer.txt`
- When: `conductor launch builder 001 1 --resume s-1 --message answer.txt --from supervisor` を実行する
- Then: 終了コード 1 で、`--ask` を求める案内が出る

### conductor launch: SAFE_ANSWERS のある問いで --choice が無ければ拒む
- 対応: US-15.1
- Given: 既定の conductor 設定
- When: `conductor launch builder 001 1 --resume s-1 --message answer.txt --from supervisor --ask G8` を実行する
- Then: 終了コード 1 で、`--choice` を求める案内が出る

### conductor launch: choices に無い値を拒む
- 対応: US-15.1
- Given: 既定の conductor 設定
- When: `--from supervisor --ask G8 --choice yes` で launch する
- Then: 終了コード 1 で拒否される

### conductor launch: choices にあっても safe に無い値を拒む
- 対応: US-15.1
- Given: 既定の conductor 設定
- When: `--from supervisor --ask design-conflict --choice adjust` で launch する
- Then: 終了コード 1 で、ユーザーに上げる案内が出る

### conductor launch: G3 で推奨以外の案を選ぶ答えを拒む
- 対応: US-15.2
- Given: 既定の conductor 設定で、session-id `s-1` の architect の子が、再設計でなく上限以内の options の報告をした G3 の確認の回で止まっているワークスペースと、回答ファイル `answer.md`
- When: `conductor launch architect 001 --resume s-1 --message answer.md --from supervisor --ask G3 --choice other` を実行する
- Then: 終了コード 1 で、ユーザーに上げる案内が出る

### conductor launch: G3 の確認の回で推奨案を選ぶ答えは受け付ける
- 対応: US-15.1
- Given: 上と同じ、G3 の確認の回で止まっている session-id `s-1` の architect の子と `answer.md`
- When: `conductor launch architect 001 --resume s-1 --message answer.md --from supervisor --ask G3 --choice recommended --json` を実行する
- Then: 成功し、`command` が `HIKYAKU_ANSWER_FROM=supervisor` を含む

### conductor launch: G3 で子の位置を確かめられなければ推奨案でも同意に倒して拒む
- 対応: US-15.3
- Given: 既定の conductor 設定で、記録の無い session-id `s-unknown` と `answer.md`
- When: `conductor launch architect 001 --resume s-unknown --message answer.md --from supervisor --ask G3 --choice recommended` を実行する
- Then: 終了コード 1 で拒否される

### conductor launch: G10 の確認の回では監督の承認を受け付ける
- 対応: US-15.1
- Given: session-id `s-2` の close-cycle の子が、decisions・constraints の変更を含まない G10 の確認の回で止まっているワークスペースと `answer.md`
- When: `conductor launch close-cycle 001 --resume s-2 --message answer.md --from supervisor --ask G10 --choice approved --json` を実行する
- Then: 成功し、`command` が `HIKYAKU_ANSWER_FROM=supervisor` を含む

### conductor launch: 確認ゲートの承認は監督の答えとして受け付ける（解釈）
- 対応: US-15.1
- Given: 既定の conductor 設定（G8 は確認で監督が答える）
- When: `--from supervisor --ask G8 --choice approved` と `--choice rejected` でそれぞれ launch する
- Then: どちらも成功し、`command` が `HIKYAKU_ANSWER_FROM=supervisor` を含む

### conductor launch: questions はリスクの申告が無ければ拒む
- 対応: US-15.1
- Given: 既定の conductor 設定
- When: `--from supervisor --ask questions` で、`--harm` も `--no-risk` も付けずに launch する
- Then: 終了コード 1 で、`--harm` か `--no-risk` を求める案内が出る

### conductor launch: review-findings の proceed はリスクの申告が必須で、fix は不要
- 対応: US-15.1
- Given: 既定の conductor 設定
- When: `--from supervisor --ask review-findings --choice proceed` と `--choice fix` を、どちらもリスクの申告無しで launch する
- Then: proceed は終了コード 1、fix は成功する

### conductor launch: --no-risk の申告で受け付け、riskDeclaration に none を出す
- 対応: —
- Given: 既定の conductor 設定
- When: `--from supervisor --ask questions --no-risk --json` で launch する
- Then: 成功し、JSON の `riskDeclaration` が `none` になる

### conductor launch: 上限以内の害の申告は受け付け、riskDeclaration に害と前提を出す
- 対応: US-13.3
- Given: `[app]` が `exposure = "internal"`・`data = "none"`・`impact = "low"`（上限は中まで）のワークスペース
- When: `--from supervisor --ask review-findings --choice proceed --harm 中 --premises app.exposure --json` で launch する
- Then: 成功し、`riskDeclaration` が害 `中` と前提 `["app.exposure"]` を持つ

### conductor launch: 上限を超える害の申告を拒む
- 対応: US-13.3
- Given: 同じ `[app]`（上限は中まで）のワークスペース
- When: `--from supervisor --ask questions --harm 高 --premises app.exposure` で launch する
- Then: 終了コード 1 で、ユーザーに上げる案内が出る

### conductor launch: 事後同意が有効でも上限を超える申告は拒む
- 対応: US-15.2
- Given: 同じ `[app]` に加え、サイクル設定の `[consent]` で事後同意を選んだワークスペース
- When: `--from supervisor --ask questions --harm 高 --premises app.exposure` で launch する
- Then: 終了コード 1 で拒否される（受け付けて事項を積む分岐は無い）

### conductor launch: 宣言の重い領域を前提に挙げた申告は害が中でも拒む
- 対応: US-13.3
- Given: `[app]` が `exposure = "personal"`・`data = "none"`・`impact = "low"`（上限は高まで）で、`[[app.areas]]` に `name = "billing"`・`paths = ["src/billing/**"]`・`exposure = "public"`・`data = "personal-or-secret"`・`impact = "high"`（重い領域）を宣言したワークスペース
- When: `--from supervisor --ask questions --harm 中 --premises area:billing` で launch する
- Then: 終了コード 1 で拒否される

### conductor launch: 宣言が無ければ高の申告も受け付ける
- 対応: —
- Given: `[app]` の宣言が無いワークスペース
- When: `--from supervisor --ask questions --harm 高 --premises app.exposure` で launch する
- Then: 成功する

### conductor launch: --escalate はユーザーに上げる問いを記録させる固定文で再開する
- 対応: US-21.4
- Given: `[conductor] escalate = ["G8"]` の設定
- When: `conductor launch builder 001 1 --resume s-1 --escalate --ask G8 --json` を実行する
- Then: 成功し、`argv[2]` が `ledger open build-01 001 --type question --who user --when now --ask G8` の記録と、コミット・push と、本文に `waiting: <ID>` を置いた blocked で終えることを指示し、`command` に `HIKYAKU_ANSWER_FROM` が無い

### conductor launch: --escalate は作業単位を architect と close に読み替え、--message と --ask の欠落を拒む
- 対応: —
- Given: 既定の conductor 設定
- When: `conductor launch architect 001 --resume s-1 --escalate --ask G3 --json`、`conductor launch close-cycle 001 --resume s-1 --escalate --ask G10 --json`、`--escalate --message answer.txt --ask G8`、`--escalate`（`--ask` 無し）をそれぞれ実行する
- Then: 前の2つは固定文の `ledger open` の単位がそれぞれ `architect`・`close` になり、後の2つは終了コード 1 になる

## lib/ledger.mts（answerSourceProblem・answerSource）

### answerSourceProblem: conductor の子で HIKYAKU_ANSWER_FROM が user でなければ --by user を拒む
- 対応: US-19.7
- Given: `HIKYAKU_CONDUCTOR_CHILD=1` で、`HIKYAKU_ANSWER_FROM` が未設定の環境と `supervisor` の環境
- When: `answerSourceProblem("user", env)` を呼ぶ
- Then: どちらも理由の文字列を返す。`HIKYAKU_ANSWER_FROM=user` なら `undefined` を返す

### answerSourceProblem: 子でない、または --by user でなければ検査しない
- 対応: —
- Given: `HIKYAKU_CONDUCTOR_CHILD` の無い環境での `"user"`、`HIKYAKU_CONDUCTOR_CHILD=1` で `HIKYAKU_ANSWER_FROM` 未設定の環境での `"ai:builder"`
- When: それぞれ `answerSourceProblem(by, env)` を呼ぶ
- Then: どちらも `undefined` を返す

## CLI: ledger decide・ledger object（答えの出どころ）

### ledger decide: conductor の子で出どころが user でなければ --by user を拒み、記録を書かない
- 対応: US-19.7
- Given: question の事項 `Q-1` がある作業単位 build-01 と、`HIKYAKU_CONDUCTOR_CHILD=1`・`HIKYAKU_ANSWER_FROM=supervisor` の環境
- When: `ledger decide build-01 Q-1 --decision decided --by user --input "残す"` を実行し、続けて `--dry-run` を付けて実行する
- Then: どちらも終了コード 1 で、`decisions.jsonl` に decide の行が増えない

### ledger decide: HIKYAKU_ANSWER_FROM の値を決定の from に残す
- 対応: US-19.7
- Given: 同じ事項と、`HIKYAKU_CONDUCTOR_CHILD=1`・`HIKYAKU_ANSWER_FROM=user` の環境
- When: `ledger decide build-01 Q-1 --decision decided --by user --input "残す"` を実行する
- Then: 成功し、追記された decide の記録の `from` が `"user"` になる。`HIKYAKU_ANSWER_FROM` の無い環境で決めた記録には `from` が無く、既存の記録もそのまま読める

### ledger object: 決定つきの異議は decide と同じ検査を受け、--defer は検査しない
- 対応: US-19.7
- Given: `HIKYAKU_CONDUCTOR_CHILD=1`・`HIKYAKU_ANSWER_FROM=supervisor` の環境
- When: 決定つきの `ledger object … --by user` と、`--defer` を付けた `ledger object …` をそれぞれ実行する
- Then: 決定つきは終了コード 1、`--defer` は成功する。`HIKYAKU_ANSWER_FROM=user` で決定つきを実行すると成功し、記録の `from` が `"user"` になる

## lib/waiting.mts（deriveWaiting）

### deriveWaiting: 依存しないビルドは待たず、問いを出したビルドと依存するビルドが待つ
- 対応: US-21.2
- Given: tasklist に build-01・build-02（build-01 に依存）・build-03（依存なし）があり、作業ツリーの build-01 の記録に未決の `question`・`who=user`・`when=now` の事項 `Q-1` がある
- When: `deriveWaiting(config, cycle, builds)` を呼ぶ
- Then: `builds` が `build-01`・`build-02` の2件で、どちらも `waitingFor` が `["Q-1"]`。build-03 は含まれない

### deriveWaiting: 依存は推移的にたどる
- 対応: US-21.3
- Given: build-01 ← build-02 ← build-03（build-03 は build-02 に、build-02 は build-01 に依存）と、build-01 の未決の待ち `Q-1`
- When: `deriveWaiting` を呼ぶ
- Then: build-01・build-02・build-03 の3件が `waitingFor: ["Q-1"]` を持つ

### deriveWaiting: architect の問いは全ビルドが待ち、close の問いはどのビルドも待たない
- 対応: US-21.3
- Given: build-01・build-02 があり、architect の記録に未決の待ち `Q-A`、close の記録に未決の待ち `Q-C` がある
- When: `deriveWaiting` を呼ぶ
- Then: `items` に `Q-A`・`Q-C` の両方があり、`builds` は build-01・build-02 がそれぞれ `waitingFor: ["Q-A"]` だけを持つ

### deriveWaiting: origin の architect のブランチにだけある待ちでも全ビルドが待つ
- 対応: US-21.3
- Given: 一時 Git リポジトリで build-01・build-02 があり、作業ツリーには記録が無く、origin の architect のブランチ（`branchName` の規則）の architect の `decisions.jsonl` にだけ未決の待ち `Q-A` がある
- When: `deriveWaiting` を呼ぶ
- Then: `items` の `Q-A` の `source` が `origin/<architect のブランチ>` で、build-01・build-02 がどちらも `waitingFor: ["Q-A"]` を持つ

### deriveWaiting: plan の単位の待ちでも全ビルドが待つ
- 対応: US-21.3
- Given: build-01・build-02 があり、作業ツリーの `plan` の単位の記録に未決の `question`・`who=user`・`when=now` の事項 `Q-P` がある
- When: `deriveWaiting` を呼ぶ
- Then: build-01・build-02 がどちらも `waitingFor: ["Q-P"]` を持つ

### deriveWaiting: origin のブランチにだけある記録を読み、同じ ID は1つに重ねる
- 対応: US-21.3
- Given: 一時 Git リポジトリで、build-01 のブランチ（`branchName` の規則）を origin に push し、その上の build-01 の `decisions.jsonl` にだけ未決の待ち `Q-1` があり、作業ツリーにも同じ `Q-1` の open がある
- When: `deriveWaiting` を呼ぶ
- Then: `items` に `Q-1` が1件だけあり、`source` が作業ツリーまたは `origin/<build-01 のブランチ>` を指す

### deriveWaiting: どれかの断面に decide があれば待ちにしない
- 対応: —
- Given: 作業ツリーに `Q-1` の open だけがあり、origin の build-01 のブランチには `Q-1` の decide がある
- When: `deriveWaiting` を呼ぶ
- Then: `items` と `builds` が空になる

### deriveWaiting: 読めない断面は unavailable に入れ、判定を続ける
- 対応: —
- Given: origin の build-02 のブランチの `decisions.jsonl` が JSON として壊れており、作業ツリーの build-01 に未決の待ち `Q-1` がある
- When: `deriveWaiting` を呼ぶ
- Then: `unavailable` に build-02 の断面と理由が1件入り、`builds` には build-01 の待ちが出る。ブランチが origin に無いビルドは `unavailable` に入らない

## CLI: conductor waiting・next --json

### next --json: 依存しないビルドが available に残り、waiting に待つビルドと事項が出る
- 対応: US-21.2
- Given: build-01・build-02（build-01 に依存）・build-03 があり、build-01 のブランチが origin にあって未決の待ち `Q-1`（summary「既存の API を残すか」）がある一時 Git リポジトリ
- When: `next 001 --json` と `next 001` を実行する
- Then: JSON は `available` に build-03 があり、`waiting.items` に `Q-1`、`waiting.builds` に build-01・build-02 が `waitingFor: ["Q-1"]` で出る。テキストは「答えを待っているビルド」の節に build-02 と `Q-1` が出る。どちらも何もファイルを書かない

### conductor waiting: 何の答えを待っているかをテキストと JSON で示す
- 対応: US-21.3
- Given: 上と同じリポジトリ
- When: `conductor waiting 001 --json` と `conductor waiting 001` を実行する
- Then: JSON は `items`・`builds`・`unavailable` を持ち、テキストには build-02 が `Q-1`（「既存の API を残すか」）を待っていることが出る

### next: 待ちが無ければ waiting は空で、テキストに待ちの節を出さない
- 対応: —
- Given: 未決の who=user・when=now の事項が無いサイクル
- When: `next 001 --json` と `next 001` を実行する
- Then: `waiting` は `{ items: [], builds: [] }` で、テキストに「答えを待っているビルド」の節が無い

## CLI: conductor asks

### conductor asks: 問いを積む方針を JSON とテキストに出す
- 対応: US-21.2
- Given: 既定の conductor 設定のワークスペース
- When: `conductor asks 001 --json` と `conductor asks 001` を実行する
- Then: JSON に空でない文字列の `queueing` があり、`deferredConsent` は無い。テキストに「ユーザーに上げる問いは記録に積み、依存しないビルドを先に進める」の1行がある
