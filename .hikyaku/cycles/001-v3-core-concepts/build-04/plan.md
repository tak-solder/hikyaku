# Build 04: 異議と、各フェーズが未決事項を記録する手順

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/ledger.mts`（差分）

- `OpenRecord.basis?: string` — 異議の根拠（食い違う宣言・記録の参照。自由文）。`isRecord` は欄が無くても読む（既存の記録はそのまま読める）
- `export const OBJECTION_DECISIONS: Decision[] = ["consented", "decided"]` — 異議への決定。`consented` は異議を聞いたうえで選択どおりに進める（受け入れる）、`decided` はユーザーが選択を改めた
- `export function unacceptedObjections(ledger: Ledger, unit: string, step: string): LedgerItem[]`
  - その作業単位・そのステップ（`OpenRecord.step`）の、害が高（`harm: "高"`）の `objection` のうち、決定が無いか、最新の決定が「ユーザー（`by: user`）の、`accepts` 付きの `consented`」でも「ユーザーの `decided`」でもないもの
  - 中の異議は対象にしない（記録だけで進む）
- `export function latestOpenAt(unitDirectory: string, matches: (record: OpenRecord) => boolean): string | undefined`
  - その作業単位のディレクトリの `decisions.jsonl` だけを読み、条件に合う事項の最新の `at` を返す
  - 読めなければ `undefined` を返し、例外は投げない。壊れた記録で同意のゲートを黙って消さないよう（plan-review の指摘）、builder の `stop` が `unitLedgerProblem` で先に止まる（コードレビュー1回目の指摘で、空文字を返して倒す形から改めた。以前の承認が新しい衝突のゲートを隠すため）
  - build-03 の「手順の位置だけを読む経路（Stop フック・step where・conductor parse）は記録を読まない」を、この1ファイルに限って改める。design-delta が delegation の判定を未決事項の記録に置いているため。handoff の「永続化すること」に反映する

### `scripts/commands/ledger.mts`（`ledger object` を追加）

```
hikyaku ledger object <phase> [<cycle>] --summary <text> --basis <text> --loses <text> --harm 高|中
  --decision consented|decided --input <ユーザーの答え> [--accepts <text>] [--premises <ref,...>] [--dry-run] [--json]
```

- `open`（`type: objection`・`when: now`・`who: user`・`step` は `ledger open` と同じく自動）と `decide`（`by: user`）を、同じ作業単位のファイルに対で書く
- 害が高で `--decision consented` なら `--accepts` と `--premises` が必須（US-1.4・US-1.5）
- （解釈）害が高でも `--decision decided`（ユーザーが選択を改めた）なら `--accepts` は求めない。受け入れるものが無いため。`--premises` は任意
- `--input` は必須（ユーザーの決定なので）

### `scripts/lib/steps/engine.mts`（割り込みのゲート）

- `StepDefinition.interrupt?: (ctx: StepContext) => string | undefined` — 割り込みのゲート。きっかけの時刻を返す回だけ手順に入り、その時刻より後に承認の記録が無ければ、並びの位置に関わらず現在地になる。並びの完了の判定（前のステップの完了より後か）には加わらない
  - builder の `delegation` に使う。design-conflict は plan・実装・検証・レビューのどこでも起きうるので、並びの中の固定の位置に置くと、承認が後ろのステップの完了をやり直しにしてしまう
- `evaluate`: 割り込みのゲートは並びの評価から外して別に評価し、未承認なら `current` をそれに置き換える。差し戻し（`rejected`）の答えは通常のゲートと同じく `revise` に返す
- `lintApproval`: `interrupt` は gate だけが持てる

### `scripts/lib/steps/builder.mts` / `architect.mts` / `planner.mts`

- builder: 先頭に `{ id: "delegation", kind: "gate", interrupt: 最新の design-conflict の事項の at, consent: now（委任の前提が崩れた出来事のあと）, ask: "delegation" }`
  - 手順（return.md）は「design-conflict を記録 → `step next` → delegation」の順なので、差し戻すときも return.md を書く前に builder の delegation の承認が残る。再設計のあと builder に戻っても、同じ出来事でもう一度は出ない
  - （解釈）差し戻すと、return.md の作成という別の出来事として architect の再設計の回の先頭でもう一度尋ねる（US-14.2 が2つの出来事を挙げているため。1つにまとめない）
- architect: 先頭に `{ id: "delegation", kind: "gate", when: roundOf === "return", consent: now, ask: "delegation" }`。再設計の回の最初のステップなので、通常の並びのゲートで足りる
- planner の G1: `args: (ctx) => ({ profile: ctx.config.profile })`

### `scripts/lib/steps/directive.mts`

- `Directive.objection?: { guide: string[]; pointers: string[]; command: string }` — サイクルに属す作業単位の gate にだけ載せる
  - （解釈）サイクルに属さない patch の P1・P2 には載せない。未決事項の記録はサイクルの中だけで使え（ADR pending-items-ledger・user-stories のスコープ外）、記録できない異議を唱えさせないため
  - `guide`: スクリプトが固定する短い指示（宣言・記録と食い違うときだけ異を唱える／根拠と失うものを示す／好みの違いには唱えない／害の重さは persistence.md の重要度／高ならユーザーが受け入れることを自分の言葉で書くまで承認を報告しない）
  - `pointers`: `hikyaku config` の宣言（`[app]`・`[[app.areas]]`・`[boundaries]`）、document-guide.md の `constraints`・`decisions` のパス（登録されていて未作成・対象外でないもの）、`cycles/{cycle}/tasklist.md`（予測ピーク）、`hikyaku ledger list {cycle}`（受け入れ・決定の記録）
  - `command`: `ledger object` の呼び方
- `renderDirective` に `異議:` の行を足す

### `scripts/commands/step.mts`

- gate の `approved` の報告で、`unacceptedObjections(readLedger(cycle), phase, step)` が空でなければ受け付けない（すべてのゲート。内部スキルの G6 も同じ判定）。記録を読めないときも受け付けない（安全側）

### `scripts/lib/conductor.mts`

- `ASKS` に `{ id: "delegation", category: "consent", where: "architect / builder: 委任の前提が崩れたあと、委任を続けるか" }`。同意の種別なのでユーザーに固定され、`delegate` に書けない

### 指示ファイル

- 新規: `skills/architect/steps/delegation.md`・`skills/builder/steps/delegation.md`（`（ask: delegation）`）
- `ledger open` の差し込み: `skills/planner/steps/user-stories.md`（未回答の質問）、`skills/architect/steps/adr.md`・`design-delta.md`（暫定の設計判断）、`skills/build-manager/steps/G6.md`（G6 での受け入れ）、`skills/builder/steps/handoff.md`・`references/templates.md`（「残したこと」は ID のポインタ）、`skills/builder/steps/review.md`・`pr.md`（「確度: 要確認」は事項にし、PR 本文には ID と要点）、`skills/builder/references/return.md`（design-conflict の記録と delegation）、`skills/patch/steps/persist.md`（サイクルに属す patch）、`skills/close-cycle/steps/collect.md`・`G10.md`（`close` 期限の事項を示して決定を記録）
- 記録する側ごとの「いつ・誰が」と、決めるときの決め手（build-03 の「`--by ai:<phase>` は同じフェーズだけ」に沿う）

| 記録する側 | type | --who | --when | 決めるとき |
|---|---|---|---|---|
| planner（未回答の質問） | question | user | gate:G1 か phase:architect | ユーザーが答えたら `--by user` |
| architect（暫定の設計判断） | provisional | user、または確かめるビルドの `ai:build-NN` | gate:G4・merge@build-NN・phase:build-NN | ユーザーなら `--by user`。`ai:build-NN` はそのビルドが `--by ai:build-NN` で確定する |
| build-manager（G6 での受け入れ） | risk | user | merge | G6 の答えで、すぐに `--by user --decision consented --accepts` |
| builder（残したこと） | question / provisional | user | merge・close・phase:build-NN | ユーザー（G10 で示された答えなど）が `--by user` |
| builder（design-conflict） | question | 対話は user、conductor の子は supervisor | now | 選択肢の答えで、who と同じ決め手かユーザー |
| patch（サイクルに属す） | question / provisional | user | merge か close | `--by user` |
| close-cycle | — | — | — | `close` 期限の事項を G10 で示し、ユーザーの答えを `--by user --input` で記録する。AI の別フェーズの事項も `--by user` で決める（付け替えない） |
| conductor（監督の判断） | provisional | supervisor | now | 同じ回答で `--by supervisor` |
- `skills/planner/steps/G1.md`: プロファイルの確認を1行出す
- `skills/conductor/references/headless-protocol.md`: 監督の判断の記録先を `decisions.jsonl`（`ledger open --who supervisor` と `ledger decide --by supervisor`）に改める
- `skills/builder/SKILL.md` の完了の案内: 「残したこと」へのリンクを、事項の ID に合わせる

## 非機能要件

- **セキュリティ**: 該当なし（ワークフローの手順。アプリケーションのアクセス制御ではない）
- **エラーハンドリング**: `ledger object` の不足は `HikyakuError` で欄名とヒントを返す。高の異議が残るゲートの承認は、事項の ID と `ledger decide` の呼び方を添えて拒む
- **マージ時点のデータ安全**: 本番データに触れない。ワークスペースの既存の記録（progress.jsonl・decisions.jsonl）の形は変えず、`OpenRecord` に任意の欄が増えるだけなので、既存の記録はそのまま読める。builder の `delegation` は design-conflict の事項が無いサイクルでは手順に入らず、architect の `delegation` は再設計の回にだけ入るので、進行中のサイクルの現在地は変わらない

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 365k |
| builderフェーズ段階 | 395k |

**読むファイル**

- `design/design-delta.md` の 1節（委任の前提が崩れた出来事）・2節、ADR `20261116-pending-items-ledger.md`
- `scripts/lib/ledger.mts`・`scripts/commands/ledger.mts`・`scripts/lib/steps/engine.mts`・`directive.mts`・`builder.mts`・`architect.mts`・`planner.mts`・`build-manager.mts`・`close-cycle.mts`・`patch.mts`・`scripts/commands/step.mts`・`scripts/lib/conductor.mts`（ASKS）
- `scripts/lib/steps/locate.mts`（`directiveOf`。evaluate の呼び出し元）・`index.mts`、`scripts/lib/docs.mts`（`loadGuide`）
- 指示ファイル（上の一覧。`skills/builder/steps/review.md`・`pr.md` を含む）と `docs/workflow/` の各フェーズ・`docs/reference/cli.md`
- `tests/ledger.test.mts`・`tests/step-architect.test.mts`・`tests/step-planner-close.test.mts`・`tests/step-consent.test.mts`・`tests/step.test.mts`・`tests/step-hook.test.mts`・`tests/conductor.test.mts` の該当箇所

**作成するファイル**

- `scripts/lib/ledger.mts`（約 +50 行）、`scripts/commands/ledger.mts`（約 +90 行）、`scripts/lib/steps/engine.mts`（約 +40 行）、`directive.mts`（約 +50 行）、`builder.mts`・`architect.mts`・`planner.mts`（各 +10〜20 行）、`scripts/commands/step.mts`（約 +15 行）、`conductor.mts`（+1 行）
- 指示ファイル 2 新規・約 12 変更、docs 約 7 ファイル、`CHANGELOG.md`
- `tests/objection.test.mts`（新規、約 250 行）

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 130k | 読んだ ledger.mts・commands/ledger.mts・engine.mts・directive.mts・commands/step.mts・steps/*.mts・conductor.mts の ASKS・design-delta・ADR・各指示ファイル（約 100k）に、locate.mts・index.mts・docs.mts、builder の review.md・pr.md、docs/workflow の各フェーズ・cli.md、既存テスト（step / step-hook / conductor / step-architect / step-planner-close / ledger）の該当箇所 |
| 実装 | 80k | ledger object と unacceptedObjections・latestOpenAt、engine の割り込みゲート、directive の異議の指示とポインタ、step report の高の異議の検査、architect・builder の delegation、G1 の profile、ASKS、指示文の差し込み約14ファイル、docs 6〜7ファイル、CHANGELOG |
| テスト | 55k | ledger object の CLI、ゲートの承認の拒否、delegation の出現（builder 割り込み・architect 再設計の回・記録が壊れたとき）、G1 の args、directive の異議、resolveAsk、記録する側の指示ファイルと planner・builder の結合テスト。npm test は1回約4分 |
| 未知の領域 | 40k | 全スキルの評価に効く evaluate を変えたことによる既存テストの修正ループ、割り込みゲートと floor・orphans・publication の干渉、ledger と steps の循環 import |
| **予測ピーク** | **395k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [x] Step 1: ledger.mts に `basis`・`OBJECTION_DECISIONS`・`unacceptedObjections`・`latestOpenAt`、commands/ledger.mts に `ledger object`
- [x] Step 2: engine の割り込みのゲートと lint、builder・architect の `delegation`、planner の G1 の args
- [x] Step 3: directive の異議の指示とポインタ、step report の高の異議の検査
- [x] Step 4: ASKS に `delegation`、指示ファイル（delegation 2本と記録する側の差し込み、headless-protocol）
- [x] Step 5: テスト（`tests/objection.test.mts`）
- [x] Step 6: docs（workflow の各フェーズ・cli.md・conductor.md）と CHANGELOG
- [ ] Step 7: `npx tsc --noEmit`・`npm test`（step lint・conductor lint の CLI テストを含む）
