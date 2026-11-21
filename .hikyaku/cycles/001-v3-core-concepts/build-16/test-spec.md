# Build 16: 事後同意の有効の判定と、上限を超える受け入れの積み上げ テストシナリオ

共通の前提（各シナリオで断りが無ければ）:

- 一時 Git リポジトリに `hikyaku init --root docs/hikyaku` と `cycle new test --profile express` でサイクル `001-test` を作り、サイクル設定は `docs/hikyaku/cycles/001-test/.hikyaku.config`
- 「前提の宣言あり」は、ルートの `.hikyaku.config` の `[app]` に `exposure = "internal"`・`data = "none"`・`impact = "low"`（上限は「中」まで）と `merge_gate = "user"` を書き、`main` にコミットして bare の origin へ push し、`origin/HEAD → origin/main` にした状態
- 「重い領域」は `[[app.areas]] name = "auth" paths = ["src/auth/**"]` と `name = "billing" paths = ["src/billing/**"]`
- 環境変数 `HIKYAKU_CONDUCTOR_CHILD` は未設定

## config.mts（`[consent]` の読み込み）

### loadConfig: サイクル設定の `[consent] deferred = true` を読む
- 対応: US-20.1
- Given: サイクル設定に `[consent]` と `deferred = true` を書いた
- When: `loadConfig` でサイクル 001 の設定を解決する
- Then: `ResolvedConfig.consent` が `{ deferred: true }` になる

### loadConfig: `[consent]` を書かなければ `{ deferred: undefined }`
- 対応: —
- Given: ルートにもサイクル設定にも `[consent]` が無い
- When: `loadConfig` でサイクル 001 の設定を解決する
- Then: `ResolvedConfig.consent` が `{ deferred: undefined }` になり、エラーにならない

### loadConfig: ルートに `[consent]` を書くとエラー
- 対応: US-20.1
- Given: ルートの `.hikyaku.config` に `[consent]` と `deferred = true` を書いた（サイクル設定には無い）
- When: `hikyaku config 001` を実行する
- Then: 終了コード 1 で、stderr に `[consent]` はサイクル設定でだけ書ける旨と、ルートの `.hikyaku.config` のパスが出る

### loadConfig: ルートの `[consent]` は allowMissingRoot の経路でもエラー
- 対応: US-20.1
- Given: ルートの `.hikyaku.config` に `[consent]`（`deferred = false`）を書いた
- When: `allowMissingRoot` を指定して `loadConfig` を呼ぶ（早期 return の経路）
- Then: 値が false でもエラーになる（早期 return より前に検査される）

### readConsent: 未知のキーはエラー
- 対応: —
- Given: サイクル設定の `[consent]` に `deferred = true` と `mode = "x"` を書いた
- When: `hikyaku config 001` を実行する
- Then: 終了コード 1 で、stderr に未知のキー `mode` とサイクル設定のパスが出る

### readConsent: 真偽値でない値はエラー
- 対応: —
- Given: サイクル設定の `[consent]` に `deferred = "yes"` を書いた
- When: `hikyaku config 001` を実行する
- Then: 終了コード 1 で、stderr に `deferred` は真偽値である旨が出る

### readConsent: merge-base のサイクル設定の不正な値は (b) を不成立にする
- 対応: —
- Given: 前提の宣言あり。`main` にコミットして origin へ push したサイクル設定の `[consent]` が `deferred = 1`（真偽値でない）。作業ブランチを `main` から切り、作業ツリーのサイクル設定は `deferred = true`。G1 の承認の記録は無い
- When: `deferredConsent(config, cycleDirectory)` を呼ぶ
- Then: 例外で落ちず、`requested: true`・`effective: false` で、`reason` に基準のサイクル設定を読めない旨（(b) が成立しない理由）が入る

## deferred-consent.mts（deferredConsent: 有効の判定）

### deferredConsent: requested でなければ git も記録も読まない
- 対応: US-20.1
- Given: サイクル設定に `[consent]` が無い（前提の宣言あり）
- When: `deferredConsent(config, cycleDirectory)` を呼ぶ
- Then: `{ requested: false, effective: false }` が返り、`reason` は未選択の旨。git コマンドを1回も実行しない（`PATH` から git を外しても同じ結果になる）

### deferredConsent: `deferred = false` は requested ではない
- 対応: US-20.1
- Given: サイクル設定に `[consent] deferred = false`、G1 の承認の記録に `deferredConsent: true`
- When: `deferredConsent` を呼ぶ
- Then: `requested: false`・`effective: false`（記録の値で有効にしない）

### deferredConsent: G1 の記録が true なら有効
- 対応: US-20.1
- Given: 前提の宣言あり。サイクル設定に `[consent] deferred = true`。`planning/progress.jsonl` の最後の planner G1 の `approved` に `deferredConsent: true`。`main` のサイクル設定には `[consent]` が無い
- When: `deferredConsent` を呼ぶ
- Then: `{ requested: true, effective: true }`

### deferredConsent: merge-base のサイクル設定に true があれば有効
- 対応: US-20.1
- Given: 前提の宣言あり。サイクル設定に `[consent] deferred = true` を書いて `main` にコミットし origin へ push 済み。作業ブランチ `feature/x` を `main` から切った。G1 の記録には `deferredConsent` が無い
- When: `feature/x` で `deferredConsent` を呼ぶ
- Then: `effective: true`

### deferredConsent: 前提の宣言（`merge_gate`）が無ければ有効にならない
- 対応: US-20.3
- Given: ルートの `[app]` に 3 軸だけを書き `merge_gate` を書かずにコミット・push。サイクル設定に `deferred = true`、G1 の記録に `deferredConsent: true`
- When: `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false`、`reason` にマージがユーザーの関門である前提（`merge_gate`）が宣言に無い旨が入る

### deferredConsent: `[app]` 自体が無ければ有効にならない
- 対応: US-20.3
- Given: ルートに `[app]` が無い。サイクル設定に `deferred = true`、G1 の記録に `deferredConsent: true`
- When: `deferredConsent` を呼ぶ
- Then: `effective: false`、`reason` に前提の宣言が無い旨が入る

### deferredConsent: 作業ツリーにだけ `merge_gate` を書いても有効にならない
- 対応: US-20.3
- Given: `main`（origin へ push 済み、`origin/HEAD → origin/main`）のルート `[app]` は 3 軸だけで `merge_gate` が無く、作業ツリーのルート `[app]` にだけ `merge_gate = "user"` を足した（未コミット）。サイクル設定に `[consent] deferred = true`。G1 の承認の記録は `deferredConsent: true`
- When: `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` はマージがユーザーの関門である前提（`merge_gate`）が宣言に無い旨（`strictest` の論理積で `mergeGate` が undefined になり、merge_gate の段階で落ちる。G1 の記録の段階まで進まない）

### deferredConsent: 基準の宣言を読めない（incomplete）なら有効にならない
- 対応: US-20.3
- Given: origin を作らず、作業ツリーのルート `[app]` に 3 軸と `merge_gate = "user"` を書いた。サイクル設定に `[consent] deferred = true`、G1 の承認の記録は `deferredConsent: true`
- When: `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` は基準の宣言を読めない（`incomplete`）旨の1つだけ（作業ツリーの `merge_gate` だけで有効にしない）

### deferredConsent: conductor の子では有効にならない
- 対応: US-20.1
- Given: 「G1 の記録が true なら有効」と同じ状態で、環境変数 `HIKYAKU_CONDUCTOR_CHILD=1`
- When: `deferredConsent` を呼ぶ（CLI では `hikyaku config 001 --json` を同じ環境変数で実行）
- Then: `effective: false`、`reason` に conductor の子では有効にしない旨が入る

### deferredConsent: 判定の順で最初に外れた理由を返す
- 対応: —
- Given: `HIKYAKU_CONDUCTOR_CHILD=1` かつ `merge_gate` が宣言に無い。サイクル設定に `deferred = true`
- When: `deferredConsent` を呼ぶ
- Then: `reason` は conductor の子の理由（`merge_gate` の理由ではない）

### deferredConsent: G1 の後に作業ブランチで足した値は効かない
- 対応: US-20.1
- Given: 前提の宣言あり（ルートに `[app] merge_gate = "user"`、`origin/main` にマージ済み）。サイクル設定に `[consent]` が無い状態で planner の G1 を approved で記録した（`deferredConsent: false`）。そのあと作業ブランチでサイクル設定に `[consent] deferred = true` を足してコミットした（`main` には無い）
- When: `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` は G1 の記録にも merge-base のサイクル設定にも値が無い旨
- 対照: 同じ状態でサイクル設定の変更を `main` にマージして origin へ push し、作業ブランチに取り込むと `effective: true` になる

### deferredConsent: 最後の G1 の記録だけを見る
- 対応: —
- Given: 前提の宣言あり（ルートに `[app] merge_gate = "user"`、`origin/main` にマージ済み）。サイクル設定に `[consent] deferred = true`。`planning/progress.jsonl` に planner G1 の approved が2件あり、1件目が `deferredConsent: true`、2件目（後）が `deferredConsent: false`。merge-base のサイクル設定には `[consent]` が無い
- When: `deferredConsent` を呼ぶ
- Then: `effective: false` で、`reason` は G1 の記録にも merge-base のサイクル設定にも値が無い旨
- 対照: 2件目を `deferredConsent: true` に変えると `effective: true` になる

### deferredConsent: G1 の記録に欄が無い（従来の記録）なら (a) は不成立
- 対応: —
- Given: 前提の宣言あり（ルートに `[app] merge_gate = "user"`、`origin/main` にマージ済み）。planner G1 の approved の記録に `deferredConsent` 欄が無い。サイクル設定は `[consent] deferred = true`、merge-base のサイクル設定には無い
- When: `deferredConsent` を呼ぶ
- Then: `effective: false` で、`reason` は G1 の記録にも merge-base のサイクル設定にも値が無い旨

### deferredConsent: スタックした前フェーズのブランチに入っているだけでは有効にならない
- 対応: US-20.1
- Given: 前提の宣言あり（ルートに `[app] merge_gate = "user"`、`origin/main` にマージ済み）。`main` から切った前フェーズのブランチ `hikyaku/001/architect` にサイクル設定の `[consent] deferred = true` をコミットし（`main` には未マージ）、そこから `hikyaku/001/build-01` を切った。G1 の承認の記録は無い
- When: `hikyaku/001/build-01` で `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` は merge-base のサイクル設定に値が無い旨（merge-base は `main` 上）
- 対照: `hikyaku/001/architect` を `main` にマージして origin へ push し、build ブランチに取り込むと `effective: true` になる

### deferredConsent: conductor ブランチに入っているだけでは有効にならない
- 対応: US-20.1
- Given: 前提の宣言あり（ルートに `[app] merge_gate = "user"`、`origin/main` にマージ済み）。`main` から切った conductor ブランチ `hikyaku/001/conductor` にだけサイクル設定の `[consent] deferred = true` をコミットし、そこから build ブランチを切った（`main` には無い）。G1 の承認の記録は無い。`HIKYAKU_CONDUCTOR_CHILD` は未設定
- When: build ブランチで `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` は merge-base のサイクル設定に値が無い旨
- 対照: 同じ値を `main` にマージして origin へ push し、build ブランチに取り込むと `effective: true` になる

### deferredConsent: サイクル設定の base_branch を向け直しても有効にならない
- 対応: US-20.1
- Given: 前提の宣言あり（ルートに `[app] merge_gate = "user"`、`origin/main` にマージ済み）。`main` から切ったブランチ `staging` にサイクル設定の `[consent] deferred = true` をコミットし origin へ push（`main` には無い）。作業ブランチは `staging` から切り、サイクル設定の `base_branch = "staging"` に向け直した。G1 の承認の記録は無い
- When: `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` は merge-base のサイクル設定に値が無い旨（デフォルトブランチ `main` の merge-base に値が無い。PR のマージ先 `staging` は使わない）
- 対照: `staging` を `main` にマージして origin へ push すると `effective: true` になる

### deferredConsent: デフォルトブランチと defaultBase の両方に値があるときだけ成立する
- 対応: US-20.1
- Given: 前提の宣言あり（ルートに `[app] merge_gate = "user"` を `main` と `develop` の両方にマージ済みで origin へ push）。ルート設定の `base_branch = "develop"`（defaultBase）。`develop` にはサイクル設定の `[consent] deferred = true` がマージ済みで、デフォルトブランチ `main` には無い。作業ツリーのサイクル設定も `deferred = true`。G1 の承認の記録は無い
- When: `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` は merge-base のサイクル設定に値が無い旨（`main` の基準）
- 対照: 続けて `main` にも同じ値をマージして push すると `effective: true` になる

### deferredConsent: ローカルの ref だけに値があっても成立しない
- 対応: US-20.1
- Given: 前提の宣言あり（ルートに `[app] merge_gate = "user"`、`origin/main` にマージ済み）。ローカルの `main` にサイクル設定の `[consent] deferred = true` をコミットしたが origin へ push していない（`origin/main` には無い）。作業ブランチをローカルの `main` から切った。G1 の承認の記録は無い
- When: `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` は merge-base のサイクル設定に値が無い旨（`origin/main` の基準に値が無い）
- 対照: ローカルの `main` を origin へ push すると `effective: true` になる

### deferredConsent: デフォルトブランチが分からなければ (b) は不成立
- 対応: —
- Given: 前提の宣言（ルートに `[app] merge_gate = "user"`）とサイクル設定の `[consent] deferred = true` を `main` にコミットし、bare の origin を作って push した。ルート設定の `base_branch = "main"`（defaultBase の基準から宣言を読めるので `incomplete` にはならない）。`git remote set-head` はせず、`origin/HEAD` が無い。G1 の承認の記録は無い
- When: `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` はデフォルトブランチ（origin/HEAD）が分からない旨の1つだけ
- 対照: `git remote set-head origin main` を実行すると `effective: true` になる

### deferredConsent: 基準の ref が Hikyaku のブランチなら (b) は不成立
- 対応: —
- Given: 前提の宣言あり（ルートに `[app] merge_gate = "user"`、`origin/main` にマージ済み）。ルート設定の `base_branch` が `hikyaku/001/architect`（Hikyaku のブランチ）で、`main` と `hikyaku/001/architect` の両方の merge-base にサイクル設定の `[consent] deferred = true` がある。G1 の承認の記録は無い
- When: `deferredConsent` を呼ぶ
- Then: `requested: true`・`effective: false` で、`reason` は基準を読めない旨（baselines の1つが `unavailable`）
- 対照: ルート設定の `base_branch` を `main` に戻すと `effective: true` になる

### deferredConsent: 結果をキャッシュする
- 対応: —
- Given: 「G1 の記録が true なら有効」の状態で、同じ `ResolvedConfig` を持つ
- When: `deferredConsent(config, dir)` を呼んだあと `progress.jsonl` を消し、同じ `config`・`dir` でもう一度呼ぶ
- Then: 2回目も `effective: true`（同じオブジェクトの値）。別の `loadConfig` で得た `config` では `effective: false` になる

### deferredConsentNotice: requested なのに有効でないときだけ文を返す
- 対応: US-20.3
- Given: 3つの状態 — (1) `[consent]` 無し、(2) requested で有効、(3) requested で `merge_gate` が無い
- When: それぞれで `deferredConsentNotice` を呼ぶ
- Then: (1)(2) は undefined、(3) は事後同意が有効でない旨と `reason` を含む文字列

## deferred-consent.mts（g1ConsentRecord: G1 で記録する値）

### g1ConsentRecord: requested でなければ false
- 対応: US-20.1
- Given: サイクル設定に `[consent]` が無い
- When: `g1ConsentRecord(config, dir, "2026-11-17T10:00:00Z")` を呼ぶ
- Then: `{ value: false }`（note なし）

### g1ConsentRecord: 提示の前にコミットした値は true
- 対応: US-20.1
- Given: サイクル設定の `deferred = true` を `2026-11-17T09:00:00+09:00` にコミットし、未コミットの変更が無い
- When: `presentedAfter = "2026-11-17T01:00:00Z"`（= 10:00 JST）で呼ぶ
- Then: `{ value: true }`（タイムゾーンの異なる時刻を Date に直して比べる）

### g1ConsentRecord: 提示のあとにコミットした値は false
- 対応: US-20.1
- Given: サイクル設定の `deferred = true` を `2026-11-17T11:00:00+09:00` にコミット
- When: `presentedAfter = "2026-11-17T01:00:00Z"` で呼ぶ
- Then: `value: false` と、提示のあとに書き換えた旨の `note`

### g1ConsentRecord: 境界値（コミット時刻と提示の時刻が同じ）
- 対応: —
- Given: サイクル設定の最後のコミットの committer date が `2026-11-17T01:00:00Z`
- When: `presentedAfter = "2026-11-17T01:00:00Z"` で呼ぶ
- Then: `value: true`（「より後」だけを false にする）

### g1ConsentRecord: 未コミットの変更があれば false
- 対応: US-20.1
- Given: 提示の前に `deferred = true` をコミット済みで、作業ツリーでサイクル設定にコメント行を足した（未コミット）
- When: 提示の後の時刻で呼ぶ
- Then: `value: false` と、未コミットの変更がある旨の `note`

### g1ConsentRecord: git を読めなければ false
- 対応: —
- Given: Git リポジトリでない一時ディレクトリにサイクル設定（`[consent] deferred = true`）を置き、その設定を読んだ `ResolvedConfig` を持つ
- When: `g1ConsentRecord(config, そのディレクトリ, "2026-11-17T01:00:00Z")` を呼ぶ
- Then: `value: false` と、git を読めない旨の `note`

### g1ConsentRecord: presentedAfter が無ければ false
- 対応: —
- Given: サイクル設定の `[consent] deferred = true` をコミット済みで、未コミットの変更が無い
- When: `g1ConsentRecord(config, dir, undefined)` を呼ぶ（G1 の直前に完了のステップの記録が無い）
- Then: `value: false` と、提示の時刻が分からない旨の `note`（安全側）

## planner の G1（step next の args と step report の記録）

### step next: G1 の args に事後同意の値が載る
- 対応: US-20.1
- Given: サイクル設定に `deferred = true` をコミット済みで、planner を G1 の直前まで進めた
- When: `hikyaku step next planner 001 --json` を実行する
- Then: G1 の directive の `args.deferredConsent` が `true`。`[consent]` が無ければ `false`

### step report: G1 の approved で deferredConsent を記録する
- 対応: US-20.1
- Given: 「step next: G1 の args に事後同意の値が載る」の状態（コミットは G1 の直前のステップの完了より前）
- When: `hikyaku step report planner G1 001 --result approved --input OK` を実行する
- Then: `planning/progress.jsonl` の G1 の行に `"deferredConsent": true` が入る

### step report: 提示のあとに書き換えた値は false で記録し、出力に1行出す
- 対応: US-20.1
- Given: G1 の直前のステップを done で報告したあとに、サイクル設定へ `deferred = true` を足してコミットした
- When: `hikyaku step report planner G1 001 --result approved --input OK` を実行する
- Then: G1 の行は `"deferredConsent": false`、stdout に提示のあとに書き換えたので記録しない旨が1行出る

### step report: G1 の値は LLM の引数では受け取らない
- 対応: US-20.1
- Given: サイクル設定に `[consent]` が無い状態で G1 にいる
- When: `step report planner G1 001 --result approved --input OK --deferred-consent true` を実行する
- Then: 終了コード 1 で、stderr に `不明なオプションです: --deferred-consent` が出る（registry の既存の検査）。`planning/progress.jsonl` に G1 の行は追記されない

### step report: G1 の approved 以外では deferredConsent を書かない
- 対応: —
- Given: サイクル設定に `deferred = true`
- When: G1 を `--result rejected` で報告する、または G1 以外のステップを done で報告する
- Then: その行に `deferredConsent` 欄が無い

### step report: `--dry-run` では記録しない
- 対応: —
- Given: G1 にいて、サイクル設定は `deferred = true`
- When: `step report planner G1 001 --result approved --input OK --dry-run` を実行する
- Then: `planning/progress.jsonl` が変わらない

## engine.mts（StepDefinition.defers と lintApproval）

### lintApproval: ゲートのステップに defers があればエラー
- 対応: —
- Given: `kind: "gate"` で `defers` を持つ定義を含む手順
- When: `lintApproval` を呼ぶ
- Then: defers は gate でないステップだけに置ける旨のエラーが返る

### lintApproval: 既存の手順定義は通る
- 対応: —
- Given: `stepsOf` で得たすべてのスキルの手順（architect の options・design-delta に defers がある）
- When: `lintApproval` と `hikyaku step lint` を実行する
- Then: エラーが無い

## architect（G3 の deferred と options の defers）

### G3: 事後同意が有効で害が上限を超えれば、options の done に --loses が要る
- 対応: US-20.4
- Given: 前提の宣言あり（上限「中」）。事後同意が有効（G1 の記録 true）。architect を options まで進めた
- When: `step report architect options 001 --result done --harm 高 --paths src/api/**` を `--loses` 無しで実行する
- Then: 終了コード 1 で、stderr に `--loses` が要る旨が出て、`design/progress.jsonl` にも `design/decisions.jsonl` にも追記されない

### G3: --loses を添えれば risk の事項が自動で積まれ、G3 は止まらない
- 対応: US-20.4
- Given: 前の シナリオと同じ状態
- When: `step report architect options 001 --result done --harm 高 --paths src/api/** --loses "安全側の案 A の、公開前の段階的リリース"` を実行する
- Then: `design/decisions.jsonl` に `record: "open"`・`kind: "risk"`・`who: "user"`・`when: "merge@architect"`・`ask: "G3"`・`step: "options"`・`premises: ["app.exposure"]`・`loses` が上の文・`harm: "高"`・`source: "step-report"` の事項が1件追記される。返った directive は G3 で止まらず（express では G3 を飛ばして）`adr` に進む

### G3: deferred の回のゲートは確認として評価される
- 対応: US-10.5
- Given: 前の シナリオと同じ状態で profile を `standard`（確認のゲートを省かない）にした
- When: options の done（`--loses` 付き）の後に `step next architect 001 --json` を実行する
- Then: G3 の directive の `approval` が `"confirm"` で、`approvalReason` が null

### G3: 上限が「なし」なら最上段の軸を前提に入れる
- 対応: US-20.4
- Given: 前提の宣言の軸を `exposure = "public"`・`data = "none"`・`impact = "low"`（上限「なし」）にし、事後同意が有効
- When: options を `--harm 中 --paths src/api/** --loses "..."` で done にする
- Then: 事項の `premises` が `["app.exposure"]`（最上段の軸だけ）

### G3: 上限を決めた軸が複数なら全部を前提に入れる
- 対応: —
- Given: 軸を `exposure = "internal"`・`data = "internal"`・`impact = "low"`（2軸が中段、上限「中」）にし、事後同意が有効
- When: options を `--harm 高 --paths src/api/** --loses "..."` で done にする
- Then: `premises` が `app.exposure` と `app.data` の両方を含む

### G3: 重い領域に当たれば `area:<name>` を前提に入れ、害の超過と両方なら両方
- 対応: US-20.4
- Given: 重い領域 auth を宣言し、事後同意が有効
- When: options を `--harm 高 --paths src/auth/** --loses "..."` で done にする
- Then: `premises` が `app.exposure` と `area:auth` の両方を含み、G3 は deferred（止まらない）

### G3: 重い領域だけに当たれば、前提は `area:<name>` だけ
- 対応: US-20.4
- Given: 重い領域 auth を宣言し（上限「中」）、事後同意が有効
- When: options を `--harm 中 --paths src/auth/** --loses "..."` で done にする
- Then: 事項の `premises` が `["area:auth"]` だけ（害は上限以内なので `app.<axis>` を含まない）で、G3 は止まらずに `adr` へ進む

### G3: 上限以内なら defers は値を返さず、--loses は要らない
- 対応: —
- Given: 事後同意が有効。上限「中」
- When: options を `--harm 中 --paths src/api/**` で `--loses` 無しに done にする
- Then: 受け付けられ、`decisions.jsonl` に事項が増えない

### G3: 事後同意が有効でなければ従来どおり now で、事項を積まない
- 対応: US-20.3
- Given: サイクル設定に `deferred = true` があるが `merge_gate` の宣言が無い
- When: options を `--harm 高 --paths src/api/**` で done にし、`step next` を実行する
- Then: `--loses` は求められず、G3 は `approval: "consent"` で返り、`notices` に事後同意が有効でない理由が出る

### G3: 申告が欠けた回は now のまま
- 対応: US-20.2
- Given: 事後同意が有効
- When: options を `--harm` も `--paths` も無しで done にする
- Then: `--loses` は求められず、事項も積まれず、G3 は `approval: "consent"`

### G3: 基準の宣言を読めない回は now のまま
- 対応: US-20.2
- Given: サイクル設定は `deferred = true`、G1 の記録は true だが、origin が無く基準の宣言を読めない（incomplete）
- When: options を `--harm 高 --paths src/api/**` で done にする
- Then: `--loses` は求められず、G3 は `approval: "consent"`

### G3: 差し戻しからの再設計の回は now のまま
- 対応: US-20.2
- Given: 事後同意が有効。サイクルに `return.md` があり、architect が差し戻しからの再設計の回にいる
- When: options を `--harm 高 --paths src/api/**` で `--loses` 無しに done にし、`step next` を実行する
- Then: 報告は受け付けられ（`defers` が値を返さない）、`decisions.jsonl` に事項は増えず、G3 は `approval: "consent"`

### G3: 手書きの `ledger open` の事項では deferred にならない
- 対応: US-20.4
- Given: 事後同意が有効。options を `--harm 高 --paths src/api/** --loses "..."` で done にして事項が積まれたあと、`design/decisions.jsonl` のその行から `source` 欄だけを消した（手書きの `ledger open` と同じ形。ask・premises・at はそのまま）
- When: `step next architect 001 --json` を実行する
- Then: G3 は `approval: "consent"`（`source: "step-report"` の無い事項は数えない）

### G3: 前の回の options より前の事項では deferred にならない
- 対応: —
- Given: 事後同意が有効。1回目の options の done（`--loses` 付き）で `ask: "G3"` の事項が積まれた。そのあと `design/progress.jsonl` に、事項の `at` より後の時刻で options の done の行（`--harm 高 --paths src/api/**` 相当）を直接追記した（2回目の done に対応する事項が無い状態）
- When: `step next architect 001 --json` を実行する
- Then: G3 は `approval: "consent"`（事項の `at` が最後の options の done より前）

### G3: 事項の premises が判定の前提を覆わなければ now
- 対応: —
- Given: 事後同意が有効で重い領域 auth を宣言。options を `--harm 高 --paths src/auth/** --loses "..."` で done にし、`premises: ["app.exposure", "area:auth"]` の事項が積まれた。そのあと `design/decisions.jsonl` のその行の `premises` を `["app.exposure"]` に書き換えた
- When: `step next architect 001 --json` を実行する
- Then: G3 は `approval: "consent"`

### G3: decisions.jsonl を読めなければ now
- 対応: —
- Given: 事後同意が有効で G3 が deferred になる状態から、`design/decisions.jsonl` を壊れた JSON 行にした
- When: `step next` を実行する
- Then: G3 は `approval: "consent"`（安全側）

## architect（G4 の deferred と design-delta の defers）

### G4: 申告に無い重い領域に触れる設計は、事後同意が有効なら事項を積んで止まらない
- 対応: US-20.4
- Given: 事後同意が有効。重い領域 auth・billing を宣言。options を `--harm 中 --paths src/api/**` で done にし、design-delta.md に `src/auth/session.ts` と `src/billing/invoice.ts` への言及を書いた
- When: `step report architect design-delta 001 --result done --loses "安全側の案の、認証まわりの分離"` を実行する
- Then: `decisions.jsonl` に `ask: "G4"`・`step: "design-delta"`・`when: "merge@architect"`・`who: "user"`・`premises: ["area:auth", "area:billing"]`・`source: "step-report"` の事項が積まれ、G4 は止まらずに次へ進む（express）

### G4: --loses が無ければ design-delta の done を受け付けない
- 対応: US-20.4
- Given: 前の シナリオと同じ状態
- When: `--loses` 無しで design-delta を done で報告する
- Then: 終了コード 1、stderr に `--loses` が要る旨。progress にも decisions にも追記されない

### G4: architecture-review で設計の文書が変わり、事項に無い重い領域に触れたら now に戻る
- 対応: US-20.4
- Given: 事後同意が有効。design-delta の done で `premises: ["area:auth"]` の事項が積まれ G4 が deferred になった。そのあと architecture-review で design-delta.md に `src/billing/invoice.ts` への言及を足した（design-delta の done は取り直していない）
- When: `step next architect 001 --json` を実行する
- Then: G4 は `approval: "consent"`（いまの `undeclaredAreas` の billing を事項が覆わない）

### G4: 外との境界の変更は事後同意が有効でも now
- 対応: US-20.2
- Given: 事後同意が有効。`[boundaries]` に外との境界 `src/api/public/**` を宣言し、design-delta.md がそのパスに触れ、さらに申告に無い重い領域 auth にも触れる
- When: design-delta を `--loses "..."` 付きで done にして `step next` を実行する
- Then: G4 は `approval: "consent"` で、`approvalReason` は外との境界の理由（境界の判定が裏取りの deferred より先）。`design/decisions.jsonl` に `ask: "G4"` の事項は積まれない

### G4: 差し戻しからの再設計の回は now のまま
- 対応: US-20.2
- Given: 事後同意が有効。`return.md` がある再設計の回で、design-delta.md が申告に無い重い領域 auth に触れる
- When: design-delta を done にして `step next` を実行する
- Then: G4 は `approval: "consent"`

### G4: 基準の宣言を読めない回は now のまま
- 対応: US-20.2
- Given: サイクル設定 `deferred = true`・G1 の記録 true だが、基準の宣言を読めない（incomplete）。design-delta.md が auth に触れる
- When: design-delta を done にして `step next` を実行する
- Then: `--loses` は求められず、G4 は `approval: "consent"`

### G4: 申告の裏取りが無ければ defers は値を返さない
- 対応: —
- Given: 事後同意が有効。options の `--paths src/auth/**` で申告済みで、design-delta.md も auth にだけ触れる
- When: design-delta を `--loses` 無しで done にする
- Then: 受け付けられ、事項は積まれない

## step report（risk の自動記録）

### step report: `--dry-run` では事項を書かない
- 対応: —
- Given: 事後同意が有効で、options の done が上限を超える状態
- When: `step report architect options 001 --result done --harm 高 --paths src/api/** --loses "..." --dry-run` を実行する
- Then: `design/progress.jsonl` と `design/decisions.jsonl` のどちらも変わらない

### step report: ledger を読めなければ報告を受け付けない
- 対応: —
- Given: 事後同意が有効で、`design/decisions.jsonl` が壊れている。options の done が上限を超える
- When: `--loses` 付きで options を done で報告する
- Then: 終了コード 1 で、`design/progress.jsonl` に追記されない

### step report: 事項は progress の追記のあとに書かれる
- 対応: —
- Given: 「G3: --loses を添えれば risk の事項が自動で積まれ」の状態
- When: 報告する
- Then: 事項の `at` が options の done の行の `at` 以上である

### ledger open: 手書きの事項に source は付かない
- 対応: —
- Given: architect の作業単位
- When: `hikyaku ledger open architect 001 --kind risk ...` で事項を開く
- Then: 追記された行に `source` 欄が無い

## 同意ゲートの一覧（build-06 との接続）

### ledger consent-list: 積まれた G3・G4 の事項が同意ゲートの一覧に載る
- 対応: US-10.5
- Given: 事後同意が有効で、G3（`premises: ["app.exposure"]`）と G4（`premises: ["area:auth"]`）の事項が自動で積まれた
- When: `hikyaku ledger consent-list architect 001 --json` を実行する
- Then: 2件が載り、各項目に受け入れたリスク・前提・`loses` が含まれる（同意を省かず、マージの前に示される）

### step next: deferred にしたサイクルでも PR の前に同意ゲートが現れる
- 対応: US-10.5
- Given: 前の シナリオの状態で architect を pr の直前まで進めた
- When: `step next architect 001 --json` を実行する
- Then: build-06 の同意ゲート（ask: `deferred-consent`）が `approval: "consent"` で返る

## G1・G10 は事後同意の対象にならない

### G1: 事後同意が有効でも同意のまま
- 対応: US-20.2
- Given: merge-base のサイクル設定に `deferred = true` があり事後同意が有効。profile `express`
- When: planner を G1 まで進めて `step next planner 001 --json` を実行する
- Then: G1 は `approval: "consent"`（deferred にならない）

### G10: decisions の変更は事後同意が有効でも同意のまま
- 対応: US-20.2
- Given: 事後同意が有効（merge-base のサイクル設定に `deferred = true`）。document-guide.md に `decisions` を `docs/adr/` で登録済み。close-cycle を G10 の直前まで進め、作業ツリーに新しい ADR `docs/adr/20261117-new.md` を足した（未コミット）
- When: `step next close-cycle 001 --json` を実行する
- Then: G10 は `approval: "consent"`・`approvalReason` は decisions・constraints の変更を含む昇格の旨（deferred にならない）

### G10: constraints の変更は事後同意が有効でも同意のまま
- 対応: US-20.2
- Given: 事後同意が有効。document-guide.md に `constraints` を `docs/constraints.md` で登録し、その本文をコミット済み。close-cycle を G10 の直前まで進め、作業ツリーで `docs/constraints.md` の本文に1行足した（未コミット）
- When: `step next close-cycle 001 --json` を実行する
- Then: G10 は `approval: "consent"`・`approvalReason` は decisions・constraints の変更を含む昇格の旨

## 手順の位置だけを読む経路との一致

### step where: G3 が deferred の回に step next と現在地が一致する
- 対応: —
- Given: 事後同意が有効で、options の done（`--loses` 付き）で G3 が deferred になった（profile `express`）
- When: `hikyaku step where architect 001 --json` と `hikyaku step next architect 001 --json` を実行する
- Then: どちらも現在のステップが `adr`（G3 を通り過ぎた位置）で一致する

### step where: G4 が deferred の回に step next と現在地が一致する
- 対応: —
- Given: 事後同意が有効で、design-delta の done（`--loses` 付き）で G4 が deferred になった（profile `express`）
- When: `step where` と `step next` を実行する
- Then: 現在のステップが一致する（G4 の次のステップ）

### step where: 事項が前提を覆わず now に戻った回も一致する
- 対応: —
- Given: 「G4: architecture-review で設計の文書が変わり…」の状態
- When: `step where` と `step next` を実行する
- Then: どちらも現在のステップが G4 で一致する

## 表示（config と notices）

### config --json: deferredConsent に判定が出る
- 対応: US-20.3
- Given: サイクル設定 `deferred = true`、`merge_gate` が無い
- When: `hikyaku config 001 --json` を実行する
- Then: `deferredConsent` が `{ requested: true, effective: false, reason: "<merge_gate が無い旨>" }`

### config: テキストに1行出る
- 対応: —
- Given: 事後同意が有効
- When: `hikyaku config 001` を実行する
- Then: 事後同意が有効である旨の1行が出る

### buildDirective: requested で有効でなければ notices に出し続ける
- 対応: US-20.3
- Given: サイクル設定 `deferred = true`、前提の宣言に `merge_gate` が無い
- When: `step next architect 001 --json` を options・G3・design-delta の各位置で実行する
- Then: どの directive の `notices` にも事後同意が有効でない旨と理由が含まれる

### buildDirective: requested でなければ notices に出さない
- 対応: —
- Given: `[consent]` が無い
- When: `step next architect 001 --json`
- Then: `notices` に事後同意の文が無い

## 検証コマンド

### conductor lint・step lint・tsc・npm test が通る
- 対応: —
- Given: build-16 の変更（指示文 G1.md・options.md・design-delta.md を含む）を適用したリポジトリ
- When: `node scripts/hikyaku.mts conductor lint`、`node scripts/hikyaku.mts step lint`、`npx tsc --noEmit`、`npm test` を実行する
- Then: すべて終了コード 0

### step report の help に --loses が載る
- 対応: —
- Given: build-16 の変更を適用した
- When: `hikyaku help step report` を実行する
- Then: usage と details に `--loses` が出る
