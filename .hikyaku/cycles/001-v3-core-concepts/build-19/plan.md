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
 *   "none"     子でない、architect・ビルド以外の子（close-cycle）、または事後同意が有効でないサイクルの子。従来どおり
 *              （子なら同意ゲートを手順に入れず、pr の accepts が決定の無い項目で止めて blocked でユーザーに上げる）
 * "last" と "deferred" は、事後同意が有効（deferredConsent(config, cycle).effective）なサイクルの子だけ。
 * 選んでいない・有効でないサイクルで同意を後ろへ回さない（ADR deferred-consent・原則11。plan-review の指摘）
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
- `checkSupervisorAnswer` の4番目（上限を超える申告）: 次をすべて満たすときだけ受け付け、`defer: true` を返す。どれかが外れれば従来どおり拒む（`--escalate` へ）
  - 事後同意が有効（`deferredConsent(config, cycle).effective`）
  - 子に同意ゲートの置き場がある（位置を確かめられた子の作業単位を子として評価し、`consentGateSlot` が undefined）。位置を確かめられない（`--resume` なし・記録なし）・close-cycle の子・pr を終えた最後のビルドの子は置き場が無い
  - 前提が宣言の参照（`app.*`・宣言にある `area:<name>`）だけ（`ledger object --defer` と同じ検査。共通の関数 `deferrablePremisesProblem(config, premises)` に切り出して両方で使う。宣言を変える PR の `ledger premises` で見直せるようにするため）
- `defer` のとき、launch は環境変数 `HIKYAKU_ANSWER_DEFER=1` を子に渡す（`ANSWER_ENV.defer`）
- **risk の事項はスクリプトが書く**（plan-review の指摘。LLM に開かせない）: 子の `ledger decide --by supervisor` は、`HIKYAKU_ANSWER_DEFER=1` なら
  `--loses`（退けた安全側の案で失う利点）を必須にし、決定と同時に risk の事項（`type: risk`・`who: user`・`when: merge@<unit>`・
  `harm`・`premises` は `HIKYAKU_ANSWER_RISK` から、`ask`・`summary` は事項の要約と監督の答え・`token`）を同じ作業単位の記録に書く。
  `conductor parse --expect-answer` は token つきの監督の決定を確かめる（既存）ので、決定があれば risk の事項もある。
  子への回答の先頭には、`--loses` が要ることだけを書く固定文（`deferNotice`）を足す
- `ChildAnswer` に `defer: boolean` を足す。`OpenRecord.source` の値に `"supervisor-answer"` を足す（G3・G4 の deferred の判定は `"step-report"` だけを数えるので影響しない）。risk の事項の `ask` は監督の答えの問い、要約は「監督の答え（{ask} / {choice}）で受け入れたリスク: {答えた事項の要約}」

### `conductor asks`

- JSON に `deferredConsent`（`deferredConsent(config, context.directory)` の `{ requested, effective, reason }`）。
  テキストに「事後同意: 有効 / 無効（理由） / 選んでいない」の1行（`問いの扱い` の行は既にある）

### 手順・docs

- `skills/conductor/SKILL.md`
  - Step 0: 確認の文面に「事後同意: {asks の deferredConsent}」の行を足す。有効なら、上限を超える受け入れは最後のビルドの同意ゲートで一覧にしてユーザーに尋ねること
  - Step 1「待っている問いを尋ねる」: `ask` が `deferred-consent` の待ちは、そのビルドのブランチで `ledger consent-list <build> {cycle} --full` の出力を要約せずに示し、項目ごとの決定を受け取る。再開の `--closes` に待ちの ID と同意の項目の ID を渡す
  - Step 3 gate: 監督の答えが上限を超える申告でも、事後同意が有効で子に置き場があれば launch が受け付け、子に risk を積ませる（拒まれたら従来どおり `--escalate`）
  - Step 4: 最後の PR の本文に `ledger pr-section <最後のビルド> {cycle} --all` の出力と、`ledger premises --changed-from {ベースブランチ} --format pr` の出力を貼る。
    `pr-section --all --json` の `undecided` が空でなければ、PR を作らずにユーザーに上げる（最後のビルドの同意ゲートを通らなかった項目の安全網。plan-review の懸念）
- CLI のヘルプ（`conductor launch` の details の `--closes` と上限を超える申告、`ledger pr-section` の usage と details、`ledger consent-list` の details、`ledger decide` の details の `--loses`）と `docs/reference/cli.md` の該当節
- `skills/conductor/references/headless-protocol.md`: 子の同意ゲート（最後のビルドの子だけ）と、`--closes` の同意の項目の記録の仕方
- `skills/builder/steps/consent.md`: conductor の子では最後のビルドだけ返り、対象はサイクル全体。退けた項目の扱い（reworkFrom は子の中で作り直す、returns は return.md で差し戻す、resumed は deferred-consent の問いとして gate で止まる）
- `docs/workflow/conductor.md`、`CHANGELOG.md` の `[3.0.0]`

## 非機能要件

- **セキュリティ**: 監督が上限を超える受け入れを通せるのは、事後同意が有効で同意ゲートの置き場があり、前提が宣言の参照だけの子だけ。その受け入れの risk の事項は監督の決定と同時にスクリプトが書き、最後のビルドの同意ゲートでユーザーが決めるまで PR を完了させない（最後のビルドの pr の accepts がサイクル全体を確かめる）。close-cycle の子は従来どおり拒む
- **受け入れる残り**: 同意の項目ごとの決定の値（consented / rejected など）は、子がユーザーの答えの文面から読み取って記録する。`--by user` を書ける ID は launch の `--closes` で縛るが、値の取り違えは検出しない（監督がユーザーの答えを構造化して渡す形は、このビルドでは足さない。handoff の「残したこと」に書く）
- **エラーハンドリング**: 記録を読めないときは、同意ゲートを手順に入れ、承認と PR の作成を受け付けない（従来と同じ安全側）。ビルドの子で tasklist を読めなければ、最後のビルドとみなす（"last"。同意ゲートを置いて止める向きに倒す。"deferred" に倒すと決定の無い項目で PR を通してしまう）
- **マージ時点のデータ安全**: 本番データに触れない（Hikyaku のワークフローの記録の読み方の変更）。既存の decisions.jsonl・progress.jsonl・tasklist.md の形は変えない。子でないセッションの挙動は変わらない

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 380k |
| builderフェーズ段階 | 450k |

**読むファイル**

- `design/design-delta.md` の 3節・4節、build-07 の plan.md の付録・handoff.md、issue.md
- `scripts/lib/steps/consent.mts`（346行）、`scripts/lib/deferred-consent.mts`（167行）、`scripts/lib/ledger.mts`（同意と答えの部分）
- `scripts/commands/ledger.mts`（object --defer・consent-list・pr-section・return-draft）、`scripts/commands/conductor.mts`（asks・launch・childStep・checkSupervisorAnswer）、`scripts/lib/conductor.mts`（固定文）
- `scripts/lib/steps/architect.mts`（G3・G4 の deferred）、`scripts/lib/tasklist.mts`、`scripts/lib/steps/locate.mts`
- `skills/conductor/SKILL.md`（Step 0/1/3/4）、`skills/builder/steps/consent.md`
- 実装時: `tests/consent-gate.test.mts`・`tests/conductor-answers.test.mts`・`tests/deferred-consent.test.mts`・`tests/deferred-objection.test.mts` の該当部分、`scripts/lib/risk.mts`（`exceedsCeilingFor`・`effectiveDeclaration`）、`skills/conductor/references/headless-protocol.md`・`docs/workflow/conductor.md`・`docs/reference/cli.md`・`skills/builder/references/return.md` の該当節、`CHANGELOG.md` の `[3.0.0]`。build-06・16・17・18 の handoff は、build-07 の plan の付録と handoff が要点を引き継いでいるので読まない

**作成・変更するファイル**

- `scripts/lib/steps/consent.mts`（約90行の変更）、`scripts/lib/ledger.mts`（約15行）、`scripts/lib/deferred-consent.mts`（約10行）
- `scripts/commands/ledger.mts`（約100行）、`scripts/commands/conductor.mts`・`scripts/lib/conductor.mts`（約85行）
- `skills/conductor/SKILL.md`・`references/headless-protocol.md`・`skills/builder/steps/consent.md`・`docs/workflow/conductor.md`・`docs/reference/cli.md`・`CHANGELOG.md`（約120行）
- `tests/consent-gate.test.mts`・`tests/conductor-answers.test.mts`・`tests/deferred-consent.test.mts`・`tests/deferred-objection.test.mts`（約300行の追加と変更）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | ガイドの既定（実測の開始時の固定分は 59k だが、ガイドの 80k〜100k に合わせて 90k） |
| 読み込み | 195k | plan までに読んだ分（約130k）に、実装時に読む tests/consent-gate・conductor-answers・deferred-consent・deferred-objection の該当部分、scripts/lib/risk.mts の該当部分、headless-protocol.md・docs/workflow/conductor.md・docs/reference/cli.md・return.md の該当節、CHANGELOG の [3.0.0]（約65k） |
| 実装 | 65k | consent.mts のモードと切り替え（約100行）、ledger.mts の cycleConsentItems と ChildAnswer.defer（約25行）、commands/ledger.mts の consent-list・pr-section --all・出どころ・return-draft・decide の risk の同時記録と --loses・前提の検査の切り出し（約100行）、deferred-consent の子の行の削除、conductor launch の --closes の拡張と事後同意の分岐（約70行）、asks の deferredConsent、ヘルプ文、SKILL.md・consent.md・headless-protocol・docs（cli.md 含む）・CHANGELOG（約120行） |
| テスト | 60k | consent-gate（最後以外の子が止まらない・無効なら止まる・最後のビルドのサイクル全体・close-cycle の子）、deferred-consent（子で有効・G3/G4 の deferred）、deferred-objection（子の --defer）、ledger（pr-section --all と出どころ）、conductor-answers（asks の deferredConsent・launch の事後同意の分岐と DEFER・decide の risk の同時記録・--closes の同意の項目） |
| 未知の領域 | 40k | 既存の結合テストの期待値の調整、循環 import の初期化順、positionOnly での最後のビルドの評価、検証と修正のループ |
| **予測ピーク** | **450k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [x] Step 1: `ledger.mts` に `cycleConsentItems`、`consent.mts` に `isLastBuild`・`conductorConsentMode`・`consentTargets` を足し、`consentStep` の slot・when・accepts・reopens・args と `consentGateSlot` を切り替える
- [x] Step 2: `deferred-consent.mts` の子の無効化を消す
- [x] Step 3: `ledger consent-list`・`pr-section`（`--all`・出どころ）・`return-draft` を `consentTargets` に寄せる
- [x] Step 4: `conductor asks` の `deferredConsent`、`conductor launch` の `--closes` の同意の項目と `checkSupervisorAnswer` の事後同意の分岐（`deferredRiskMessage`）
- [x] Step 5: テスト（step-consent・ledger・conductor）
- [x] Step 6: SKILL.md・headless-protocol・consent.md・docs・CHANGELOG
- [ ] Step 7: ローカル検証（`npx tsc --noEmit`・`npm test`。`conductor lint`・`step lint` は npm test の結合テストで確かめる）
