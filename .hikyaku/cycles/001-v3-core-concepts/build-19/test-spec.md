# Build 19: conductor での事後同意（最後のビルドの子の同意ゲートと、最後の PR の一覧） テストシナリオ

以下、特に断らない限り、一時 Git リポジトリにサイクル `001-test`（tasklist.md に build-01・build-02・build-03 の3行）を置く。
「事後同意が有効」は、サイクル設定に `[consent] deferred = true` があり、ベースブランチにマージ済みで、宣言に `[app] merge_gate = "user"` がある状態を指す。
「子」は環境変数 `HIKYAKU_CONDUCTOR_CHILD=1` で動くセッションを指す。

## cycleConsentItems（scripts/lib/ledger.mts）

### cycleConsentItems: 作業単位を問わず who=user・when=merge@ の risk と objection を拾う
- 対応: US-20.6
- Given: decisions.jsonl に、architect で記録した `architect.1-aaaa`（type=risk・who=user・when=merge@architect）、build-01 で記録した `build-01.1-bbbb`（type=objection・who=user・when=merge@build-01）、build-02 で記録した `build-02.1-cccc`（type=risk・who=user・when=merge@build-03）がある
- When: `cycleConsentItems(readLedger(cycleDirectory))` を呼ぶ
- Then: 3件すべてが返る

### cycleConsentItems: 対象外の事項を含めない
- 対応: —
- Given: type=question・who=user・when=merge@build-01、type=risk・who=ai・when=merge@build-01、type=risk・who=user・when=now の3件だけがある
- When: `cycleConsentItems` を呼ぶ
- Then: 空の配列が返る

### cycleConsentItems: 記録順で返す
- 対応: —
- Given: `build-02.1-cccc`（記録 10:00）、`architect.1-aaaa`（記録 10:05）、`build-01.1-bbbb`（記録 10:10）の順に記録された同意の対象がある
- When: `cycleConsentItems` を呼ぶ
- Then: ID の並びが `build-02.1-cccc`, `architect.1-aaaa`, `build-01.1-bbbb` になる

## isLastBuild（scripts/lib/steps/consent.mts）

### isLastBuild: ほかの全ビルドの PR 列が埋まっていれば true
- 対応: US-20.6
- Given: 作業ツリーの tasklist.md で build-01 の PR 列が `#11`、build-02 が `#12`、build-03 が空
- When: `isLastBuild(cycleDirectory, "build-03")` を呼ぶ
- Then: true が返る

### isLastBuild: ほかに PR 列が空のビルドがあれば false
- 対応: —
- Given: build-01 の PR 列が `#11`、build-02 と build-03 が空
- When: `isLastBuild(cycleDirectory, "build-03")` を呼ぶ
- Then: false が返る

### isLastBuild: 自分の PR 列が埋まっていても最後と判定する
- 対応: —
- Given: build-01 が `#11`、build-02 が `#12`、build-03 が `#13`（すべて埋まっている）
- When: `isLastBuild(cycleDirectory, "build-03")` を呼ぶ
- Then: true が返る（判定に使うのは build-03 以外の PR 列だけ）

### isLastBuild: build-NN でない単位は false
- 対応: —
- Given: build-01〜03 の PR 列がすべて `#11`〜`#13` で埋まっている
- When: `isLastBuild(cycleDirectory, "architect")` と `isLastBuild(cycleDirectory, "close")` を呼ぶ
- Then: どちらも false が返る

### isLastBuild: tasklist を読めなければ true（止める向き）
- 対応: —
- Given: サイクルのディレクトリに tasklist.md が無い
- When: `isLastBuild(cycleDirectory, "build-02")` を呼ぶ
- Then: true が返る

### isLastBuild: そのビルドの行が無ければ true
- 対応: —
- Given: tasklist.md に build-01 と build-02 の行だけがあり、どちらも PR 列が空
- When: `isLastBuild(cycleDirectory, "build-04")` を呼ぶ
- Then: true が返る

### isLastBuild: ビルドが1つだけのサイクルでは、そのビルドが最後（解釈）
- 対応: —
- Given: tasklist.md に build-01 の行だけがあり、PR 列が空
- When: `isLastBuild(cycleDirectory, "build-01")` を呼ぶ
- Then: true が返る

## conductorConsentMode（scripts/lib/steps/consent.mts）

### conductorConsentMode: 子でないセッションは none
- 対応: —
- Given: 事後同意が有効、`HIKYAKU_CONDUCTOR_CHILD` が未設定、build-01・02 の PR 列が埋まっている
- When: `conductorConsentMode("builder", { cycle, unit: "build-03" })` を呼ぶ
- Then: "none" が返る

### conductorConsentMode: 事後同意が有効なサイクルの architect の子は deferred
- 対応: US-21.1
- Given: 事後同意が有効、`HIKYAKU_CONDUCTOR_CHILD=1`
- When: `conductorConsentMode("architect", { cycle, unit: "architect" })` を呼ぶ
- Then: "deferred" が返る

### conductorConsentMode: 事後同意が有効なサイクルの最後以外のビルドの子は deferred
- 対応: US-21.1
- Given: 事後同意が有効、子、build-01 の PR 列が `#11`、build-02・03 が空
- When: `conductorConsentMode("builder", { cycle, unit: "build-02" })` を呼ぶ
- Then: "deferred" が返る

### conductorConsentMode: 事後同意が有効なサイクルの最後のビルドの子は last
- 対応: US-20.6
- Given: 事後同意が有効、子、build-01 が `#11`、build-02 が `#12`、build-03 が空
- When: `conductorConsentMode("builder", { cycle, unit: "build-03" })` を呼ぶ
- Then: "last" が返る

### conductorConsentMode: tasklist を読めないビルドの子は last
- 対応: —
- Given: 事後同意が有効、子、tasklist.md が無い
- When: `conductorConsentMode("builder", { cycle, unit: "build-02" })` を呼ぶ
- Then: "last" が返る

### conductorConsentMode: close-cycle の子は none
- 対応: —
- Given: 事後同意が有効、子、build-01〜03 の PR 列がすべて埋まっている
- When: `conductorConsentMode("close-cycle", { cycle, unit: "close" })` を呼ぶ
- Then: "none" が返る

### conductorConsentMode: 事後同意を選んでいないサイクルの子は none
- 対応: —
- Given: サイクル設定に `[consent]` が無い、子、build-01・02 の PR 列が埋まっている
- When: architect の子と build-03 の子でそれぞれ `conductorConsentMode` を呼ぶ
- Then: どちらも "none" が返る

### conductorConsentMode: 選んでいても有効でない（merge_gate が無い）サイクルの子は none
- 対応: —
- Given: サイクル設定に `[consent] deferred = true` があるが宣言に `[app] merge_gate` が無い（requested=true・effective=false）、子
- When: `conductorConsentMode("architect", { cycle, unit: "architect" })` を呼ぶ
- Then: "none" が返る

## consentTargets（scripts/lib/steps/consent.mts）

### consentTargets: last ならサイクル全体の同意の対象
- 対応: US-20.6
- Given: 事後同意が有効、build-03 が最後のビルド、子。記録に when=merge@architect の risk、when=merge@build-01 の objection、when=merge@build-03 の risk がある
- When: `consentTargets(ledger, "builder", { cycle, unit: "build-03" })` を呼ぶ
- Then: 3件すべてが返る

### consentTargets: last 以外はその作業単位の対象だけ
- 対応: —
- Given: 上と同じ記録で、`HIKYAKU_CONDUCTOR_CHILD` が未設定
- When: `consentTargets(ledger, "builder", { cycle, unit: "build-03" })` を呼ぶ
- Then: when=merge@build-03 の risk の1件だけが返る

## consentStep（同意ゲートが手順に入るか）

### consentStep: 事後同意が有効なサイクルの architect の子では、merge@architect の項目があっても同意ゲートが手順に入らない
- 対応: US-21.1
- Given: 事後同意が有効、architect の子、design まで進んでいる。記録に `architect.1-aaaa`（risk・who=user・when=merge@architect・決定なし）がある
- When: 子の環境で `step next architect 001` を呼ぶ
- Then: 次のステップが `consent` ではなく `pr` になる

### consentStep: 事後同意が有効なサイクルの最後以外のビルドの子では、同意ゲートが手順に入らない
- 対応: US-21.1
- Given: 事後同意が有効、build-01 が空の PR 列（build-02 が最後ではない状態）、build-02 の子が pr の手前。記録に `build-02.1-dddd`（risk・who=user・when=merge@build-02・決定なし）がある
- When: 子の環境で `step next builder 001 build-02` を呼ぶ
- Then: 次のステップが `pr` になる

### consentStep: 最後のビルドの子では、ほかの単位で記録した項目だけでも同意ゲートが現れる
- 対応: US-20.6
- Given: 事後同意が有効、build-01 が `#11`・build-02 が `#12`、build-03 の子が pr の手前。記録には `architect.1-aaaa`（when=merge@architect・決定なし）だけがあり、merge@build-03 の項目は無い
- When: 子の環境で `step next builder 001 build-03` を呼ぶ
- Then: 次のステップが `consent`（ask: deferred-consent）になる

### consentStep: 最後のビルドの子の同意ゲートの args はサイクル全体の ID
- 対応: US-20.6
- Given: 上の状態に加え、`build-01.1-bbbb`（objection・merge@build-01）と `build-03.1-eeee`（risk・merge@build-03）がある
- When: 子の環境で `step next builder 001 build-03 --json` を呼ぶ
- Then: directive の `args.items` が `architect.1-aaaa`, `build-01.1-bbbb`, `build-03.1-eeee` の3件になる

### consentStep: 最後のビルドの子でも、サイクル全体に対象が無ければ同意ゲートは現れない
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子で pr の手前。記録に who=user・when=merge@ の risk・objection が1件も無い
- When: 子の環境で `step next builder 001 build-03` を呼ぶ
- Then: 次のステップが `pr` になる

### consentStep: 最後のビルドの子で記録を読めなければ同意ゲートを手順に入れる
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子、build-01 の decisions.jsonl が JSON として壊れている
- When: 子の環境で `step next builder 001 build-03` を呼ぶ
- Then: 次のステップが `consent` になり、args に `error`（未決事項の記録を読めません）が入る

### consentStep: 事後同意が無効なサイクルの子は、従来どおり同意ゲートが手順に入らない
- 対応: —
- Given: `[consent]` の無いサイクル、build-03 が最後のビルドの子で pr の手前、記録に `build-03.1-eeee`（risk・merge@build-03・決定なし）がある
- When: 子の環境で `step next builder 001 build-03` を呼ぶ
- Then: 次のステップが `pr` になる

### consentStep: 最後のビルドの子の reopens は、承認のあとにほかの単位で足された対象で取り直す
- 対応: —
- Given: build-03 が最後のビルドの子で、同意ゲートを 10:00 に承認済み。10:05 に build-01 の記録へ `build-01.2-ffff`（risk・who=user・when=merge@build-01・決定なし）が足された
- When: 子の環境で `step next builder 001 build-03` を呼ぶ
- Then: 次のステップが `consent` に戻り、理由に `build-01.2-ffff` が含まれる

### consentStep: 最後のビルドの子の reopens は、記録を読めなければ取り直す
- 対応: —
- Given: build-03 が最後のビルドの子で同意ゲートを承認済み。そのあと architect の decisions.jsonl が壊れた
- When: 子の環境で `step next builder 001 build-03` を呼ぶ
- Then: 次のステップが `consent` に戻る

### consentStep: 子でないセッションの挙動は変わらない
- 対応: —
- Given: 事後同意が有効、`HIKYAKU_CONDUCTOR_CHILD` 未設定、build-01・02 の PR 列が埋まっている、build-03 が pr の手前。記録には `architect.1-aaaa`（when=merge@architect）だけがある
- When: `step next builder 001 build-03 --json` を呼ぶ
- Then: 同意ゲートは現れず次の1手は `pr`（子でないセッションの対象は when=merge@build-03 の事項だけで、`architect.1-aaaa` は build-03 の対象にならない）

## consentProblem（pr の accepts）

### consentProblem: deferred の子は決定の無い項目があっても pr を完了できる
- 対応: US-21.1
- Given: 事後同意が有効、architect の子、`architect.1-aaaa`（risk・merge@architect・決定なし）がある
- When: 子の環境で `step report architect pr 001 --result done` を呼ぶ
- Then: 終了コード 0 で受け付けられる

### consentProblem: deferred の子でも、同じ単位で退けて作り直していない項目があれば pr を受け付けない
- 対応: —
- Given: 事後同意が有効、build-02 が最後以外のビルドの子。`build-02.1-dddd`（step=implement）の最新の決定が rejected（--by user）で、そのあと implement を done で報告し直していない
- When: 子の環境で `step report builder pr 001 build-02 --result done` を呼ぶ
- Then: 拒まれ、理由に「退けた項目を作り直していません（build-02.1-dddd → implement）」が含まれる

### consentProblem: 事後同意が無効なサイクルの子は、決定の無い項目で pr が止まり blocked を案内する
- 対応: —
- Given: `[consent]` の無いサイクル、build-02 の子、`build-02.1-dddd`（risk・merge@build-02・決定なし）がある
- When: 子の環境で `step report builder pr 001 build-02 --result done` を呼ぶ
- Then: 拒まれ、理由に `build-02.1-dddd` と「PR を完了にせず、blocked でユーザーに上げてください」が含まれる

### consentProblem: last の子は、ほかの単位で記録した決定の無い項目で pr を受け付けない
- 対応: US-20.6
- Given: 事後同意が有効、build-03 が最後のビルドの子。`architect.1-aaaa`（merge@architect）に決定が無く、`build-03.1-eeee` は consented（--by user）
- When: 子の環境で `step report builder pr 001 build-03 --result done` を呼ぶ
- Then: 拒まれ、理由に `architect.1-aaaa` が含まれ、`build-03.1-eeee` は含まれない。案内は consent.md の手順（blocked の案内ではない）

### consentProblem: last の子は、サイクル全体の全項目に決定があれば pr を完了できる
- 対応: US-20.6
- Given: 上の状態で、`architect.1-aaaa` に `--decision consented --by user` を記録した
- When: 子の環境で同意ゲートを承認し、`step report builder pr 001 build-03 --result done` を呼ぶ
- Then: 終了コード 0 で受け付けられる

### consentProblem: close-cycle の子は、決定の無い項目があれば従来どおり pr で止まる
- 対応: —
- Given: 事後同意が有効、close-cycle の子、`build-03.2-gggg`（risk・who=user・when=merge@close・決定なし）がある
- When: 子の環境で `step report close-cycle pr 001 --result done` を呼ぶ
- Then: 拒まれ、理由に `build-03.2-gggg` と「PR を完了にせず、blocked でユーザーに上げてください」が含まれる

## consentGateSlot / ledger object --defer

### consentGateSlot: deferred の子では置き場を問わず --defer を受け付ける
- 対応: US-21.1
- Given: 事後同意が有効、build-02 が最後以外のビルドの子で、pr を done で報告済み
- When: 子の環境で `ledger object build-02 001 --summary "公開 API の入力検証を後に回す" --basis '[app] exposure = "public"' --loses "不正な入力を最初から弾けない" --harm 高 --defer --premises app.exposure` を呼ぶ
- Then: 終了コード 0 で記録され、事項は who=user・when=merge@build-02 になる

### consentGateSlot: architect の子でも --defer を受け付ける
- 対応: US-21.1
- Given: 事後同意が有効、architect の子が design の途中
- When: 子の環境で `ledger object architect 001 ... --harm 高 --defer --premises app.exposure` を呼ぶ
- Then: 終了コード 0 で記録され、when=merge@architect になる

### consentGateSlot: deferred の子が積んだ異議は、最後のビルドの同意ゲートに載る
- 対応: US-20.6
- Given: 上のシナリオで build-02 の子が積んだ異議 `build-02.2-hhhh` があり、build-01・02 の PR 列が埋まっている
- When: build-03 の子の環境で `step next builder 001 build-03 --json` を呼ぶ
- Then: 同意ゲートが現れ、args.items に `build-02.2-hhhh` が入る

### consentGateSlot: last の子は同意ゲートの手前なら --defer を受け付ける
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子で implement の途中
- When: 子の環境で `ledger object build-03 001 ... --harm 高 --defer --premises app.exposure` を呼ぶ
- Then: 終了コード 0 で記録される

### consentGateSlot: last の子は pr を終えたあとの --defer を拒む
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子で pr を done で報告済み
- When: 子の環境で `ledger object build-03 001 ... --harm 高 --defer --premises app.exposure` を呼ぶ
- Then: 終了コード 1 で拒まれ、記録は増えない

### consentGateSlot: close-cycle の子の --defer は拒む
- 対応: —
- Given: 事後同意が有効、close-cycle の子
- When: 子の環境で `ledger object close 001 ... --harm 高 --defer --premises app.exposure` を呼ぶ
- Then: 終了コード 1 で拒まれ、理由に「同意ゲートがありません」が含まれる

### consentGateSlot: 事後同意が無効なサイクルの子の --defer は拒む
- 対応: —
- Given: `[consent] deferred = true` だが merge_gate の無い（有効でない）サイクル、build-02 の子
- When: 子の環境で `ledger object build-02 001 ... --harm 高 --defer --premises app.exposure` を呼ぶ
- Then: 終了コード 1 で拒まれる

## deferredConsent の子での有効化（scripts/lib/deferred-consent.mts）

### compute: conductor の子でも事後同意が有効になる
- 対応: US-21.1
- Given: ベースブランチに `[consent] deferred = true` と `[app] merge_gate = "user"` がマージ済み、architect のブランチ
- When: `HIKYAKU_CONDUCTOR_CHILD=1` で事後同意を判定する
- Then: effective が true になり、reason に「conductor の子」が含まれない

### compute: 同じプロセスで子と子でないの評価が同じ結果になる
- 対応: —
- Given: 上と同じワークスペース
- When: 同じプロセスで、子でない環境で判定したあと `asConductorChild` の中で判定する
- Then: どちらも effective が true になる（キャッシュの鍵に child/self を持たない）

### G3: 事後同意が有効なサイクルの architect の子で、上限を超える受け入れが deferred になる
- 対応: US-21.1
- Given: 事後同意が有効、architect の子が options の手前まで進んでいる、宣言の上限は「中まで」
- When: 子の環境で `step report architect options 001 --result done --harm 高 --paths "src/api/**" --loses "入力検証を先に作る利点" --json` を呼ぶ
- Then: 承認の種類が `confirm` になり、記録に type=risk・who=user・when=merge@architect・source=step-report の事項が1件積まれる

### G3: architect の子でも --loses が無ければ拒む
- 対応: —
- Given: 上と同じ状態
- When: `--loses` を付けずに同じ報告をする
- Then: 終了コード 1 で拒まれ、記録は増えない

### G4: 事後同意が有効なサイクルの architect の子で、申告に無い重い領域に触れる設計が deferred になる
- 対応: US-21.1
- Given: 事後同意が有効、宣言に重い領域 `billing`（paths: src/billing/**）、architect の子が design の手前
- When: 子の環境で design を `--paths "src/billing/**"` 付きで報告する
- Then: G4 の承認の種類が `confirm` になり、risk の事項（premises に `area:billing`）が積まれる

### G3: 事後同意が無効なサイクルの architect の子は、従来どおりその場で同意
- 対応: —
- Given: `[consent]` の無いサイクル、architect の子
- When: `step report architect options 001 --result done --harm 高 --paths "src/api/**" --json` を呼ぶ
- Then: 承認の種類が `consent` になり、記録に事項は積まれない

## ledger consent-list / pr-section / return-draft（scripts/commands/ledger.mts）

### consent-list: 最後のビルドの子ではサイクル全体の項目を並べる
- 対応: US-20.6
- Given: 事後同意が有効、build-03 が最後のビルド。記録に `architect.1-aaaa`・`build-01.1-bbbb`・`build-03.1-eeee` がある
- When: 子の環境で `ledger consent-list build-03 001 --json` を呼ぶ
- Then: 3件すべてが項目に入る

### consent-list: 子でないセッションの build-03 は、その単位の項目だけ
- 対応: —
- Given: 上と同じ記録、`HIKYAKU_CONDUCTOR_CHILD` 未設定
- When: `ledger consent-list build-03 001 --json` を呼ぶ
- Then: `build-03.1-eeee` の1件だけが入る

### pr-section --all: サイクル全体の受け入れたリスク・決定の無い項目・未解決の退けを出す
- 対応: US-20.6
- Given: `architect.1-aaaa`（consented --by user）、`build-01.1-bbbb`（決定なし）、`build-02.1-cccc`（rejected --by user）がある
- When: `ledger pr-section build-03 001 --all --json` を呼ぶ
- Then: `accepted` が [`architect.1-aaaa`]、`undecided` が [`build-01.1-bbbb`]、`rejected` が [`build-02.1-cccc`] になる

### pr-section --all: 全作業単位の merge@ の question・provisional を出す
- 対応: US-20.6
- Given: `architect.2-iiii`（provisional・who=user・when=merge@architect・未決）と `build-01.3-jjjj`（question・who=user・when=merge@build-01・未決）がある
- When: `ledger pr-section build-03 001 --all --json` を呼ぶ
- Then: `beforeMerge` に2件とも入る

### pr-section: --all なしの子でないセッションは、ほかの単位の項目を出さない
- 対応: —
- Given: 上の2つのシナリオの記録、`HIKYAKU_CONDUCTOR_CHILD` 未設定
- When: `ledger pr-section build-03 001 --json` を呼ぶ
- Then: `accepted`・`undecided`・`rejected`・`beforeMerge` のどれにも architect・build-01・build-02 の ID が入らない

### pr-section: --all なしでも最後のビルドの子では、同意の対象がサイクル全体になり、question・provisional は自分の単位だけ
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子。`architect.1-aaaa`（consented）、`architect.2-iiii`（provisional・merge@architect）、`build-03.2-kkkk`（provisional・merge@build-03）がある
- When: 子の環境で `ledger pr-section build-03 001 --json` を呼ぶ
- Then: `accepted` に `architect.1-aaaa` が入り、`beforeMerge` は [`build-03.2-kkkk`] だけになる

### pr-section: 決定の行に答えの出どころを添える
- 対応: US-20.6
- Given: `architect.1-aaaa` に、子が `HIKYAKU_ANSWER_FROM=user`・`HIKYAKU_ANSWER_ITEMS=architect.1-aaaa` で `--decision consented --by user` を記録した（from=user）
- When: `ledger pr-section build-03 001 --all` を呼ぶ
- Then: その項目の下に `決定: consented（ユーザー・出どころ: user）` の行が出る

### pr-section: from の無い決定は従来どおりの表示
- 対応: —
- Given: 子でないセッションで `architect.1-aaaa` に `--decision consented --by user` を記録した（from なし）
- When: `ledger pr-section build-03 001 --all` を呼ぶ
- Then: 決定の行に「出どころ」が含まれない

### pr-section --all: 書き込まない
- 対応: —
- Given: 上の記録がある
- When: `ledger pr-section build-03 001 --all` を呼ぶ
- Then: 呼ぶ前後で作業ツリーのファイルが変わらない

### return-draft: 最後のビルドの子は、ほかのビルドで記録した退けた項目を差し戻せる
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子。`architect.1-aaaa`（merge@architect）を build-03 の子が rejected（--by user）で記録した
- When: 子の環境で `ledger return-draft build-03 001 architect.1-aaaa` を呼ぶ
- Then: 終了コード 0 で差し戻しの下書きが出る

### return-draft: 子でないセッションの build-03 では、ほかの単位の項目は同意ゲートの項目として扱わない
- 対応: —
- Given: 上と同じ記録、`HIKYAKU_CONDUCTOR_CHILD` 未設定
- When: `ledger return-draft build-03 001 architect.1-aaaa` を呼ぶ
- Then: 同意ゲートの項目ではないとして拒まれる（build-18 までと同じ）

## ledger decide --by supervisor と事後同意の risk の同時記録

### childAnswer: HIKYAKU_ANSWER_DEFER=1 なら defer が true
- 対応: US-15.4
- Given: 子の環境に `HIKYAKU_ANSWER_FROM=supervisor`・`HIKYAKU_ANSWER_ASK=questions`・`HIKYAKU_ANSWER_DEFER=1` がある
- When: `childAnswer()` を呼ぶ
- Then: `defer` が true になる。`HIKYAKU_ANSWER_DEFER` が無ければ false

### decide: DEFER の監督の答えには --loses を求める
- 対応: US-15.4
- Given: build-02 の子、環境に `HIKYAKU_ANSWER_FROM=supervisor`・`_ASK=questions`・`_RISK='高:app.exposure'`・`_TOKEN=t-001`・`_DEFER=1`、記録に `build-02.3-llll`（question・who=supervisor の待ち）がある
- When: `ledger decide build-02 build-02.3-llll 001 --decision decided --by supervisor --input "ログの保持を延ばす"` を `--loses` なしで呼ぶ
- Then: 終了コード 1 で拒まれ、理由に `--loses` が含まれ、記録は増えない

### decide: DEFER の監督の答えで、決定と risk の事項を同時に書く
- 対応: US-15.4, US-21.1
- Given: 上と同じ環境
- When: `ledger decide build-02 build-02.3-llll 001 --decision decided --by supervisor --input "ログの保持を延ばす" --loses "保持を短くして漏えい時の範囲を狭める利点"` を呼ぶ
- Then: build-02 の decisions.jsonl に、決定（token=t-001）と、type=risk・who=user・when=merge@build-02・harm=高・premises=[app.exposure]・loses="保持を短くして漏えい時の範囲を狭める利点"・ask=questions・source=supervisor-answer・token=t-001 の事項が書かれる

### decide: 同時に書く risk の事項の要約は監督の答えと事項の要約から作る（解釈）
- 対応: —
- Given: 上と同じ環境で、`build-02.3-llll` の要約が「ログの保持期間」、`HIKYAKU_ANSWER_CHOICE` が無い
- When: 上の decide を呼ぶ
- Then: risk の事項の summary が「監督の答え（questions）で受け入れたリスク: ログの保持期間」になる（choice が無ければ問いの ID だけ。choice があれば「questions / proceed」の形）

### decide: DEFER でない監督の答えには risk の事項を書かない（解釈）
- 対応: —
- Given: 環境に `HIKYAKU_ANSWER_DEFER` が無く、`HIKYAKU_ANSWER_RISK='中:app.exposure'`
- When: `ledger decide build-02 build-02.3-llll 001 --decision decided --by supervisor --input "..."` を呼ぶ
- Then: 終了コード 0 で決定だけが書かれ、type=risk の事項は増えない

### decide: supervisor-answer の risk は G3・G4 の deferred の判定に数えない
- 対応: —
- Given: 事後同意が有効、architect の子。options を `--harm 高 --paths src/api/**` で報告して step report が積んだ risk（source=step-report・ask=G3）を、ユーザーが rejected にした。そのうえで、ask=G3 の source=supervisor-answer の risk（when=merge@architect、前提 app.exposure）を記録に足した
- When: 子の環境で `step next architect 001 --json` を呼ぶ（G3 の位置）
- Then: G3 の承認の種類は `consent`（その場の同意）のまま。supervisor-answer の事項は、同意を遅らせる根拠（source=step-report の事項）に数えない

### decide: 同時に書いた risk の事項は最後のビルドの同意ゲートに載る
- 対応: US-15.4, US-21.1
- Given: build-02 の子が DEFER の答えで risk の事項 `build-02.4-mmmm` を書いた。build-01・02 の PR 列が埋まった
- When: build-03 の子の環境で `ledger consent-list build-03 001 --json` を呼ぶ
- Then: `build-02.4-mmmm` が項目に入り、決定が無い状態で示される

### conductor parse --expect-answer: DEFER の答えでも token の一致する決定があれば通る
- 対応: —
- Given: 上の decide で token=t-001 の決定と risk の事項が書かれた子の結果
- When: `conductor parse --expect-answer t-001` で子の結果を確かめる
- Then: stepProblems に答えの欠落が入らない

## conductor launch --from supervisor（checkSupervisorAnswer の4番目）

### launch: 事後同意が有効で置き場があり前提が宣言だけなら、上限を超える申告を受け付ける
- 対応: US-15.4, US-21.1
- Given: 事後同意が有効、宣言の上限が「中まで」、build-02 の子（最後以外）が session-id `s-02` で実装の途中、`questions` の問いで止まっている
- When: `conductor launch builder 001 02 --resume s-02 --from supervisor --ask questions --harm 高 --premises app.exposure` を呼ぶ
- Then: 終了コード 0 で、子のコマンドに `HIKYAKU_ANSWER_DEFER=1` と `HIKYAKU_ANSWER_RISK='高:app.exposure'` が入る

### launch: DEFER のとき子への回答の先頭に --loses が要る旨の固定文が入る
- 対応: US-15.4
- Given: 上と同じ状態
- When: 上と同じ launch を `--json` で呼ぶ
- Then: 子へのメッセージの先頭に、`--loses` が要ることを示す固定文（deferNotice）が入る

### launch: 上限以内の申告には DEFER を渡さない
- 対応: —
- Given: 事後同意が有効、宣言の上限が「中まで」、build-02 の子が s-02 で止まっている
- When: `conductor launch builder 001 02 --resume s-02 --from supervisor --ask review-findings --choice proceed --harm 中 --premises app.exposure` を呼ぶ
- Then: 終了コード 0 で、子のコマンドに `HIKYAKU_ANSWER_DEFER` が入らない

### launch: 事後同意が無効なら上限を超える申告を拒む
- 対応: —
- Given: `[consent]` の無いサイクル、宣言の上限が「中まで」、build-02 の子が s-02 で止まっている
- When: `conductor launch builder 001 02 --resume s-02 --from supervisor --ask questions --harm 高 --premises app.exposure` を呼ぶ
- Then: 終了コード 1 で、stderr に「上限を超える」と `--escalate` の案内が出る

### launch: 選んでいても有効でない（merge_gate が無い）サイクルでは拒む
- 対応: —
- Given: サイクル設定に `[consent] deferred = true` があるが merge_gate が無い、build-02 の子が s-02 で止まっている
- When: 上と同じ launch を呼ぶ
- Then: 終了コード 1 で拒まれる

### launch: --resume が無く子の位置を確かめられなければ拒む
- 対応: —
- Given: 事後同意が有効
- When: `conductor launch builder 001 02 --from supervisor --ask questions --harm 高 --premises app.exposure` を `--resume` なしで呼ぶ
- Then: 終了コード 1 で拒まれる

### launch: close-cycle の子への上限を超える申告は拒む
- 対応: —
- Given: 事後同意が有効、close-cycle の子が s-cl で止まっている
- When: `conductor launch close-cycle 001 --resume s-cl --from supervisor --ask questions --harm 高 --premises app.exposure` を呼ぶ
- Then: 終了コード 1 で拒まれる

### launch: pr を終えた最後のビルドの子への上限を超える申告は拒む
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子（s-03）で、pr を done で報告済み
- When: `conductor launch builder 001 03 --resume s-03 --from supervisor --ask questions --harm 高 --premises app.exposure` を呼ぶ
- Then: 終了コード 1 で拒まれる

### launch: 同意ゲートの手前にいる最後のビルドの子への申告は受け付ける
- 対応: US-21.1
- Given: 事後同意が有効、build-03 が最後のビルドの子（s-03）で implement の途中
- When: 上と同じ launch を呼ぶ
- Then: 終了コード 0 で `HIKYAKU_ANSWER_DEFER=1` が入る

### launch: 前提に宣言の参照以外を含む上限を超える申告は拒む
- 対応: —
- Given: 事後同意が有効、build-02 の子が s-02 で止まっている
- When: `--harm 高 --premises "app.exposure,docs/api.md"` で launch を呼ぶ
- Then: 終了コード 1 で拒まれる

### launch: 宣言に無い area を前提に挙げた上限を超える申告は拒む
- 対応: —
- Given: 事後同意が有効、宣言の領域は `billing` だけ、build-02 の子が s-02 で止まっている
- When: `--harm 高 --premises area:payments` で launch を呼ぶ
- Then: 終了コード 1 で拒まれる

### launch: 宣言にある area を前提に挙げた上限を超える申告は受け付ける
- 対応: —
- Given: 事後同意が有効、全体の上限は「中まで」、`[[app.areas]]` に重い領域 `billing`（paths `src/billing/**`）が宣言されている。重い領域を前提に挙げた申告は、害が中でも上限を超えるとみなす（既存の `exceedsCeilingFor`。build-07 のテスト「重い領域を前提に挙げた申告を害が中でも拒み」と同じ判定）。build-02 の子が s-02 で止まっている
- When: `--ask questions --harm 中 --premises area:billing` で launch を呼ぶ
- Then: 終了コード 0 で `HIKYAKU_ANSWER_DEFER=1` が入る

### deferrablePremisesProblem: ledger object --defer と同じ判定をする
- 対応: —
- Given: 宣言に `[app]` と領域 `billing` がある
- When: `deferrablePremisesProblem(config, ["app.exposure", "area:billing"])` と `deferrablePremisesProblem(config, ["app.exposure", "README.md"])` と `deferrablePremisesProblem(config, [])` を呼ぶ
- Then: 1つ目は undefined、2つ目と3つ目は理由の文字列を返す。`ledger object --defer --premises README.md` も同じ理由で拒む

## conductor launch --from user --closes（closesMessage）

### launch --closes: 最後のビルドの子の再開で、サイクル全体の同意の項目を閉じられる
- 対応: US-20.6
- Given: 事後同意が有効、build-03 が最後のビルドの子（s-03）で同意ゲートの待ち（ask: deferred-consent）。記録に `architect.1-aaaa`・`build-01.1-bbbb`（決定なし）がある
- When: `conductor launch builder 001 03 --resume s-03 --from user --ask deferred-consent --closes architect.1-aaaa,build-01.1-bbbb --message "aaaa は同意、bbbb は退ける"` を呼ぶ
- Then: 終了コード 0 で、`HIKYAKU_ANSWER_ITEMS=architect.1-aaaa,build-01.1-bbbb` が入る

### closesMessage: 同意の項目は項目ごとの決定のひな形を出す
- 対応: US-20.6
- Given: 上と同じ launch
- When: 子へのメッセージを見る
- Then: 「ユーザーの答えに従って項目ごとに consented / decided / rejected / resolved を選び、高として扱う異議はユーザーの言葉を --accepts に添える」行と、`hikyaku ledger decide build-03 architect.1-aaaa 001 --decision <…> --by user --input=…` の形のひな形が項目ごとに出る。`--decision decided` の固定文は同意の項目には出ない

### closesMessage: 待ちの事項と同意の項目を分けて出す
- 対応: —
- Given: 最後のビルドの子の再開で、`--closes` に待ちの question `build-03.3-nnnn` と同意の項目 `architect.1-aaaa` を渡す
- When: `closesMessage("build-03", "001", ["build-03.3-nnnn"], answer, [architect.1-aaaa の項目])` を呼ぶ
- Then: `build-03.3-nnnn` は `--decision decided --by user` の固定文、`architect.1-aaaa` は項目ごとの決定のひな形になる

### closesMessage: consentItems を渡さなければ従来と同じ文面
- 対応: —
- Given: 待ちの事項 `build-02.3-llll` だけ
- When: `closesMessage("build-02", "001", ["build-02.3-llll"], "延ばす")` を呼ぶ
- Then: build-18 までと同じ文面（`--decision decided --by user --input='延ばす'` の1行と答え）が返る

### launch --closes: 最後以外のビルドの子では、ほかの単位の同意の項目を閉じられない（解釈）
- 対応: —
- Given: 事後同意が有効、build-02 が最後以外のビルドの子（s-02）、記録に `architect.1-aaaa`（決定なし）がある
- When: `conductor launch builder 001 02 --resume s-02 --from user --closes architect.1-aaaa --message "同意"` を呼ぶ
- Then: 終了コード 1 で拒まれる（閉じられる ID に入らない）

### decide: 子が --closes で渡された同意の項目に --by user の決定を書ける
- 対応: —
- Given: 子の環境に `HIKYAKU_ANSWER_FROM=user`・`HIKYAKU_ANSWER_ITEMS=architect.1-aaaa,build-01.1-bbbb`
- When: 子が `ledger decide build-03 architect.1-aaaa 001 --decision consented --by user --input "同意"` と `ledger decide build-03 build-01.1-bbbb 001 --decision rejected --by user --input "退ける"` を呼ぶ
- Then: どちらも終了コード 0 で、決定に from=user が残る。ITEMS に無い ID への `--by user` は拒まれる

## conductor asks

### asks: 事後同意が有効なら JSON と表示に出る
- 対応: US-20.9
- Given: 事後同意が有効
- When: `conductor asks 001 --json` と `conductor asks 001` を呼ぶ
- Then: JSON の `deferredConsent` が `{ requested: true, effective: true, reason: … }` になり、テキストに「事後同意: 有効」の行が出る

### asks: 選んでいるが有効でなければ理由を出す
- 対応: US-20.9
- Given: サイクル設定に `[consent] deferred = true` があるが宣言に merge_gate が無い
- When: `conductor asks 001 --json` と `conductor asks 001` を呼ぶ
- Then: JSON の `deferredConsent` が `requested: true, effective: false` で reason に merge_gate の欠落の理由が入り、テキストに「事後同意: 無効（<理由>）」の行が出る

### asks: 選んでいなければその旨を出す
- 対応: US-20.9
- Given: サイクル設定に `[consent]` が無い
- When: `conductor asks 001 --json` と `conductor asks 001` を呼ぶ
- Then: JSON の `deferredConsent` が `requested: false, effective: false` になり、テキストに「事後同意: 選んでいない」の行が出る

## childStep（監督と子の位置の一致）

### childStep: 最後のビルドの子の同意ゲートの位置が、監督と子で一致する
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子で、pr の手前。記録に `architect.1-aaaa`（決定なし）だけがある
- When: 子の環境の `step next builder 001 build-03` と、監督の `conductor parse`（childStep・positionOnly）で現在地を評価する
- Then: どちらも `consent` を現在地とし、監督は子を違反としない

### childStep: 最後のビルドの子でサイクル全体に対象が無ければ、監督も子も pr を現在地とする
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子で pr の手前、同意の対象が1件も無い
- When: 子の `step next` と監督の childStep で現在地を評価する
- Then: どちらも `pr` を現在地とする（positionOnly でも記録を読み、ゲートを入れない）

### childStep: 最後以外のビルドの子は、merge@ の項目があっても監督も子も pr を現在地とする
- 対応: US-21.1
- Given: 事後同意が有効、build-02 が最後以外のビルドの子で pr の手前、`build-02.1-dddd`（決定なし）がある
- When: 子の `step next` と監督の childStep で現在地を評価する
- Then: どちらも `pr` を現在地とする

### childStep: positionOnly で最後のビルドの記録を読めなければ同意ゲートを入れる
- 対応: —
- Given: 事後同意が有効、build-03 が最後のビルドの子、architect の decisions.jsonl が壊れている
- When: 監督の childStep で現在地を評価する
- Then: `consent` を現在地とする（子の step next と同じ）

## ledger premises（最後の PR の宣言の変更）

### premises: conductor ブランチで変えた宣言と、それを拠り所にした全フェーズの受け入れが PR の節に載る
- 対応: US-20.9
- Given: main の `[app]` は `exposure = "internal"`。conductor ブランチ（main から分岐）で `exposure = "personal"` に変えてコミットした。記録には architect の risk `architect.1-aaaa`（premises `app.exposure`）と build-01 の risk `build-01.1-bbbb`（premises `app.exposure`）、build-01 の risk `build-01.2-cccc`（premises `app.data`）がある
- When: 最後のビルドのブランチで `ledger premises --changed-from main --format pr` を呼ぶ
- Then: 出力に変わったキー `app.exposure` と、その下に `architect.1-aaaa`・`build-01.1-bbbb` が並ぶ。`build-01.2-cccc` は並ばない

### premises: 宣言を変えていなければ節は空
- 対応: US-20.9
- Given: conductor ブランチの `[app]` が main と同じ
- When: `ledger premises --changed-from main --format pr` を呼ぶ
- Then: 出力が空（最後の PR の本文に節を貼らない）
