# Build 01: 承認の種類の基盤（エンジン・G1・conductor の同意） テストシナリオ

## engine（scripts/lib/steps/engine.mts）

### consentOf: consent を持たない定義は確認になる
- 対応: US-10.2
- Given: `{ id: "X1", kind: "run", title: "t" }`（`consent` も `enabled` も無い）の定義と、任意の StepContext
- When: `consentOf(definition, ctx)` を呼ぶ
- Then: `false` が返る

### consentOf: consent: false の定義は確認になる
- 対応: US-10.2
- Given: `{ id: "G9", kind: "gate", title: "t", ask: "G9", consent: false }` の定義
- When: `consentOf(definition, ctx)` を呼ぶ
- Then: `false` が返る

### consentOf: consent 関数の判定をそのまま返す
- 対応: US-10.1
- Given: `consent: () => ({ timing: "now", reason: "要件の合意" })` を持つ gate の定義
- When: `consentOf(definition, ctx)` を呼ぶ
- Then: `{ timing: "now", reason: "要件の合意" }` が返る

### consentOf: consent 関数が ctx を見て回ごとに判定を変える
- 対応: US-14.4
- Given: `consent: (ctx) => ctx.unit === "design" ? { timing: "now", reason: "r" } : false` を持つ定義と、`unit` が `"design"` の ctx と `"build-01"` の ctx
- When: それぞれの ctx で `consentOf` を呼ぶ
- Then: `"design"` の ctx では `{ timing: "now", reason: "r" }`、`"build-01"` の ctx では `false` が返る

### isOn: consent が now なら enabled が false でも on
- 対応: US-10.1
- Given: `when: () => true`、`consent: () => ({ timing: "now", reason: "r" })`、`enabled: () => false` の gate の定義
- When: `isOn(definition, ctx)` を呼ぶ
- Then: `true` が返る

### isOn: consent が false なら enabled が false のとき off
- 対応: US-10.2
- Given: `when: () => true`、`consent: false`、`enabled: () => false` の gate の定義
- When: `isOn(definition, ctx)` を呼ぶ
- Then: `false` が返る

### isOn: consent が false なら enabled が true のとき on
- 対応: US-10.2
- Given: `when: () => true`、`consent: false`、`enabled: () => true` の gate の定義
- When: `isOn(definition, ctx)` を呼ぶ
- Then: `true` が返る

### isOn: enabled を省略した定義は有効として扱う
- 対応: —
- Given: `when: () => true`、`consent: false` で `enabled` を持たない gate の定義
- When: `isOn(definition, ctx)` を呼ぶ
- Then: `true` が返る

### isOn: when も enabled も無い run の定義は on
- 対応: —
- Given: `{ id: "X1", kind: "run", title: "t" }` の定義
- When: `isOn(definition, ctx)` を呼ぶ
- Then: `true` が返る

### isOn: when が false なら consent が now でも off
- 対応: —
- Given: `when: () => false`、`consent: () => ({ timing: "now", reason: "r" })`、`enabled: () => true` の gate の定義
- When: `isOn(definition, ctx)` を呼ぶ
- Then: `false` が返る

### isOn: consent が deferred なら enabled が false のとき off
- 対応: US-10.2
- Given: `when: () => true`、`consent: () => ({ timing: "deferred", reason: "r" })`、`enabled: () => false` の gate の定義
- When: `isOn(definition, ctx)` を呼ぶ
- Then: `false` が返る

### isOn: consent が deferred なら enabled が true のとき on
- 対応: —
- Given: `when: () => true`、`consent: () => ({ timing: "deferred", reason: "r" })`、`enabled: () => true` の gate の定義
- When: `isOn(definition, ctx)` を呼ぶ
- Then: `true` が返る

### evaluate: gates.* を off にした確認のゲートは step status で off になる
- 対応: US-10.2
- Given: profile standard のサイクル 001-test（`codebase_survey_gate` は既定の false）
- When: `hikyaku step status architect 001 --json` を実行する
- Then: `steps` に `G2:off` が含まれる

## planner の G1（scripts/lib/steps/planner.mts）

### G1: どのプロファイルでも user-stories の後に G1 が返る
- 対応: US-10.1
- Given: `cycle new test --profile <p>` で作ったサイクル（`<p>` は express・economy・standard・thorough の4通り）と `retrospective = "skip"` のルート設定
- When: inputs・scope を done で報告し、`planning/user-stories.md` を書いて user-stories を done で報告し、レビューが返れば done で報告する
- Then: 4通りのどれでも、次の directive が `kind: "gate"`・`step: "G1"` になる

### G1: レビューを含む関連するキーをすべて外しても G1 が返る
- 対応: US-10.1
- Given: profile express のサイクルと、ルート設定に `user_stories_review = false`・`codebase_survey_gate = false`・`design_choice_gate = false`・`architecture_gate = false`・`plan_gate = false`・`retrospective = "skip"`
- When: inputs・scope・user-stories を done で報告する
- Then: 次の directive が `step: "G1"` の gate になり、`step status plan 001 --json` で G1 が off でない

### G1: G1 の directive は同意で、理由を添える
- 対応: US-10.1
- Given: profile economy のサイクルで、planner が G1 の手前まで進んでいる
- When: `hikyaku step next plan 001 --json` を実行する
- Then: directive の `approval` が `"consent"`、`approvalReason` が空でない文字列（要件の合意である旨）になる

## architect の G3・G4（scripts/lib/steps/architect.mts）

### G3・G4: express の差し戻しからの再設計の回では G3 が返る
- 対応: US-14.4
- Given: profile express のサイクルで通常の設計を PR まで終え、`return.md` を置いて `step restart architect 001 --round return --reason "build-01 からの差し戻し"` を実行した
- When: survey・questions・options を done で報告する
- Then: 次の directive が `kind: "gate"`・`step: "G3"` で、`approval` が `"consent"` になる

### G3・G4: express の差し戻しからの再設計の回では G4 が返る
- 対応: US-14.4
- Given: 上と同じ express の再設計の回で、G3 を `approved` で、adr・design-delta・architecture-review を done で報告した
- When: architecture-review の done の応答を見る
- Then: 次の directive が `step: "G4"` の gate で、`approval` が `"consent"`、`approvalReason` に差し戻しからの再設計である旨が入る

### G3・G4: 全ゲートを off にした設定でも再設計の回では G3 と G4 が返る
- 対応: US-14.4
- Given: profile standard のサイクルとルート設定 `codebase_survey_gate = false`・`design_choice_gate = false`・`architecture_gate = false`・`plan_gate = false` で、通常の設計を終えたあと `--round return` で再設計の回を区切った
- When: survey・questions・options、G3、adr・design-delta・architecture-review の順に報告する
- Then: options の後に G3、architecture-review の後に G4 の gate がそれぞれ返る

### G3・G4: express の通常の設計の回では G3 と G4 は返らない
- 対応: US-10.2
- Given: profile express のサイクルの最初の設計の回（`round` は `"design"`）
- When: survey・questions・options・adr・design-delta・architecture-review を done で報告する
- Then: options の次は adr、architecture-review の次は build-split で、`step status architect 001 --json` に `G3:off`・`G4:off` が含まれる

### G3・G4: express の追加設計の回（--round add）では G3 は返らない
- 対応: —
- Given: profile express のサイクルで build 1 を完了させ、`step restart architect 001 --round add --reason "認可の抜け"` を実行し、design-change を done で報告した
- When: questions・options を done で報告する
- Then: options の次が adr になり、G3 の gate は返らない（同意になるのは差し戻しからの再設計の回だけ）

### G3: 再設計の回でも options を skipped にすると G3 は返らない
- 対応: —
- Given: profile express のサイクルの差し戻しからの再設計の回
- When: survey・questions を done で、options を `--result skipped --reason "分岐なし"` で報告する
- Then: 次の directive が `step: "design-delta"` になり、G3 は返らない（when が false なら同意の回でも off）

### G2: codebase_survey_gate を true にすると確認として返る
- 対応: US-10.2
- Given: profile standard のサイクルとルート設定 `codebase_survey_gate = true`、`design/codebase-survey.md` がある
- When: survey を done で報告する
- Then: 次の directive が `step: "G2"` の gate で、`approval` が `"confirm"`、`approvalReason` が `null` になる

## architect の designChoiceGate（options・adr の args）

### designChoiceGate: express の通常の回では false
- 対応: —
- Given: profile express のサイクルの最初の設計の回
- When: survey・questions を done で報告し、options の directive を受け取る
- Then: `args.designChoiceGate` が `false` になる

### designChoiceGate: express の再設計の回では options で true
- 対応: US-14.4
- Given: profile express のサイクルで `--round return` の再設計の回を区切り、survey を done で報告した
- When: questions を done で報告し、options の directive を受け取る
- Then: `args.designChoiceGate` が `true` になる

### designChoiceGate: express の再設計の回では adr で true
- 対応: US-14.4
- Given: 上と同じ express の再設計の回で、options を done、G3 を `approved --input "Minimal 案で"` で報告した
- When: adr の directive を受け取る
- Then: `args.designChoiceGate` が `true` になる

### designChoiceGate: pr の args も G3 が手順に入るかを返す
- 対応: —
- Given: profile express のサイクルと profile standard のサイクルで、それぞれ通常の設計の回を validate まで報告した（再設計の回は pr が off なので、pr は通常の回で確かめる）
- When: pr の directive を受け取る
- Then: express では `args.designChoiceGate` が `false`、standard では `true` になる

### designChoiceGate: standard の通常の回では true
- 対応: —
- Given: profile standard のサイクルの最初の設計の回
- When: questions を done で報告し、options の directive を受け取る
- Then: `args.designChoiceGate` が `true` になる

## directive（scripts/lib/steps/directive.mts）

### approval: run の directive は approval を持たない
- 対応: —
- Given: profile standard のサイクルで、architect の最初の1手（survey）
- When: `step next architect 001 --json` を実行する
- Then: directive に `approval` と `approvalReason` が無い（または未定義）

### approval: 常に確認のゲート G6 は express でも confirm
- 対応: US-10.2
- Given: profile express のサイクルで、build-manager を load・scope・estimate・dry-run まで done で報告した
- When: 次の directive を受け取る
- Then: `step: "G6"` の gate で、`approval` が `"confirm"`、`approvalReason` が `null` になる

### approval: deferred の回は確認として示す
- 対応: US-10.2
- Given: `consent: () => ({ timing: "deferred", reason: "r" })`・`enabled: () => true` の gate を持つ合成したスキルの定義と、その評価
- When: `buildDirective` で directive を組み立てる
- Then: `approval` が `"confirm"`、`approvalReason` が `null` になる

### G7: plan_gate で確認として外せる
- 対応: US-10.2
- Given: profile standard のサイクル 001 にビルド 1 と issue.md があり、ルート設定 `plan_gate = false`（standard の既定）と `plan_gate = true` の2通り
- When: builder の plan を `--peak 350k` で、plan-review を done で報告する
- Then: `plan_gate = false` では次が test-spec で `step status build-01 001 --json` に `G7:off`、`plan_gate = true` では次が G7 の gate で `approval` が `"confirm"`

### P1: patch の対応方針の合意は同意
- 対応: US-10.1
- Given: サイクルに属さない patch の作業単位で、手順が P1 の手前まで進んでいる
- When: `step next <patch のフェーズ> --json` を実行する
- Then: `step: "P1"` の gate で、`approval` が `"consent"`、`approvalReason` が空でない

### P2: patch の永続ドキュメントの更新の承認は同意（コードレビュー ラウンド 2 で確認から改めた）
- 対応: US-10.1
- Given: patch の P2 の定義（decisions・constraints の変更を含みうる）
- When: `consentOf(P2, ctx)` を呼ぶ
- Then: `timing: "now"` で理由が空でない（G10 と同じく同意の側に倒す）

### designChoiceGate: options をスキップした回でも設定どおり
- 対応: —
- Given: options が skipped の記録と、`gates.designChoice` が true / false の設定
- When: architect の pr の args を評価する
- Then: true の設定では `designChoiceGate` が true、false では false（構造の条件では false にしない）

### approval: G10 は express でも同意として返る
- 対応: US-10.1
- Given: profile express のサイクル（候補ごとの区分と `promotion_gate` は build-11。この build では G10 は常に同意）
- When: close-cycle の collect を done で報告する
- Then: 次の directive が `step: "G10"` の gate で、`approval` が `"consent"` になる

### renderDirective: 確認のゲートの行に「承認: 確認」と出す
- 対応: US-10.2
- Given: ルート設定 `codebase_survey_gate = true` で G2 の手前まで進んだサイクル
- When: `step next architect 001`（テキスト出力）を実行する
- Then: 出力に `承認: 確認` の行が含まれ、`承認: 同意` は含まれない

### renderDirective: 同意のゲートの行に理由を添えて「承認: 同意（…）」と出す
- 対応: US-10.1
- Given: planner が G1 の手前まで進んだサイクル
- When: `step next plan 001`（テキスト出力）を実行する
- Then: 出力に `承認: 同意（` で始まり、理由を括弧で添えた行が含まれる

## config（scripts/lib/config.mts・scripts/commands/config.mts）

### user_stories_gate: ルート設定に false を書くと移行のヒントつきのエラー
- 対応: US-10.1
- Given: ルート設定 `hikyaku_root = "docs/hikyaku"` と `user_stories_gate = false`
- When: `hikyaku config --json` を実行する
- Then: 終了コード 1 で、stderr に `user_stories_gate` と、G1 は同意なので外せずキーを削除する旨のヒントが含まれる

### user_stories_gate: true を書いてもエラーにする
- 対応: —
- Given: ルート設定 `user_stories_gate = true`
- When: `hikyaku config --json` を実行する
- Then: 終了コード 1 で、stderr に `user_stories_gate` が含まれる（値に関わらず廃止キーとして止める）

### user_stories_gate: サイクル設定に書くと step で止まる
- 対応: US-10.1
- Given: ルート設定は正常で、`docs/hikyaku/cycles/001-test/.hikyaku.config` に `user_stories_gate = false`
- When: `hikyaku step next plan 001 --json` を実行する
- Then: directive が `kind: "stop"` で、message に `user_stories_gate` と移行のヒントが含まれる（G1 が外れた手順は返らない）

### Gates: 解決した設定に userStories が無い
- 対応: —
- Given: profile economy のサイクル
- When: `hikyaku config 001 --json` を実行する
- Then: `gates` に `userStories` のキーが無く、`codebaseSurvey`・`designChoice`・`architecture`・`plan` だけがある

### config の表示: G1 を常に有効（同意）と示す
- 対応: US-10.1
- Given: profile express のサイクル
- When: `hikyaku config 001`（テキスト出力）を実行する
- Then: G1 の行に「常に有効（同意）」が出る

## conductor（scripts/lib/conductor.mts）

### resolveAsk: G10 は既定でユーザーに固定される
- 対応: US-10.1
- Given: `DEFAULT_CONDUCTOR` と、全ゲートが有効な AskSettings
- When: `resolveAsk("G10", conductor(), settings)` を呼ぶ
- Then: `category: "consent"`・`handler: "user"`・`source: "fixed"` になる

### resolveAsk: G6 と G8 は確認で、既定では監督が答える
- 対応: US-10.2
- Given: `DEFAULT_CONDUCTOR` と AskSettings
- When: `resolveAsk("G6", …)` と `resolveAsk("G8", …)` を呼ぶ
- Then: どちらも `category: "confirm"`・`handler: "supervisor"`・`source: "default"` になる

### resolveAsk: escalate に書いた確認の G8 はユーザーに上がる
- 対応: —
- Given: `conductor({ escalate: ["G8"] })`
- When: `resolveAsk("G8", config, settings)` を呼ぶ
- Then: `handler: "user"`・`source: "escalate"` になる

### resolveAsk: approval に consent を渡すとカテゴリを上書きしてユーザーに固定する
- 対応: US-14.4
- Given: `DEFAULT_CONDUCTOR` と、`designChoice: false` の AskSettings（express 相当）
- When: `resolveAsk("G3", conductor(), settings, "consent")` を呼ぶ
- Then: `category: "consent"`・`handler: "user"`・`source: "fixed"`・`enabled: true` になる

### resolveAsk: approval が consent なら delegate に書いてあってもユーザーに上がる
- 対応: US-10.1
- Given: `conductor({ delegate: ["G4"] })` と AskSettings
- When: `resolveAsk("G4", config, settings, "consent")` を呼ぶ
- Then: `handler: "user"`・`source: "fixed"` になる

### resolveAsk: approval が consent なら escalate に書いてあっても source は fixed
- 対応: US-10.1
- Given: `conductor({ escalate: ["G3"] })` と AskSettings
- When: `resolveAsk("G3", config, settings, "consent")` を呼ぶ
- Then: `handler: "user"`・`source: "fixed"` になる（`"escalate"` ではない）

### resolveAsk: approval に confirm を渡すと enabled を true にして監督に振る
- 対応: US-10.2
- Given: `DEFAULT_CONDUCTOR` と `architecture: false` の AskSettings（G4 の静的な enabled は false）
- When: `resolveAsk("G4", conductor(), settings, "confirm")` を呼ぶ
- Then: `category: "confirm"`・`handler: "supervisor"`・`enabled: true` になる

### resolveAsk: approval を渡さなければ静的な分類と enabled を使う
- 対応: —
- Given: `DEFAULT_CONDUCTOR` と `designChoice: false` の AskSettings
- When: `resolveAsk("G3", conductor(), settings)` を呼ぶ
- Then: `category: "confirm"`・`handler: "supervisor"`・`enabled: false` になる

### resolveAsk: 障害・中止・分類できない問いはユーザーに上がる
- 対応: —
- Given: `DEFAULT_CONDUCTOR` と AskSettings
- When: `retry-limit`・`abandon`・`other`・表に無い `"Z9"` で `resolveAsk` を呼ぶ
- Then: どれも `handler: "user"` になり、`abandon`・`other`・`Z9` は `source: "fixed"` になる

### Handler: どの問いの handler も "human" にならない
- 対応: —
- Given: `DEFAULT_CONDUCTOR` と AskSettings
- When: `resolveAllAsks(conductor(), settings)` を呼ぶ
- Then: 全要素の `handler` が `"supervisor"` か `"user"` のどちらかで、`"human"` は1件も無い

### checkConductorAsks: delegate に G10 を書くとエラー
- 対応: US-10.1
- Given: `conductor({ delegate: ["G10"] })`
- When: `checkConductorAsks(config, "[conductor]")` を呼ぶ
- Then: `/指定できません/` に合うエラーが投げられ、メッセージに「ユーザー」が含まれ「人間」は含まれない

### checkConductorAsks: escalate に G10 を書くとエラー
- 対応: —
- Given: `conductor({ escalate: ["G10"] })`
- When: `checkConductorAsks(config, "[conductor]")` を呼ぶ
- Then: `/指定できません/` に合うエラーが投げられる（固定カテゴリと同じ扱い）

### checkConductorAsks: delegate に確認の G8 を書くのは受け付ける
- 対応: US-10.2
- Given: `conductor({ delegate: ["G8"] })`
- When: `checkConductorAsks(config, "[conductor]")` を呼ぶ
- Then: エラーにならない

## conductor の CLI（scripts/commands/conductor.mts）

### parse: express の再設計の回の G3 は、子の手順の approval でユーザーに上がる
- 対応: US-14.4
- Given: profile express のサイクルで、`CLAUDE_CODE_SESSION_ID=s-1` のもとで差し戻しからの再設計の回を区切り、options まで報告して手順が G3 で止まっている。`r.json` は `session_id: "s-1"` で `<hikyaku-gate id="G3">` を含む
- When: `hikyaku conductor parse r.json 001 --expect-digest <digest> --json` を実行する
- Then: `ask.category` が `"consent"`、`ask.handler` が `"user"`、`ask.source` が `"fixed"` で、`step.approval` が `"consent"`、`step.approvalReason` が空でない文字列になる

### parse: 通常の回の G3 は確認として監督に振られる
- 対応: US-10.2
- Given: profile standard のサイクルで、`CLAUDE_CODE_SESSION_ID=s-1` のもとで options まで報告して手順が G3 で止まっている。`r.json` は `session_id: "s-1"` で `<hikyaku-gate id="G3">` を含む
- When: `hikyaku conductor parse r.json 001 --expect-digest <digest> --json` を実行する
- Then: `ask.category` が `"confirm"`、`ask.handler` が `"supervisor"` で、`step.approval` が `"confirm"`、`step.approvalReason` が `null` になる

### parse: delegate に G3 を書いても再設計の回の G3 はユーザーに上がる
- 対応: US-10.1
- Given: 上の express の再設計の回の状態に、ルート設定 `[conductor]` の `delegate = ["G3"]` を足し、digest を取り直した
- When: `hikyaku conductor parse r.json 001 --expect-digest <digest> --json` を実行する
- Then: `ask.handler` が `"user"`、`ask.source` が `"fixed"` になる

### parse: ステップの途中の問い（questions）には子の approval を渡さない
- 対応: —
- Given: profile express のサイクルの再設計の回で手順が G3 に居て、`r.json` は `<hikyaku-gate id="questions">` を含む
- When: `hikyaku conductor parse r.json 001 --expect-digest <digest> --json` を実行する
- Then: `ask.category` が `"spec"` のまま（step.ask と parsed.id が一致しないので上書きしない）

### parse: G8 の表示はユーザーの語で示す
- 対応: —
- Given: profile standard のサイクル 001（子の手順の記録なし）、ルート設定 `[conductor]` の `escalate = ["G8"]`、`session_id: "s-1"` で `<hikyaku-gate id="G8">` を含む `r.json`。digest は `conductor asks 001 --json` の `digest`
- When: `hikyaku conductor parse r.json 001 --expect-digest <digest>`（テキスト出力）を実行する
- Then: 出力に「ユーザーに上げる」が含まれ、「人間」は含まれない

### asks: G3・G4 が再設計の回に同意になることを JSON とテキストで示す
- 対応: US-14.4
- Given: profile express のサイクル
- When: `hikyaku conductor asks 001 --json` とテキスト出力を実行する
- Then: JSON に `consentWhen.G3` と `consentWhen.G4` が文字列であり、テキストに「ユーザーに上げる同意ゲート」の行があり「人間」は含まれない

### lint: プラグイン本体の ASKS とタグが一致する
- 対応: —
- Given: このリポジトリのプラグイン本体
- When: `hikyaku conductor lint` を実行する
- Then: 成功し、「一致しています」が出る

## step lint（scripts/commands/step.mts）

### step lint: プラグイン本体の定義は gate がすべて承認の種類を持つ
- 対応: US-10.2
- Given: このリポジトリのプラグイン本体（planner・architect・build-manager・builder・close-cycle・patch・init・token-guide の定義）
- When: `hikyaku step lint` を実行する
- Then: 終了コード 0 で成功する

### step lint: consent を持たない gate を問題にする
- 対応: —
- Given: `{ id: "G9", kind: "gate", title: "t", ask: "G9" }`（`consent` が undefined）を含むスキルの定義
- When: step lint の検査をその定義に対して行う
- Then: G9 が承認の種類を持たない旨の問題が1件返り、検査は失敗する

### step lint: consent: false を明示した gate は問題にしない
- 対応: —
- Given: `{ id: "G9", kind: "gate", title: "t", ask: "G9", consent: false }` を含むスキルの定義
- When: step lint の検査をその定義に対して行う
- Then: G9 についての問題は返らない

### step lint: gate でないのに consent を持つ定義を問題にする
- 対応: —
- Given: `{ id: "x", kind: "run", title: "t", consent: false }` を含むスキルの定義
- When: step lint の検査をその定義に対して行う
- Then: x が gate でないのに consent を持つ旨の問題が返る

### step lint: gate でないのに enabled を持つ定義を問題にする
- 対応: —
- Given: `{ id: "x", kind: "run", title: "t", enabled: () => true }` を含むスキルの定義
- When: step lint の検査をその定義に対して行う
- Then: x が gate でないのに enabled を持つ旨の問題が返る

## プロファイルを黙って切り替えない

### 再設計の回で同意のゲートが出ても、サイクルの profile は express のまま
- 対応: US-14.3
- Given: profile express のサイクルで差し戻しからの再設計の回を区切り、G3 の gate が返るところまで進めた
- When: `hikyaku config 001 --json` を実行し、`cycles.md` のサイクル 001 の行を読む
- Then: `profile` は `"express"`、`gates.designChoice` と `gates.architecture` は `false` のままで、`cycles.md` の profile 列も `express` のまま

### step next は cycles.md と設定ファイルを書き換えない
- 対応: US-14.3
- Given: profile express のサイクルで、再設計の回の G3 で止まっている状態のワークスペースのスナップショット
- When: `hikyaku step next architect 001 --json` を実行する
- Then: 実行後のスナップショットが実行前と一致する（`cycles.md`・`.hikyaku.config`・サイクル設定に変更が無い）

### conductor parse は同意に振り分けても profile を変えない
- 対応: US-14.3
- Given: profile express のサイクルで、再設計の回の G3 を parse して `ask.handler` が `"user"` になる状態
- When: parse の前後で `hikyaku conductor asks 001 --json` を実行する
- Then: 前後とも `profile` が `"express"` で `digest` が一致する

### user_stories_gate のエラーは設定を書き換えずに止める
- 対応: US-14.3
- Given: ルート設定に `user_stories_gate = false` を書いたワークスペースのスナップショット
- When: `hikyaku config --json` と `hikyaku step next plan 001 --json` を実行する
- Then: どちらも失敗または stop で止まり、実行後のスナップショットが実行前と一致する（キーを黙って消したり profile を変えたりしない）

## ドキュメント（docs/configuration/profiles.md）

### profiles.md: ゲート表に承認の列があり、各ゲートが確認か同意かが分かる
- 対応: US-10.4
- Given: 変更後の `docs/configuration/profiles.md`
- When: ゲート表を読む
- Then: 「承認」列があり、G1・G10 は同意、G2・G6・G7・G8 は確認、G3・G4 は確認で差し戻しからの再設計の回は同意と条件が添えられている

### profiles.md: G1 を設定で外せないことが書かれている
- 対応: US-10.4
- Given: 変更後の `docs/configuration/profiles.md`
- When: G1 の記述を読む
- Then: G1 はどのプロファイル・設定でも止まる同意である旨があり、`user_stories_gate` で外せるという記述が無い
