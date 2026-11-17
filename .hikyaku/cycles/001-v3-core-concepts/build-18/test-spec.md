# Build 18: 上限を超える異議と、事後同意の同意ゲートの範囲 テストシナリオ

前提の書き方（各シナリオで共通に使う設定）:

- 上限 高: ルート `.hikyaku.config` の `[app] exposure = "personal"`・`data = "none"`・`impact = "low"`
- 上限 中: `[app] exposure = "internal"`・`data = "none"`・`impact = "low"`
- 上限 なし: `[app] exposure = "public"`・`data = "none"`・`impact = "low"`
- 重い領域: `[[app.areas]] name = "billing"`・`paths = ["src/billing/**"]`（軸は省略）
- 事後同意が有効: ルートに `[app] merge_gate = "user"`、サイクル設定に `[consent] deferred = true`、planning/progress.jsonl に G1 の承認の記録（`deferredConsent: true`）がある（`deferredConsent(config, cycleDirectory).effective === true`）
- requested: サイクル設定に `[consent] deferred = true` がある（`config.consent.deferred === true`。有効かどうかは問わない）
- 結合テストは一時 Git リポジトリにサイクル `001-x` を作り、`hikyaku ledger …`・`hikyaku step …` を実行する

## risk.mts

### exceedsCeilingFor: 基準の宣言を読めない回は上限を超える
- 対応: US-13.3
- Given: `effectiveDeclaration` が `{ incomplete: true, declaration: undefined }` を返す状態（基準のブランチの `.hikyaku.config` が TOML として壊れている）
- When: `exceedsCeilingFor(effective, "中", [])` を呼ぶ
- Then: true を返す

### exceedsCeilingFor: incomplete なら宣言があり害が中でも超える
- 対応: US-13.3
- Given: `{ incomplete: true, declaration: <上限 高の宣言> }`
- When: `exceedsCeilingFor(effective, "中", ["app.exposure"])` を呼ぶ
- Then: true を返す（上限 高・害 中の比較より incomplete が優先される）

### exceedsCeilingFor: 宣言が無ければ超えない
- 対応: US-13.3
- Given: `{ incomplete: false, declaration: undefined }`（`[app]` を書いていないワークスペース）
- When: `exceedsCeilingFor(effective, "高", ["area:billing"])` を呼ぶ
- Then: false を返す（害が高でも、area 前提があっても上限を設けない）

### exceedsCeilingFor: 上限 高・害 高は超えない
- 対応: US-13.3
- Given: 上限 高の宣言、incomplete は false、areas は空
- When: `exceedsCeilingFor(effective, "高", ["app.exposure"])` を呼ぶ
- Then: false を返す

### exceedsCeilingFor: 上限 高・害 中は超えない
- 対応: US-13.3
- Given: 上限 高の宣言、incomplete は false
- When: `exceedsCeilingFor(effective, "中", [])` を呼ぶ
- Then: false を返す

### exceedsCeilingFor: 上限 中・害 高は超える
- 対応: US-13.3
- Given: 上限 中の宣言（`exposure = "internal"`）
- When: `exceedsCeilingFor(effective, "高", ["app.exposure"])` を呼ぶ
- Then: true を返す

### exceedsCeilingFor: 上限 中・害 中は超えない
- 対応: US-13.3
- Given: 上限 中の宣言
- When: `exceedsCeilingFor(effective, "中", ["app.exposure"])` を呼ぶ
- Then: false を返す

### exceedsCeilingFor: 上限 なし・害 中は超える
- 対応: US-13.3
- Given: 上限 なしの宣言（`exposure = "public"`）
- When: `exceedsCeilingFor(effective, "中", [])` を呼ぶ
- Then: true を返す

### exceedsCeilingFor: 上限 なし・害 高は超える
- 対応: US-13.3
- Given: 上限 なしの宣言
- When: `exceedsCeilingFor(effective, "高", [])` を呼ぶ
- Then: true を返す

### exceedsCeilingFor: 害が未指定なら中として比べる
- 対応: US-13.3
- Given: 上限 中の宣言と、上限 なしの宣言の2通り
- When: それぞれ `exceedsCeilingFor(effective, undefined, [])` を呼ぶ
- Then: 上限 中では false、上限 なしでは true を返す（`exceeds("中", ceiling)` と同じ結果）

### exceedsCeilingFor: 宣言の重い領域を前提に挙げれば害が中でも超える
- 対応: US-13.3
- Given: 上限 高の宣言に重い領域 `billing`（軸は省略）がある
- When: `exceedsCeilingFor(effective, "中", ["area:billing"])` を呼ぶ
- Then: true を返す

### exceedsCeilingFor: 重い領域に当たれば上限 高・害 高でも超える
- 対応: US-13.3
- Given: 上限 高の宣言に重い領域 `billing`
- When: `exceedsCeilingFor(effective, "高", ["app.exposure", "area:billing"])` を呼ぶ
- Then: true を返す（領域を重ねた上限は「なし」）

### exceedsCeilingFor: 宣言に無い領域名は効かない
- 対応: US-13.3
- Given: 上限 高の宣言に重い領域 `billing` だけがある
- When: `exceedsCeilingFor(effective, "中", ["area:auth"])` を呼ぶ
- Then: false を返す（`auth` は重ねず、上限 高・害 中の比較になる）

### exceedsCeilingFor: area 以外の前提は上限を変えない
- 対応: —
- Given: 上限 中の宣言に重い領域 `billing`
- When: `exceedsCeilingFor(effective, "中", ["app.data", "constraints#billing", "adr:20261116-risk-ceiling-table.md"])` を呼ぶ
- Then: false を返す（`area:` の接頭辞が無い参照は領域の名前として扱わない）

## ledger.mts

### isHighObjection: 害が高の異議は高として扱う
- 対応: US-13.3
- Given: `type: "objection"`・`harm: "高"`・`exceedsCeiling` なしの事項
- When: `isHighObjection(item)` を呼ぶ
- Then: true を返す

### isHighObjection: 上限を超える害が中の異議は高として扱う
- 対応: US-13.3
- Given: `type: "objection"`・`harm: "中"`・`exceedsCeiling: true` の事項
- When: `isHighObjection(item)` を呼ぶ
- Then: true を返す

### isHighObjection: 上限を超えない害が中の異議は高として扱わない
- 対応: US-13.3
- Given: `type: "objection"`・`harm: "中"`・`exceedsCeiling` なしの事項
- When: `isHighObjection(item)` を呼ぶ
- Then: false を返す

### isHighObjection: 異議でない事項は高として扱わない
- 対応: —
- Given: `type: "risk"`・`harm: "高"`・`exceedsCeiling: true` の事項
- When: `isHighObjection(item)` を呼ぶ
- Then: false を返す

### unacceptedObjections: 上限を超える中の異議は accepts の無い consented で片づかない
- 対応: US-13.3
- Given: build-02 のステップ `G7` で記録した `harm: "中"`・`exceedsCeiling: true`・`who: "user"`・`when: "now"` の異議と、`by: "user"`・`decision: "consented"`・`accepts` なしの決定
- When: `unacceptedObjections(ledger, "build-02", "G7")` を呼ぶ
- Then: その異議が1件返る

### unacceptedObjections: accepts 付きの consented なら片づく
- 対応: US-13.3
- Given: 上と同じ異議に、`decision: "consented"`・`accepts: "課金の二重請求のおそれを受け入れる"` の決定
- When: `unacceptedObjections(ledger, "build-02", "G7")` を呼ぶ
- Then: 空を返す

### unacceptedObjections: 上限を超えない中の異議は数えない
- 対応: US-13.3
- Given: `harm: "中"`・`exceedsCeiling` なしの異議で決定なし
- When: `unacceptedObjections(ledger, "build-02", "G7")` を呼ぶ
- Then: 空を返す（従来どおり記録だけで進む）

### unacceptedObjections: who=user・when=merge@ の異議は数えない
- 対応: US-13.3
- Given: build-02 のステップ `G7` で記録した `exceedsCeiling: true`・`who: "user"`・`when: "merge@build-02"`・決定なしの異議
- When: `unacceptedObjections(ledger, "build-02", "G7")` を呼ぶ
- Then: 空を返す（同意ゲートの対象なのでゲートの承認を止めない）

### unacceptedObjections: who が user でない merge@ の異議は数える
- 対応: US-13.3
- Given: `harm: "高"`・`who: "ai:builder"`・`when: "merge@build-02"`・決定なしの異議（step `G7`）
- When: `unacceptedObjections(ledger, "build-02", "G7")` を呼ぶ
- Then: その異議が1件返る（同意ゲートの対象ではないので、ゲートを止める）

### consentDecided: 上限を超える異議は accepts の無い consented を決定と数えない
- 対応: US-13.3
- Given: `harm: "中"`・`exceedsCeiling: true`・`when: "merge@build-02"` の異議に、`by: "user"`・`decision: "consented"`・`accepts` なしの決定
- When: `consentDecided(item)` を呼ぶ
- Then: false を返す

### consentDecided: 上限を超える異議は accepts 付きの consented を決定と数える
- 対応: US-13.3
- Given: 上と同じ異議に `accepts: "受け入れる"` 付きの consented
- When: `consentDecided(item)` を呼ぶ
- Then: true を返す

### consentDecided: 上限を超える異議でも rejected・resolved の扱いは変わらない
- 対応: —
- Given: `exceedsCeiling: true` の異議に、最新の決定が `by: "user"` の `rejected` のものと `resolved`（accepts なし）のもの
- When: それぞれ `consentDecided(item)` を呼ぶ
- Then: rejected は false、resolved は true を返す

### consentDecided: 上限を超えない中の異議は accepts なしの consented でも決定
- 対応: —
- Given: `harm: "中"`・`exceedsCeiling` なし・`when: "merge@build-02"` の異議に accepts なしの consented
- When: `consentDecided(item)` を呼ぶ
- Then: true を返す（従来どおり）

## commands/ledger.mts（ledger object・--defer なし）

### ledger object: 上限を超える中の異議は --accepts が無ければ拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意は無効（サイクル設定に `[consent]` なし）、builder の build-02 が G7 を提示中
- When: `ledger object build-02 001-x --summary "…" --basis "[app] exposure = public" --loses "…" --harm 中 --decision consented --input "このまま進める" --premises app.exposure` を実行する
- Then: 終了コードが非 0 で、`--accepts` を求めるメッセージが出る。build-02 の decisions.jsonl に行は増えない

### ledger object: 上限を超える中の異議は --premises が無ければ拒む
- 対応: US-13.3
- Given: 上と同じ
- When: `--harm 中 --decision consented --input "…" --accepts "公開の影響を受け入れる"` で `--premises` を付けずに実行する
- Then: 終了コードが非 0 で、`--premises` を求めるメッセージが出る。記録は増えない

### ledger object: 事後同意が有効でも --defer なしならその場の受け入れの言葉が要る
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効
- When: `--harm 中 --decision consented --input "…" --premises app.exposure` で `--accepts` なしに実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object: 重い領域を前提に挙げた中の異議は上限 高でも --accepts が要る
- 対応: US-13.3
- Given: 上限 高、重い領域 `billing`
- When: `--harm 中 --decision consented --input "…" --premises area:billing` で `--accepts` なしに実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object: 基準の宣言を読めない回は宣言が無くても上限を超えるとみなす
- 対応: US-13.3
- Given: 作業ツリーの `[app]` は上限 高だが、基準のブランチ（`resolvePrBase` の defaultBase）の `.hikyaku.config` が TOML として壊れている（`effectiveDeclaration().incomplete === true`）
- When: `--harm 中 --decision consented --input "…" --premises app.exposure` で `--accepts` なしに実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object: 上限を超えれば exceedsCeiling: true を記録する
- 対応: US-13.3
- Given: 上限 なし、事後同意は無効
- When: `--harm 中 --decision consented --input "進める" --accepts "公開の影響を受け入れる" --premises app.exposure` で実行する
- Then: 成功し、open の行に `exceedsCeiling: true`・`when: "now"`・`who: "user"`、decide の行に `accepts` が書かれる

### ledger object: 上限を超えると出力に1行で示す
- 対応: US-13.3
- Given: 上と同じ
- When: 同じコマンドを `--json` なしで実行する
- Then: テキスト出力に「上限を超える」を含む行が1行ある

### ledger object: 上限を超えない中の異議は従来どおり --accepts なしで記録できる
- 対応: US-13.3
- Given: 上限 中、重い領域なし
- When: `--harm 中 --decision consented --input "進める"` で `--accepts`・`--premises` なしに実行する
- Then: 成功し、open の行に `exceedsCeiling` の欄が無い

### ledger object: 上限を超えない高の異議は従来どおり --accepts と --premises が要る
- 対応: —
- Given: 上限 高
- When: `--harm 高 --decision consented --input "…"` で `--accepts` なしに実行する
- Then: 終了コードが非 0 で拒まれる。`--accepts "…" --premises app.impact` を付ければ成功し、`exceedsCeiling` の欄は書かれない

### ledger object: decided なら上限を超えても --accepts は要らない
- 対応: —
- Given: 上限 なし
- When: `--harm 中 --decision decided --input "選択を改める"` で `--accepts`・`--premises` なしに実行する
- Then: 成功し、open の行に `exceedsCeiling: true` が書かれる

### ledger object: 宣言が無いワークスペースでは上限を超えない
- 対応: US-13.3
- Given: ルート・基準のブランチとも `[app]` を書いていない（incomplete は false）
- When: `--harm 中 --decision consented --input "進める" --premises area:billing` で `--accepts` なしに実行する
- Then: 成功し、`exceedsCeiling` の欄は書かれない

### ledger object: --dry-run では上限を超える判定をしても書き込まない
- 対応: —
- Given: 上限 なし
- When: `--harm 中 --decision consented --input "…" --accepts "…" --premises app.exposure --dry-run --json` で実行する
- Then: 成功し、JSON の `record.exceedsCeiling` が true、decisions.jsonl は作られない（行も増えない）

## commands/ledger.mts（ledger open --type objection）

### ledger open: 上限を超える異議は --premises が無ければ拒む
- 対応: US-13.3
- Given: 上限 なし
- When: `ledger open build-02 001-x --type objection --when now --who user --summary "…" --harm 中` を実行する
- Then: 終了コードが非 0 で、`--premises` を求めるメッセージが出る

### ledger open: 上限を超える異議に exceedsCeiling: true を付ける
- 対応: US-13.3
- Given: 上限 なし
- When: `--type objection --when now --who user --summary "…" --harm 中 --premises app.exposure` で実行する
- Then: 成功し、open の行に `exceedsCeiling: true` が書かれる

### ledger open: 害を書かない異議は中として上限と比べる
- 対応: US-13.3
- Given: 上限 なし
- When: `--type objection --when now --who user --summary "…" --premises app.exposure` で `--harm` なしに実行する
- Then: 成功し、open の行に `exceedsCeiling: true` が書かれる（`harm` の欄は無い）

### ledger open: 上限を超えない中の異議は従来どおり --premises なしで記録できる
- 対応: US-13.3
- Given: 上限 中
- When: `--type objection --when now --who user --summary "…" --harm 中` で実行する
- Then: 成功し、`exceedsCeiling` の欄は書かれない

### ledger open: 異議を when=merge で記録しようとすると拒み、--defer を案内する
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効、build-02 は pr の前
- When: `--type objection --when merge@build-02 --who user --summary "…" --harm 中 --premises app.exposure` で実行する
- Then: 終了コードが非 0 で、`ledger object --defer` を案内するメッセージが出る。記録は増えない

### ledger open: 上限を超えない異議でも when=merge は拒む
- 対応: —
- Given: 上限 高、事後同意が有効
- When: `--type objection --when merge@build-02 --who user --summary "…" --harm 中` で実行する
- Then: 終了コードが非 0 で拒まれる（`--defer` の拒否の条件を迂回して同意ゲートへ積む経路が無い）

### ledger open: 異議でない事項の when=merge は従来どおり受け付ける
- 対応: —
- Given: 上限 なし
- When: `--type risk --when merge@build-02 --who user --summary "…" --premises app.exposure --loses "…"` で実行する
- Then: 成功する（拒否は `objection` に限られる）

## commands/ledger.mts（ledger object --defer）

### ledger object --defer: 通れば when=merge@<単位>・決定なしで記録する
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効、builder の build-02 が G7 を提示中（pr は未完了）
- When: `ledger object build-02 001-x --defer --summary "公開 API の互換を崩す" --basis "[app] exposure = public" --loses "既存クライアントの互換" --harm 中 --premises app.exposure` を実行する
- Then: 成功し、build-02 の decisions.jsonl に open の行が1行だけ増える。`type: "objection"`・`who: "user"`・`when: "merge@build-02"`・`exceedsCeiling: true`・`basis`・`loses`・`harm: "中"`・`premises: ["app.exposure"]` を持ち、decide の行は無い

### ledger object --defer: 事後同意が無効なら理由を添えて拒む
- 対応: US-13.3
- Given: 上限 なし、サイクル設定に `[consent] deferred = true` があるがルートに `merge_gate` が無い（`deferredConsent().effective === false`）
- When: 上と同じ `--defer` のコマンドを実行する
- Then: 終了コードが非 0 で、`deferredConsent().reason` の文面がメッセージに含まれる。記録は増えない

### ledger object --defer: サイクル設定に [consent] が無ければ拒む
- 対応: US-13.3
- Given: 上限 なし、サイクル設定に `[consent]` なし
- When: `--defer` のコマンドを実行する
- Then: 終了コードが非 0 で、「サイクル設定に [consent] deferred = true がありません」を含む

### ledger object --defer: --premises が無ければ拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効
- When: `--defer --summary "…" --basis "…" --loses "…" --harm 中` で `--premises` なしに実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: 宣言でない前提だけなら拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効
- When: `--defer … --harm 中 --premises constraints#billing` を実行する
- Then: 終了コードが非 0 で、前提は `app.*`・`area:*` に限ることが示される

### ledger object --defer: 宣言の前提に宣言でない前提が混ざれば拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効
- When: `--defer … --harm 中 --premises app.exposure,adr:20261116-risk-ceiling-table.md` を実行する
- Then: 終了コードが非 0 で拒まれる（1つでも `app.*`・`area:*` 以外があれば拒む）

### ledger object --defer: 重い領域の前提だけなら受け付ける
- 対応: US-13.3
- Given: 上限 高、重い領域 `billing`、事後同意が有効
- When: `--defer … --harm 中 --premises area:billing` を実行する
- Then: 成功し、`exceedsCeiling: true`・`when: "merge@build-02"` で記録される

### ledger object --defer: 上限を超えないなら拒み、その場の決定を案内する
- 対応: US-13.3
- Given: 上限 中、事後同意が有効
- When: `--defer … --harm 中 --premises app.exposure` を実行する
- Then: 終了コードが非 0 で、`--defer` を外してその場で決定を記録する案内が出る。記録は増えない

### ledger object --defer: 宣言に無い領域名では上限を超えないので拒む
- 対応: US-13.3
- Given: 上限 高、重い領域 `billing` だけ、事後同意が有効
- When: `--defer … --harm 中 --premises area:auth` を実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: --decision を渡したら拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効
- When: `--defer … --harm 中 --premises app.exposure --decision consented` を実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: --input を渡したら拒む
- 対応: US-13.3
- Given: 同上
- When: `--defer … --harm 中 --premises app.exposure --input "進める"` を実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: --accepts を渡したら拒む
- 対応: US-13.3
- Given: 同上
- When: `--defer … --harm 中 --premises app.exposure --accepts "受け入れる"` を実行する
- Then: 終了コードが非 0 で拒まれる（受け入れの言葉は同意ゲートでユーザーから取る）

### ledger object --defer: --basis・--loses・--harm・--summary は必須のまま
- 対応: —
- Given: 上限 なし、事後同意が有効
- When: `--defer --premises app.exposure` に `--basis`・`--loses`・`--harm`・`--summary` のどれか1つを欠いて4通り実行する
- Then: どれも終了コードが非 0 で、欠けたオプションを指定するよう求められる

### ledger object --defer: planner の作業単位では置き場が無いので拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効
- When: `ledger object plan 001-x --defer … --harm 中 --premises app.exposure` を実行する
- Then: 終了コードが非 0 で、同意ゲートの置き場が無い理由が出る

### ledger object --defer: close の作業単位では置き場が無いので拒む
- 対応: US-13.3
- Given: 同上
- When: `ledger object close 001-x --defer … --harm 中 --premises app.exposure` を実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: architect の差し戻しの回では拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効、build-02 に return.md があり architect の回が差し戻し（`roundOf(ctx) === "return"`）
- When: `ledger object design 001-x --defer … --harm 中 --premises app.exposure` を実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: architect の通常の回では受け付ける
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効、architect の最初の回で G3 を提示中
- When: `ledger object design 001-x --defer … --harm 中 --premises app.exposure` を実行する
- Then: 成功し、`when: "merge@design"` で記録される

### ledger object --defer: この回で pr を done にした後は拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効、build-02 の progress.jsonl のこの回に `step: "pr"`・`result: "done"` がある
- When: `ledger object build-02 001-x --defer … --harm 中 --premises app.exposure` を実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: patch で publish を done にした後は拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効、サイクルに属す patch の作業単位のこの回に `step: "publish"`・`result: "done"` がある
- When: その patch の作業単位で `ledger object … --defer … --harm 中 --premises app.exposure` を実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: conductor の子では置き場が無いので拒む
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効、`HIKYAKU_CONDUCTOR_CHILD=1`
- When: build-02 で `--defer … --harm 中 --premises app.exposure` を実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: step restart の後の回では、前の回の pr の done は数えない（解釈）
- 対応: —
- Given: 上限 なし、事後同意が有効、build-02 の progress.jsonl に pr の done があり、その後に `step restart` の区切りがある
- When: build-02 で `--defer … --harm 中 --premises app.exposure` を実行する
- Then: 成功する
- 解釈: plan の「この回で pr を done にしていない」を、既存の `anchorDone` と同じく `currentEvents`（最後の restart より後）の範囲で判定すると読んだ

### ledger object --defer: --dry-run では書き込まない（解釈）
- 対応: —
- Given: 上限 なし、事後同意が有効
- When: `--defer … --harm 中 --premises app.exposure --dry-run --json` を実行する
- Then: 成功し、JSON の `record.when` が `merge@build-02`、`decision` が無い（または null）。decisions.jsonl は変わらない
- 解釈: 書き込むコマンドに `--dry-run` を用意する AGENTS.md の規約から、`--defer` でも同じ形で出力し書き込まないとした。JSON の `decision` の表し方は決めていないので「無い」ことだけを確かめる

### ledger object --defer: 記録した異議が同意ゲートの一覧に載る
- 対応: US-13.3
- Given: `--defer` で build-02 に異議 `build-02-1` を記録した
- When: `ledger consent-list build-02 001-x --json` を実行する
- Then: 一覧に `build-02-1` が1件あり、決定が無い状態として示される

### ledger object --defer: 決定なしでは同意ゲートの承認を受け付けない
- 対応: US-13.3
- Given: `--defer` で記録した異議に決定が無く、build-02 の手順が consent にいる
- When: `step report build-02 consent approved` を実行する
- Then: 終了コードが非 0 で、決定の無い項目の ID が理由に含まれる

### ledger object --defer: 決定なしでは pr を完了しない
- 対応: US-13.3
- Given: 同上の状態で、consent をとばして pr を報告しようとする
- When: `step report build-02 pr done` を実行する
- Then: 終了コードが非 0 で拒まれる

### ledger object --defer: accepts の無い consented では同意ゲートが完了しない
- 対応: US-13.3
- Given: `--defer` で記録した異議に `ledger decide build-02 build-02-1 --decision consented --by user --input "進める"`（accepts なし）を記録した
- When: `step report build-02 consent approved` を実行する
- Then: 終了コードが非 0 で拒まれ、`consent-list` の状態は受け入れの言葉が無いことを示す

### ledger object --defer: accepts 付きの consented を記録すればゲートと pr が完了する
- 対応: US-13.3
- Given: 同じ異議に `--decision consented --by user --input "進める" --accepts "互換を崩すことを受け入れる"` を記録した
- When: `step report build-02 consent approved` のあと `step report build-02 pr done` を実行する
- Then: どちらも成功する

### ledger object --defer: 記録した異議はそのゲートの承認を止めない
- 対応: US-13.3
- Given: build-02 の G7 を提示中に `--defer` で異議を記録した（決定なし）
- When: `step report build-02 G7 approved` を実行する
- Then: 成功する（`unacceptedObjections` は who=user・merge@ の異議を数えない）

### consentState: 上限を超える異議の文面が害の高だけを指さない
- 対応: —
- Given: `harm: "中"`・`exceedsCeiling: true` の異議に accepts の無い consented
- When: `ledger consent-list build-02 001-x` を実行する
- Then: 状態の文面に「害が高の異議」だけでなく上限を超える異議にも合う表現（例: 「高として扱う異議」）が出る。「（害が高の異議）」の文面のままではない

## steps/consent.mts（consentGateSlot）

### consentGateSlot: builder の pr の前は置き場がある
- 対応: US-13.3
- Given: サイクルの build-02、conductor の子でない、この回で pr は未完了
- When: `consentGateSlot(stepsOf("builder"), ctx)` を呼ぶ
- Then: undefined を返す

### consentGateSlot: consent ステップを持たないスキルは置き場が無い
- 対応: US-13.3
- Given: planner・close-cycle・create-cycle の ctx
- When: それぞれ `consentGateSlot(stepsOf(<skill>), ctx)` を呼ぶ
- Then: どれも理由の文字列を返す

### consentGateSlot: サイクルに属さない patch は置き場が無い
- 対応: —
- Given: `ctx.cycle === undefined` の patch の ctx
- When: `consentGateSlot(stepsOf("patch"), ctx)` を呼ぶ
- Then: 理由の文字列を返す

### consentGateSlot: 対象が無くても置き場はある
- 対応: US-13.3
- Given: build-02 にもサイクルにも when=merge@build-02 の事項が無い
- When: `consentGateSlot(stepsOf("builder"), ctx)` を呼ぶ
- Then: undefined を返す（slot は「対象があるか」を見ない）

## steps/consent.mts（同意ゲートの when・hasConsentItems）

### consentStep.when: requested のサイクルでほかの単位の事項だけでも step next がゲートを示す
- 対応: US-13.3
- Given: requested（事後同意が有効）、design/ の decisions.jsonl に `when: "merge@build-02"`・`who: "user"`・`type: "risk"` の事項があり、build-02 のファイルには同意の対象が無い。build-02 は consent の直前まで done
- When: `step next build-02 001-x` を実行する
- Then: directive の step が `consent` で、`args.items` に design の事項の ID が入る

### consentStep.when: requested のサイクルでほかの単位の事項だけでも step where がゲートを示す
- 対応: US-13.3
- Given: 上と同じ
- When: `step where` を実行する
- Then: build-02 の現在のステップが `consent` として示される

### consentStep.when: requested のサイクルでほかの単位の事項だけでも Stop フックがゲートを示す
- 対応: US-13.3
- Given: 上と同じで、現在のブランチが build-02 のブランチ
- When: Stop フックのコマンドを標準入力つきで実行する
- Then: 引き止めの理由に build-02 の `consent` が現れる

### consentStep.when: requested でないサイクルはほかの単位の事項だけではゲートを出さない
- 対応: US-13.3
- Given: サイクル設定に `[consent]` なし、design/ の decisions.jsonl に `when: "merge@build-02"`・`who: "user"` の事項、build-02 のファイルには対象なし
- When: `step next build-02 001-x` と `step where` を実行する
- Then: どちらも consent を示さず、次の手が `pr` になる（build-06 のまま）

### consentStep.when: requested でないサイクルでも自分の単位の事項があればゲートを示す
- 対応: —
- Given: サイクル設定に `[consent]` なし、build-02 の decisions.jsonl に `when: "merge@build-02"`・`who: "user"` の事項
- When: `step next build-02 001-x` を実行する
- Then: directive の step が `consent`（build-06 のまま）

### consentStep.when: requested のサイクルで記録が壊れていればゲートを手順に入れる
- 対応: US-13.3
- Given: requested、design/ の decisions.jsonl に JSON として読めない行がある、build-02 には対象なし
- When: `step next build-02 001-x` を実行する
- Then: directive の step が `consent`（読めないので安全側に入れる）

### consentStep.when: requested のサイクルで対象がどこにも無ければ step next はゲートを出さない
- 対応: US-13.3
- Given: requested、サイクルのどの decisions.jsonl にも `when: "merge@build-02"` の事項が無い
- When: `step next build-02 001-x` を実行する
- Then: 次の手が `pr` になる

### consentStep.when: requested のサイクルで位置だけを読む経路は記録を読まずにゲートを入れる
- 対応: US-13.3
- Given: 上と同じ（対象がどこにも無い）
- When: `step where` を実行する
- Then: build-02 の現在のステップが `consent` として示される（positionOnly では記録を読まずに true）

### consentStep.when: requested でも別の単位宛ての事項は対象にしない
- 対応: —
- Given: requested、design/ に `when: "merge@build-03"` の事項だけがある
- When: `step next build-02 001-x` を実行する
- Then: 次の手が `pr` になる

### consentStep.when: requested でも who が user でない merge@ の事項は対象にしない
- 対応: —
- Given: requested、design/ に `who: "ai:architect"`・`when: "merge@build-02"`・`type: "risk"` の事項だけがある
- When: `step next build-02 001-x` を実行する
- Then: 次の手が `pr` になる

### consentStep.when: requested でも pr を done にした回はゲートを出さない
- 対応: —
- Given: requested、design/ に `when: "merge@build-02"` の事項があり決定済み、build-02 のこの回で pr が done
- When: `step next build-02 001-x` と `step where` を実行する
- Then: どちらも consent を示さない（slot の条件）

### consentStep.when: requested でも conductor の子ではゲートを出さない
- 対応: —
- Given: requested、design/ に `when: "merge@build-02"` の事項、`HIKYAKU_CONDUCTOR_CHILD=1`
- When: `step next build-02 001-x` を実行する
- Then: 次の手が `pr` になる（pr の accepts は止める）

### consentStep.when: architect の差し戻しの回はゲートを出さない
- 対応: —
- Given: requested、design/ に `when: "merge@design"` の事項、architect の回が差し戻し
- When: `step next design 001-x` を実行する
- Then: consent が手順に入らない（off）

### consentStep.reopens: requested でも承認後の再提示はその単位のファイルだけを見る
- 対応: —
- Given: requested、build-02 の consent を承認したあと、design/ に `when: "merge@build-02"` の決定の無い事項が足された
- When: `step next build-02 001-x` を実行する
- Then: consent は reopen されず次の手は `pr`。`step report build-02 pr done` は拒まれ、理由にその場で一覧を示す案内（`ledger consent-list build-02`）と足された事項の ID が出る

## steps/consent.mts（consentProblem の案内）

### consentProblem: requested でほかの単位の事項だけなら consent.md の案内になる
- 対応: US-13.3
- Given: requested、design/ に決定の無い `when: "merge@build-02"` の事項、build-02 のファイルに対象なし、consent は未承認
- When: `step report build-02 consent approved` を実行する
- Then: 拒否の理由に `skills/builder/steps/consent.md` の手順の案内が出る（その場の案内ではない）

### consentProblem: requested でないならほかの単位の事項だけのときはその場の案内になる
- 対応: US-13.3
- Given: `[consent]` なし、design/ に決定の無い `when: "merge@build-02"` の事項、build-02 に対象なし
- When: `step report build-02 pr done` を実行する
- Then: 拒否の理由に `hikyaku ledger consent-list build-02` と `hikyaku ledger decide build-02 <ID> …` のその場の案内が出る

### consentProblem: その場の案内のコマンドに --accepts が添えられる
- 対応: US-13.3
- Given: 上と同じ
- When: 同じコマンドを実行する
- Then: 案内の `ledger decide` のコマンドに `[--accepts "<受け入れる言葉>"]` が含まれる

### consentProblem: ゲートの承認後はその場の案内になる
- 対応: —
- Given: requested、build-02 の consent をこの回で承認済み、その後に design/ へ決定の無い `when: "merge@build-02"` の事項が足された
- When: `step report build-02 pr done` を実行する
- Then: 拒否の理由がその場の案内（consent.md ではない）

### consentProblem: conductor の子では blocked で上げる案内になる
- 対応: —
- Given: requested、`HIKYAKU_CONDUCTOR_CHILD=1`、決定の無い対象がある
- When: `step report build-02 pr done` を実行する
- Then: 拒否の理由が「conductor の子では同意ゲートが手順に入りません」の案内

## steps/locate.mts・directive.mts（位置だけの経路）

### directiveOf: 事後同意が有効で G3 が deferred のとき step where と step next の位置が一致する
- 対応: US-13.3
- Given: 上限 なし、事後同意が有効、architect が options を done にし、`step report` が積んだ G3 の risk 事項がある
- When: `step next design 001-x` と `step where` を実行する
- Then: 両方の現在のステップが同じ（G3 が off ならどちらも G3 の次、on ならどちらも G3）

### directiveOf: 事後同意が無効で G3 が同意のとき位置が一致する
- 対応: US-13.3
- Given: 上限 なし、事後同意なし、architect が options を done
- When: `step next design 001-x` と `step where` を実行する
- Then: 両方とも `G3` を示す

### directiveOf: G4 が外との境界に触れて同意になるとき位置が一致する
- 対応: US-13.3
- Given: `[boundaries] external = ["src/api/**"]`、design-delta.md が `src/api/` に触れ、architect が design-delta を done
- When: `step next design 001-x` と `step where` を実行する
- Then: 両方とも `G4` を示す

### directiveOf: 事後同意が有効で G4 の事項が積まれたとき位置が一致する
- 対応: US-13.3
- Given: 上の状態に事後同意が有効で、`step report` が G4 の事項を積んでいる
- When: `step next design 001-x` と `step where` を実行する
- Then: 両方の現在のステップが同じ

### directiveOf: positionOnly の評価でも返す opened は元の ctx のまま（解釈）
- 対応: —
- Given: requested、builder の build-02 で consent の直前
- When: `directiveOf(unit)` を呼ぶ
- Then: 返る `opened.ctx.positionOnly` は true ではなく、`directive.step` は `consent`
- 解釈: plan の「返す `opened` は元のまま（呼び手は `nextCommand` にだけ使う）」を、`opened.ctx` に `positionOnly` を足さないことと読んだ

### buildDirective: notices: false のとき consent の args は記録を読まない
- 対応: —
- Given: requested、design/ に `when: "merge@build-02"` の事項がある
- When: `buildDirective(opened, evaluation, { measure: false, notices: false })` で consent の directive を作る
- Then: `args.items` が空（positionOnly の ctx で args を作る）

### currentStep: 位置だけの評価で off を返す
- 対応: —
- Given: requested、サイクルに同意の対象が無い、build-02 は consent の直前
- When: `ledger open build-02 001-x --type question --when consent@build-02 --who user --summary "…"` を実行する
- Then: 成功し、「consent は今の設定では現れない」の警告は出ない（positionOnly の評価で consent は on）

### currentStep: ledger object が記録する step が step where と同じになる
- 対応: —
- Given: requested、サイクルに同意の対象が無い、build-02 は consent の直前
- When: `ledger object build-02 001-x --summary "…" --basis "…" --loses "…" --harm 中 --decision consented --input "…"`（上限 高）を実行する
- Then: open の行の `step` が `step where` の示すステップと同じ

## directive.mts（OBJECTION_GUIDE）・skills

### objectionGuide: ガイドに上限を超える異議の扱いが載る
- 対応: US-13.3
- Given: 上限 中、builder の build-02 で G7 を提示中
- When: `step next build-02 001-x --json` を実行する
- Then: directive の異議のガイドに、上限を超えると判定された異議は害が中でも受け入れの言葉（`--accepts`）と前提が要るという1項目がある

### objectionGuide: ガイドに --defer が載る
- 対応: US-13.3
- Given: 同上
- When: 同上
- Then: ガイドに、事後同意が有効なサイクルでは `--defer` で同意ゲートへ回せるという1項目があり、`command` に `--defer` の形（`--decision`・`--input`・`--accepts` を含まない形）が添えられる

### skills の consent.md: 高として扱う異議の文面になっている
- 対応: —
- Given: `skills/architect/steps/consent.md`・`skills/builder/steps/consent.md`・`skills/patch/steps/consent.md`
- When: 本文を読む
- Then: 「害が高の異議」だけの表現が残らず、「高として扱う異議（害が高か、上限を超える）」になっている

## 検査とビルド

### conductor lint: ask のタグと ASKS が一致する
- 対応: —
- Given: build-18 の変更を入れた作業ツリー
- When: `node scripts/hikyaku.mts conductor lint` を実行する
- Then: 終了コード 0

### step lint: ステップ定義の検査が通る
- 対応: —
- Given: 同上（consent の定義に slot を持たせた `ConsentStepDefinition`）
- When: `node scripts/hikyaku.mts step lint` を実行する
- Then: 終了コード 0

### tsc: 型検査が通る
- 対応: —
- Given: 同上
- When: `npx tsc --noEmit` を実行する
- Then: 終了コード 0（erasableSyntaxOnly に反する構文が無い）

### npm test: 既存テストと新しいテストが通る
- 対応: —
- Given: 同上、`tests/deferred-objection.test.mts` を含む
- When: `npm test` を実行する
- Then: 終了コード 0（consent-gate・objection・step-hook などの既存テストも通る）
