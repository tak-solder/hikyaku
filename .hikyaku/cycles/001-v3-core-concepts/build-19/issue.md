# Build 19: conductor での事後同意（最後のビルドの子の同意ゲートと、最後の PR の一覧）

## やること

- 事後同意（conductor の形）: 最後のビルドの子のときだけ同意ゲートを有効にし、サイクル全体の事項（who=user・when=merge@<どこでも> の risk・objection）を対象にする。最後のビルドは「作業ツリーの tasklist で、このビルド以外の全ビルドの PR 列が埋まっている」で判定する
- conductor の子での事後同意の有効化（build-16 で無効にしていたもの）と、同意ゲートを手順に入れること（build-06 で外していたもの）。監督が子の位置を評価する `childStep` と `consentStep` の評価をそろえる（build-06 の handoff）
- architect・最後以外のビルドの子では、`pr` の `accepts` の対象を最後のビルドの同意ゲートへ回す（`merge@` の事項で止めない）。上限を超える異議の `ledger object --defer` を拒まず、最後のビルドの同意ゲートへ回す（build-18 の「同意ゲートの置き場が無い」拒否を緩める）
- 監督の答えの検査（build-07 の `conductor launch --from supervisor` の検査）に、上限を超える申告を事後同意が有効で、かつ子に同意ゲートの置き場があるとき（`consentGateSlot` と同じ判定。architect・最後以外のビルドの子と、まだゲートの手前にいる最後のビルドの子。close-cycle の子は除く）だけ受け付け、子への回答の先頭に `risk` の事項（`--who user --when merge --premises … --loses …`）を積む固定文を足す分岐を入れる（US-15.4・US-21.1 の監督側。子の事後同意の有効化と同じビルドで入れ、監督と子の判定を割らない）
- 子で事後同意を有効にすると、architect の子の G3・G4 の deferred の判定と step report の自動の積み上げも動き出す（`scripts/lib/steps/architect.mts`）。これは design-delta 3節どおりの挙動として受け入れ、テストで確かめる
- close-cycle の子は従来どおり（最後のビルドの同意ゲートを過ぎたあとなので、pr の `accepts` で止め、`--defer` も拒む）
- 同意ゲートの `when` は build-18 の拡張（requested のサイクルでサイクル全体から対象を探す）の上に、最後のビルドの子の条件を足す。args・reopens・`ledger consent-list` も同じ対象を使う
- 退けた項目（build-17 の handoff の問い）: 同じ単位の作り直し（`reworkFrom`）は子の中で完結、前のフェーズの項目（`returns`）は return.md の経路で最後のビルドから差し戻す、再開後に作り直しが済んだかを尋ねる項目（`resumed`）は `deferred-consent` の問いとして gate を出す（監督は build-07 の `--escalate` で積む）。`skills/builder/steps/consent.md` に書く
- `ledger pr-section --all`（サイクル全体の同意の対象と、全作業単位の `merge@` の question・provisional）と、決定の行への答えの出どころ（build-07 の `from`）の表示
- `skills/conductor/SKILL.md`: Step 1 で `deferred-consent` の待ちに当たったら、そのビルドのブランチで `ledger consent-list <build> {cycle} --full` の出力を要約せずに示し、項目ごとの決定を受け取る。Step 4 で、最後の PR（conductor ブランチ→ベースブランチ）の本文に `ledger pr-section <最後のビルド> {cycle} --all` の出力と、宣言の変更（`ledger premises --changed-from <ベースブランチ>`。conductor ブランチとベースブランチの差分で導く）を載せる
- `conductor asks` の JSON に `deferredConsent`（`{ requested, effective, reason }`）を足し、Step 0 の委任の範囲の確認に事後同意の有効・無効の行を足す
- `skills/conductor/references/headless-protocol.md`・`docs/workflow/conductor.md` を直す。CHANGELOG に追記する

## やらないこと

- ビルドの並行実行
- 監督が記録をコミットすること（最後のビルドの子が同意を取る形にした）
- 監督の答えの検査・答えの出どころ・待ちの導出（build-07）

## 対応する受け入れ基準

- US-15.4, US-20.6, US-20.9, US-21.1

## 受け入れ基準

- [ ] 事後同意のサイクルでは、architect・最後以外のビルドの子は上限を超える受け入れ（merge@ の事項）で止まらず、最後のビルドの同意ゲートで全フェーズの一覧が示される
- [ ] close-cycle の子は、決定の無い同意の項目があれば従来どおり pr で止まる
- [ ] 事後同意が有効なサイクルでは、監督の上限を超える申告を launch が受け付け、子への回答に risk の事項を積む指示が入る（無効なとき、または close-cycle など置き場の無い子では build-07 のとおり拒否）
- [ ] 事後同意が有効なサイクルの architect の子で、G3・G4 が deferred になる
- [ ] 最後の PR の本文の節に、全フェーズで受け入れたリスクと同意・退けの決定（答えの出どころつき）が載る（`pr-section --all` の出力）
- [ ] サイクルの中で宣言を変えていれば、最後の PR の本文に、変わったキーとそれを拠り所にした受け入れが載る
- [ ] Step 0 の表示（`conductor asks`）に事後同意の有効・無効と理由が出る
- [ ] `conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「3. 事後同意」（conductor の項）、「4. conductor の走りきり」（Step 0 の項）
- build-07 の plan.md の「最後のビルドの同意ゲート」「`ledger consent-list` / `ledger pr-section`」「`conductor asks`」の節 — plan-review の指摘（close-cycle の子の扱い・resumed の扱い）を反映済みの下書き
- `decisions` の `20261116-deferred-consent.md` — conductor での同意の取り方と最後の PR の本文がこの判断に従う
- `decisions` の `20261116-conductor-runs-to-end.md` — 同意ゲートの答えも問いを積む経路に乗る

## 予測ピーク

読むファイル: build-07 の plan.md の該当節・handoff、`scripts/lib/steps/consent.mts`、`scripts/lib/ledger.mts`・`scripts/commands/ledger.mts`（同意の部分・consent-list・pr-section）、`scripts/lib/deferred-consent.mts`、`scripts/lib/risk.mts`（該当部分）、`scripts/lib/steps/architect.mts`（G3・G4 の deferred）、`scripts/lib/tasklist.mts`（PR 列）、`scripts/lib/steps/locate.mts`、`scripts/lib/conductor.mts`・`scripts/commands/conductor.mts`（asks・launch の検査・childStep）、`skills/conductor/SKILL.md`・`references/headless-protocol.md`、`docs/workflow/conductor.md`、`skills/builder/steps/consent.md`・`references/return.md`、`tests/step-consent.test.mts`・`tests/ledger.test.mts`・`tests/conductor.test.mts`（該当部分）、build-06・16・17・18 の handoff、ADR deferred-consent
作成・変更するファイル: `scripts/lib/steps/consent.mts`、`scripts/lib/ledger.mts`、`scripts/commands/ledger.mts`、`scripts/lib/deferred-consent.mts`、`scripts/commands/conductor.mts`、`skills/conductor/SKILL.md`・`references/headless-protocol.md`、`skills/builder/steps/consent.md`、`docs/workflow/conductor.md`、`tests/step-consent.test.mts`・`tests/ledger.test.mts`・`tests/conductor.test.mts`、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 145k | build-07 の plan.md の該当節・handoff、consent.mts（346行）・ledger.mts（803行）の同意の部分・commands/ledger.mts（831行）の consent-list・pr-section、deferred-consent.mts（167行）、risk.mts の該当部分、steps/architect.mts（589行）の G3・G4 の deferred の判定、tasklist.mts（325行）の PR 列、steps/locate.mts と commands/conductor.mts の childStep・asks・launch の検査、conductor の SKILL.md（449行）・headless-protocol.md・docs/workflow/conductor.md、builder の consent.md・return.md、tests/step-consent.test.mts（470行）・tests/ledger.test.mts・tests/conductor.test.mts（1278行）の該当部分、build-06・16・17・18 の handoff、ADR deferred-consent |
| 実装 | 55k | consent.mts の conductorConsentMode・isLastBuild・consentTargets（約80行）、ledger の cycleConsentItems・pr-section --all と出どころの表示（約60行）、deferred-consent の子の有効化（約10行）、asks の deferredConsent と launch の事後同意の分岐（約50行）、SKILL.md Step 0/1/4・consent.md・headless-protocol・docs・CHANGELOG（約100行） |
| テスト | 50k | step-consent.test.mts（最後以外の子が止まらない・最後のビルドのゲートとサイクル全体の対象・close-cycle の子は止まる・--defer の緩和・architect の子の G3/G4 の deferred）、ledger.test.mts（pr-section --all）、conductor.test.mts（asks の deferredConsent・launch の事後同意の分岐） |
| 未知の領域 | 40k | 子で事後同意を有効にしたときの architect の子の G3・G4 と、監督の childStep の評価（deferred-consent のキャッシュの鍵 child/self）への影響、循環 import の初期化順、既存の consent の結合テストの調整、resumed の問いの扱い |
| **予測ピーク** | **380k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
