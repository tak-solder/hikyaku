# Build 12: G4 と G8 の提示（gate brief） 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 280k | issue.md の内訳 |
| builderフェーズ段階 | 305k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結

**乖離**: なし（実測 298,698 − 予測 305k ≒ −6k、−2%）

**乖離の要因**: なし。plan-review の指摘で読み込みを 60k → 80k、未知の領域を 20k → 30k に見直した値がほぼ当たった。コードレビューが2ラウンドとも指摘を返し、その修正（基準の読み取りの分離・節の読み取り・共通化）がレビュー前（244,333）から約 55k を使っている

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 80k | risk.mts・traceability.mts・steps/architect.mts・design-delta・handoff 2件に加え、config.mts の boundaries 周り・registry.mts と commands/diff.mts・stack.mts の scope・tests/step-risk-gates.test.mts・tests/risk.test.mts・helpers・docs 5件（architect.md・build.md・profiles.md・config-file.md・cli.md）と CHANGELOG の [3.0.0] 節 |
| 実装 | 60k | gate-brief.mts（約 220 行）・commands/gate.mts（約 90 行）・risk.mts の基準の [boundaries] の読み取りと effectiveBoundaries・architect.mts の G4 consent/args/notices・traceability の test-spec 読み取り・G4.md/G8.md/test-spec.md・docs と CHANGELOG |
| テスト | 45k | tests/gate-brief.test.mts（G4 の分類・宣言なし・裏取りと境界の同時表示・G8 の解釈と未対応・番号なし・スキップ・--full の CLI）、step-risk-gates に G4 の外の境界での同意と [boundaries] だけの場合、risk.test.mts に基準の境界との和 |
| 未知の領域 | 30k | steps/index.mts との循環 import（gate-brief.mts を architect.mts から読む）、基準のブランチを用意する一時 Git リポジトリのテスト、touchedPaths と境界の glob の照合の取りこぼし |
| **予測ピーク** | **305k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 298,698 |
| 開始時の固定分 | 59,495 |
| 呼び出し回数 | 123 |
| 出力トークン | 103,346 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | 3.0.0 |
| セッション | cafb370b（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 3（実装 2 / テスト 1） |
| 変更ファイル数 | 21（実装 18 / テスト 3） |
| 追加行数 | 1,057（実装 559 / テスト 498） |
| 削除行数 | 61 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- G8 の委任された判断（監督）: issue.md に無い追加2点（基準の `[boundaries]` との和、基準を読めないときの同意）を、handoff に AI の解釈として残す（最後の PR でユーザーに示すため）
- review-findings の委任された判断（監督）: 残した指摘には、回避策（`git remote set-head origin --auto`）も handoff に書く

## 永続化すること

- `workflow` [中]: conductor の子で `step lint`・`conductor lint` を回せるよう、`[conductor] allowed_tools` に `Bash(node scripts/hikyaku.mts:*)` を足す（根拠: build-02・build-15・build-12 のどれでも、リポジトリのスクリプトを直接実行できず lint を回せなかった。ステップ定義を変えたビルドで lint の確認が抜ける）
- `conventions` [中]: ゲートの同意の条件を変えたら、`scripts/lib/conductor.mts` の `CONSENT_WHEN` と `scripts/commands/config.mts` のゲートの説明行も同じ PR で直す（根拠: build-12 のコードレビュー2回目で、G4 の外との境界の条件がどちらにも抜けていたと指摘された。docs の profiles.md だけ直していた）

## 役に立たなかった記述

なし
