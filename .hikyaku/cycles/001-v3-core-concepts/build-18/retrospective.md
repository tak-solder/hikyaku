# Build 18: 上限を超える異議と、事後同意の同意ゲートの範囲 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 395k | issue.md の内訳 |
| builderフェーズ段階 | 395k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結

**乖離**: 326,178 − 395k = 約 −69k（約 −17%）

**乖離の要因**: 読み込みを 165k と見たが、plan-review で足した読むファイルのうち `steps/hook.mts`・`commands/conductor.mts`・build-04・06 の handoff・既存テスト（consent-rework・step-consent・close-consent・step-hook・ledger）・ADR の全文はほとんど読まずに済んだ（`directiveOf` の変更が呼び手に波及せず、既存テストは `npm test` の結果だけで足りた。−50k 前後）。plan-review・test-spec・test-spec-review をサブエージェントに委任したので、レビューの読み込みはメインに載らなかった。未知の領域 40k のうち、コードレビューの修正ループ（2ラウンド）は約 20k で収まった。区切りではどれも目安を下回った（G8 231k / 250k、実装開始前 231k / 300k、レビュー前 288k / 400k）

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 165k | 読み済み約 80k に、plan-review で足した分: steps/engine.mts（StepDefinition・evaluate）・config.mts（consent）・architect/builder/patch の consentStep の呼び手・commands/step.mts（where）・steps/hook.mts・commands/conductor.mts（parse）・lib/ledger.mts の cycleTimeline・build-04・06 の handoff・tests の consent-rework・step-consent・close-consent・step-hook・ledger の該当部分・skills の consent.md 3つ・directive.mts の OBJECTION_GUIDE・ADR 3つの該当節・docs の workflow の build・patch・architect、configuration の config-file・profiles、reference/cli.md、CHANGELOG の [3.0.0] |
| 実装 | 55k | risk.mts の exceedsCeilingFor、ledger.mts の isHighObjection・exceedsCeiling 欄と3関数の置き換え、commands/ledger.mts の open（merge の拒否）・object の上限との比較と --defer（拒否の4条件と決定の欄を受け付けない検査）、consent.mts の slot と hasConsentItems・consentProblem の案内、directiveOf・buildDirective・currentStep の positionOnly、OBJECTION_GUIDE と consent.md 3つ、help、docs 6つ、CHANGELOG |
| テスト | 45k | tests/deferred-objection.test.mts（一時 Git リポジトリの結合テスト、約 350 行。ledger open の merge の迂回を含む）と既存テスト（consent-gate・objection）の期待値の修正 |
| 未知の領域 | 40k | directiveOf が評価全体に positionOnly を渡す変更の波及（Stop フック・step where・conductor parse・ledger の現在のステップ）、consentDecided の条件の変更の波及、コードレビューの修正ループ |
| **予測ピーク** | **395k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 326,178 |
| 開始時の固定分 | 59,497 |
| 呼び出し回数 | 110 |
| 出力トークン | 92,385 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | 3.0.0 |
| セッション | f58851cf（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 1（実装 0 / テスト 1） |
| 変更ファイル数 | 19（実装 17 / テスト 2） |
| 追加行数 | 721（実装 268 / テスト 453） |
| 削除行数 | 70 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督（conductor）からの補足: `gh` が使えないので PR の作成は監督が代行する（PR 本文を `.tmp/hikyaku-pr-{phase}.md` に書いて blocked で止まる）。ADR を書くときの書式。監督の委任された判断は `build-NN/questions.md` に記録する

## 永続化すること

- `workflow` [中]: 位置だけを読む評価（`directiveOf` の既定）と、事項を記録するコマンドの現在地の評価は分ける。事項の `step` は `step next` と同じ評価で求めないと、位置だけの評価が安全側に入れたゲートが記録に残り、退けの戻り先を誤る（根拠: build-18 のコードレビュー1回目の指摘。issue.md は `currentStep` も positionOnly にそろえると書いていたが、それでは記録が誤った）

## 役に立たなかった記述

なし
