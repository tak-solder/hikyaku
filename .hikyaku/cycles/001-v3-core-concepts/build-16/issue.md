# Build 16: 事後同意の有効の判定と、上限を超える受け入れの積み上げ

分割（builder の plan-review のあと、G6）: 異議の上限との比較と `ledger object --defer`、同意ゲートの範囲の拡張（requested のサイクルでサイクル全体を探す・手順の位置だけを読む経路）は build-18 に移した。

## やること

- サイクル設定限定の `[consent] deferred` を足す。ルートに書いたらエラー（サイクル設定でだけ書けるキーの検査を `loadConfig` のルート側に新設）。有効の判定（`{ requested, effective, reason }`。git を読むので `loadConfig` の中では計算せず、`ResolvedConfig` を鍵にキャッシュする関数と `config --json` の `deferredConsent` で示す）。有効になるのは、`[app]` にマージがユーザーの関門である前提（`merge_gate`。build-02 の `strictest` の論理積の値）が書かれ、基準の宣言を読めない回（`incomplete`）でなく、conductor の子でなく、かつ次のどちらかのときだけ: (a) G1 の承認の記録の値が `true`、(b) merge-base のサイクル設定に `true` がある。(b) は緩める向きの判定なので、デフォルトブランチ（origin/HEAD）と defaultBase（`resolvePrBase` の `defaultBase`）の両方について、読めたすべての ref（`origin/<branch>` とローカル）の merge-base に値があるときだけ成立させる（サイクル設定の `base_branch` の向け直しで有効にしない。読めない基準・Hikyaku のブランチがあれば不成立）。PR のマージ先（`base`）は判定に使わない。有効でなければ理由を `config`・各 directive の `notices` に出し続ける
- planner の G1 の args に、サイクル設定の `[consent] deferred` の値を添え、提示に1行出す（build-04 のプロファイルの行と並べる）。`step report` が G1 の承認の記録（planning/progress.jsonl の任意欄 `deferredConsent`）に値を残す。値は設定からスクリプトが読み、LLM の引数では受け取らない。提示したあとに書き換えた値を承認として残さない（サイクル設定に未コミットの変更がある、または最後のコミットが G1 の直前のステップの完了より後なら `false` を記録する）
- `consent(ctx)` の `deferred`: 同意の部分をマージの前の同意ゲート（build-06）へ遅らせ、その回のゲートは確認として `enabled` で評価する。`deferred` を返せるのは上限を超えるリスクの受け入れだけ（G3 と、build-15 の G4 の裏取りがこれに当たる。G1・G10 の `decisions`・`constraints`・宣言の変更・意図を変える判断・外の前提が要る判断・外との境界の変更・差し戻しからの再設計の回・基準を読めない回・申告の欠けは常に `now`）。G3・G4 の判定は手順の位置だけを読む経路でも同じ結果を返す（位置をずらさない）
- 上限を超える受け入れを `risk` の事項（`who=user`、`when=merge@architect`、`premises`・`loses`）として積む: G3 は options の done、G4 は design-delta の done の報告から `step report` が自動で書き（`--loses` を必須にする。事項の `step` は戻り先の options / design-delta に固定。`--dry-run` では書かない）。G3・G4 が `deferred` になるのは、自動で書いた事項（手書きの `ledger open` は数えない）がその回の done より後にあり、その `premises` がいまの判定の理由（上限を決めた軸、当たった重い領域、G4 ならいまの `undeclaredAreas` の全領域）をすべて覆うときだけ。覆っていなければ `now`
- G4 の判定の順序: 外との境界の変更（build-12）が `now` を返す判定を、申告の裏取りの `deferred` より先に置く（外との境界はユーザーが同意するもので、事後同意に回さない）
- conductor の子の中では、この build の時点では事後同意を有効にしない（安全側。conductor での扱いは build-07）
- `docs/configuration/config-file.md`・`profiles.md` と、`docs/workflow/` の plan・architect、`docs/reference/cli.md`（`step report --loses`）と `step report` の help を直す。CHANGELOG に追記する

## やらないこと

- 異議の上限との比較（US-13.3 の異議の部分）、`ledger object --defer`、`isHighObjection`（build-18）
- 同意ゲートの範囲の拡張（requested のサイクルでサイクル全体から対象を探す、手順の位置だけを読む経路で記録を読まずにゲートを入れる）と `directiveOf` の positionOnly（build-18）
- 同意ゲート・`ledger consent-list` / `pr-section`（build-06）、退けの作り直しの経路（build-17）
- conductor での事後同意（最後のビルドの子の同意ゲート、最後の PR の本文、Step 0 の表示、監督の答えの上限との比較。build-07）
- 意図を変える判断・外の前提が要る判断の事後同意（スコープ外 Q7）
- マージを機械で止めること（スコープ外 Q18）、マージが関門かを GitHub の設定から確かめること（スコープ外 Q9）

## 対応する受け入れ基準

- US-10.5, US-20.1, US-20.2, US-20.3, US-20.4

## 受け入れ基準

- [ ] ルートに `[consent]` を書くとエラー。前提の宣言が無いとき・基準の宣言を読めないときは有効にならず、理由が示される
- [ ] G1 の承認の後に作業中のブランチで `[consent] deferred` を足しても有効にならない。スタックした前フェーズのブランチや conductor ブランチに入っているだけでも、サイクル設定の `base_branch` を向け直しても有効にならない。G1 で提示して承認された値か、ベースブランチにマージされた値なら有効になる（一時リポジトリの結合テスト）
- [ ] 事後同意が有効なサイクルで、上限を超える受け入れ（G3・G4）が止まらずに `risk` の事項として積まれ、build-06 の同意ゲートの一覧に載る
- [ ] architecture-review で設計の文書が変わり、事項に無い重い領域に触れたら G4 は `now` に戻る
- [ ] 事後同意が有効でも、G1、G10 の `decisions`・`constraints` の変更、外との境界の変更、差し戻しからの再設計の回、基準を読めない回は `now` のまま
- [ ] 事後同意が有効で G3・G4 が deferred になる回に、手順の位置だけを読む経路（`step where`）と `step next` の現在のステップが一致する
- [ ] conductor の子では事後同意が有効にならない（この build の時点）
- [ ] `conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「3. 事後同意」と「1. 承認の種類と上限」（`deferred` の意味の項、上限はユーザーがマージした宣言で決める項）
- `decisions` の `20261116-deferred-consent.md` — キー・有効の判定がこの判断に従う
- `decisions` の `20261116-approval-kind-in-step-definitions.md` — `deferred` の評価がこの判断に従う
- `decisions` の `20261116-risk-ceiling-table.md` — 上限と基準の宣言（merge-base）の読み方
- build-06 の `plan.md` の「有効の判定」「同意の判定」「ledger」— plan-review の指摘を反映した設計の下書き（分割前に作った）

## 予測ピーク

分割の検討までに、このセッションで plan と plan-review を終えている（実測 約 290k）。残りの範囲をこのセッションで続ける前提で見積もった。

読むファイル: 読み済み — design-delta 1節・3節、ADR、依存ビルドの handoff、build-06 の分割前の plan.md、`scripts/lib/steps/architect.mts`・`engine.mts`・`consent.mts`・`planner.mts`・`directive.mts`・`locate.mts`、`scripts/commands/step.mts`・`ledger.mts`・`config.mts`、`scripts/lib/ledger.mts`・`progress.mts`・`risk.mts`・`config.mts`、`tests/helpers.mts`・`step-risk-gates.test.mts`、`skills/planner/steps/G1.md`・`skills/architect/steps/options.md`・`design-delta.md`、docs の config-file・profiles。残り — tests の config・step-planner-close の該当部分、docs の workflow の plan・architect、`docs/reference/cli.md`、CHANGELOG の `[3.0.0]`
作成するファイル: `scripts/lib/deferred-consent.mts`、`tests/deferred-consent.test.mts`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 標準ガイドの出発点 80k〜100k の中央（分割前のセッションで計測した開始時の固定分 59k に手順の進行分） |
| 読み込み | 215k | 分割の検討までの実測 約 200k（design-delta 1・3節、ADR、依存ビルドの handoff、build-06 の分割前の plan、steps と commands と lib の該当ファイル）に、残り約 15k（tests の config・step-planner-close の該当部分、docs の workflow の plan・architect・reference/cli.md、CHANGELOG の [3.0.0]） |
| 実装 | 55k | 新規 lib/deferred-consent.mts（約 200 行）、config.mts の [consent]、progress.mts、step.mts（G1 の記録・defers と --loses・risk の自動記録・help）、engine.mts の defers と lint、architect.mts の G3・G4 の deferred と defers、risk.mts の ceilingAxes、ledger.mts の source 欄、directive の notices、config の出力、指示文 3つ、docs 5つ、CHANGELOG |
| テスト | 45k | tests/deferred-consent.test.mts（一時 Git リポジトリの結合テスト、約 350 行）と既存テストの期待値の修正 |
| 未知の領域 | 30k | step report の報告後の評価の模擬、merge-base のサイクル設定の読み出し、architect.mts の循環 import、npm test の修正ループ |
| **予測ピーク** | **435k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
