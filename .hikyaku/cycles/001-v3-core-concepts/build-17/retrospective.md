# Build 17: 同意ゲートで退けた項目の作り直しの経路 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 320k | issue.md の内訳 |
| builderフェーズ段階 | 345k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結

**乖離**: なし（実測のピーク 310,504 − builderフェーズ段階 345k = −34k。−10% 以内）

**乖離の要因**: なし。読み込みは plan の時点で約 105k 読了と見て、そのとおりだった。コードレビュー2ラウンドの修正（約 +45k）は、テストと未知の領域の見積もりの中に収まった。区切りではどこも目安を超えていない

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 110k | build-06・09 の handoff、design-delta 3・6節、ADR 2件、consent.mts・engine.mts・directive.mts・builder.mts・patch.mts・architect.mts の手順部、ledger.mts の事後同意部、escalation.mts・phase.mts、commands/ledger.mts の後半、step.mts の report・restart 部、templates.md・return.md・consent.md、consent-gate.test.mts・escalation.test.mts（ここまでで約 105k 読了）＋docs の該当節 |
| 実装 | 55k | consent.mts の戻り先（内部スキルの対応を含む）と accepts（約 130 行）、commands/ledger.mts の return-draft（約 80 行）、consent.md 3つ・return.md・templates.md・docs 4ファイル・CHANGELOG |
| テスト | 45k | consent-gate.test.mts に戻り先の単体・CLI（同じ単位の作り直し・前のフェーズ・return-draft→restart）約 220 行 |
| 未知の領域 | 45k | 報告し直しによるやり直しと戻り先の組み合わせ（patch の Draft PR のやり直し、architect の options・design-delta の報告し直しで defers が要る --loses など）、architect の再設計の回の起動 |
| **予測ピーク** | **345k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 310,504 |
| 開始時の固定分 | 59,496 |
| 呼び出し回数 | 122 |
| 出力トークン | 92,949 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | 3.0.0 |
| セッション | 31d65ef1（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 1（実装 0 / テスト 1） |
| 変更ファイル数 | 18（実装 17 / テスト 1） |
| 追加行数 | 785（実装 384 / テスト 401） |
| 削除行数 | 22 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督の補足（このサイクルの環境）: `gh` が使えないので PR の作成は監督が代行する。PR 本文を `.tmp/hikyaku-pr-{phase}.md` に書いて blocked で止まる

## 永続化すること

- `workflow` [中]: Hikyaku 自身のリポジトリで、このサイクルの機能（`ledger` コマンド・同意ゲートなど）を使う手順に来たら、インストール済みのプラグイン（3.0.0）には無いことを前提にする。リポジトリの CLI（`node scripts/hikyaku.mts`）は権限で直接実行できないので、確かめは `npm test` の中で行い、未決事項の記録は handoff.md の「残したこと」に文章で書く（根拠: build-06・build-17 とも、`ledger open` が「不明なコマンド」で失敗し、リポジトリの CLI の直接の実行が拒否された）
- `conventions` [中]: テストやコマンドで `scripts/lib/steps/<skill>.mts` を最初に import すると、`steps/index.mts` との循環 import で未初期化の値を読んで落ちる。`ledger.mts` か `steps/index.mts` を先に import する（根拠: build-17 の新しいテストで `ReferenceError: Cannot access 'ARCHITECT_STEPS' before initialization`。handoff と同じ知見）

## 役に立たなかった記述

なし
