# Build 17: 同意ゲートで退けた項目の作り直しの経路

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/steps/consent.mts`（差分）

- `GATE_REWORK: Record<string, Record<string, string>>` — ゲートで記録した事項の戻り先（architect: G3→options・G4→design-delta、builder: G7・G8→plan、patch: P1→scope）
- `export function reworkStepOf(skill: SkillSteps, step: string | undefined, ctx: StepContext): string`
  - 事項の `step` を、done で報告し直せる戻り先に対応させる
  - ゲートなら `GATE_REWORK` の対応先（手順に入っている run のとき）。無ければそのゲートより前で最も近い、手順に入っている run ステップ
  - run / call で手順に入っていればそのステップ。手順に入っていなければ、それより前で最も近い run ステップ
  - 内部スキル（build-manager・retrospective）のステップ（G6 など）なら、その内部スキルを呼ぶ call ステップ（architect の `build-split`、builder の `split`・`retrospective`）として扱う。call が手順に入っていればそこ、入っていなければそれより前で最も近い run ステップ（plan-review の指摘。G6 の受け入れを退けて G2〜G4 まで取り直さないため）
  - それでも手順に無い（記録なし）か、前に run が無ければ、手順に入っている最初の run ステップ（安全側＝全部やり直す）
  - 手順に入っているかは `isOn` で判定し、評価が投げたら入っているとみなす
  - スキル定義は `stepsOf(skill)`（`./index.mts`）を呼び出し時にだけ引く（循環 import のため、モジュールの評価時には使わない）
- `export interface ConsentRejections { rework: { id: string; step: string }[]; reworked: string[]; returns: string[] }`
- `export function consentRejections(skill: string, items: LedgerItem[], ctx: StepContext): ConsentRejections`
  - 最新の決定が `rejected` の項目を分ける
  - `open.unit === ctx.unit`（同じ作業単位）: 戻り先を、退けの決定（`latest.at`）より後に done で報告し直していれば `reworked`、まだなら `rework`
  - それ以外（前のフェーズ）: `returns`
- `consentProblem(skill)` を改める
  - 決定が足りない項目から `reworked` を除く（同意ゲートの承認と pr / publish の done を受け付ける）
  - 案内を3つに分ける: 決定の無い項目（従来の案内）／作り直していない退け（戻り先を done で報告し直す）／前のフェーズの退け（builder は `references/return.md` の退けからの差し戻し、ほかは記録したフェーズで作り直し、ユーザーが `resolved` を記録するまで受け付けない）
- `consentStep(skill).args` に、作り直しが要る退けがあるときだけ `reworkFrom`（作り直しが要る項目の戻り先のうち手順で最も前のもの）と `rework`（項目ごとの戻り先）、前のフェーズの退けがあるときだけ `returns`（ID）を足す。退けが無ければ `{ items }` のまま

`consentDecided` / `undecidedConsentItems`（ledger.mts）は変えない（build-06 の申し送り）。PR 本文の「未解決の退け」（`ledger pr-section`）と `cycle status` は最新が rejected の事項を出し続けており、作り直しても `resolved` まではそのまま出る。

### `scripts/commands/ledger.mts`（差分）

- `ledger return-draft <phase> [<cycle>] --items <id,...> [--json]`（読み取り専用）
  - `<phase>` は build-NN だけ（return.md は builder が書く）
  - 各 ID が在り、最新の決定が `rejected` で、記録した作業単位が `<phase>` と別（前のフェーズ）であることを確かめる。同じ単位なら `reworkFrom` の経路を案内してエラー
  - 出力: `# 差し戻し: build-NN` / 何が崩れたか / 退けた項目（ID と要約・記録した単位） / 試したこと（退けられた受け入れ・拠り所・失うもの・ユーザーの答え） / 問題を変える選択肢（テンプレートの置き場所） / 推奨（置き場所） / このビルドの状態（置き場所）
  - 選択肢と推奨は置き場所のままなので、下書きのままでは行き詰まりの報告の検査を通らない（LLM が書く）

### 指示文・テンプレート

- `skills/builder/references/templates.md` の return.md に「退けた項目」の節（退けからの差し戻しのときだけ）
- `skills/builder/references/return.md` に「同意ゲートで前のフェーズの判断を退けたとき」の手順（`ledger return-draft` → 選択肢と推奨を書く → handoff.md を削除する → コミット & push → architect を案内）
  - 同意ゲートは handoff・retrospective の後ろにあるので、退けから差し戻す時点で handoff.md はある。完了の印として読まれるので builder が削除する（振り返りの記録は事実の記録なので残す）。`return-draft` の「作り直しが要るもの」にも handoff.md を出す（plan-review の指摘）
- `skills/{architect,builder,patch}/steps/consent.md` に退けたときの戻り方（`args.reworkFrom` のステップを作り直して done で報告し直す／前のフェーズの退け）と、作り直しが済んだとユーザーが認めたら `resolved` を記録できること。どちらも既存の `（ask: deferred-consent）` の中で尋ねる（新しい ask は足さない）
  - patch は P1 の戻り先が `scope` で、Draft PR を作る `pr` もやり直しになる。作り直しの回は既存の Draft PR を使い、本文の合意を直して同じ PR を `--pr` に添えて報告し直す、と patch の consent.md と `steps/pr.md` に書く（plan-review の指摘）
  - architect の `options` / `design-delta` を報告し直すと `defers` が新しい risk の事項を書きうる（`--loses` が要る）。consent.md の戻り方に、報告し直しは各ステップの指示どおりに行う、とだけ書く（既存の挙動）

### docs / CHANGELOG

- `docs/workflow/build.md`・`architect.md`・`patch.md` の同意ゲートの節、`docs/reference/cli.md` の ledger の行に `return-draft`
- `CHANGELOG.md` の `[3.0.0]` 節

## 非機能要件

- **エラーハンドリング**: 戻り先の判定は記録を読むだけで、読めなければ従来どおり受け付けない（安全側）。`return-draft` は書き込まない
- **マージ時点のデータ安全**: 該当なし（Hikyaku のワークフローの記録の読み方と指示文の変更。利用者のリポジトリの既存の記録は形式を変えず、受け付ける条件が「作り直したあと」に広がるだけ）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 320k |
| builderフェーズ段階 | 345k |

**読むファイル**

- build-06・build-09 の handoff、`design/design-delta.md` の「3. 事後同意」「6. 行き詰まりの報告」、ADR deferred-consent・escalation-report-check
- `scripts/lib/steps/consent.mts`・`engine.mts`・`directive.mts`・`builder.mts`・`patch.mts`・`architect.mts`（手順部）・`index.mts`
- `scripts/lib/ledger.mts`（事後同意部）・`escalation.mts`・`phase.mts`
- `scripts/commands/ledger.mts`（後半）・`step.mts`（report・restart 部）
- `skills/builder/references/templates.md`・`return.md`、`skills/*/steps/consent.md`、`skills/patch/steps/pr.md`、`skills/build-manager/steps/G6.md`
- `tests/consent-gate.test.mts`・`escalation.test.mts`、`docs/workflow/build.md`・`architect.md`・`patch.md`・`docs/reference/cli.md`・`CHANGELOG.md` の該当節

**作成するファイル**

- `scripts/lib/steps/consent.mts`（約 +100 行）、`scripts/commands/ledger.mts`（約 +80 行）
- `tests/consent-gate.test.mts`（約 +220 行）
- 指示文 5ファイル、docs 4ファイル、CHANGELOG

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 110k | build-06・09 の handoff、design-delta 3・6節、ADR 2件、consent.mts・engine.mts・directive.mts・builder.mts・patch.mts・architect.mts の手順部、ledger.mts の事後同意部、escalation.mts・phase.mts、commands/ledger.mts の後半、step.mts の report・restart 部、templates.md・return.md・consent.md、consent-gate.test.mts・escalation.test.mts（ここまでで約 105k 読了）＋docs の該当節 |
| 実装 | 55k | consent.mts の戻り先（内部スキルの対応を含む）と accepts（約 130 行）、commands/ledger.mts の return-draft（約 80 行）、consent.md 3つ・return.md・templates.md・docs 4ファイル・CHANGELOG |
| テスト | 45k | consent-gate.test.mts に戻り先の単体・CLI（同じ単位の作り直し・前のフェーズ・return-draft→restart）約 220 行 |
| 未知の領域 | 45k | 報告し直しによるやり直しと戻り先の組み合わせ（patch の Draft PR のやり直し、architect の options・design-delta の報告し直しで defers が要る --loses など）、architect の再設計の回の起動 |
| **予測ピーク** | **345k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [x] Step 1: `consent.mts` に `reworkStepOf`・`consentRejections` を足し、`consentProblem` と同意ゲートの `args` を改める
- [x] Step 2: `ledger return-draft` を足す
- [x] Step 3: テスト（`tests/consent-rework.test.mts`。戻り先の対応・同じ単位の作り直しで承認と pr が通る・前のフェーズは resolved まで止まる・未解決の退けが PR 本文と cycle status に出続ける・return-draft に選択肢と推奨を書けば restart --round return が通る）
- [x] Step 4: 指示文（consent.md 3つ・return.md・templates.md・patch の pr.md）
- [x] Step 5: docs・CHANGELOG
- [x] Step 6: `conductor lint`・`step lint`（`npm test` の中で実行。リポジトリの CLI は権限で直接実行できない）・`npx tsc --noEmit`・`npm test`
