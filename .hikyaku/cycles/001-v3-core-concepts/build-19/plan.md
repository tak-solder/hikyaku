# Build 19: conductor での事後同意（最後のビルドの子の同意ゲートと、最後の PR の一覧）

## 依存パッケージ

なし

## クラス設計

### 子の同意の扱い（`scripts/lib/steps/consent.mts`）

```ts
/** 作業ツリーの tasklist で、このビルド以外の全ビルドの PR 列が埋まっているか（build-NN でなければ false。tasklist を読めない・そのビルドの行が無ければ true＝止める向き） */
export function isLastBuild(cycleDirectory: string, unit: string): boolean

/**
 * conductor の子の同意の扱い。
 *   "last"     最後のビルドの子。同意ゲートを手順に入れ、対象はサイクル全体
 *   "deferred" architect の子と、最後以外のビルドの子。同意ゲートを手順に入れず、pr の accepts も決定の無い項目で止めない
 *              （最後のビルドの同意ゲートへ回す）。--defer も置き場を問わず受け付ける
 *   "none"     子でない、または architect・ビルド以外の子（close-cycle）。従来どおり
 */
export type ConductorConsentMode = "last" | "deferred" | "none";
export function conductorConsentMode(skill: string, ctx: Pick<StepContext, "cycle" | "unit">): ConductorConsentMode

/** 同意ゲート・pr の accepts・consent-list・pr-section・return-draft・launch --closes が使う対象（"last" ならサイクル全体） */
export function consentTargets(ledger: Ledger, skill: string, ctx: Pick<StepContext, "cycle" | "unit">): LedgerItem[]
```

- skill は呼び手が渡す（`consentStep(skill)` の skill、コマンドでは `opened.skill.skill`）。ctx からは決めない
- `consentStep` の `slot`（手順に入るか）: `!isConductorChild()` を `conductorConsentMode(skill, ctx) !== "deferred"` に変える
- `hasConsentItems`: "last" なら `cycleConsentItems(readLedger(cycle))` が空でないか。**positionOnly でも記録を読む**（読めなければ true）。
  監督の `childStep`（positionOnly）と子の `step next` で、最後のビルドの同意ゲートの有無をそろえるため（build-06 の handoff の2か所）。
  最後のビルドの子だけなので、位置だけの経路で読む量が増えるのはその回だけ
- `consentProblem`:
  - "deferred": 決定の無い項目では止めない（最後のビルドの同意ゲートへ回す）。退けの作り直しの検査（rework・returns・resumed）はそのまま
  - "last": 対象を `consentTargets`（サイクル全体）にする。案内は consent.md の手順
  - 「conductor の子では同意ゲートが手順に入りません」の案内は、"none" の子（close-cycle）にだけ残す（「PR を完了にせず、blocked でユーザーに上げてください」）
- `consentStep` の `args` と `reopens` も `consentTargets` を使う。"last" の reopens はサイクル全体を読み、承認より後に足された決定の足りない対象で取り直す（読めなければ取り直す）
- `consentGateSlot`（`ledger object --defer` の拒否）: "deferred" の子は置き場を問わず受け付ける（記録は `when=merge@<その単位>` のまま。最後のビルドの同意ゲートがサイクル全体から拾う）。"last" は従来どおり（ゲートの手前なら置き場あり、pr の後は無し）。close-cycle は従来どおり同意ゲートの定義が無いので拒む
- `asConductorChild` と `childStep` はそのまま。モードは ctx と環境変数から決まるので、子と監督で同じ評価になる

### サイクル全体の対象（`scripts/lib/ledger.mts`）

```ts
/** サイクル全体の同意の対象（type が risk か objection・who=user・when=merge@<どこでも>）。記録順 */
export function cycleConsentItems(ledger: Ledger): LedgerItem[]
```

### 事後同意の子での有効化（`scripts/lib/deferred-consent.mts`）

- `compute` の「conductor の子では事後同意を有効にしません」の行を消す。キャッシュの鍵の child/self も消す（結果が子かどうかで変わらなくなる）
- これで architect の子の G3・G4 の deferred と、step report の自動の積み上げ（`deferredRisk`）が動く（design-delta 3節どおり）

### `ledger consent-list` / `ledger pr-section` / `ledger return-draft`（`scripts/commands/ledger.mts`）

- consent-list: 対象を `consentTargets(ledger, opened.skill.skill, opened.ctx)` にする（最後のビルドの子ならサイクル全体）
- pr-section: `--all` を足す。対象はサイクル全体の同意の対象（`cycleConsentItems`）と、全作業単位の `merge@` の question・provisional（未決）。
  `--all` なしでも、最後のビルドの子では `consentTargets` によりサイクル全体になる（`merge@` の question・provisional は従来どおり <phase> だけ）
- 決定の行に答えの出どころを添える: `決定: consented（ユーザー・出どころ: user）`（`from` が無い決定は従来どおり）
- return-draft: 同意ゲートの項目かの判定を `consentTargets` にする（最後のビルドの子は、ほかのビルドで記録した項目も差し戻せる）

### `conductor launch`（`scripts/commands/conductor.mts`・`scripts/lib/conductor.mts`）

- `--from user --closes`: 閉じられる ID に、再開する子の作業単位の同意の対象（`consentTargets` を子として評価。最後のビルドならサイクル全体）を足す。
  待ちの事項（従来の条件）と同意の対象に分け、`closesMessage` に渡す
- `closesMessage(unit, cycle, items, answer, consentItems = [])`: 同意の対象は `--decision decided` の固定文ではなく、
  「ユーザーの答えに従って項目ごとに consented / decided / rejected / resolved を選び、高として扱う異議は
  ユーザーの言葉を `--accepts` に添える」行と、項目ごとの `ledger decide` のひな形を出す
- `checkSupervisorAnswer` の4番目（上限を超える申告）: 事後同意が有効（`deferredConsent(config, cycle).effective`）で、
  子に同意ゲートの置き場がある（位置を確かめられた子の作業単位を子として評価し、`consentGateSlot` が undefined）ときだけ受け付け、
  `deferRisk: true` を返す。位置を確かめられない（`--resume` なし・記録なし）・close-cycle の子・置き場の無い最後のビルドの子は従来どおり拒む
- `deferRisk` のとき、子への回答の先頭に固定文（`deferredRiskMessage`）を足す:

```ts
/** 上限を超える監督の答えを、最後のビルドの同意ゲートへ積ませる固定文 */
export function deferredRiskMessage(unit: string, cycle: string, ask: string, harm: Harm, premises: string[], answer: string): string
// 1. hikyaku ledger open {unit} {cycle} --type risk --who user --when merge --harm {harm} --premises {premises} --ask {ask}
//      --summary "<監督の答えで受け入れたリスクの要約>" --loses "<退けた安全側の案で失う利点>"
// 2. 監督の答えを記録し、続ける
```

### `conductor asks`

- JSON に `deferredConsent`（`deferredConsent(config, context.directory)` の `{ requested, effective, reason }`）。
  テキストに「事後同意: 有効 / 無効（理由） / 選んでいない」の1行（`問いの扱い` の行は既にある）

### 手順・docs

- `skills/conductor/SKILL.md`
  - Step 0: 確認の文面に「事後同意: {asks の deferredConsent}」の行を足す。有効なら、上限を超える受け入れは最後のビルドの同意ゲートで一覧にしてユーザーに尋ねること
  - Step 1「待っている問いを尋ねる」: `ask` が `deferred-consent` の待ちは、そのビルドのブランチで `ledger consent-list <build> {cycle} --full` の出力を要約せずに示し、項目ごとの決定を受け取る。再開の `--closes` に待ちの ID と同意の項目の ID を渡す
  - Step 3 gate: 監督の答えが上限を超える申告でも、事後同意が有効で子に置き場があれば launch が受け付け、子に risk を積ませる（拒まれたら従来どおり `--escalate`）
  - Step 4: 最後の PR の本文に `ledger pr-section <最後のビルド> {cycle} --all` の出力と、`ledger premises --changed-from {ベースブランチ} --format pr` の出力を貼る
- `skills/conductor/references/headless-protocol.md`: 子の同意ゲート（最後のビルドの子だけ）と、`--closes` の同意の項目の記録の仕方
- `skills/builder/steps/consent.md`: conductor の子では最後のビルドだけ返り、対象はサイクル全体。退けた項目の扱い（reworkFrom は子の中で作り直す、returns は return.md で差し戻す、resumed は deferred-consent の問いとして gate で止まる）
- `docs/workflow/conductor.md`、`CHANGELOG.md` の `[3.0.0]`

## 非機能要件

- **セキュリティ**: 監督が上限を超える受け入れを通せるのは、事後同意が有効で同意ゲートの置き場がある子だけ。その受け入れは最後のビルドの同意ゲートでユーザーが決めるまで PR を完了させない（最後のビルドの pr の accepts がサイクル全体を確かめる）。close-cycle の子は従来どおり拒む
- **エラーハンドリング**: 記録を読めないときは、同意ゲートを手順に入れ、承認と PR の作成を受け付けない（従来と同じ安全側）。ビルドの子で tasklist を読めなければ、最後のビルドとみなす（"last"。同意ゲートを置いて止める向きに倒す。"deferred" に倒すと決定の無い項目で PR を通してしまう）
- **マージ時点のデータ安全**: 本番データに触れない（Hikyaku のワークフローの記録の読み方の変更）。既存の decisions.jsonl・progress.jsonl・tasklist.md の形は変えない。子でないセッションの挙動は変わらない

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 380k |
| builderフェーズ段階 | 400k |

**読むファイル**

- `design/design-delta.md` の 3節・4節、build-07 の plan.md の付録・handoff.md、issue.md
- `scripts/lib/steps/consent.mts`（346行）、`scripts/lib/deferred-consent.mts`（167行）、`scripts/lib/ledger.mts`（同意と答えの部分）
- `scripts/commands/ledger.mts`（object --defer・consent-list・pr-section・return-draft）、`scripts/commands/conductor.mts`（asks・launch・childStep・checkSupervisorAnswer）、`scripts/lib/conductor.mts`（固定文）
- `scripts/lib/steps/architect.mts`（G3・G4 の deferred）、`scripts/lib/tasklist.mts`、`scripts/lib/steps/locate.mts`
- `skills/conductor/SKILL.md`（Step 0/1/3/4）、`skills/builder/steps/consent.md`
- 実装時: `tests/step-consent.test.mts`・`tests/conductor.test.mts`・`tests/ledger.test.mts` の該当部分、`skills/conductor/references/headless-protocol.md`・`docs/workflow/conductor.md`・`skills/builder/references/return.md` の該当節、`CHANGELOG.md` の `[3.0.0]`

**作成・変更するファイル**

- `scripts/lib/steps/consent.mts`（約90行の変更）、`scripts/lib/ledger.mts`（約15行）、`scripts/lib/deferred-consent.mts`（約10行）
- `scripts/commands/ledger.mts`（約60行）、`scripts/commands/conductor.mts`・`scripts/lib/conductor.mts`（約85行）
- `skills/conductor/SKILL.md`・`references/headless-protocol.md`・`skills/builder/steps/consent.md`・`docs/workflow/conductor.md`・`CHANGELOG.md`（約100行）
- `tests/step-consent.test.mts`・`tests/ledger.test.mts`・`tests/conductor.test.mts`（約300行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 60k | — |
| 読み込み | 190k | plan までに読んだ分（約130k: issue・design-delta・build-07 の plan 付録と handoff・consent.mts・deferred-consent.mts・ledger.mts の同意と答えの部分・commands/ledger.mts の object/consent-list/pr-section・commands/conductor.mts の asks/launch/childStep/checkSupervisorAnswer・lib/conductor.mts の固定文・architect.mts の G3/G4・tasklist.mts・locate.mts・conductor SKILL.md の Step 0/1/3/4・builder consent.md）に、実装時に読む tests/step-consent.test.mts・tests/conductor.test.mts・tests/ledger.test.mts の該当部分、headless-protocol.md・docs/workflow/conductor.md・return.md の該当節、CHANGELOG の [3.0.0]（約60k） |
| 実装 | 55k | consent.mts の conductorConsentMode・isLastBuild・consentTargets と slot/when/accepts/reopens/args の切り替え（約90行）、ledger.mts の cycleConsentItems（約15行）、commands/ledger.mts の consent-list・pr-section --all・出どころの表示・return-draft（約60行）、deferred-consent の子の行の削除、conductor launch の --closes の拡張と checkSupervisorAnswer の事後同意の分岐・固定文（約70行）、asks の deferredConsent（約15行）、SKILL.md Step 0/1/4・consent.md・headless-protocol・docs・CHANGELOG（約100行） |
| テスト | 55k | step-consent.test.mts（最後以外の子が止まらない・最後のビルドのゲートとサイクル全体の対象・close-cycle の子・--defer の緩和・architect の子の G3/G4 の deferred）、ledger.test.mts（pr-section --all と出どころ・consent-list の対象）、conductor.test.mts（asks の deferredConsent・launch の事後同意の分岐と --closes の同意の項目） |
| 未知の領域 | 40k | 既存の結合テストの期待値の調整（子では事後同意が無効・ゲートが入らない前提のテスト）、循環 import の初期化順、positionOnly での最後のビルドの評価、検証と修正のループ |
| **予測ピーク** | **400k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `ledger.mts` に `cycleConsentItems`、`consent.mts` に `isLastBuild`・`conductorConsentMode`・`consentTargets` を足し、`consentStep` の slot・when・accepts・reopens・args と `consentGateSlot` を切り替える
- [ ] Step 2: `deferred-consent.mts` の子の無効化を消す
- [ ] Step 3: `ledger consent-list`・`pr-section`（`--all`・出どころ）・`return-draft` を `consentTargets` に寄せる
- [ ] Step 4: `conductor asks` の `deferredConsent`、`conductor launch` の `--closes` の同意の項目と `checkSupervisorAnswer` の事後同意の分岐（`deferredRiskMessage`）
- [ ] Step 5: テスト（step-consent・ledger・conductor）
- [ ] Step 6: SKILL.md・headless-protocol・consent.md・docs・CHANGELOG
- [ ] Step 7: ローカル検証（`npx tsc --noEmit`・`npm test`。`conductor lint`・`step lint` は npm test の結合テストで確かめる）
