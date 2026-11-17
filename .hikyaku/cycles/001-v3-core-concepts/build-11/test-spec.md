# Build 11: G10 の同意と確認の区分、基準を消す経路と指標の比較 テストシナリオ

共通の前提（結合テスト）: `tests/helpers.mts` の `workspace(t, true)` で一時 Git リポジトリを作り、サイクルは `docs/hikyaku/cycles/001-test`（`cycles.md` の `status: active`、`started: 2026-10-01`）。document-guide.md の `decisions` の `path` は `docs/decisions/`、`constraints` の `path` は `docs/constraints.md`、`conventions` は `AGENTS.md`、`overview` は `docs/overview.md`。ADR の frontmatter は `---\nstatus: accepted\n---\n\n# キャッシュ層を置く\n\n- **決定**: …\n` の形。

## config（`scripts/lib/config.mts`）

### loadConfig: promotion_gate の既定は express だけ false
- 対応: US-11.2
- Given: ルート設定に `profile = "express"` を書いたワークスペースと、`profile = "standard"` を書いたワークスペース。どちらも `promotion_gate` は書かない
- When: それぞれ `loadConfig` を呼ぶ
- Then: express は `gates.promotion === false`、standard は `gates.promotion === true`

### loadConfig: promotion_gate を明示すればプロファイルの既定を上書きする
- 対応: US-11.2
- Given: `profile = "standard"` と `promotion_gate = false` を書いたルート設定
- When: `loadConfig` を呼ぶ
- Then: `gates.promotion === false`

### readMetricsConfig: [metrics] が無ければ window は 2
- 対応: US-9.4
- Given: `[metrics]` テーブルを書かないルート設定
- When: `loadConfig` を呼ぶ
- Then: `metrics.window === 2`

### readMetricsConfig: サイクル設定の window がルートの値を上書きする
- 対応: US-9.4
- Given: ルート設定に `[metrics]\nwindow = 2`、サイクル `001-test` の設定に `[metrics]\nwindow = 3`
- When: サイクル `001-test` を指定して `loadConfig` を呼ぶ
- Then: `metrics.window === 3`

### readMetricsConfig: 0・負・小数・文字列は HikyakuError
- 対応: —
- Given: `[metrics]` の `window` が `0`、`-1`、`1.5`、`"2"` のそれぞれのルート設定
- When: `loadConfig` を呼ぶ
- Then: いずれも `HikyakuError` を投げ、メッセージに `metrics.window`（キー名）と「正の整数」が含まれる

### readMetricsConfig: window = 1 は受け付ける（境界）
- 対応: —
- Given: `[metrics]\nwindow = 1`
- When: `loadConfig` を呼ぶ
- Then: `metrics.window === 1`、エラーにならない

## promotions（`scripts/lib/promotions.mts`）

### candidateApproval: decisions と constraints は同意
- 対応: US-11.1
- Given: 宛先が `decisions` の候補 `{ target: "decisions", text: "キャッシュ層の再評価条件を足す" }` と、宛先が `constraints` の候補
- When: `candidateApproval` を呼ぶ
- Then: どちらも `"consent"`

### candidateApproval: overview・conventions・glossary は確認
- 対応: US-11.2
- Given: 宛先が `overview`、`conventions`、`glossary` の候補（それぞれ1件）
- When: `candidateApproval` を呼ぶ
- Then: すべて `"confirm"`

### isStatusOnlyChange: accepted → implemented だけなら true
- 対応: US-11.2
- Given: before が `---\nstatus: accepted\n---\n\n# キャッシュ層を置く\n本文\n`、after が before の `status: accepted` を `status: implemented` に変えただけの文字列
- When: `isStatusOnlyChange(before, after)` を呼ぶ
- Then: `true`

### isStatusOnlyChange: 状態と同時に本文も変えれば false
- 対応: US-11.1
- Given: before は上と同じ。after は `status: implemented` に変え、さらに本文の `本文` を `本文（改訂）` に変えたもの
- When: `isStatusOnlyChange` を呼ぶ
- Then: `false`

### isStatusOnlyChange: superseded への書き換えは false
- 対応: US-11.1
- Given: before は `status: accepted`、after は `status: superseded`（ほかの行は同じ）
- When: `isStatusOnlyChange` を呼ぶ
- Then: `false`

### isStatusOnlyChange: proposed → implemented は false
- 対応: US-11.1
- Given: before は `status: proposed`、after は `status: implemented`（ほかの行は同じ）
- When: `isStatusOnlyChange` を呼ぶ
- Then: `false`（除外は `accepted` から `implemented` だけ）

### isStatusOnlyChange: frontmatter の外の `status: accepted` の行を書き換えても false（解釈）
- 対応: —
- Given: frontmatter に status が無く、本文の箇条書きに `status: accepted` の行がある before と、その行だけを `status: implemented` にした after
- When: `isStatusOnlyChange` を呼ぶ
- Then: `false`

### isStatusOnlyChange: 内容が同一なら false（解釈）
- 対応: —
- Given: before と after が同じ文字列（`status: accepted` のまま）
- When: `isStatusOnlyChange` を呼ぶ
- Then: `false`（状態の書き換えではない。ただし `docChanges` は変更の無いファイルを返さないので通常は呼ばれない）

### cycleAdrNames: サイクルの文書にファイル名が現れる ADR を返す
- 対応: —
- Given: `docs/decisions/20261101-cache-layer.md` と `20261102-queue.md` と `20250301-old-auth.md` がある。サイクルの `design/design-delta.md` に `20261101-cache-layer.md`、`build-02/issue.md` に拡張子なしの `20261102-queue` が書かれている。`20250301-old-auth` はサイクルのどの `.md` にも現れない
- When: `cycleAdrNames("docs/hikyaku/cycles/001-test")` を呼ぶ
- Then: `Set { "20261101-cache-layer.md", "20261102-queue.md" }`（`20250301-old-auth.md` は含まない）

### cycleAdrNames: サイクルの `.md` 以外（progress.jsonl）に現れるだけでは含めない（解釈）
- 対応: —
- Given: `20261103-retry.md` の名前がサイクル直下の `progress.jsonl` にだけ現れる
- When: `cycleAdrNames` を呼ぶ
- Then: `20261103-retry.md` を含まない

### consentChanges: 宛先が decisions・constraints の候補はすべて同意
- 対応: US-11.1
- Given: candidates に `decisions` 宛て1件（「ADR 20261101-cache-layer の状態を implemented に」）、`constraints` 宛て1件、`conventions` 宛て1件。changes は空
- When: `consentChanges` を呼ぶ
- Then: 2件を返し、どちらも `source: "candidate"`、`doc` は `decisions` と `constraints`。`conventions` の候補は含まない

### consentChanges: 確認の候補だけで差分も無ければ空
- 対応: US-11.2
- Given: candidates は `overview` 宛てと `glossary` 宛ての2件、changes は空
- When: `consentChanges` を呼ぶ
- Then: `[]`

### consentChanges: このサイクルの ADR の状態だけの書き換えは除く
- 対応: US-11.2
- Given: candidates は空。changes は `{ path: "docs/decisions/20261101-cache-layer.md", doc: "decisions", status: "M", before: "status: accepted の ADR", after: "status: implemented にしただけ" }`。`20261101-cache-layer.md` は design-delta.md に現れる
- When: `consentChanges` を呼ぶ
- Then: `[]`

### consentChanges: このサイクルの ADR でも本文を変えれば同意
- 対応: US-11.1
- Given: 上と同じ ADR で、after は状態に加えて「再評価条件」の行を変えたもの
- When: `consentChanges` を呼ぶ
- Then: 1件、`source: "diff"`、`doc: "decisions"`、`text` に `20261101-cache-layer.md` を含む

### consentChanges: 新しい ADR（A）は同意
- 対応: US-11.1
- Given: changes は `{ path: "docs/decisions/20261117-new-index.md", doc: "decisions", status: "A", after: "---\nstatus: implemented\n---\n…" }`
- When: `consentChanges` を呼ぶ
- Then: 1件、`source: "diff"`、`doc: "decisions"`

### consentChanges: ADR の削除（D）は同意
- 対応: US-11.1
- Given: changes は `{ path: "docs/decisions/20261101-cache-layer.md", doc: "decisions", status: "D", before: "…" }`
- When: `consentChanges` を呼ぶ
- Then: 1件、`source: "diff"`

### consentChanges: 他サイクルの ADR は状態だけの書き換えでも同意
- 対応: US-11.1
- Given: changes は `20250301-old-auth.md`（サイクルの文書に現れない）の `accepted → implemented` だけの `M`
- When: `consentChanges` を呼ぶ
- Then: 1件、`source: "diff"`（安全側）

### consentChanges: constraints の変更は状態の書き換えの形でも同意
- 対応: US-11.1
- Given: changes は `{ path: "docs/constraints.md", doc: "constraints", status: "M", before, after }`（before と after の差は1行）
- When: `consentChanges` を呼ぶ
- Then: 1件、`doc: "constraints"`

### consentChanges: 候補と差分の両方があれば両方を並べる
- 対応: US-11.3
- Given: candidates に `decisions` 宛て1件、changes に新しい ADR `20261117-new-index.md` の `A` 1件
- When: `consentChanges` を呼ぶ
- Then: 2件、`source` は `"candidate"` と `"diff"` が1件ずつ

### docChanges: close-cycle の進捗を最初に足したコミットの親と比べる
- 対応: US-11.1
- Given: コミット C1 で `docs/decisions/20261101-cache-layer.md`（accepted）を足し（architect の ADR、design-delta.md にも名前を書く）、コミット C2 でサイクル直下の `progress.jsonl` に close-cycle の collect の記録を初めて足す。作業ツリーで同じ ADR を `implemented` に書き換え、`docs/decisions/20261117-new-index.md` を追跡外のまま置く
- When: `docChanges(config, cycleDirectory)` を呼ぶ
- Then: 2件を返す: `20261101-cache-layer.md` は `status: "M"`（C1 の内容が before。新しい ADR として数えない）、`20261117-new-index.md` は `status: "A"`

### docChanges: close-cycle の進捗がまだコミットされていなければ HEAD と比べる
- 対応: —
- Given: HEAD に `20261101-cache-layer.md`（accepted）がある。サイクル直下の `progress.jsonl` は作業ツリーにだけあり未コミット。作業ツリーで ADR に1行足す
- When: `docChanges` を呼ぶ
- Then: 1件、`status: "M"`、before は HEAD の内容

### docChanges: 追跡外の新しいファイルを追加として数える
- 対応: US-11.1
- Given: `docs/decisions/20261117-new-index.md` を作業ツリーに置き、`git add` しない（`.gitignore` にも無い）
- When: `docChanges` を呼ぶ
- Then: そのファイルが `status: "A"` で含まれる

### docChanges: decisions・constraints 以外のパスの変更は返さない
- 対応: US-11.2
- Given: 作業ツリーで `AGENTS.md` と `docs/overview.md` を変え、decisions・constraints は変えない
- When: `docChanges` を呼ぶ
- Then: `[]`

### docChanges: constraints が未作成のときは document-guide.md の差分で拾う
- 対応: US-11.1
- Given: document-guide.md の `constraints` の `path` が `未作成`。作業ツリーで `docs/constraints.md` を新しく作り、document-guide.md の `constraints` の行を `docs/constraints.md` に書き換える
- When: `docChanges` を呼んで `consentChanges` に渡す
- Then: 1件以上の同意が要る変更が返る（document-guide.md の差分による）

### docChanges: 対象外の decisions は見ない
- 対応: —
- Given: document-guide.md の `decisions` の `path` が `対象外`。`constraints` は変更なし
- When: `docChanges` を呼ぶ
- Then: `[]`（git を呼んでもエラーにならない）

### docChanges: サイクルが closed なら差分を見ない
- 対応: —
- Given: `cycles.md` の `001-test` が `status: closed`。作業ツリーに新しい ADR `20261201-later.md`（後続のサイクルの変更）がある
- When: `docChanges` を呼ぶ
- Then: `[]`

### docChanges: git が使えないときは理由の文字列を返す
- 対応: US-11.1
- Given: `.git` を消した（または `PATH` から git を外した）ワークスペース
- When: `docChanges` を呼ぶ
- Then: 戻り値は文字列（理由。空でない）

## promotions --json（`scripts/commands/promotions.mts`）

### promotions --json: 候補ごとに approval を返す
- 対応: US-11.3
- Given: サイクルの build-01/handoff.md の「永続化すること」に `decisions` 宛て1行、`conventions` 宛て1行、`constraints` 宛て1行
- When: `hikyaku promotions 001 --json` を実行する
- Then: 終了コード 0。3件の候補それぞれに `approval` があり、`decisions` と `constraints` は `"consent"`、`conventions` は `"confirm"`

### promotions（テキスト）: 同意の候補に印が付く
- 対応: US-11.3
- Given: 上と同じ記録
- When: `hikyaku promotions 001` をテキストで実行する
- Then: `decisions`・`constraints` の行と `conventions` の行で付く印が異なり、`decisions` の行に同意を表す語（「同意」）が含まれる

## close-cycle のステップ（`scripts/lib/steps/close-cycle.mts`・`step next/report close`）

### G10 の consent: 同意が要る変更があれば standard でも G10 を返し directive の approval が consent
- 対応: US-11.1
- Given: standard。handoff.md に `decisions` 宛ての候補1件
- When: `step report close collect 001 --result done --json`
- Then: 次の directive は `step: "G10"`、`approval` が `"consent"`、`args.consentChanges` に `source: "candidate"` の1件

### G10 の consent: express でも同意が要る変更があれば省かれない
- 対応: US-11.1
- Given: `profile = "express"`。handoff.md に `constraints` 宛ての候補1件
- When: collect を done で報告する
- Then: 次は `G10`（write へ飛ばない）、`approval: "consent"`

### G10 の consent: promotion_gate = false を明示しても同意の回は省かれない
- 対応: US-11.1
- Given: `profile = "standard"` と `promotion_gate = false`。作業ツリーに新しい ADR `docs/decisions/20261117-new-index.md`（追跡外）
- When: collect を done で報告する
- Then: 次は `G10`、`args.consentChanges` に `source: "diff"` の1件

### G10 の enabled: 確認の候補だけなら express で省ける
- 対応: US-11.2
- Given: express。handoff.md に `conventions` 宛てと `overview` 宛ての候補だけ。decisions・constraints の差分なし
- When: collect を done で報告する
- Then: 次の directive は `step: "write"`、`args.promotionGate === "skipped"`

### G10 の enabled: 確認の候補だけでも standard では確認として G10 を返す
- 対応: US-11.2
- Given: standard。確認の候補だけ
- When: collect を done で報告する
- Then: 次は `G10`、`approval` は `"confirm"`、`args.consentChanges` は空配列

### G10 の args: 同意の変更と確認の変更が分かれて渡る
- 対応: US-11.3
- Given: standard。候補は `decisions` 宛て1件と `glossary` 宛て1件
- When: G10 の directive を得る
- Then: `args.consentChanges` は `decisions` の1件だけ（`glossary` は含まない）。`args.returned === false`

### G10 の consent: 状態だけの書き換えなら express で G10 を省いたまま write が通る
- 対応: US-11.2
- Given: express。確認の候補だけ。architect のコミットで `docs/decisions/20261101-cache-layer.md`（accepted、design-delta.md に名前あり）がある。collect の報告後に、作業ツリーでその ADR を `status: implemented` にだけ書き換える
- When: `step report close write 001 --result done --json`
- Then: 受け付けられ、次は `close`（write の次のステップ）。G10 には戻らない

### write の accepts: G10 を省いた回に新しい ADR を書くと受け付けず G10 へ戻る
- 対応: US-11.1
- Given: express。確認の候補だけで G10 を省いて write に入った。作業ツリーに `docs/decisions/20261117-new-index.md` を足す
- When: `step report close write 001 --result done`
- Then: 終了コード 1、stderr に `20261117-new-index.md` と「step next」（G10 へ戻ること）が含まれる。続けて `step next close 001 --json` は `step: "G10"`、`approval: "consent"`、`args.returned === true`

### write の accepts: G10 を省いた回に ADR の本文を変えても受け付けない
- 対応: US-11.1
- Given: express。G10 を省いて write に入った。`20261101-cache-layer.md` の「決定」の行を書き換える（状態は accepted のまま）
- When: write を done で報告する
- Then: 受け付けられず、`step next` は `G10`（`approval: "consent"`）

### write の accepts: 同意の承認がある回は同意が要る差分があっても受け付ける
- 対応: US-11.1
- Given: standard。`decisions` 宛ての候補があり、G10 を同意として `--result approved --input "OK"` で承認した。作業ツリーに新しい ADR を足す
- When: write を done で報告する
- Then: 受け付けられ、次は `close`

### reopens: 確認として承認した回に同意が要る差分が出たら G10 が pending に戻る
- 対応: US-11.1
- Given: standard。確認の候補だけで G10 を承認（記録は `approval: "confirm"`）。その後、作業ツリーで `docs/constraints.md` を変える
- When: `step next close 001 --json`
- Then: `step: "G10"`、`approval: "consent"`、`args.returned === true`。write の done を報告すると受け付けない

### reopens: 確認の承認のあと差分が状態だけの書き換えなら戻らない
- 対応: US-11.2
- Given: standard。G10 を確認として承認した。作業ツリーで `20261101-cache-layer.md`（このサイクルの ADR）を `accepted → implemented` にだけ書き換える
- When: `step next close 001 --json`
- Then: `step: "write"`（G10 に戻らない）

### reopens: approval 欄の無い既存の G10 の承認は同意として扱う
- 対応: —
- Given: サイクル直下の `progress.jsonl` に、このビルドの前の形の G10 の承認 `{"skill":"close-cycle","step":"G10","result":"approved","input":"OK",…}`（`approval` 欄なし）を書く。作業ツリーに新しい ADR を足す
- When: `step next close 001 --json`
- Then: `step: "write"`（G10 に戻らない）。write の done も受け付ける

### step report: gate の approved に approval を記録する
- 対応: US-11.1
- Given: standard。G10 の回は同意（`decisions` 宛ての候補あり）
- When: `step report close G10 001 --result approved --input "OK"`
- Then: サイクル直下の `progress.jsonl` の最後の行に `"approval":"consent"`

### step report: 確認の回の承認は confirm で記録する
- 対応: US-11.2
- Given: standard。確認の候補だけ
- When: G10 を approved で報告する
- Then: 記録の `approval` は `"confirm"`

### step report: rejected には approval を記録しない（解釈）
- 対応: —
- Given: standard。G10 の回は同意
- When: `step report close G10 001 --result rejected --input "constraints は不要"`
- Then: 記録に `approval` 欄が無い

### G10 の consent: git が使えなければ同意に倒す
- 対応: US-11.1
- Given: express。確認の候補だけ。`docChanges` が理由の文字列を返す状態（git を外した環境）
- When: collect を done で報告する
- Then: 次は `G10`、`approval: "consent"`、directive の理由に git が使えないことが含まれる

### G10: サイクルが closed になった後は後続の ADR で戻らない
- 対応: —
- Given: standard。G10 を確認として承認し、write・close まで済ませ `cycles.md` を `status: closed` にした。その後、作業ツリーに `docs/decisions/20261201-later.md` を足す（後続のサイクルの変更）
- When: `step next close 001 --json`
- Then: G10 に戻らず、close 以降の現在地（`pr` など）を返す

### step where / Stop フック: 位置だけを読む経路でも同じ現在地を返す
- 対応: —
- Given: express。確認の候補だけで G10 を省いて write に入り、作業ツリーに新しい ADR を足す
- When: `step where close 001 --json` と `step next close 001 --json`
- Then: どちらも `G10`

### write の args: G10 を承認した回は promotionGate が approved
- 対応: —
- Given: standard。G10 を approved で報告した
- When: write の directive を得る
- Then: `args.promotionGate === "approved"`

### followups の args: ruleRemovals と metricsComparison を渡す
- 対応: US-9.2
- Given: `.claude/rules/legacy.md`（paths が `src/legacy/**`、一致するファイルなし、`importance: 中`）がある。publish まで進めた
- When: `step report close publish 001 --result done --json`
- Then: `step: "followups"`、`args.ruleRemovals` に `location: ".claude/rules/legacy.md"`・`kind: "stale"` の1件、`args.metricsComparison` は配列（消した点が無ければ空）、`args.g10Input` は G10 の `--input` の値

### followups の recordsPr: --pr 無しでも done を受け付ける
- 対応: US-9.3
- Given: followups まで進めた
- When: `step report close followups 001 --result done`
- Then: 終了コード 0、記録に `pr` 欄が無い

### followups の recordsPr: --pr を添えれば記録する
- 対応: US-9.3
- Given: followups まで進めた
- When: `step report close followups 001 --result done --pr 123`
- Then: 終了コード 0、サイクル直下の `progress.jsonl` の followups の done に `"pr":123`

### recordsPr optional: 不正な --pr は受け付けない（解釈）
- 対応: —
- Given: followups まで進めた
- When: `step report close followups 001 --result done --pr abc`
- Then: 終了コード 1、記録は増えない

### hooks: G10 を省いた回はフックを採らない
- 対応: —
- Given: express。確認の候補だけ。フックの候補が handoff に記録されている
- When: collect を done で報告し、write まで進める
- Then: hooks のステップは `skipped` 扱いで、followups の `args.hooks === false`

## エンジン（`scripts/lib/steps/engine.mts`）

### reopens: 承認の記録があっても理由を返せば pending
- 対応: —
- Given: テスト用の手順定義で gate `X` に `reopens: (ctx, event) => event.approval === "confirm" ? "差分が出た" : undefined` を持たせ、`X` の approved（`approval: "confirm"`）の記録がある
- When: エンジンで現在地を評価する
- Then: 現在地は `X`、理由に「差分が出た」

### reopens: 理由を返さなければ承認済みのまま進む
- 対応: —
- Given: 上と同じで、記録の `approval` が `"consent"`
- When: 評価する
- Then: 現在地は `X` の次のステップ

### recordsPr: true のステップは従来どおり --pr が必須
- 対応: —
- Given: close-cycle の `publish`（`recordsPr: true`）まで進めた
- When: `--pr` 無しで done を報告する
- Then: 終了コード 1（既存の挙動が変わらない）

## conductor（`scripts/lib/conductor.mts`）

### ASKS: G10 は confirm で enabledWhen が gates.promotion
- 対応: US-11.2
- Given: `ASKS` を読む
- When: ID `G10` の項目を取り出す
- Then: `category === "confirm"`、`enabledWhen` が `gates.promotion`

### CONSENT_WHEN: G10 を含む
- 対応: US-11.1
- Given: `CONSENT_WHEN` を読む
- When: `G10` を引く
- Then: 存在する（回によって同意になるゲートとして扱われる）

### childStep: 同意の回の G10 は delegate に書いてもユーザーに固定
- 対応: US-11.1
- Given: conductor の設定で `delegate` に `G10` を書く。子の close-cycle の G10 の directive の `approval` が `"consent"`
- When: `resolveAsk` を呼ぶ
- Then: handler は `"user"`

### childStep: 確認の回の G10 は delegate に従う
- 対応: US-11.2
- Given: 上と同じ `delegate`。子の G10 の `approval` が `"confirm"`
- When: `resolveAsk` を呼ぶ
- Then: handler は `"supervisor"`

### conductor lint: ASKS とタグが一致する
- 対応: —
- Given: このビルドの変更後のリポジトリ
- When: `node scripts/hikyaku.mts conductor lint`
- Then: 終了コード 0

## 消す候補（`scripts/lib/rules.mts`）

### removalCandidates: 一致しない rule は stale
- 対応: US-9.2
- Given: measures に `.claude/rules/legacy.md`（一致なし、`prevents`・`basis` あり、`importance: 中`）
- When: `removalCandidates` を呼ぶ
- Then: 1件、`kind: "stale"`、`location: ".claude/rules/legacy.md"`

### removalCandidates: prevents が欠けた rule は unreasoned
- 対応: US-9.2
- Given: `.claude/rules/api.md`（`basis: いまのコードの形`、`prevents` なし、`importance: 中`、一致あり）
- When: `removalCandidates` を呼ぶ
- Then: 1件、`kind: "unreasoned"`

### removalCandidates: basis が欠けた rule も unreasoned
- 対応: US-9.2
- Given: `.claude/rules/db.md`（`prevents` あり、`basis` なし、`importance: 中`）
- When: `removalCandidates` を呼ぶ
- Then: 1件、`kind: "unreasoned"`

### removalCandidates: 役に立たなかった rule は unhelpful
- 対応: US-9.2
- Given: unhelpful に `rule:.claude/rules/api.md`（理由「この回の変更に関係しなかった」）。rule は理由も一致もそろっている
- When: `removalCandidates` を呼ぶ
- Then: 1件、`kind: "unhelpful"`、`sources` にその記録の所在（retrospective.md のパス）を含む

### removalCandidates: 役に立たなかった文書の行は引用を含む行を探す
- 対応: US-9.2
- Given: `AGENTS.md` に `- 例外は日本語で書く（防ぐ: 英語の混在 / 立つ: いまのコードの形 / 重要度: 中）` の行。unhelpful に `AGENTS.md` の引用「例外は日本語で書く」
- When: `removalCandidates` を呼ぶ
- Then: 1件、`kind: "unhelpful"`、`location` は `AGENTS.md`、`quote` に引用、`reasons` に `防ぐ: 英語の混在`・`重要度: 中`

### removalCandidates: 重要度が高の rule は返さない
- 対応: US-9.5
- Given: `.claude/rules/secrets.md`（`importance: 高`、一致なし、`prevents` なし）。unhelpful にも `rule:.claude/rules/secrets.md`
- When: `removalCandidates` を呼ぶ
- Then: `[]`

### removalCandidates: 重要度が高の文書の行は返さない
- 対応: US-9.5
- Given: `AGENTS.md` に `- 本番の鍵をログに出さない（防ぐ: 情報の漏えい / 立つ: 外の前提 / 重要度: 高）`。unhelpful にその引用
- When: `removalCandidates` を呼ぶ
- Then: `[]`

### removalCandidates: 同じ rule が複数の理由に当たれば1件に束ねる
- 対応: US-9.2
- Given: `.claude/rules/legacy.md` が一致なし・`prevents` なし・unhelpful に挙がる（`importance: 中`）
- When: `removalCandidates` を呼ぶ
- Then: `location: ".claude/rules/legacy.md"` は1件だけ（`sources` に unhelpful の記録の所在を含む）

### removalCandidates: 理由の欠けた文書の行は役に立たなかった記述に挙がらなければ候補にしない（解釈）
- 対応: —
- Given: `AGENTS.md` に理由の欄の無い行 `- 関数は短く書く`。unhelpful は空
- When: `removalCandidates` を呼ぶ
- Then: `[]`

### removalCandidates: 引用が文書に見つからなければ候補にしない（解釈）
- 対応: —
- Given: unhelpful に `AGENTS.md` の引用「存在しない記述」
- When: `removalCandidates` を呼ぶ
- Then: `[]`（エラーにしない）

### removalCandidates: 最終変更からの日数を添える
- 対応: —
- Given: `.claude/rules/legacy.md` の最終変更が 200 日前（テスト用の `lastTouched`）
- When: `removalCandidates` を呼ぶ
- Then: `lastTouchedDays === 200`

### rules candidates: 消す候補の節と JSON の removals
- 対応: US-9.2
- Given: 一時リポジトリに `.claude/rules/legacy.md`（paths `src/legacy/**`、一致なし、`importance: 中`）と `.claude/rules/secrets.md`（一致なし、`importance: 高`）。サイクル 001-test の build-01/retrospective.md の「役に立たなかった記述」に `rule:.claude/rules/api.md`（`importance: 中`、理由あり）
- When: `hikyaku rules candidates 001 --json`
- Then: 終了コード 0。`removals` は `legacy.md`（stale）と `api.md`（unhelpful）の2件で、`secrets.md` を含まない。テキスト出力には「消す候補」の節がある

### rules candidates: サイクルを省けば役に立たなかった記述を材料にしない
- 対応: —
- Given: 上と同じリポジトリ
- When: `hikyaku rules candidates --json`
- Then: `removals` は `legacy.md` の1件だけ

## 指標の比較（`scripts/lib/quality-metrics.mts`）

### CycleMetrics: 4つの指標を集める
- 対応: US-9.4
- Given: サイクル `002-a` の `design/progress.jsonl` に architect の `restart`（`round: "return"`）が2行、`decisions.jsonl` に `rejected` の決定が1件、handoff の「永続化すること」に `[高]` の落とし穴が1行と `[中]` が1行、「レビューの記録」に `[重]` 3行・`[軽]` 2行
- When: 指標を集める
- Then: `{ cycle: "002-a", returns: 2, rejected: 1, highPitfalls: 1, heavyFindings: 3 }`

### CycleMetrics: restart でも round が return でなければ数えない
- 対応: —
- Given: `design/progress.jsonl` に `restart` の行が `round: "return"` 1行と `round: "options"` 1行
- When: 指標を集める
- Then: `returns: 1`

### removalPoints: followups の done の pr を拾う
- 対応: US-9.4
- Given: closed のサイクル `002-a` の直下の `progress.jsonl` に close-cycle の followups の done `"pr":12`。active のサイクル `003-b` にも followups の done `"pr":99`
- When: `removalPoints(config, cycles)`
- Then: `002-a` / `12` の点だけを返す（active のサイクルは数えない）

### removalPoints: #12 と #123 を取り違えない
- 対応: US-9.4
- Given: ベースブランチ `main` の first-parent に、件名 `rules を消す (#123)` のコミット（2026-09-01）と、件名 `基準を試しに消す (#12)` のコミット（2026-09-10）がある。点は `pr: 12`
- When: `removalPoints`
- Then: マージの時点は 2026-09-10 のコミット。`#123` のコミットは当たらない

### removalPoints: 件名の #12 の後ろに数字が続けば当たらない（境界）
- 対応: —
- Given: first-parent の件名は `Merge pull request #120 from x/y` だけ。点は `pr: 12`
- When: `removalPoints`
- Then: その点は「未マージ」

### removalPoints: マージコミットと第1親の差分から消えた rule を並べる
- 対応: US-9.4
- Given: `main` で `.claude/rules/legacy.md` を持つ状態から、ブランチ `x-close-criteria` でそれを消し、`git merge --no-ff` で件名 `Merge pull request #12 from x/x-close-criteria` のマージコミットを作る
- When: `removalPoints`
- Then: 点の消した基準に `.claude/rules/legacy.md`

### removalPoints: スカッシュのコミットでも消えた文書の行を並べる
- 対応: US-9.4
- Given: `main` に件名 `基準を試しに消す (#12)` の通常コミットで、`AGENTS.md`（document-guide.md に登録）から `- 例外は日本語で書く（防ぐ: 英語の混在 / 立つ: いまのコードの形 / 重要度: 中）` の行を消す
- When: `removalPoints`
- Then: 消した基準に `AGENTS.md` のその行（箇条書きの行）

### removalPoints: 登録されていない文書の行や箇条書きでない行は並べない（解釈）
- 対応: —
- Given: `#12` のコミットで、document-guide.md に無い `notes/todo.md` の箇条書きと、`AGENTS.md` の段落の行（`- ` で始まらない）を消す
- When: `removalPoints`
- Then: 消した基準は空

### removalPoints: first-parent でないコミットは当たらない
- 対応: —
- Given: `#12` の件名のコミットがマージされたブランチ側（第2親の系列）にだけあり、`main` の first-parent の件名には `#12` が無い
- When: `removalPoints`
- Then: 「未マージ」

### removalPoints: PR がベースブランチに無ければ未マージ
- 対応: US-9.4
- Given: 点は `pr: 45`、`main` の log に `#45` を含む件名が無い
- When: `removalPoints`
- Then: その点は「未マージ」

### compareMetrics: 前後が window 件ずつそろえば合計と悪くなった指標を返す
- 対応: US-9.4
- Given: window = 2。マージの日 2026-09-10。closed のサイクル `001-p`（finished 2026-08-01、heavyFindings 1）・`002-q`（finished 2026-09-05、heavyFindings 2、returns 1）を前、`004-s`（started 2026-09-12、heavyFindings 3）・`005-t`（started 2026-10-01、heavyFindings 2、returns 0）を後
- When: `compareMetrics(point, cycles, 2)`
- Then: `comparable: true`、前の合計 heavyFindings 3・returns 1、後の合計 heavyFindings 5・returns 0。悪くなった指標は `heavyFindings` だけ

### compareMetrics: 前は直近 window 件を取る
- 対応: —
- Given: window = 2。マージの日より前に完了したサイクルが3件（finished 2026-07-01、2026-08-01、2026-09-05）
- When: `compareMetrics`
- Then: 前は 2026-08-01 と 2026-09-05 の2件（2026-07-01 は含まない）

### compareMetrics: 後は先頭 window 件を取る
- 対応: —
- Given: window = 2。マージの日以後に開始したサイクルが3件（started 2026-09-12、2026-10-01、2026-11-01）
- When: `compareMetrics`
- Then: 後は 2026-09-12 と 2026-10-01 の2件

### compareMetrics: マージの日に完了したサイクルはどちらにも入らない（境界）
- 対応: —
- Given: マージの日 2026-09-10。`002-q` は started 2026-09-01・finished 2026-09-10
- When: `compareMetrics`
- Then: `002-q` は前にも後にも入らない

### compareMetrics: マージの日に開始したサイクルは後に入る（境界）
- 対応: —
- Given: マージの日 2026-09-10。`004-s` は started 2026-09-10
- When: `compareMetrics`
- Then: `004-s` は後に入る

### compareMetrics: 後に、いま締めている active のサイクルを含める
- 対応: US-9.4
- Given: window = 2。後は closed の `004-s`（started 2026-09-12）と、いま close-cycle を回している active の `005-t`（started 2026-10-01）
- When: `compareMetrics`
- Then: `comparable: true`、後は2件

### compareMetrics: 後が window に満たなければ比較できない
- 対応: US-9.4
- Given: window = 2。前は2件、後は1件
- When: `compareMetrics`
- Then: `{ comparable: false, reason }`、reason に「比較できない」理由（後のサイクルが足りない）

### compareMetrics: 前が window に満たなければ比較できない
- 対応: US-9.4
- Given: window = 2。前は1件、後は2件
- When: `compareMetrics`
- Then: `comparable: false`

### compareMetrics: decisions.jsonl が読めなければ比較できない
- 対応: —
- Given: 前後とも2件そろうが、`004-s` の `decisions.jsonl` が JSON として壊れている
- When: `compareMetrics`
- Then: `comparable: false`、reason に `004-s` の `decisions.jsonl`

### compareMetrics: 同じ値なら悪くなった指標に入れない（境界）
- 対応: —
- Given: 前後の rejected の合計がどちらも 2
- When: `compareMetrics`
- Then: 悪くなった指標に `rejected` を含まない

### compareMetrics: 未マージの点は比較できない
- 対応: —
- Given: `removalPoints` が「未マージ」とした点
- When: `compareMetrics`
- Then: `comparable: false`、reason にマージされていないこと

### metricsComparison: followups の args に一時リポジトリの比較が載る
- 対応: US-9.4
- Given: 一時リポジトリ。`cycles.md` に closed の `001-p`（finished 2026-08-01）・`002-q`（finished 2026-09-05、followups の done に `"pr":12`）、closed の `003-r`（started 2026-09-12）、active の `004-s`（started 2026-10-01、いま close-cycle）。`main` の first-parent に件名 `Merge pull request #12 from x/q-close-criteria` のマージコミット（コミット日時 2026-09-10、`.claude/rules/legacy.md` を消す）。各サイクルに restart・decisions.jsonl・handoff を置く
- When: `004-s` で followups まで進め、directive を得る
- Then: `args.metricsComparison` に1件、`cycle: "002-q"`・`pr: 12`・`comparable: true`・消した基準に `.claude/rules/legacy.md`、前後の合計がそろう

### metricsComparison: 後が足りなければ followups の args に比較できないと出る
- 対応: US-9.4
- Given: 上と同じだが `003-r` が無い（後は `004-s` の1件だけ）
- When: followups の directive を得る
- Then: `args.metricsComparison[0].comparable === false`、reason が空でない。followups の done は受け付ける（止めない）

### metricsComparison: 位置だけを読む経路では呼ばない
- 対応: —
- Given: followups の手前まで進めたサイクル
- When: `step where close 001 --json`
- Then: 現在地は返るが、`metricsComparison` の計算（git log）は行われない（`positionOnly`。args に `metricsComparison` を含まない）
