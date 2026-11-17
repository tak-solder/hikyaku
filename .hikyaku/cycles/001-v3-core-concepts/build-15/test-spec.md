# Build 15: G3・G4 を宣言の上限で同意にする（害とパスの申告と裏取り） テストシナリオ

共通の前提（結合テスト）: 一時 Git リポジトリに `.hikyaku.config`（ルート設定）とワークスペース・サイクル 001（profile `express`。G3・G4 が確認なら省かれる）を置いて main にコミットし、bare の origin を作って main を push、`git remote set-head origin main` で origin/HEAD を origin/main に向ける。そのうえで architect のブランチを切り、`step report` で options の done まで進める。以下で「宣言」と書くときは、この origin/main に push 済みのルート設定の `[app]` を指す（作業ツリーにだけ書いた宣言は、基準を読めず incomplete になるため）。

## scripts/commands/step.mts（buildEvent: `--harm` / `--paths` の受け付け）

### step report: options の done で申告を記録する
- 対応: US-10.3
- Given: 宣言 `exposure = "internal"`, `data = "none"`, `impact = "low"` がある一時リポジトリで、architect が options の手前まで進んでいる
- When: `step report architect options 001 --result done --harm 中 --paths "src/api/**,docs/{a,b}.md"` を実行する
- Then: 成功し、design/progress.jsonl の最後の options の記録に `"harm":"中"` と `"paths":["src/api/**","docs/{a,b}.md"]` が入る（波括弧の中のカンマでは区切らない）

### step report: 申告が欠けていても options の done は受け付ける
- 対応: US-10.3
- Given: 上と同じリポジトリで、architect が options の手前まで進んでいる
- When: `step report architect options 001 --result done` を `--harm` も `--paths` も付けずに実行する
- Then: 成功し、記録に `harm`・`paths` の欄が無く、次の directive は G3 になる

### step report: `--harm` に高・中以外の値を渡すとエラー
- 対応: —
- Given: architect が options の手前まで進んでいる
- When: `step report architect options 001 --result done --harm 低 --paths "src/**"` を実行する
- Then: 終了コードが非 0 で、`--harm` は `高|中` だけを受け付ける旨のエラーが出て、progress.jsonl に記録が増えない

### step report: `--paths` が空の glob を含むとエラー
- 対応: —
- Given: architect が options の手前まで進んでいる
- When: `step report architect options 001 --result done --harm 中 --paths "src/**,,docs/**"` と `--paths ""` をそれぞれ実行する
- Then: どちらも終了コードが非 0 で、progress.jsonl に記録が増えない

### step report: `declaresRisk` でないステップに `--harm` / `--paths` を付けるとエラー
- 対応: —
- Given: architect が questions の手前まで進んでいる
- When: `step report architect questions 001 --result done --harm 中` を実行する
- Then: 終了コードが非 0 で、`--harm` / `--paths` は options の done でしか受け付けない旨のエラーが出る

### step report: options の skipped に `--harm` を付けるとエラー
- 対応: —
- Given: architect が options の手前まで進んでいる
- When: `step report architect options 001 --result skipped --harm 高` を実行する
- Then: 終了コードが非 0 で、done 以外の報告では申告を受け付けない旨のエラーが出る

## scripts/lib/steps/directive.mts

### reportCommand: options の done の報告コマンドに申告の欄を載せる
- 対応: US-10.3
- Given: architect の次のステップが options
- When: `step next architect 001` の directive を得る
- Then: done の報告コマンドに ` --harm 高|中 --paths <触れるパスの glob,...>` が含まれ、ほかの run ステップ（questions など）の報告コマンドには含まれない

## scripts/lib/steps/engine.mts（lintApproval）

### lintApproval: gate に `declaresRisk` を付けた定義は弾く
- 対応: —
- Given: `kind: "gate"`, `declaresRisk: true` を持つ StepDefinition を含む SkillSteps
- When: `step lint` 相当の検査（`lintApproval`）にかける
- Then: そのステップを指すエラーが返る。プラグイン本体の ARCHITECT_STEPS ではエラーが出ない

## scripts/lib/steps/architect.mts（riskDeclaration）

### riskDeclaration: この回の最後の options の done の申告を返す
- 対応: —
- Given: 通常の回で options の done が2回（1回目 `harm: "高"`, `paths: ["src/a/**"]`、2回目 `harm: "中"`, `paths: ["src/b/**"]`）記録されている
- When: `riskDeclaration(ctx)` を呼ぶ
- Then: `{ harm: "中", paths: ["src/b/**"] }` を返す

### riskDeclaration: 前の回の申告は読まない
- 対応: —
- Given: 前の回に `harm: "中"`, `paths: ["src/a/**"]` の options の done があり、`step restart architect 001 --round add` で区切った今回はまだ options の done が無い
- When: `riskDeclaration(ctx)` を呼ぶ
- Then: undefined を返す

### riskDeclaration: 記録の不正な値は欠けとして扱う
- 対応: US-10.3
- Given: progress.jsonl を直接書き換え、options の done の記録が `"harm":"低"`, `"paths":["src/**",""]` になっている
- When: `riskDeclaration(ctx)` を呼ぶ
- Then: `harm`・`paths` のどちらも undefined の申告を返す（欠けとして同意の側に倒れる）

## scripts/lib/steps/architect.mts（G3 の consent: g3Consent）

### g3Consent: 申告が上限以内で重い領域に当たらなければ確認として省ける
- 対応: US-10.3
- Given: 宣言 `exposure = "internal"`, `data = "none"`, `impact = "low"`（上限は中）、`[[app.areas]]` に `name = "auth"`, `paths = ["src/auth/**"]`。options の done を `--harm 中 --paths "src/api/**"` で記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 は返らず（`G3:off`）、次は adr になる

### g3Consent: 害の申告が上限を超えれば同意
- 対応: US-10.3, US-13.3
- Given: 上と同じ宣言（上限は中）で、options の done を `--harm 高 --paths "src/api/**"` で記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 が `approval: "consent"` で返り、`approvalReason` に申告した害（高）が上限（中）を超えることが含まれる

### g3Consent: 上限が「なし」の宣言では害が中でも同意
- 対応: US-13.3
- Given: 宣言 `exposure = "public"`, `data = "none"`, `impact = "low"`（最上段があるので上限はなし）で、options の done を `--harm 中 --paths "src/api/**"` で記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 が `approval: "consent"` で返る

### g3Consent: 3軸すべて最下段なら害が高でも省ける
- 対応: US-10.3
- Given: 宣言 `exposure = "personal"`, `data = "none"`, `impact = "low"`（上限は高）、重い領域なしで、options の done を `--harm 高 --paths "src/api/**"` で記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 は返らず、次は adr になる

### g3Consent: 申告したパスが重い領域に当たれば害が中でも同意
- 対応: US-10.3, US-13.3
- Given: 宣言の上限が高（3軸すべて最下段）で、`[[app.areas]]` に `name = "auth"`, `paths = ["src/auth/**"]`。options の done を `--harm 中 --paths "src/auth/login.ts"` で記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 が `approval: "consent"` で返り、`approvalReason` に領域名 `auth` が含まれる

### g3Consent: `--paths` が欠ければ同意
- 対応: US-10.3
- Given: 宣言の上限が高で、options の done を `--harm 中` だけで記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 が `approval: "consent"` で返り、理由に申告の欠けが含まれる

### g3Consent: `--harm` が欠ければ同意
- 対応: US-10.3
- Given: 宣言の上限が高で、options の done を `--paths "src/api/**"` だけで記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 が `approval: "consent"` で返る

### g3Consent: 宣言が無いワークスペースでは従来どおりプロファイルで決まる
- 対応: US-13.4
- Given: origin/main・作業ツリーのどちらのルート設定にも `[app]` が無く、options の done を申告なし（`--harm`・`--paths` を付けない）で記録済み
- When: profile を express と standard にして、それぞれ `step next architect 001` を実行する
- Then: express では G3 が返らず（`G3:off`）、standard では G3 が `approval: "confirm"` で返る。どちらも notices に基準の宣言についての行は出ない

### g3Consent: 基準の宣言を読めない（incomplete）なら申告が上限以内でも同意
- 対応: US-13.3
- Given: origin/main にコミットしたルート設定の `[app]` が壊れている（`exposure = "everyone"` のようにこの版の検査を通らない値）。作業ツリーは正しい宣言（上限は高）で、options の done を `--harm 中 --paths "src/api/**"` で記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 が `approval: "consent"` で返る

### g3Consent: origin が無く作業ツリーにだけ宣言があると incomplete で同意
- 対応: US-13.3
- Given: origin を作らず（origin/HEAD も無い）、作業ツリーのルート設定にだけ上限が高の宣言を置く。options の done を `--harm 中 --paths "src/api/**"` で記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 が `approval: "consent"` で返る（作業ツリーの宣言だけで上限を緩められないため）

### g3Consent: 差し戻しからの再設計の回は宣言・申告に関わらず同意
- 対応: —
- Given: 宣言の上限が高、`step restart architect 001 --round return` で再設計の回を区切り、options の done を `--harm 中 --paths "src/api/**"` で記録済み、profile は express
- When: `step next architect 001` を実行する
- Then: G3 が `approval: "consent"` で返り、`approvalReason` に「差し戻しからの再設計」が含まれる

## scripts/lib/steps/architect.mts（designChoiceGate）

### designChoiceGate: options の done がまだ無い間は宣言による同意を含めない
- 対応: US-10.3
- Given: 宣言 `exposure = "public"`（上限なし）があり、profile は express、architect の次のステップが options（done はまだ無い）
- When: `step next architect 001` で options の directive を得る
- Then: `args.designChoiceGate` が false（申告前なので、宣言だけで同意にしない）

### designChoiceGate: options の done のあと、上限超えなら adr に true を渡す
- 対応: US-10.3
- Given: 宣言の上限が中、profile は express、options の done を `--harm 高 --paths "src/api/**"` で記録し、G3 を `--result approved` で報告済み
- When: `step next architect 001` で adr の directive を得る
- Then: `args.designChoiceGate` が true

### designChoiceGate: options の done のあと、上限以内なら adr に false を渡す
- 対応: US-10.3
- Given: 宣言の上限が中、重い領域は `src/auth/**` だけ、profile は express、options の done を `--harm 中 --paths "src/api/**"` で記録済み
- When: `step next architect 001` で adr の directive を得る
- Then: G3 は返らず、adr の `args.designChoiceGate` が false

## scripts/lib/steps/architect.mts（G4 の consent・args: undeclaredAreas）

### G4 consent: 基準の宣言を読めない（incomplete）なら申告が当たらなくても同意
- 対応: US-13.3
- Given: origin/main のルート設定の `[app]` が壊れている。作業ツリーには正しい宣言（上限は高、重い領域 `auth`）があり、profile は express。options の done は `--harm 中 --paths "src/api/**"`、design-delta.md は `src/api/` にしか触れない
- When: `step next architect 001` で G4 に進む
- Then: G4 が `approval: "consent"` で返る

### G4 consent: 申告に `--paths` が無い回は、申告を空とみなして裏取りする
- 対応: US-13.3
- Given: 宣言の上限が高、重い領域 `auth`（`src/auth/**`）。options の done を `--harm 中` だけで記録し（G3 は申告の欠けで同意として承認済み）、design-delta.md が `` `src/auth/session.ts` `` に触れる。profile は express
- When: `step next architect 001` で G4 に進む
- Then: G4 が `approval: "consent"` で返り、`args.undeclaredAreas` に `auth` が入る

### G4 consent: design-delta.md が G3 の申告に無い重い領域に触れれば同意
- 対応: US-13.3
- Given: 宣言の上限が高、`[[app.areas]]` に `name = "billing"`, `paths = ["src/billing/**"]`。options の done は `--harm 中 --paths "src/api/**"`、G3 は省かれ、design-delta.md の本文に `` `src/billing/invoice.ts` `` がある。profile は express
- When: architecture-review まで報告し、`step next architect 001` を実行する
- Then: G4 が `approval: "consent"` で返り、`approvalReason` に `billing` が含まれ、`args.undeclaredAreas` が `[{ name: "billing", touched: ["src/billing/invoice.ts"] }]`

### G4 consent: このサイクルの ADR が申告に無い重い領域に触れても同意
- 対応: US-13.3
- Given: 上と同じ宣言・申告で、design-delta.md は `src/api/` にしか触れず、ベースとの merge-base 以降に足した decisions の ADR の本文に `` `src/billing/**` `` がある
- When: `step next architect 001` で G4 に進む
- Then: G4 が `approval: "consent"` で返り、`args.undeclaredAreas` に `billing` が入る

### G4 consent: 申告が当たっている領域は除き、確認として省く
- 対応: US-13.3
- Given: 宣言の上限が高、重い領域 `auth`（`src/auth/**`）。options の done は `--harm 中 --paths "src/auth/**"`（G3 は同意として承認済み）、design-delta.md は `` `src/auth/session.ts` `` に触れる。profile は express
- When: `step next architect 001` で G4 の位置まで進める
- Then: G4 は返らず（`G4:off`）、`undeclaredAreas` は空

### G4 consent: options をスキップした回は申告を空とみなして裏取りする
- 対応: US-13.3
- Given: 宣言の上限が高、重い領域 `auth`（`src/auth/**`）。options を `--result skipped` で報告し、design-delta.md が `` `src/auth/session.ts` `` に触れる。profile は express
- When: `step next architect 001` で G4 に進む
- Then: G4 が `approval: "consent"` で返り、`args.undeclaredAreas` に `auth` が入る

### G4 consent: 宣言が無ければ従来どおりで、args の undeclaredAreas は空
- 対応: US-13.4
- Given: どこにも `[app]` が無く、design-delta.md が `` `src/auth/session.ts` `` に触れる。profile は standard
- When: `step next architect 001` で G4 に進む
- Then: G4 が `approval: "confirm"` で返り、`args.undeclaredAreas` が `[]`、notices に宣言についての行は出ない

### G4 consent: ADR の一覧を読めなければ同意に倒し、理由を notices に出す
- 対応: US-13.3
- Given: 宣言の上限が高で、document-guide.md が読めない（壊れている）ため `cycleAdrs` が例外を投げる。design-delta.md は重い領域に触れない。profile は express
- When: `step next architect 001` で G4 に進む
- Then: 手順は止まらずに G4 が `approval: "consent"` で返り、notices に裏取りできなかった理由が出る

## scripts/lib/steps/architect.mts（G3・G4 の notices）

### notices: 基準の宣言を読めなかった回は G3・G4 の directive に出る
- 対応: US-13.3
- Given: origin/main のルート設定の `[app]` が壊れている（incomplete）。profile は standard で、options の done を `--harm 中 --paths "src/api/**"` で記録済み
- When: `step next architect 001` で G3 の directive を、続けて G4 の directive を得る
- Then: どちらの `notices` にも `基準 main の宣言を読めません` を含む行がある。`step where`（手順の位置だけを読む経路）の出力にはこの行が出ない

## scripts/lib/conductor.mts・scripts/commands/config.mts

### CONSENT_WHEN と config の表示: G3・G4 の説明が宣言の上限と裏取りを含む
- 対応: —
- Given: 一時リポジトリに宣言（上限は中）を置く
- When: `conductor asks --json` と `config` を実行する
- Then: `consentWhen.G3` と `config` の G3 の行に、上限を超える申告・申告の欠け・重い領域が含まれ、`consentWhen.G4` と `config` の G4 の行に、申告に無い重い領域（裏取り）が含まれる。どちらも「人間」の語を使わない
