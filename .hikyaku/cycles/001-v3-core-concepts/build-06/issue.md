# Build 06: 事後同意（PR を作る直前の同意ゲート）

## やること

- `scripts/lib/steps/consent.mts` の `consentStep(skill)` で、architect・builder は `pr` の直前、patch は `publish` の直前に同意ゲート（`（ask: deferred-consent）`、ユーザーに固定。consent は常に `now`）を置く。対象は、`type` が `risk` か `objection` で `who=user`・`when=merge@<その作業単位>` の事項（記録した作業単位は問わない）
- 同意ゲートの `when`: サイクルに属し、その作業単位の decisions.jsonl に対象があるとき（サイクルに属さない patch は外す）。手順の位置だけを読む経路（Stop フック・step where・conductor parse）でも、その作業単位のファイル1つだけを読む（build-04 の delegation のきっかけと同じ種類の例外。読めなければ手順に入れる＝安全側）。ほかの作業単位で記録した `when=merge@<この単位>` の事項は、`pr` の `accepts`（報告の時だけサイクル全体を読む）が止める。requested のサイクルで全体を読むように広げるのは build-16
- `accepts`（gate の approved にも効かせる）は、一覧の全項目にユーザーの決定（consented / decided / resolved）があること。最新の決定が `rejected` の項目があれば承認を受け付けない（作り直しの経路は build-17。それまでは、ユーザーが作り直しを済ませて `resolved` を記録するまで進まない＝安全側）。`pr`（patch は `publish`）の `accepts` にも同じ検査を付ける
- conductor の子では、この build の時点では同意ゲートを手順に入れない（ユーザーに固定の問いで子が止まるのを避ける。conductor での扱いは build-07）。ただし `pr`（patch は `publish`）の `accepts` の検査は外さない。決定の無い項目があれば PR は完了せず、子は blocked でユーザーに上がる（安全側の根拠はこの検査）
- `ledger consent-list <phase>`（1項目を「受け入れたリスク / 拠り所の前提 / 失うもの」の3行に収め、`--full` で全文）と `ledger pr-section <phase>`（「受け入れたリスク（事後同意）」「未解決の退け」「マージの前に決める事項」（`when=merge@<単位>` の question・provisional で未決）「期限を過ぎた事項」の節。どれも無ければ空）を足す。各 pr.md（planner・architect・builder・close-cycle、patch は publish.md）でその出力を本文に貼る
- ASKS とタグを同期する。`skills/{architect,builder,patch}/steps/consent.md` を新設する。各フェーズの docs（workflow）・`docs/reference/cli.md` を直す。CHANGELOG に追記する

## やらないこと

- 退けの作り直しの経路（`args.reworkFrom`・退けによる return.md と `ledger return-draft`・テンプレートの「退けた項目」。build-17）
- `[consent] deferred` のキーと有効の判定、G1 の提示と記録、G3・G4 の `deferred` と `risk` の事項の自動記録、`ledger object --defer`、異議の害と上限の比較（build-16）
- conductor での事後同意（最後のビルドの子の同意ゲート、最後の PR の本文、Step 0 の表示。build-07）
- 意図を変える判断・外の前提が要る判断の事後同意（スコープ外 Q7）
- マージを機械で止めること（スコープ外 Q18）、マージが関門かを GitHub の設定から確かめること（スコープ外 Q9）

## 対応する受け入れ基準

- US-19.5, US-19.6, US-20.5, US-20.7, US-20.8, US-20.10（`cycle status` の表示は build-03 で入っている。PR 本文の節をこの build で足す）

## 受け入れ基準

- [ ] `when=merge@<単位>` の `risk`・`objection`（`who=user`）の事項があると、PR を作る直前に同意ゲートが現れ、`ledger consent-list` の一覧（1項目3行、`--full` で全文）で示される。事項が無ければ現れない
- [ ] 一覧の全項目にユーザーの決定が無ければ（最新が rejected のままの項目を含む）、同意ゲートも pr も完了にならない
- [ ] `ledger pr-section` が「受け入れたリスク（事後同意）」の一覧と、マージの前に決める事項と、期限を過ぎて決定の無い事項の節を出し、未解決の退けも出し続ける
- [ ] conductor の子では同意ゲートが現れないが、決定の無い項目があれば pr は完了にならない（この build の時点）
- [ ] `conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「3. 事後同意」と「2. 未決事項と決定の記録」（`pr-section`・期限の判定）
- `decisions` の `20261116-deferred-consent.md` — 同意ゲート・一覧がこの判断に従う
- `decisions` の `20261116-pending-items-ledger.md` — 事項と決定の記録、期限の判定（`timingOf`）

## 予測ピーク

読むファイル: `scripts/lib/steps/engine.mts`・`architect.mts`・`builder.mts`・`patch.mts`・`planner.mts`・`publication.mts`・`directive.mts`・`locate.mts`、`scripts/lib/ledger.mts`、`scripts/commands/ledger.mts`・`step.mts`、`scripts/lib/conductor.mts`、各スキルの `steps/pr.md`・`publish.md`、`tests/helpers.mts`・`objection.test.mts`、手順の並びを確かめる既存テスト、`docs/workflow/` の各フェーズ・`docs/reference/cli.md`・CHANGELOG
作成・変更するファイル: `scripts/lib/steps/consent.mts`（新規）、`skills/architect/steps/consent.md`・`skills/builder/steps/consent.md`・`skills/patch/steps/consent.md`（新規）、`scripts/lib/ledger.mts`、`scripts/commands/ledger.mts`・`step.mts`、steps 定義 3 つ、pr.md・publish.md、`tests/consent-gate.test.mts`（新規）、docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 100k | このセッションの開始時の実測 59k に、手順の進行分（plan・2回のレビュー・分割の検討・G6・G8 の提示） |
| 読み込み | 205k | このセッションの見積もり時点の実測 274k のうち、固定費を除く読み込み約 175k（engine・architect・builder・patch・planner・directive・ledger lib/cmd・step.mts・config.mts・risk.mts・依存ビルドの handoff・ADR・2回のレビュー結果）に、残り: conductor.mts の ASKS・locate.mts・各 pr.md と publish.md・tests の helpers と手順の並びを確かめる既存テスト・docs/workflow の各フェーズ・reference/cli.md・CHANGELOG（約 30k） |
| 実装 | 55k | 新規 steps/consent.mts（約 100 行）、lib/ledger.mts（同意の対象）、architect・builder・patch の steps 定義と pr の accepts、step.mts（gate の approved で accepts）、commands/ledger.mts（consent-list・pr-section、約 150 行）、consent.md 3つ・pr.md 5つ・docs・CHANGELOG |
| テスト | 45k | tests/consent-gate.test.mts（一時 Git リポジトリ。同意ゲートの出現と accepts、conductor の子、pr-section の4節、約 300 行）と、手順の並びを確かめる既存テストの修正 |
| 未知の領域 | 30k | steps/consent.mts → ledger.mts → steps/index.mts の循環 import、npm test の修正ループ |
| **予測ピーク** | **435k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

builder の plan で 570k と見積もり直したため、build-manager で分割した（有効の判定と上限を超える受け入れの積み上げを build-16、退けの作り直しの経路を build-17 へ移した）。
