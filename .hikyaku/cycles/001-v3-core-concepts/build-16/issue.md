# Build 16: 事後同意の有効の判定と、上限を超える受け入れの積み上げ

## やること

- サイクル設定限定の `[consent] deferred` を足す。ルートに書いたらエラー（サイクル設定でだけ書けるキーの検査を `loadConfig` のルート側に新設）。有効の判定（`{ requested, effective, reason }`。git を読むので `loadConfig` の中では計算せず、`ResolvedConfig` を鍵にキャッシュする関数と `config --json` の `deferredConsent` で示す）。有効になるのは、`[app]` にマージがユーザーの関門である前提（`merge_gate`。build-02 の `strictest` の論理積の値）が書かれ、conductor の子でなく、かつ次のどちらかのときだけ: (a) G1 の承認の記録の値が `true`、(b) merge-base のサイクル設定に `true` がある。(b) は緩める向きの判定なので、デフォルトブランチ（origin/HEAD）と defaultBase（`resolvePrBase` の `defaultBase`）の両方について、読めたすべての ref（`origin/<branch>` とローカル）の merge-base に値があるときだけ成立させる（サイクル設定の `base_branch` の向け直しで有効にしない。読めない基準・Hikyaku のブランチがあれば不成立）。PR のマージ先（`base`）は判定に使わない。有効でなければ理由を `config`・各 directive の `notices` に出し続ける
- planner の G1 の args に、サイクル設定の `[consent] deferred` の値を添え、提示に1行出す（build-04 のプロファイルの行と並べる）。`step report` が G1 の承認の記録（planning/progress.jsonl の任意欄 `deferredConsent`）に値を残す。値は設定からスクリプトが読み、LLM の引数では受け取らない。提示したあとに書き換えた値を承認として残さない（サイクル設定に未コミットの変更がある、または最後のコミットが G1 の直前のステップの完了より後なら `false` を記録する）
- `consent(ctx)` の `deferred`: 同意の部分をマージの前の同意ゲート（build-06）へ遅らせ、その回のゲートは確認として `enabled` で評価する。`deferred` を返せるのは上限を超えるリスクの受け入れだけ（G3 と、build-15 の G4 の裏取りがこれに当たる。G1・G10 の `decisions`・`constraints`・宣言の変更・意図を変える判断・外の前提が要る判断・外との境界の変更・差し戻しからの再設計の回・基準を読めない回・申告の欠けは常に `now`）
- 上限を超える受け入れを `risk` の事項（`who=user`、`when=merge@architect`、`premises`・`loses`）として積む: G3 は options の done、G4 は design-delta の done の報告から `step report` が自動で書き（`--loses` を必須にする。事項の `step` は戻り先の options / design-delta に固定。`--dry-run` では書かない）。G3・G4 が `deferred` になるのは、自動で書いた事項（手書きの `ledger open` は数えない）がその回の done より後にあり、その `premises` がいまの判定の理由（上限を決めた軸、当たった重い領域、G4 ならいまの `undeclaredAreas` の全領域）をすべて覆うときだけ。覆っていなければ `now`
- 異議: `ledger object --defer` は、根拠が `app.*` / `area:*` のときだけ、`objection` の事項を `when=merge@<unit>`・決定なしで記録する（build-06 の同意ゲートの一覧に載る。build-04 の `unacceptedObjections` は、`when` が `merge@…` の異議を数えない）。事後同意が無効、上限を超えない、記録する作業単位の今の回に同意ゲートの置き場が無い（plan / close / create、architect の差し戻しからの再設計の回）なら拒む。異議の害の重さを `risk.mts` の上限と比べ、上限を超える受け入れかを判定する（US-13.3。上限を超えれば、事後同意が無効でも害が中でも `--accepts` と `--premises` を求めるその場の同意にする。上限を超えなければ build-04 のとおり）
- 同意ゲート（build-06）の `when` を広げる: requested のサイクルでは、その作業単位のファイルだけでなくサイクルの記録全体から対象を探す（ほかの作業単位で記録した `when=merge@<この単位>` の事項を、ゲートで示すため）。requested でなければ build-06 のまま。手順の位置だけを読む経路（Stop フック・step where・conductor parse）は、requested のサイクルでは記録を読まずに同意ゲートを手順に入れる（安全側。`step next` が示すゲートを位置だけの経路が見落とさないため）
- G4 の判定の順序: 外との境界の変更（build-12）が `now` を返す判定を、申告の裏取りの `deferred` より先に置く（外との境界はユーザーが同意するもので、事後同意に回さない）
- conductor の子の中では、この build の時点では事後同意を有効にしない（安全側。conductor での扱いは build-07）
- `docs/configuration/config-file.md`・`profiles.md` と、architect・planner の docs を直す。CHANGELOG に追記する

## やらないこと

- 同意ゲート・`ledger consent-list` / `pr-section`（build-06）、退けの作り直しの経路（build-17）
- conductor での事後同意（最後のビルドの子の同意ゲート、最後の PR の本文、Step 0 の表示、監督の答えの上限との比較。build-07）
- 意図を変える判断・外の前提が要る判断の事後同意（スコープ外 Q7）
- マージを機械で止めること（スコープ外 Q18）、マージが関門かを GitHub の設定から確かめること（スコープ外 Q9）

## 対応する受け入れ基準

- US-10.5, US-13.3, US-20.1, US-20.2, US-20.3, US-20.4

## 受け入れ基準

- [ ] ルートに `[consent]` を書くとエラー。前提の宣言が無いときは有効にならず、理由が示される
- [ ] G1 の承認の後に作業中のブランチで `[consent] deferred` を足しても有効にならない。スタックした前フェーズのブランチや conductor ブランチに入っているだけでも、サイクル設定の `base_branch` を向け直しても有効にならない。G1 で提示して承認された値か、ベースブランチにマージされた値なら有効になる（一時リポジトリの結合テスト）
- [ ] 事後同意が有効なサイクルで、上限を超える受け入れ（G3・G4）が止まらずに `risk` の事項として積まれ、build-06 の同意ゲートの一覧に載る
- [ ] 上限を超える異議は、事後同意が無効でも害が中でも、`--accepts`・`--premises` が無ければ拒まれる
- [ ] requested のサイクルで、ほかの作業単位で記録した `when=merge@<この単位>` の事項だけがあるとき、`step next` も手順の位置だけを読む経路も同意ゲートを示す
- [ ] 上限を超えない異議と、根拠が宣言（`app.*` / `area:*`）でない `--defer` は、事後同意の一覧に積まれない
- [ ] architecture-review で設計の文書が変わり、事項に無い重い領域に触れたら G4 は `now` に戻る
- [ ] 事後同意が有効でも、G1、G10 の `decisions`・`constraints` の変更、外との境界の変更、差し戻しからの再設計の回、基準を読めない回は `now` のまま
- [ ] conductor の子では事後同意が有効にならない（この build の時点）
- [ ] `conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「3. 事後同意」と「1. 承認の種類と上限」（`deferred` の意味の項、上限はユーザーがマージした宣言で決める項）
- `decisions` の `20261116-deferred-consent.md` — キー・有効の判定がこの判断に従う
- `decisions` の `20261116-approval-kind-in-step-definitions.md` — `deferred` の評価がこの判断に従う
- `decisions` の `20261116-risk-ceiling-table.md` — 上限と基準の宣言（merge-base）の読み方
- build-06 の `plan.md` の「有効の判定」「同意の判定」「ledger」— plan-review の指摘を反映した設計の下書き（分割前に作った）

## 予測ピーク

読むファイル: `design/design-delta.md` の1節・3節、ADR deferred-consent・approval-kind-in-step-definitions、build-02・build-15・build-06 の handoff、build-06 の plan.md、`scripts/lib/config.mts`（loadConfig・assertCycleOverridable・finalize）、`scripts/lib/risk.mts`（基準の宣言）、`scripts/lib/steps/architect.mts`・`engine.mts`・`planner.mts`・`directive.mts`、`scripts/commands/step.mts`、`scripts/lib/ledger.mts`、`scripts/commands/ledger.mts`、`scripts/lib/progress.mts`、`tests/step-risk-gates.test.mts`・`objection.test.mts`、`docs/configuration/config-file.md`・`profiles.md`、`docs/workflow/` の plan・architect、CHANGELOG、`skills/planner/steps/G1.md`・`skills/architect/steps/options.md`・`design-delta.md`、`scripts/commands/config.mts`、`scripts/lib/stack.mts`（`resolvePrBase`）・`premises.mts`、`scripts/lib/steps/consent.mts`（build-06）、build-12 の G4 の判定
作成・変更するファイル: `scripts/lib/deferred-consent.mts`（新規）、`scripts/lib/config.mts`、`scripts/lib/steps/engine.mts`・`architect.mts`・`planner.mts`・`directive.mts`、`scripts/commands/step.mts`・`ledger.mts`・`config.mts`、`scripts/lib/ledger.mts`、`scripts/lib/steps/consent.mts`（`when` を広げる）、`skills/planner/steps/G1.md`・`skills/architect/steps/options.md`・`design-delta.md`、`tests/deferred-consent.test.mts`（新規）、docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 160k | design-delta 1節・3節、ADR deferred-consent・approval-kind-in-step-definitions・risk-ceiling-table、build-02・build-06・build-12・build-15 の handoff、build-06 の plan.md、config.mts（loadConfig・assertCycleOverridable・finalize）、risk.mts（基準の宣言）、stack.mts・premises.mts、steps/architect.mts・engine.mts・planner.mts・consent.mts・directive.mts、commands/step.mts・ledger.mts・config.mts、lib/ledger.mts、progress.mts、tests/step-risk-gates.test.mts・objection.test.mts、G1.md・options.md・design-delta.md、docs/configuration/config-file.md・profiles.md・workflow の plan と architect、CHANGELOG |
| 実装 | 80k | 新規 lib/deferred-consent.mts（約 180 行）、config.mts の [consent]（サイクル限定・ルートでエラー）、G1 の args と記録、engine の defers と lint、architect の options・design-delta の defers と G3・G4 の deferred、step report の --loses と risk の自動記録、ledger object --defer と上限との比較、consentStep の when の拡張、directive の notices、config の出力、指示文・docs・CHANGELOG |
| テスト | 60k | tests/deferred-consent.test.mts（一時 Git リポジトリの結合テスト。ルートでエラー、G1 の後の追加・スタック元・base_branch の向け直しで有効にならない、merge-base で有効、G3・G4 の deferred と事項の自動記録、--defer の拒否、約 450 行）と objection.test.mts・step-risk-gates.test.mts の期待値の修正 |
| 未知の領域 | 40k | merge-base のサイクル設定の読み出し（基準ごとの ref の論理積）、G1 の提示と報告の値の照合、architect.mts の循環 import（build-15 の申し送り）、npm test の修正ループ |
| **予測ピーク** | **430k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
