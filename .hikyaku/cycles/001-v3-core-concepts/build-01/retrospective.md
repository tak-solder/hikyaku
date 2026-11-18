# Build 01: 承認の種類の基盤（エンジン・G1・conductor の同意） 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 360k | issue.md の内訳 |
| builderフェーズ段階 | 395k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結

**乖離**: 実測 360k − builderフェーズ段階 395k = −35k（約 −9%）。±10% 以内なので、なし

**乖離の要因**: なし（plan のレビューの指摘で読み込みを 100k→130k、未知の領域を 30k→40k に上げた分が、ほぼ余った。test-spec の生成と2つのレビューをサブエージェントに委任したため、メインのセッションに入らなかった。区切りではどれも目安以内で、レビュー前は 306k / 400k だった）

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 130k | engine/directive（約580行）・各スキルの steps 定義と index.mts・lib/commands の conductor・config.mts の Gates/PROFILES/廃止キー/finalize・commands/step.mts と config.mts・テスト（step 系約1,660行・conductor 1,148行・config 216行）・architect の options/adr/pr.md・conductor SKILL.md（443行）と headless-protocol.md・docs の profiles/config-file/workflow の conductor・plan・CHANGELOG [3.0.0]。約 60k は読了済み |
| 実装 | 75k | engine の consent/enabled/isOn、directive の approval、各 gate 定義の when→enabled と consent、architect の designChoiceGate を G3 の on に、Gates.userStories の削除と廃止エラー、ASKS・Handler・固定・resolveAsk の approval と enabled、asks の表示、parse の順序、step lint、conductor SKILL.md 4箇所と headless-protocol、docs 5本、CHANGELOG |
| テスト | 60k | 同意を外せない（G1・express と全ゲート off の再設計回の G3/G4）、express の再設計回の designChoiceGate、directive の approval、廃止キーのエラー、conductor の振り分け（consent 固定・delegate 不可・G6/G8 confirm・approval の上書き）、step lint、human の期待値の書き換え |
| 未知の領域 | 40k | Gates と Handler の型の変更が conductor の CLI 結合テストに波及する修正のループと、when を分けたときに巻き戻る結合テストの調整 |
| **予測ピーク** | **395k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 360,324 |
| 開始時の固定分 | 59,216 |
| 呼び出し回数 | 325 |
| 出力トークン | 111,352 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.325 |
| Hikyaku | 3.0.0 |
| セッション | 310a33c4（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 1（実装 0 / テスト 1） |
| 変更ファイル数 | 28（実装 26 / テスト 2） |
| 追加行数 | 825（実装 314 / テスト 511） |
| 削除行数 | 139 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督から: review の報告前に handoff.md を先に書いたため、`step next` が記録の欠けで stop を返した。review の done を記録してから続けるよう補足を受けた（成果物は手順の順に作る）

## 永続化すること

- `conventions` [高]: directive の args の値の意味や、監督・ゲートの振る舞いを変えたら、`skills/` と `docs/` 全体でその値名・ゲート ID を検索し、前提にしている説明を同じ PR で直す（build-01 で `designChoiceGate` の「false = express」の説明と、close-cycle の pr.md の「G10 は監督が承認」が残り、plan のレビューとコードレビューで見つかった）
- `workflow` [中]: conductor の子では、リポジトリの CLI（`node scripts/hikyaku.mts`）と複合コマンドの実行が許可されない。プラグイン本体の `step lint` / `conductor lint` は `npm test`（`tests/step-consent.test.mts`・`tests/conductor.test.mts`）で確かめる（build-01 の verify で直接の実行が拒否された）

## 役に立たなかった記述

- `AGENTS.md`「Agent Skills」: 無関係（スキルのフロントマターや構成を変えなかった）
- `AGENTS.md`「patch のブランチ名…」: 無関係（patch の作業単位には触れなかった）
