# Build 09: 行き詰まりの報告の検査と、gh が使えないときの扱い テストシナリオ

## scripts/lib/escalation.mts

### checkEscalation: 見出し形式で3つの節が揃っていれば通る
- 対応: US-3.1
- Given: 本文が「## 試したこと」の下に「- タイムアウトを 30s に延ばした」、「## 問題を変える選択肢」の下に「- スコープから CSV 出力を外す 失うもの: CSV での取り込み」、「## 推奨」の下に「CSV 出力を外す」を持つ
- When: `checkEscalation(text)` を呼ぶ
- Then: `{ ok: true, problems: [] }` が返る

### checkEscalation: 行頭のラベル形式（同じ行の本文）でも読める
- 対応: US-3.1
- Given: 本文が「試したこと: リトライを3回入れた」「選択肢: 要件を緩めて同期を日次にする 失うもの: 即時反映」「推奨: 日次にする」の3行で、見出しもリストも無い
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が true で、各ラベルの同じ行の本文が1項目として数えられている

### checkEscalation: 太字のラベルと全角コロンでも読める
- 対応: US-3.2
- Given: 本文が「**試したこと**：キャッシュを無効にした」「**選択肢**：」の下に「- 前提を変えて API v2 を使う 失うもの：v1 の互換」、「**推奨**：v2 を使う」を持つ
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が true（ラベルの `：` も、項目の `失うもの：` も認める）

### checkEscalation: 「試したこと」の節が無いと欠けになる
- 対応: US-3.1
- Given: 「## 問題を変える選択肢」（各項目に `失うもの:` あり）と「## 推奨」だけがあり、「試したこと」の見出しもラベルも無い
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が false で、`problems` に「試したこと」を名指しする1行が含まれる

### checkEscalation: 「試したこと」の中身が置き場所の印だけだと欠けになる
- 対応: US-3.1
- Given: 「## 試したこと」の下が空行と「（試した手段と結果を書く）」の1行だけで、ほかの2節は埋まっている
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が false で、`problems` に「試したこと」の欠けが含まれる（行全体が `（…）` の行は中身に数えない）

### checkEscalation: 文中に括弧を含む行は置き場所の印として除外しない
- 対応: —
- Given: 「## 試したこと」の下が「- 再実行した（結果は同じ）」の1行だけで、ほかの2節は埋まっている
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が true（行全体が `（…）` ではないので中身に数える）

### checkEscalation: 選択肢の項目に「失うもの:」が無いと何件目かを示す
- 対応: US-3.2
- Given: 「## 問題を変える選択肢」の下に「- スコープを削る 失うもの: 一括削除」「- やめる」の2項目があり、ほかの2節は埋まっている
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が false で、`problems` に「選択肢: 2件目に「失うもの:」がありません」相当の1行が含まれ、1件目への指摘は含まれない

### checkEscalation: 字下げした続きの行にある「失うもの:」も項目に数える
- 対応: US-3.2
- Given: 選択肢の節が「1. 要件を緩めて上限を 100 件にする」と、その下の字下げ行「   失うもの: 101 件以上の一括処理」から成る
- When: `checkEscalation(text)` を呼ぶ
- Then: 選択肢についての欠けは `problems` に含まれない

### checkEscalation: 選択肢の節が空だと欠けになる
- 対応: US-3.2
- Given: 「## 問題を変える選択肢」の見出しの直後に「## 推奨」が続き、選択肢の項目が0件
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が false で、`problems` に「選択肢」が1つも無いことを示す1行が含まれる

### checkEscalation: 推奨が空だと欠けになる
- 対応: US-3.3
- Given: 「試したこと」「選択肢」は埋まっていて、末尾が「推奨:」のラベルだけで本文が無い
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が false で、`problems` に「推奨」の欠けが含まれる

### checkEscalation: 節は次の見出しかほかの節のラベルで終わる
- 対応: —
- Given: 「試したこと: A を試した」の次の行が「## このビルドの状態」、その下に「- 途中まで実装済み」、続いて選択肢と推奨が揃っている
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が true で、「- 途中まで実装済み」は試したことにも選択肢にも数えられない（「このビルドの状態」の項目を選択肢と誤認して「失うもの:」の欠けを出さない）

### checkEscalation: 3つとも欠けると3件の欠けをすべて返す
- 対応: US-3.4
- Given: 本文が「# 差し戻し: build-03」と「## 何が崩れたか」だけ
- When: `checkEscalation(text)` を呼ぶ
- Then: `ok` が false で、`problems` が「試したこと」「選択肢」「推奨」それぞれの1行、計3行になる

### describeEscalationProblems: 欠けを書き直しの案内つきの複数行にする
- 対応: US-3.4
- Given: `problems` が `["試したこと: 項目がありません", "推奨: 本文がありません"]`
- When: `describeEscalationProblems(problems)` を呼ぶ
- Then: 2件の欠けがそれぞれ1行ずつ含まれ、3つの節（試したこと / 選択肢と失うもの / 推奨）で書き直す案内が付いた文字列が返る

## scripts/lib/phase.mts

### readReturn: 3節が揃った return.md では problems が空
- 対応: US-3.4
- Given: サイクルのディレクトリに「# 差し戻し: build-03」と3節が揃った return.md がある
- When: `readReturn(cycleDirectory)` を呼ぶ
- Then: `{ buildId: "build-03", problems: [] }` が返る（見出しからの buildId の読み方は従来どおり）

### readReturn: 推奨の欠けた return.md では problems に欠けが入る
- 対応: US-3.3
- Given: 「# 差し戻し: build-03」と「試したこと」「問題を変える選択肢」だけの return.md がある
- When: `readReturn(cycleDirectory)` を呼ぶ
- Then: `buildId` は "build-03" で、`problems` に「推奨」の欠けが1行含まれる

## scripts/lib/steps（builder / architect の stop）

### builder の stop: 欠けのある return.md では止まる理由に欠けが示される
- 対応: US-3.4
- Given: build-03 のブランチで、return.md が「選択肢」の2件目に `失うもの:` を欠いている
- When: builder の `step next build-03` で stop を評価する
- Then: 差し戻し中として止まり、理由に「差し戻しの記録が欠けている」こと・「選択肢: 2件目に「失うもの:」がありません」・return.md を直して push する案内が含まれる

### architect の stop: 欠けがあれば restart の前に return.md を直す案内が出る
- 対応: US-3.4
- Given: サイクルに「試したこと」を欠いた return.md がある
- When: architect の `step next architect` で stop を評価する
- Then: 案内の前に「return.md を直してから restart する」ことと「試したこと」の欠けが示される

## scripts/commands/step.mts（step restart）

### step restart: --round return で return.md に欠けがあれば受け付けない
- 対応: US-3.4
- Given: サイクルに「推奨」を欠いた return.md がある
- When: `hikyaku step restart architect --round return --reason "build-03 の差し戻し"` を実行する
- Then: 終了コード 1 で、エラーに `describeEscalationProblems` の文面（「推奨」の欠け）が含まれ、progress.jsonl に restart の記録が追記されない

### step restart: --round return で return.md が無ければ受け付けない
- 対応: US-3.4
- Given: サイクルに return.md が無い
- When: `hikyaku step restart architect --round return --reason "再設計"` を実行する
- Then: 終了コード 1 で、return.md が無いことを示すエラーになり、progress.jsonl は変わらない

### step restart: 3節が揃った return.md なら --round return を受け付ける
- 対応: —
- Given: サイクルに「# 差し戻し: build-03」と3節が揃った return.md がある
- When: `hikyaku step restart architect --round return --reason "build-03 の差し戻し"` を実行する
- Then: 終了コード 0 で、progress.jsonl に `round: "return"` の restart の記録が1行追記される

## scripts/commands/step.mts（escalates と failed --reason）

### buildEvent: escalates のステップの failed --reason に欠けがあれば受け付けない
- 対応: US-3.4
- Given: builder の `implement` ステップ（`escalates: true`）で、`--reason` が「テストが通らない。リトライ上限に達した」だけ
- When: `hikyaku step failed build-03 implement --reason "テストが通らない。リトライ上限に達した"` を実行する
- Then: 終了コード 1 で、エラーに3節すべての欠けが示され、progress.jsonl に failed の記録が追記されない

### buildEvent: escalates のステップの failed --reason が揃っていれば記録する
- 対応: US-3.1
- Given: builder の `verify` ステップで、`--reason` が「試したこと: モックを差し替えた / 選択肢: - 受け入れ基準 AC-2 を外す 失うもの: 同時編集の検証 / 推奨: AC-2 を外す」を改行区切りで持つ
- When: `hikyaku step failed build-03 verify --reason "<上記>"` を実行する
- Then: 終了コード 0 で、progress.jsonl に `result: "failed"` と `reason` が記録される

### buildEvent: patch の verify も escalates として検査される
- 対応: US-3.4
- Given: patch の作業単位で、`verify` ステップの `--reason` が「推奨」を欠いている
- When: patch の `step failed ... verify --reason "<推奨の無い報告>"` を実行する
- Then: 終了コード 1 で、「推奨」の欠けが示される

### step lint: gate に escalates が付いた定義を問題として返す
- 対応: —
- Given: `kind: "gate"` かつ `escalates: true` のステップを持つテスト用の StepDefinition
- When: `lintApproval`（`hikyaku step lint`）で検査する
- Then: そのステップを名指しする問題が1件返る。現在の builder / patch の定義では問題が0件

## scripts/lib/conductor.mts

### parseFinalText: 欠けた blocked は violation になり reason に欠けが入る
- 対応: US-3.4
- Given: 最終出力の末尾が `<hikyaku-blocked>テストが通らないので止まります</hikyaku-blocked>` だけ
- When: `parseFinalText(text)` を呼ぶ
- Then: `outcome` が "violation"、`body` がブロックの本文、`reason` に3節の欠けが含まれる

### parseFinalText: 3節が揃った blocked は blocked のまま返る
- 対応: US-3.2
- Given: `<hikyaku-blocked>` の本文に「試したこと: …」「選択肢:」の下に「- 前提を変える 失うもの: 既存の API 互換」「推奨: 前提を変える」がある
- When: `parseFinalText(text)` を呼ぶ
- Then: `outcome` が "blocked" で、`body` が本文のまま返る

### parseFinalText: 行き詰まりに見えない blocked（PR 作成の代行の依頼）も検査する（解釈）
- 対応: US-3.4
- Given: `<hikyaku-blocked>PR 作成の代行を依頼します。ブランチ: hikyaku/build-03</hikyaku-blocked>`
- When: `parseFinalText(text)` を呼ぶ
- Then: blocked の種類を区別せず、`outcome` が "violation" になる

## scripts/lib/reviewers.mts・scripts/commands/reviewers.mts（pr request-reviewers）

### planWithoutPr: reviewers_skip に含まれるフェーズは gh より前に skip が決まる
- 対応: US-18.1
- Given: phase が "build-03"、`skip` が `["build"]`、`reviewers` が `["alice"]`
- When: `planWithoutPr(input)` を呼ぶ
- Then: `{ source: "none", skipped: true, request: [], excluded: [] }` が返る

### planWithoutPr: どちらの一覧も空なら決まり、片方でもあれば undefined
- 対応: —
- Given: (a) `reviewers` と `phaseReviewers` が両方 `[]`、(b) `reviewers` が `[]` で `phaseReviewers` が `["@copilot"]`
- When: それぞれで `planWithoutPr(input)` を呼ぶ
- Then: (a) は `source: "none"`・`skipped: false` の結果、(b) はマージ先が分からないので `undefined` が返る

### pr request-reviewers: skip のときは gh を一度も呼ばない
- 対応: US-18.1
- Given: `[pr] reviewers_skip = ["build"]` の一時リポジトリで、PATH の偽の gh が呼ばれたら記録して終了コード 1 を返す
- When: `hikyaku pr request-reviewers build-03 --pr 12 --json` を実行する
- Then: 終了コード 0、出力が `skipped: true`・`applied: true` で、偽の gh の呼び出し記録が0件

### pr request-reviewers: gh が無いと applied:false・gh-unavailable で終了コード 0
- 対応: US-18.1
- Given: `[pr] reviewers = ["alice"]`、`[conductor] phase_reviewers = ["@copilot"]` で、PATH から gh を外した一時リポジトリ
- When: `hikyaku pr request-reviewers build-03 --pr 12 --json` を実行する
- Then: 終了コード 0、出力が `applied: false`・`reason: "gh-unavailable"`・`stage: "pr view"`・`error`（1行）を持つ

### pr request-reviewers: マージ先が分からない段階の manual は両方の一覧を示す
- 対応: US-18.2
- Given: 前シナリオと同じく gh が無く、`reviewers = ["alice"]`、`phase_reviewers = ["@copilot"]`
- When: `hikyaku pr request-reviewers build-03 --pr 12 --json` を実行する
- Then: `manual` に、GitHub の PR 画面で依頼するレビュアーとして conductor ブランチ向けの "@copilot" とそれ以外向けの "alice" の両方が含まれる

### pr request-reviewers: gh api graphql の失敗は stage graphql・gh-failed で終了コード 0
- 対応: US-18.1
- Given: 偽の gh が `pr view` には base "main"・author "bob" の JSON を返し、`api graphql` では「HTTP 401: Bad credentials」を出して終了コード 1
- When: `hikyaku pr request-reviewers build-03 --pr 12 --json` を実行する
- Then: 終了コード 0、`applied: false`・`reason: "gh-failed"`・`stage: "graphql"`・`error` が「HTTP 401: Bad credentials」の1行になる

### pr request-reviewers: gh pr edit の失敗は依頼する予定の一覧を manual に示す
- 対応: US-18.2
- Given: 偽の gh が view と graphql には成功し（base "main"、依頼済み無し）、`pr edit --add-reviewer` で終了コード 1。`reviewers = ["alice", "carol"]`
- When: `hikyaku pr request-reviewers build-03 --pr 12 --json` を実行する
- Then: 終了コード 0、`applied: false`・`reason: "gh-failed"`・`stage: "pr edit"` で、`manual` に "alice" と "carol" を PR 画面で依頼することが示される

### pr request-reviewers: 成功時は applied:true で既存の欄が変わらない
- 対応: —
- Given: 偽の gh がすべて成功し、`reviewers = ["alice"]`、PR の作成者が "bob"
- When: `hikyaku pr request-reviewers build-03 --pr 12 --json` を実行する
- Then: 終了コード 0、`applied: true`・`requested: true`・`request: ["alice"]` で、`phase`・`pr`・`base`・`source`・`excluded` の欄が従来どおり出る

## scripts/commands/pr-ready.mts（pr ready）

### pr ready: conductor の子は gh を呼ばずに conductor-child を返す
- 対応: —
- Given: `HIKYAKU_CONDUCTOR_CHILD=1` で、呼ばれたら記録して失敗する偽の gh が PATH にある
- When: `hikyaku pr ready build-03 --pr 12 --json` を実行する
- Then: 終了コード 0、`reason: "conductor-child"`・`ready: false` で、偽の gh の呼び出し記録が0件

### pr ready: gh が無いと applied:false と manual を出して終了コード 0
- 対応: US-18.2
- Given: PATH から gh を外した一時リポジトリ（`[pr] auto_ready = true`）
- When: `hikyaku pr ready build-03 --pr 12 --json` を実行する
- Then: 終了コード 0、`ready: false`・`applied: false`・`reason: "gh-unavailable"`・`stage: "pr view"` で、`manual` に `gh pr ready 12` を手で実行するか PR 画面で Ready for Review にすることが示される

### pr ready: gh pr ready 自体の失敗も applied:false で終了コード 0（解釈）
- 対応: US-18.1
- Given: 偽の gh が `pr view` には `{"number":12,"state":"OPEN","isDraft":true,"baseRefName":"main"}` を返し、`pr ready` で終了コード 1。`auto_ready = true`
- When: `hikyaku pr ready build-03 --pr 12 --json` を実行する
- Then: 終了コード 0、`applied: false`・`reason: "gh-failed"`・`stage: "pr ready"`・`manual` を出す（tests/pr-ready.test.mts の「公開失敗は終了コード 1」の期待値を改める）

### pr ready: --for-merge では view の失敗が終了コード 1 のまま
- 対応: —
- Given: 監督（`HIKYAKU_CONDUCTOR_CHILD` なし）で、偽の gh の `pr view` が終了コード 1
- When: `hikyaku pr ready build-03 001-v3-core-concepts --pr 12 --for-merge --json` を実行する
- Then: 終了コード 1 で、`applied: false` の正常終了にしない

### pr ready: --for-merge では gh pr ready の失敗が終了コード 1 のまま
- 対応: —
- Given: 偽の gh の `pr view` が base を conductor ブランチとする Draft の PR を返し、`pr ready` が終了コード 1
- When: `hikyaku pr ready build-03 001-v3-core-concepts --pr 12 --for-merge --json` を実行する
- Then: 終了コード 1 で、再実行のコマンドを含むエラーになる

### pr ready: 応答の形が不正なら従来どおり終了コード 1
- 対応: —
- Given: 偽の gh の `pr view` が終了コード 0 で `{"number":12,"state":"CLOSED","isDraft":true,"baseRefName":"main"}` を返す
- When: `hikyaku pr ready build-03 --pr 12 --json` を実行する
- Then: 終了コード 1 で「開いている PR の状態を確認できません」のエラーになる（gh の失敗とは扱わない）
