# Build 15: G3・G4 を宣言の上限で同意にする（害とパスの申告と裏取り） 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 350k | issue.md の内訳 |
| builderフェーズ段階 | 360k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結

**乖離**: −85k（実測 274,636 − builderフェーズ段階 360k。約 −24%）

**乖離の要因**: 固定費を 90k と見たが、開始時の固定分は 59,497 だった（−30k 前後。このサイクルの build-01 の実測約 60k と同じで、ガイドの出発点 80k〜100k はこのリポジトリでは高い）。読み込みを 130k と見たが、plan-review・test-spec の生成・test-spec-review をサブエージェントに、コードレビューを別プロセスに任せ、tests 3本・docs 4本は必要な節だけを読んだので、メインセッションに載った分は少なかった。区切りの目安はどこも超えていない（G8 183,829 / 250,000、レビュー前 224,187 / 400,000）。レビュー前からピークまでの +50k は、コードレビュー2ラウンドの指摘の修正と handoff。

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 標準ガイドの出発点の中央。手順の進行分を含む |
| 読み込み | 130k | 読了: design-delta 1節・ADR 2本・build-02 handoff・risk.mts・engine/directive/architect.mts・step.mts（report）・progress.mts。残り: tests/step-consent・step-architect・risk.test・helpers、lib/conductor.mts の CONSENT_WHEN、rules.mts の splitList、config.mts の AppDeclaration、commands/config.mts の G3・G4 の行、docs 4本の該当節、CHANGELOG [3.0.0] の該当行（plan-review の指摘で 110k→130k） |
| 実装 | 55k | progress の harm/paths、StepDefinition.declaresRisk と notices、step report の検査、reportCommand、architect.mts の G3/G4 consent・args・notices・designChoiceGate、CONSENT_WHEN、commands/config.mts の表示、options/G3/G4.md、docs 4本、CHANGELOG |
| テスト | 50k | G3 の同意化（上限超え・重い領域・申告の欠け・不正な値・宣言なし・incomplete）、G4 の裏取り（申告に無い領域・options スキップ・incomplete）、notices の条件、--harm/--paths の検査、designChoiceGate、既存テストの追随 |
| 未知の領域 | 35k | 一時リポジトリで宣言と design-delta/ADR を置く結合テストの調整、既存の architect の結合テストへの波及 |
| **予測ピーク** | **360k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 274,636 |
| 開始時の固定分 | 59,497 |
| 呼び出し回数 | 130 |
| 出力トークン | 81,751 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | 3.0.0 |
| セッション | 7ec5ef71（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 1（実装 0 / テスト 1） |
| 変更ファイル数 | 19（実装 17 / テスト 2） |
| 追加行数 | 753（実装 305 / テスト 448） |
| 削除行数 | 27 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- conductor の監督から（review-findings の回答の補足）: handoff の「残したこと」に「確度: 要確認」の懸念を残すときは、問題を変える選択肢と、それぞれで失うものを書く（ユーザーが最後の PR で判断しやすいように）

## 永続化すること

- `workflow` [中]: builder がコードレビューの懸念を「確度: 要確認」として handoff の「残したこと」に残し、設計の変更でしか直せないものは、問題を変える選択肢とそれぞれで失うものを併記する（ユーザーが最後の PR で判断する材料にするため）（根拠: build-15 の review-findings で監督から受けた補足）

## 役に立たなかった記述

なし
