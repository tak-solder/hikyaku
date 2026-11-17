# Build 12: G4 と G8 の提示（gate brief） テストシナリオ

## traceability.mts

### testSpecScenarios: ### 見出しごとに見出し・本文・対応の番号を読む
- 対応: US-12.3
- Given: test-spec.md に「### boundaryChanges: 外との境界に当たる」（本文に `- 対応: US-12.1`）と「### g8Brief: 番号なし」（本文に `- 対応: US-12.2, US-12.4`）の2つのシナリオがある
- When: testSpecScenarios(本文) を呼ぶ
- Then: 2件が出現順に返り、1件目の heading は "boundaryChanges: 外との境界に当たる"・criteria は ["US-12.1"]、2件目の criteria は ["US-12.2", "US-12.4"] で、body はそれぞれ次の ### 見出しの手前までの行になる

### testSpecScenarios: 見出しの末尾の「（解釈）」で interpreted が立つ
- 対応: US-12.2
- Given: 「### render: 迷う形は外に倒す（解釈）」と「### render: 要約を出す」の2つのシナリオがある
- When: testSpecScenarios(本文) を呼ぶ
- Then: 1件目の interpreted は true、2件目は false になる。INTERPRETED_MARK は "（解釈）" である

### testSpecScenarios: 印の無い既存の test-spec.md は解釈 0 件として読める
- 対応: —
- Given: 印も `- 解釈:` の行も無い、3つのシナリオを持つ従来形式の test-spec.md
- When: testSpecScenarios(本文) を呼ぶ
- Then: 3件が返り、interpreted はすべて false で、例外を投げない

### testSpecScenarios: コードブロックの中の見出しと番号は読まない
- 対応: —
- Given: シナリオ「### a: 実在する」（`- 対応: US-12.1`）の本文中に、``` で囲んだ「### {メソッド名}: {シナリオ名}（解釈）」と「- 対応: US-1.1」の例示がある
- When: testSpecScenarios(本文) を呼ぶ
- Then: シナリオは1件だけで、criteria は ["US-12.1"]、interpreted は false になる（例示の US-1.1 と印を拾わない）

### testSpecScenarios: 「- 対応: —」のシナリオは番号を持たない
- 対応: —
- Given: 「- 対応: —」と書いた補助的なシナリオ
- When: testSpecScenarios(本文) を呼ぶ
- Then: そのシナリオの criteria は [] になる

## risk.mts

### effectiveBoundaries: 作業ツリーと基準の [boundaries] の和を返す
- 対応: US-12.1
- Given: 基準（origin/main の merge-base）の `.hikyaku.config` に `[boundaries] external = ["api/public/**"]`、作業ツリーに `external = ["api/webhook/**"]`・`internal = ["src/core/**"]` がある
- When: effectiveBoundaries(config) を呼ぶ
- Then: external は "api/public/**" と "api/webhook/**" の両方、internal は ["src/core/**"] を含む（重複は1つにまとまる）

### effectiveBoundaries: 作業ツリーで境界を消しても基準の境界は残る
- 対応: US-12.1
- Given: 基準に `[boundaries] external = ["api/public/**"]` があり、作業ツリーの `.hikyaku.config` からは `[boundaries]` の節を削除してある
- When: effectiveBoundaries(config) を呼ぶ
- Then: external は ["api/public/**"] を含む

### effectiveBoundaries: 基準を読めなければ作業ツリーの境界だけを返す
- 対応: —
- Given: origin が無いリポジトリで、作業ツリーにだけ `[boundaries] external = ["api/public/**"]` がある
- When: effectiveBoundaries(config) を呼ぶ
- Then: external は ["api/public/**"]、internal は [] になり、例外を投げない

## gate-brief.mts

### boundaryChanges: 外との境界と内部の境界の変更を分けて返す
- 対応: US-12.1
- Given: `[boundaries] external = ["api/public/**"]`・`internal = ["src/core/**"]` を宣言し、design-delta.md が `api/public/users.ts` と `src/core/queue.ts` と `src/ui/button.tsx` に触れている
- When: boundaryChanges(config, designDirectory) を呼ぶ
- Then: declared は true、external は [{ boundary: "api/public/**", touched: ["api/public/users.ts"] }]、internal は [{ boundary: "src/core/**", touched: ["src/core/queue.ts"] }] で、`src/ui/button.tsx` はどちらにも現れない

### boundaryChanges: このサイクルの ADR が触れたパスも照合し、documents に並べる
- 対応: US-12.1
- Given: `[boundaries] external = ["api/public/**"]` を宣言し、design-delta.md は境界に触れず、このサイクルの ADR `docs/decisions/20261117-public-api.md` が `api/public/orders.ts` に触れている
- When: boundaryChanges(config, designDirectory) を呼ぶ
- Then: external は [{ boundary: "api/public/**", touched: ["api/public/orders.ts"] }] で、documents は design-delta.md と ADR のリポジトリからの相対パスの2件になる

### boundaryChanges: どちらとも決められない glob は外との境界に当たる側に倒す（解釈）
- 対応: US-12.1
- 解釈: design-delta が境界より広い glob（`api/**`）を書いたとき、外との境界の変更に含まれるかは基準から一意に決まらない。overlaps の「迷う形は当たるに倒す」に従い、外との境界の変更（同意側）に数えると解釈した
- Given: `[boundaries] external = ["api/public/**"]` を宣言し、design-delta.md が `api/**` にだけ触れている
- When: boundaryChanges(config, designDirectory) を呼ぶ
- Then: external は [{ boundary: "api/public/**", touched: ["api/**"] }] になる

### boundaryChanges: [boundaries] の宣言が無ければ declared: false で空
- 対応: US-12.5
- Given: 作業ツリーにも基準にも `[boundaries]` が無く、design-delta.md が `api/public/users.ts` に触れている
- When: boundaryChanges(config, designDirectory) を呼ぶ
- Then: declared は false、external・internal は []、unverified は false で、notices は空になる

### boundaryChanges: 作業ツリーだけが宣言していて基準を読めなければ unverified
- 対応: US-12.1
- Given: origin が無いリポジトリで、作業ツリーにだけ `[boundaries] internal = ["src/core/**"]` があり、design-delta.md は `src/ui/button.tsx` にだけ触れている
- When: boundaryChanges(config, designDirectory) を呼ぶ
- Then: declared は true、external は []、unverified は true になる

### boundaryChanges: ADR の一覧を読めなければ Error を返す
- 対応: —
- Given: `[boundaries] external = ["api/public/**"]` を宣言し、ADR の所在を引く document-guide.md を「壊れたガイド」の1行に書き換えてある
- When: boundaryChanges(config, designDirectory) を呼ぶ
- Then: Error のインスタンスが返り、例外は投げない

### g8Brief: 「（解釈）」のシナリオだけを見出しと本文で返す
- 対応: US-12.2
- Given: build-03 の test-spec.md に4つのシナリオがあり、「### parse: 空行を区切りとみなす（解釈）」の1つだけに印と `- 解釈: 空行の扱いは基準に無いので区切りとした` の行がある
- When: g8Brief(cycleDirectory, buildDirectory) を呼ぶ
- Then: testSpec は true、interpreted は1件で、heading は "parse: 空行を区切りとみなす（解釈）"、body は `- 解釈:` の行を含む

### g8Brief: どのシナリオの対応にも無い受け入れ基準を返す
- 対応: US-12.2
- Given: user-stories.md に US-3.1〜US-3.3 が定義され、issue.md の「対応する受け入れ基準」が US-3.1, US-3.2, US-3.3、test-spec.md の対応に US-3.1 と US-3.3 だけが現れる
- When: g8Brief(cycleDirectory, buildDirectory) を呼ぶ
- Then: uncovered は ["US-3.2"]、criteriaSection は undefined になる

### g8Brief: 全部対応していて解釈も無ければ、示すものは空
- 対応: US-12.2
- Given: issue.md の US-3.1, US-3.2 がどちらも test-spec.md のシナリオの対応に現れ、印の付いたシナリオが無い
- When: g8Brief(cycleDirectory, buildDirectory) を呼ぶ
- Then: interpreted は []、uncovered は [] になる

### g8Brief: user-stories.md に番号付きの基準が無ければ、受け入れ基準の節をそのまま返す
- 対応: US-12.2
- Given: user-stories.md の基準が `- [ ] ログインできる` のように番号なしで書かれ、issue.md に「## 受け入れ基準」の節（`- [ ] ログインできる`）がある
- When: g8Brief(cycleDirectory, buildDirectory) を呼ぶ
- Then: uncovered は undefined、criteriaSection は "- [ ] ログインできる" を含む issue.md の「受け入れ基準」の節になる（空にしない）

### g8Brief: issue.md に「対応する受け入れ基準」の節が無ければ追跡できない扱いにする
- 対応: —
- Given: user-stories.md に US-3.1 が定義されているが、issue.md に「対応する受け入れ基準」の節が無い
- When: g8Brief(cycleDirectory, buildDirectory) を呼ぶ
- Then: uncovered は undefined、criteriaSection は issue.md の「受け入れ基準」の節になる

### g8Brief: test-spec.md が無ければ未対応として並べず、plan.md の提示に回す（解釈）
- 対応: US-12.2
- 解釈: test-spec をスキップしたビルドで、issue.md の基準をすべて「未対応」として出すかは基準から決まらない。シナリオが無いことを未対応と取り違えないよう、uncovered は計算せず（undefined）、受け入れ基準の節を criteriaSection に残すと解釈した
- Given: build-05 の作業単位に plan.md はあるが test-spec.md が無く、issue.md の対応する受け入れ基準は US-3.1
- When: g8Brief(cycleDirectory, buildDirectory) を呼ぶ
- Then: testSpec は false、interpreted は []、uncovered は undefined、criteriaSection は issue.md の「受け入れ基準」の節になる

### renderG4Brief: 要約は外と内の境界を分けて示し、全文を含めない
- 対応: US-12.3
- Given: external に "api/public/**"（touched: "api/public/users.ts"）、internal に "src/core/**"（touched: "src/core/queue.ts"）を持つ G4Brief
- When: renderG4Brief(brief, undefined) を呼ぶ
- Then: 外との境界の変更（同意が要る）の見出しの下に api/public/users.ts、内部の境界の変更（確かめる）の見出しの下に src/core/queue.ts が出て、design-delta.md の本文は含まれない

### renderG4Brief: 宣言が無ければ従来どおりの提示で、境界の節を出さない
- 対応: US-12.5
- Given: boundaries.declared が false、undeclaredAreas が []、verified が true の G4Brief
- When: renderG4Brief(brief, undefined) を呼ぶ
- Then: 境界の変更の節は出ず、design-delta と指摘への対処を示す従来の提示である旨だけが出る

### renderG4Brief: 境界の変更と、重い領域の裏取りを並べて示す
- 対応: US-12.1
- Given: external に "api/public/**" の当たりがあり、undeclaredAreas に { name: "billing", touched: ["src/billing/invoice.ts"] } がある G4Brief
- When: renderG4Brief(brief, undefined) を呼ぶ
- Then: 外との境界の変更の節と、G3 の申告に無い重い領域 billing（src/billing/invoice.ts）の節が両方出る

### renderG4Brief: --full では design-delta.md の全文を添える
- 対応: US-12.4
- Given: 任意の G4Brief と、design-delta.md の本文 "# 設計差分\n\n- `api/public/users.ts` を変える\n"
- When: renderG4Brief(brief, 本文) を呼ぶ
- Then: 出力に要約と、design-delta.md の本文がそのまま含まれる

## steps/architect.mts（G4）

### G4 consent: 外との境界に触れる設計は express でも同意（now）
- 対応: US-12.1
- Given: express のサイクルで、基準と作業ツリーに `[app]` と `[boundaries] external = ["api/public/**"]` があり、options の申告は `--harm 中 --paths src/api/**`、design-delta.md が `api/public/users.ts` に触れる
- When: step next で G4 まで進める
- Then: step は "G4"、approval は "consent"、approvalReason は「外との境界（api/public/**）」を含み、args.boundaries.external は [{ boundary: "api/public/**", touched: ["api/public/users.ts"] }] になる

### G4 consent: 事後同意が有効でも外との境界は deferred に回さない
- 対応: US-12.1
- Given: サイクル設定に `[consent] deferred = true` を置き、ほかは前のシナリオと同じく design-delta.md が `api/public/users.ts` に触れる
- When: step next で G4 まで進める
- Then: approval は "consent" で、timing は now（deferred ではない）になり、G4 で止まる

### G4 consent: [app] が無く [boundaries] だけのワークスペースでも同意になり、args・notices が揃う
- 対応: US-12.1
- Given: `.hikyaku.config` に `[app]` が無く `[boundaries] external = ["api/public/**"]` だけがあり、design-delta.md が `api/public/users.ts` に触れる
- When: step next で G4 まで進める
- Then: approval は "consent"、args.boundaries は { declared: true, external: [当たり1件], internal: [] }、args.undeclaredAreas は [] になる

### G4 consent: 内部の境界にだけ触れるなら確認のまま
- 対応: US-12.1
- Given: standard のサイクルで `[boundaries] internal = ["src/core/**"]` を宣言し、design-delta.md が `src/core/queue.ts` にだけ触れる
- When: step next で G4 まで進める
- Then: approval は "confirm"、args.boundaries.internal は [{ boundary: "src/core/**", touched: ["src/core/queue.ts"] }] で、express では G4 を通り過ぎて build-split に進む

### G4 consent: 作業ツリーだけの宣言で基準を読めなければ同意に倒す
- 対応: US-12.1
- Given: origin が無いリポジトリで、作業ツリーにだけ `[boundaries] internal = ["src/core/**"]` があり、design-delta.md が `src/ui/button.tsx` にだけ触れる
- When: express で step next により G4 まで進める
- Then: approval は "consent" になる

### G4 consent: 差し戻しの回は外との境界に関わらず差し戻しの理由で同意
- 対応: —
- Given: return.md による差し戻しからの再設計の回で、design-delta.md が `api/public/users.ts` に触れる
- When: step next で G4 まで進める
- Then: approval は "consent"、approvalReason は差し戻しの回の理由（従来の ON_RETURN）になる

### G4 consent: 外との境界と重い領域の裏取りが両方あれば、args に両方が並ぶ
- 対応: US-12.1
- Given: `[[app.areas]]` に billing（`src/billing/**`）と `[boundaries] external = ["api/public/**"]` を宣言し、options の申告は `--paths src/api/**`、design-delta.md が `api/public/users.ts` と `src/billing/invoice.ts` に触れる
- When: step next で G4 まで進める
- Then: approval は "consent"、args.boundaries.external に api/public/users.ts の当たり、args.undeclaredAreas に { name: "billing", touched: ["src/billing/invoice.ts"] } が入る

### G4 args: 宣言が無ければ判定・提示とも従来どおり
- 対応: US-12.5
- Given: standard のサイクルで `[app]`・`[boundaries]` とも無く、design-delta.md が `api/public/users.ts` に触れる
- When: step next で G4 まで進める
- Then: approval は "confirm"、args.boundaries.declared は false で external・internal は []、notices は [] になる

### G4 notices: 境界の照合で ADR を読めなければ同意に倒し、notices に出す
- 対応: —
- Given: `[boundaries] external = ["api/public/**"]` を宣言し、G4 の手前で document-guide.md を「壊れたガイド」に書き換える
- When: step next で G4 を評価する
- Then: approval は "consent" で、notices に ADR を読めないため境界を照合できなかった旨が含まれる

## commands/gate.mts（CLI）

### gate brief G4 --json: BoundaryChanges をそのまま出し、終了コードは 0
- 対応: US-12.3
- Given: サイクル 001 で `[boundaries] external = ["api/public/**"]` を宣言し、design/design-delta.md が `api/public/users.ts` に触れる
- When: `hikyaku gate brief G4 architect 001 --json` を実行する
- Then: 終了コード 0 で、JSON の boundaries.external[0] は { boundary: "api/public/**", touched: ["api/public/users.ts"] } になる

### gate brief G8: 要約は解釈と未対応だけで、--full で plan.md と test-spec.md の全文が出る
- 対応: US-12.4
- Given: サイクル 001 の build-03 に「（解釈）」のシナリオ1件と、未対応の受け入れ基準 US-3.2 がある
- When: `hikyaku gate brief G8 build-03 001` と `hikyaku gate brief G8 build-03 001 --full` を実行する
- Then: 前者は解釈のシナリオの見出しと US-3.2 だけを出し、印の無いシナリオの見出しを含まない。後者は plan.md と test-spec.md の本文をそのまま含む

### gate brief: phase と G の組み合わせが違えばエラー
- 対応: —
- Given: サイクル 001 がある
- When: `hikyaku gate brief G4 build-03 001` と `hikyaku gate brief G8 architect 001` を実行する
- Then: どちらも 0 以外の終了コードで、G4 は architect、G8 は build-NN だけを受け付ける旨のエラーが出る

### gate brief G4: design-delta.md が未作成でも止めずにその旨を出す
- 対応: —
- Given: サイクル 001 の design/ に design-delta.md がまだ無い
- When: `hikyaku gate brief G4 architect 001` を実行する
- Then: 終了コード 0 で、design-delta.md が無い旨が出力に含まれる
