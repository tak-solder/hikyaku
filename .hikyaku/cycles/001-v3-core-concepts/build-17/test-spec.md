# Build 17: 同意ゲートで退けた項目の作り直しの経路 テストシナリオ

## scripts/lib/steps/consent.mts

### reworkStepOf: ゲートで記録した事項を対応する run ステップへ戻す
- 対応: US-20.11
- Given: architect の手順で options・design-delta が手順に入っている。builder の手順で plan が手順に入っている。patch の手順で scope が手順に入っている
- When: `reworkStepOf(ARCHITECT_STEPS, "G3", ctx)`・`reworkStepOf(ARCHITECT_STEPS, "G4", ctx)`・`reworkStepOf(BUILDER_STEPS, "G7", ctx)`・`reworkStepOf(BUILDER_STEPS, "G8", ctx)`・`reworkStepOf(PATCH_STEPS, "P1", ctx)` を呼ぶ
- Then: それぞれ `"options"`・`"design-delta"`・`"plan"`・`"plan"`・`"scope"` を返す

### reworkStepOf: GATE_REWORK に無いゲートは、それより前で最も近い手順に入っている run ステップへ戻す
- 対応: US-20.11
- Given: architect の手順で survey が手順に入っていて、G2 は `GATE_REWORK` に無い
- When: `reworkStepOf(ARCHITECT_STEPS, "G2", ctx)` を呼ぶ
- Then: G2 より前で最も近い run ステップ `"survey"` を返す

### reworkStepOf: 手順に入っている run ステップはそのステップを返す
- 対応: US-20.11
- Given: builder の手順で implement が手順に入っている
- When: `reworkStepOf(BUILDER_STEPS, "implement", ctx)` を呼ぶ
- Then: `"implement"` を返す

### reworkStepOf: 手順に入っていない run ステップは、それより前で最も近い run ステップへ戻す
- 対応: US-20.11
- Given: architect の手順で `questions` の `when`（designChanges）が false になる ctx（設計変更なし）で、その前の survey は手順に入っている
- When: `reworkStepOf(ARCHITECT_STEPS, "questions", ctx)` を呼ぶ
- Then: `"survey"` を返す

### reworkStepOf: 内部スキルのステップ（G6）は、それを呼ぶ call ステップとして扱う
- 対応: US-20.11
- Given: build-manager の G6 で記録した事項（`step: "G6"`）。architect の手順で `build-split`（call: build-manager）が手順に入っている
- When: `reworkStepOf(ARCHITECT_STEPS, "G6", ctx)` を呼ぶ
- Then: `"build-split"` を返し、G2〜G4 や options には戻さない

### reworkStepOf: 内部スキルの call が手順に入っていなければ、その前の run ステップへ戻す
- 対応: US-20.11
- Given: builder の手順で `split`（call: build-manager）の `when` が false になる ctx で、その前の `plan` は手順に入っている
- When: `reworkStepOf(BUILDER_STEPS, "G6", ctx)` を呼ぶ
- Then: `"plan"` を返す

### reworkStepOf: 記録の無い step と前に run の無いステップは、最初の run ステップへ戻す（安全側）
- 対応: —
- Given: builder の手順で最初の run ステップは `plan`
- When: `reworkStepOf(BUILDER_STEPS, undefined, ctx)` と `reworkStepOf(BUILDER_STEPS, "delegation", ctx)`、`reworkStepOf(BUILDER_STEPS, "no-such-step", ctx)` を呼ぶ
- Then: どれも `"plan"` を返す

### reworkStepOf: when の評価が投げたら手順に入っているとみなす
- 対応: —
- Given: テスト用の SkillSteps で、run ステップ `a`・`b` のうち `b` の `when` が例外を投げる
- When: `reworkStepOf(skill, "b", ctx)` を呼ぶ
- Then: 例外を外に出さず `"b"` を返す

### consentRejections: 同じ作業単位の退けを rework と reworked に、前のフェーズの退けを returns に分ける
- 対応: US-20.11
- Given: build-01 の ctx。事項 `b.1`（unit build-01・step plan、最新 rejected at 2026-11-16T01:00Z）、`b.2`（unit build-01・step G7、最新 rejected at 01:00Z、events に plan の done at 02:00Z）、`a.1`（unit architect・when merge@build-01、最新 rejected）、`b.3`（最新 consented）
- When: `consentRejections("builder", items, ctx)` を呼ぶ
- Then: plan の done（02:00Z）が退けより後なので `reworked` が `["b.1", "b.2"]`、`rework` が `[]`。`returns` は `["a.1"]` で、`b.3` はどれにも入らない

### consentRejections: 戻り先の done が退けの決定より前なら作り直していない扱い
- 対応: US-20.11
- Given: 事項 `b.1`（unit build-01・step plan、最新 rejected at 2026-11-16T03:00Z）。events に plan の done at 02:00Z だけがある
- When: `consentRejections("builder", items, ctx)` を呼ぶ
- Then: `rework` が `[{ id: "b.1", step: "plan" }]`、`reworked` が `[]`

### consentStep(args): 作り直しが要る退けがあるときだけ reworkFrom と rework を足す
- 対応: US-20.11
- Given: build-01 の記録に、退けた `b.1`（step implement）と `b.2`（step G7、戻り先 plan）があり、どちらも作り直していない
- When: builder の同意ゲートの `args(ctx)` を評価する
- Then: `reworkFrom` が手順で最も前の `"plan"`、`rework` が `[{ id: "b.1", step: "implement" }, { id: "b.2", step: "plan" }]`、`returns` は無い

### consentStep(args): 前のフェーズの退けだけなら returns だけを足し、退けが無ければ items だけ
- 対応: US-20.11
- Given: (1) build-01 の ctx で、architect で記録した `a.1`（when merge@build-01）が最新 rejected。(2) 退けの無い記録
- When: それぞれ同意ゲートの `args(ctx)` を評価する
- Then: (1) は `{ items: ["a.1"], returns: ["a.1"] }` で `reworkFrom` を持たない。(2) は `{ items: [...] }` のまま

### consentProblem: 作り直していない退けと前のフェーズの退けは、それぞれの案内で受け付けない
- 対応: US-20.11
- Given: build-01 の ctx で、作り直していない同じ単位の退け `b.1` と、前のフェーズの退け `a.1` がある
- When: `consentProblem("builder")(ctx)` を呼ぶ
- Then: 理由に `b.1` と戻り先を done で報告し直す案内、`a.1` と `references/return.md` の退けからの差し戻しの案内が含まれ、`undefined` ではない

### consentProblem: 作り直した同じ単位の退けは、resolved の前でも受け付ける
- 対応: US-20.11
- Given: build-01 の ctx で、退け `b.1`（step plan、rejected at 01:00Z）があり、events に plan の done at 02:00Z がある。ほかの対象はすべて consented
- When: `consentProblem("builder")(ctx)` を呼ぶ
- Then: `undefined` を返す（受け付ける）

### consentProblem: 前のフェーズの退けは resolved を記録すると受け付ける
- 対応: US-20.11
- Given: build-01 の ctx で、architect で記録した `a.1` が rejected の後に `resolved`（by user）の決定を持つ
- When: `consentProblem("builder")(ctx)` を呼ぶ
- Then: `undefined` を返す

## CLI: step（同意ゲートと pr / publish）

### step next / report: 同じ単位の退けは、戻り先を報告し直すまで同意ゲートも pr も完了しない
- 対応: US-20.11
- Given: 一時 Git リポジトリの build-01 で pr の直前まで進め、`b.1`（step G7）を `ledger decide build-01 b.1 --decision rejected --by user` で退けた
- When: `step next builder` を読み、同意ゲートを approved で報告し、続けて pr を done で報告する
- Then: directive の `args.reworkFrom` が `"plan"`。承認も pr の done も拒まれ、理由に plan を報告し直す案内が出る

### step report: 戻り先を done で報告し直したあとは、承認と pr が通る
- 対応: US-20.11
- Given: 前のシナリオの状態から plan を done で報告し直し、エンジンが示す後続のステップを順に報告して同意ゲートに戻った
- When: 同意ゲートを approved、pr を done で報告する
- Then: どちらも受け付けられ、`b.1` に `resolved` が無くても pr が完了する

### step report（patch）: P1 で記録した事項を退けると scope に戻り、publish は報告し直すまで完了しない
- 対応: US-20.11
- Given: patch の作業単位で P1 で記録した対象 `p.1` を退けた
- When: `step next patch` を読み、publish を done で報告し、その後 scope を done で報告し直して後続（Draft PR を作る `pr` を既存 PR の `--pr` で報告し直すを含む）を経て publish を報告する
- Then: directive の `args.reworkFrom` が `"scope"`。最初の publish は拒まれ、scope からやり直したあとの publish は受け付けられる

### step report: 前のフェーズの退けは resolved まで同意ゲートが承認にならない
- 対応: US-20.11
- Given: build-01 で、architect で記録した `a.1`（when merge@build-01）を退けた
- When: 同意ゲートを approved で報告し、次に `ledger decide build-01 a.1 --decision resolved --by user --input "..."` を記録してから再度 approved で報告する
- Then: 1回目は拒まれ、理由に return.md の経路の案内と `a.1` が出る。directive の `args.returns` は `["a.1"]`。resolved 記録後の2回目は受け付けられる

## CLI: 未解決の退けの表示

### ledger pr-section / cycle status: 作り直したあとも resolved まで未解決の退けに出続ける
- 対応: US-20.11
- Given: build-01 で `b.1` を退け、戻り先を done で報告し直して pr まで完了した（`resolved` は未記録）
- When: `ledger pr-section build-01` と `cycle status` を実行し、次に `b.1` に resolved を記録して再度実行する
- Then: 1回目はどちらにも「未解決の退け」として `b.1` が出る。resolved の後は `b.1` が出ない

## scripts/commands/ledger.mts: ledger return-draft

### return-draft: 前のフェーズの退けから下書きを出し、書き込まない
- 対応: US-20.11
- Given: build-01 で、architect で記録した `a.1`（summary「キャッシュの無効化を遅らせる」・loses「古いデータを返さない」）を退け、ユーザーの答え「受け入れない」を記録した
- When: `ledger return-draft build-01 --items a.1` を実行する
- Then: 終了コード 0。出力に `# 差し戻し: build-01`、「退けた項目」に `a.1` と要約・記録した単位 `architect`、「試したこと」に退けられた受け入れ・失うもの・ユーザーの答え、「問題を変える選択肢」「推奨」の置き場所、作り直しが要るものに handoff.md が出る。実行の前後でリポジトリのファイルが変わらない

### return-draft: --json で同じ内容を構造で返す
- 対応: —
- Given: 前のシナリオと同じ記録
- When: `ledger return-draft build-01 --items a.1 --json` を実行する
- Then: JSON として解析でき、項目の ID `a.1` と記録した単位を含む

### return-draft: 不正な入力はエラーにする
- 対応: —
- Given: build-01 に、同じ単位で退けた `b.1`、最新が consented の `b.3` がある
- When: `ledger return-draft architect --items b.1`、`ledger return-draft build-01 --items no.such`、`--items b.3`、`--items b.1` をそれぞれ実行する
- Then: どれも非 0 で終わる。phase が build-NN でない、ID が無い、最新が rejected でない、同じ単位（`reworkFrom` の経路を案内）の理由をそれぞれ示す

### return-draft: 下書きのままでは行き詰まりの報告の検査を通らず、選択肢と推奨を書けば restart --round return が通る
- 対応: US-20.11
- Given: return-draft の出力を build-01 の return.md に置き、handoff.md を削除してコミットした
- When: まず置き場所のまま `step restart architect --round return` を実行し、次に「問題を変える選択肢」に2案と失うもの、「推奨」に1案を書いて再度実行する
- Then: 1回目は検査（`checkEscalation`）の不足で拒まれ、2回目は成功して architect の差し戻しの回が始まる
