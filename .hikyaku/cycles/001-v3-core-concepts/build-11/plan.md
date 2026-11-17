# Build 11: G10 の同意と確認の区分、基準を消す経路と指標の比較

## 依存パッケージ

なし（実行時依存ゼロのまま）

## クラス設計

### 設定（`scripts/lib/config.mts`）

- `Gates.promotion: boolean`（キー `promotion_gate`。express だけ false、ほかは true）。G10 の確認のオン・オフで、同意の回には効かない
- `ResolvedConfig.metrics: { window: number }`（`[metrics] window`、既定 2、正の整数）。サイクル設定でも上書きできる（比べる範囲で、上限を緩める宣言ではない）
- `readMetricsConfig(table)`。不正な値は `HikyakuError`

### 同意が要る変更の判定（`scripts/lib/promotions.mts`）

- `CONSENT_TARGETS = ["decisions", "constraints"]`
- `candidateApproval(candidate): "consent" | "confirm"` — 宛先が `decisions`・`constraints` なら同意
- `isStatusOnlyChange(before: string, after: string): boolean` — frontmatter の `status: accepted` を `status: implemented` に変えただけ（それ以外の行が一致）か
- `cycleAdrNames(cycleDirectory): Set<string>` — このサイクルの ADR。サイクルのディレクトリの `.md`（design/・tasklist.md・build-NN/issue.md など）にファイル名（`20261116-xxx.md` か拡張子なし）が現れる ADR。現れない ADR の書き換えは、状態だけでも同意にする（安全側）
- `consentChanges(input: { candidates: Candidate[]; changes: DocChange[]; cycleAdrs: Set<string> }): ConsentChange[]` — **同意が要る変更の判定の唯一の関数**
  - `DocChange = { path: string; doc: "decisions" | "constraints"; status: "A" | "M" | "D"; before?: string; after?: string }`
  - `ConsentChange = { source: "candidate" | "diff"; doc; text: string }`
  - 候補: 宛先が `decisions`・`constraints` の候補はすべて同意（候補の時点では書き換えの中身が分からないので、同意の側に倒す）
  - 差分: `decisions` の `M` で、このサイクルの ADR（`cycleAdrNames`）かつ `isStatusOnlyChange` を満たすものだけを除き、追加・削除・本文の変更・`superseded` への書き換えは同意
- `docChanges(config, cycleDirectory): DocChange[] | string`（同期。`gitSync`）— 作業ツリーにある `decisions`・`constraints` の変更
  - 所在は作業ツリーの `loadGuide` の `decisions`・`constraints` の `path`（`未作成`・`対象外` なら見ない）。`constraints` を新しく作る write は document-guide.md の行も直すので、直した時点で作業ツリーのガイドからパスが引け、新しいファイルが追加（`A`）として同意になる
  - 比べる基準: close-cycle の進捗（`cycles/{cycle}/progress.jsonl`）を最初に足したコミットの親。まだコミットされていなければ `HEAD`。close-cycle が書く前の状態と比べるので、スタック（conductor ブランチ）でも architect が足した ADR を「新しい ADR」と数えない
  - 追跡外の新しいファイル（`git ls-files --others --exclude-standard`）も追加として数える
  - サイクルが closed になったあと（`cycle close` の後）は差分を見ない（候補だけで判定する）。close の PR のマージ後に後続のサイクルが `decisions` を変えても、閉じたサイクルの G10 が戻らないようにする
  - git が使えない・基準を決められないときは理由の文字列を返し、呼び出し側は同意に倒す
- `consentState(ctx): { changes: ConsentChange[]; problem?: string }` は steps 側（下記）で組み立てる

### close-cycle のステップ（`scripts/lib/steps/close-cycle.mts`）

- G10
  - `consent(ctx)`: `consentChanges` が1件でもあるか、差分を確かめられなければ `{ timing: "now", reason }`、無ければ `false`
  - `enabled(ctx)`: `ctx.config.gates.promotion`
  - `args(ctx)`: `consentChanges`（同意が要る変更の一覧）と `returned`（write が始まった後か: G10 を省いた回、または確認として承認した回に、作業ツリーへ同意が要る差分が出た）
  - 確認として承認した回に、後から同意が要る差分が出たら、承認を同意として取り直す: 新しい欄 `StepDefinition.reopens(ctx, event)`（gate だけ）を足し、エンジンは承認の記録があってもこれが理由を返せば pending にする。G10 は「いま同意（`now`）なのに、記録の承認が確認（`event.approval === "confirm"`）」で理由を返す
  - 既存の記録（`approval` 欄の無い承認）は、このビルドの前は G10 が常に同意だったので、同意の承認として扱う
- write
  - `accepts(ctx)`: 同意が要る差分があるのに、G10 の同意の承認（`approval` が `confirm` でない approved の記録）が今回の回に無ければ、理由と「`step next` で G10 へ戻る」を返す
  - G10 へ戻すのはエンジンの評価で行い、`args.reworkFrom` の欄は足さない（AI の解釈。plan の「設計の解釈」）: 差分が出た時点で G10 の `consent` が `now` になり、エンジンが G10 を現在地として返す（G10 が `off` の回は on になり、確認の承認の回は `reopens` で pending になる）。write の `accepts` は、その状態で write の done が報告された場合の守り
  - `args(ctx)`: `promotionGate: "approved" | "skipped"`（G10 を省いた回なら、write が G10.md の「整理」を自分で行い、PR の本文に書いたものを並べる）
- followups
  - `args` に `ruleRemovals`（消す候補。`rules.mts` の `removalCandidates`）と `metricsComparison`（`quality-metrics.mts` の比較の結果）と `g10Input`（G10 の承認の答え。試しに消すものの範囲）を足す
  - `recordsPr: "optional"`: 消す PR を作ったら `--pr` に添える。添えた PR が、後続のサイクルの指標の比較の起点になる
- 承認の種類の記録（`scripts/commands/step.mts`）: gate の `approved` に `approval: "consent" | "confirm"`（その回の `consentOf` が `now` なら consent）を記録する。`ProgressEvent.approval?` を足し、`isEvent` が読む
- `recordsPr?: boolean | "optional"`（エンジン）: `"optional"` は `--pr` を受け付けるが必須にしない

### 消す候補（`scripts/lib/rules.mts`・`scripts/commands/rules.mts`）

- `removalCandidates(input: { measures: RuleMeasure[]; unhelpful: Unhelpful[]; documents: DocumentReader }): RemovalCandidate[]`
  - `RemovalCandidate = { location: string; kind: "stale" | "unreasoned" | "unhelpful"; quote?: string; reasons: RuleReasons; sources: string[]; lastTouchedDays?: number }`
  - `stale`: 一致しない rule（既存の判定）
  - `unreasoned`: frontmatter の `prevents` か `basis` が欠けた rule
  - `unhelpful`: このサイクルの「役に立たなかった記述」に挙がった記述（`rule:<パス>` は rule、それ以外は文書の行。文書の行は引用を含む行を探し、行末の理由を `parseCriterionReasons` で読む）
  - **重要度が高のものは返さない**（rule の `importance: 高`、文書の行の `重要度: 高`）。同じ rule が複数の理由に当たれば1件に束ねる
- 文書の基準のうち理由の欠けた行は、消す候補にしない（AI の解釈。plan の「設計の解釈」）
- `hikyaku rules candidates [<cycle>]` の出力に「消す候補」の節（JSON は `removals`）を足す。サイクルが決まれば、そのサイクルの「役に立たなかった記述」も材料にする
- 消すか・どれを消すかは決めない（候補を並べるだけ）

### 指標の比較（`scripts/lib/quality-metrics.mts`、新規）

- `CycleMetrics = { cycle: string; returns: number; rejected: number; highPitfalls: number; heavyFindings: number }`
  - 差し戻し: `design/progress.jsonl` の architect の `restart`（`round: "return"`）の数
  - `rejected`: サイクルの `decisions.jsonl` の決定のうち `rejected` の数（`readLedger`。読めなければ比較できない理由にする）
  - 重要度が高の落とし穴: `collectPromotions` の候補のうち `[高]` の数
  - 重い指摘: `collectReviewRecords` と `heavyCountByCycle`
- `removalPoints(config, cycles): RemovalPoint[]`
  - closed のサイクルの直下の `progress.jsonl` で、close-cycle の `followups` の done に `pr` があるもの → `{ cycle, pr }`
  - ベースブランチ（`defaultBaseOf`）の `git log --first-parent` で、件名に PR 番号（`#N`。前後が数字でないもの。`#12` と `#123` を取り違えない）を含むコミット（マージ・スカッシュのどちらでも）の日時をマージの時点とする。そのコミットと第1親の差分（`<commit>^1..<commit>`）から、消えた `.claude/rules/` のファイルと、登録された文書（document-guide.md のパス）から消えた箇条書きの行を「消した基準」として並べる。見つからなければ「未マージ」
- `compareMetrics(point, cycles, window): MetricsComparison`
  - 前: マージの日付より前に完了（`finished` < マージの日）した closed のサイクルの直近 `window` 件。後: マージの日以後に開始（`started` ≥ マージの日）したサイクルの先頭 `window` 件（closed か、いま締めているサイクル）。`started ≤ finished` なので前と後は重ならない（マージの日に完了したサイクルはどちらにも入らない）
  - どちらかが `window` に満たなければ `{ comparable: false, reason }`（「比較できない」）
  - 揃えば前後の合計と、悪くなった指標（後 > 前）を返す。戻すかどうかは決めない
- `metricsComparison(config, currentCycle): MetricsComparison[]`（同期。followups の args から呼ぶ。`positionOnly` なら呼ばない）

### 手順・文書

- `skills/close-cycle/steps/G10.md`: 提示を「同意が要る変更（decisions・constraints）」と「確認の変更」に分ける。directive の `consentChanges` を同意の側に必ず並べる。試しに消す候補（`rules candidates` の消す候補）は「試しに消す（別の PR）」として示す。差し戻し（`returned`）の回は、同意が要る差分を示して同意を取り直す
- `skills/close-cycle/steps/collect.md`: `promotions --json` の `approval` と `rules candidates` の消す候補
- `skills/close-cycle/steps/write.md`: G10 を省いた回（`promotionGate: skipped`）の扱い。同意が要る変更を書くと `write` が受け付けられず G10 へ戻ること。試しに消す基準は close の PR で消さない
- `skills/close-cycle/steps/followups.md`: 「基準を試しに消す（`ruleRemovals`）」の節（`{close のブランチ}-criteria` のブランチ、PR 本文に何を防ぐ基準だったか・指標の比較で戻せること、`--pr` で記録）と、「指標の比較（`metricsComparison`）」の節（完了の案内で示し、悪くなっていれば戻す判断の材料としてユーザーに伝える）
- `skills/close-cycle/steps/hooks.md`: G10 を省いた回はフックを採らない（skipped）
- `scripts/commands/promotions.mts`: 候補ごとに `approval` を JSON に足し、テキストでも印を付ける
- `scripts/lib/conductor.mts`: `CONSENT_WHEN` に G10、ASKS の G10 を `confirm` に、`enabledWhen: gates.promotion`（step-consent のテストが一致を検査）。G10 を `delegate` に書くのは受け付ける（同意の回は `childStep` の `approval` でユーザーに固定される）
- 「G10 は常に同意」を前提にした記述と期待値: `scripts/commands/conductor.mts`・`scripts/commands/config.mts`（G10 の表示）、`skills/conductor/references/headless-protocol.md`・`skills/close-cycle/SKILL.md`・`skills/close-cycle/steps/pr.md`、`docs/workflow/conductor.md`、`tests/conductor.test.mts`・`tests/step-hook.test.mts`・`tests/step-consent.test.mts`
- patch の P2 は同意のまま残す（サイクルに属さない patch の永続ドキュメントの更新で、P2 を区分する判定はこのビルドの範囲外。handoff の「残したこと」に書く）
- `docs/workflow/close.md`・`docs/configuration/profiles.md`（`promotion_gate`、G10 の確認・同意）・`docs/configuration/config-file.md`（`promotion_gate`・`[metrics]`）・`docs/reference/cli.md`（`rules candidates` の消す候補）・CHANGELOG の `[3.0.0]`

## 設計の解釈（G8 で確かめたいこと）

- `args.reworkFrom`（issue.md）の欄は足さない: 戻す先はエンジンが評価で決める（同意が要る差分が出た時点で G10 が現在地になる）ので、write の directive にこの欄が載る状態が起きない。build-06 の退けの `reworkFrom` とは build-06 の側でそろえる
- 差分の基準を「close-cycle の進捗を最初に足したコミットの親」にした（ベースブランチとの merge-base だと、スタックで architect が足した ADR が新しい ADR に見え、`accepted → implemented` だけでも同意になる）。サイクルが closed になった後は差分を見ない
- 「このサイクルの ADR」は、サイクルのディレクトリの文書にファイル名が現れる ADR とする。現れない ADR は状態の書き換えだけでも同意（安全側）
- 消す候補の「理由の欠けた基準」は rule（frontmatter）に限る（**スコープを狭める解釈。G8 で判断を求める**）。文書（AGENTS.md など）の行は理由の欄の導入前に書かれたものが大半で、全行が候補になり読めない量になる。文書の行は「役に立たなかった記述」に挙がったものだけを候補にする。狭めたことは handoff の「残したこと」と PR 本文に残す
- ADR approval-kind の再評価条件「G10 で確認の候補だけを省きたい要望が出たとき」は、`promotion_gate` で省ける（issue・design-delta）ことと食い違う。ずれは ADR の側にあるので、handoff の「永続化すること」に `decisions` 宛てで残し、close-cycle の G10 で同意を取る
- 指標の比較の前後は、cycles.md の日付とマージの日付で分ける（前: 完了 < マージの日、後: 開始 ≥ マージの日）

## 非機能要件

- **エラーハンドリング**: git が使えない・基準を決められないときは、G10 を同意に倒す（安全側）。指標の材料が読めなければ「比較できない」と理由を返し、followups を止めない
- **パフォーマンス**: G10 の `consent` は評価のたびに（Stop フック・step where・conductor parse も含む）`git log`（基準のコミット）・`git diff --name-status`（decisions・constraints のパスだけ）・変わった ADR ごとの `git show` を呼ぶ。位置だけを読む経路で同意に倒すと、手順の位置が `step next` と食い違うので倒さない。サイクルが closed なら git を呼ばない。指標の比較は followups の args だけで、`git log` はベースブランチに1回
- **マージ時点のデータ安全**: 該当なし（ワークスペースの記録は形を変えない。progress.jsonl の `approval` は任意欄の追加で、無い記録は従来どおり読める。既存の G10 の承認は同意として扱うので、進行中の close-cycle が巻き戻らない）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 340k |
| builderフェーズ段階 | 400k |

**読むファイル**

- `design/design-delta.md` の1節（G10）・7節、ADR `approval-kind-in-step-definitions`・`review-records-and-criterion-reasons`、build-01・03・10 の handoff.md（読み済み）
- `scripts/lib/steps/close-cycle.mts`・`engine.mts`（読み済み）、`scripts/commands/step.mts` の報告の節（読み済み）、`scripts/lib/promotions.mts`・`commands/promotions.mts`・`rules.mts`・`commands/rules.mts`・`review-records.mts`（読み済み）
- `scripts/lib/config.mts` の該当節、`scripts/lib/progress.mts`、`scripts/lib/ledger.mts`（readLedger・Ledger の型）、`scripts/lib/git.mts` の gitSync、`scripts/lib/conductor.mts`、`scripts/lib/tokens-history.mts`（collectPeakRecords の型）
- `tests/promotions.test.mts`・`tests/rules.test.mts`・`tests/step-planner-close.test.mts`・`tests/step-consent.test.mts`・`tests/config.test.mts`・`tests/helpers.mts` の書き方
- `skills/close-cycle/steps/G10.md`・`collect.md`・`write.md`・`followups.md`・`hooks.md`（読み済み）、`docs/workflow/close.md`・`docs/configuration/profiles.md`・`config-file.md`・`docs/reference/cli.md` の該当節

**作成するファイル**

- `scripts/lib/quality-metrics.mts`（約 200 行）、`tests/quality-metrics.test.mts`（約 200 行）、`tests/close-consent.test.mts`（約 200 行）
- 変更: config.mts・promotions.mts・commands/promotions.mts・rules.mts・commands/rules.mts・steps/close-cycle.mts・steps/engine.mts・commands/step.mts・progress.mts・conductor.mts、tests/config・rules・step-consent、上記の手順・docs、CHANGELOG.md

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 125k | close-cycle・engine・step report・promotions・rules・review-records・directive は読み済み。config・progress・ledger・git・conductor（lib・commands）・commands/config の該当節、tests の promotions・rules・step-planner-close・step-consent・conductor・step-hook・config・helpers、skills の conductor の headless-protocol・close-cycle の SKILL.md と pr.md、docs の close・profiles・config-file・cli・conductor |
| 実装 | 90k | consentChanges と docChanges（基準コミット・closed 後の打ち切り）・cycleAdrNames、G10 の consent/enabled/reopens/args、write の accepts、エンジンの reopens と recordsPr optional、承認の種類の記録、ASKS の G10 と G10 前提の記述の修正、removalCandidates、quality-metrics.mts 新規（文書の削除行の導出を含む）、手順6本・docs5本・CHANGELOG |
| テスト | 55k | G10 の同意の判定と write の拒否・戻り・closed 後に戻らない（一時リポジトリ）、消す候補の高の除外、指標の比較と比較できない（一時リポジトリのマージコミット）、config、conductor の期待値 |
| 未知の領域 | 40k | git の基準コミットと追跡外ファイルの扱い、マージコミットの第1親との差分と cycles.md の日付の突き合わせ、既存の step・conductor テストの期待値の修正ループ |
| **予測ピーク** | **400k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: config に `promotion_gate`・`[metrics] window`、progress の `approval`、エンジンの `reopens` と `recordsPr: "optional"`、step report の承認の種類の記録
- [ ] Step 2: promotions の `consentChanges`・`docChanges`・`isStatusOnlyChange`、`promotions --json` の `approval`
- [ ] Step 3: close-cycle の G10（consent・enabled・reopens・args）・write（accepts・args）・followups（args・recordsPr）、conductor の ASKS と CONSENT_WHEN
- [ ] Step 4: rules の `removalCandidates` と `rules candidates` の消す候補
- [ ] Step 5: quality-metrics.mts（指標・消した点・比較）
- [ ] Step 6: テスト（G10 の同意の判定と write の拒否・G10 への戻り、消す候補の高の除外、指標の比較と「比較できない」の一時リポジトリの結合テスト、config）
- [ ] Step 7: 手順（G10・collect・write・followups・hooks）・docs・CHANGELOG
- [ ] Step 8: ローカル検証（`npx tsc --noEmit`・`npm test`）
