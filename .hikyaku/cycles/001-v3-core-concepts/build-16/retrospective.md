# Build 16: 事後同意の有効の判定と、上限を超える受け入れの積み上げ 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 430k | issue.md の内訳 |
| builderフェーズ段階 | 390k | plan.md の内訳（下表） |

**セッション**: 2セッション（plan・plan-review・分割の検討（build-18 を追加）を 2699a422 で行い、test-spec から先を新しいセッション cf2e5eed で再開した。再開後のセッションは途中でコンテナの再起動を挟んだが、同じセッションで続けた）

**乖離**: なし（選ばれた本体 2699a422 の実測 372,828 − 390k = −17k、−4%）

**乖離の要因**: 計測が本体に選んだのは、plan と分割の検討を行った前のセッション 2699a422（ブランチでの呼び出し 142 回）。builder 段階の予測は test-spec から再開する新しいセッションを対象にしていて、そのセッション cf2e5eed（`--json` の candidates。ブランチでの呼び出し 128 回）のピークは 330,605（−59k、−15%）だった。読み込みを 140k と見たが、test-spec の生成と修正・test-spec-review をサブエージェントに任せ、docs と指示文は該当の節だけを読んだので少なく済んだ。コードレビューは見積もりどおり2ラウンド回り、未知の領域（50k）の範囲に収まった。区切りでの値は G8 で 174,916 / 250,000、実装開始前で 178,866 / 300,000、レビュー前で 274,253 / 400,000 で、どれも目安の内だった

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 100k | 新しいセッションで test-spec から再開する前提。標準ガイドの出発点 90k に、残りの手順の進行分（test-spec・G8・実装・検証・コードレビュー2ラウンド・handoff・retrospective・pr）10k |
| 読み込み | 140k | plan.md・issue.md・design-delta 1節・3節・ADR deferred-consent・approval-kind-in-step-definitions・risk-ceiling-table の該当節、build-02・06・12・15 の handoff、scripts/lib/config.mts（ResolvedConfig・loadConfig・finalize・assertCycleOverridable）・risk.mts（基準の宣言・strictest・effectiveDeclaration）・progress.mts・ledger.mts（OpenRecord・openItem・readUnitLedger）、steps/engine.mts・architect.mts・planner.mts・directive.mts（buildDirective）、commands/step.mts・config.mts、tests/helpers.mts・step-risk-gates.test.mts・config と step-planner-close の該当部分、skills の G1.md・options.md・design-delta.md、docs の config-file・profiles・workflow の plan・architect・reference/cli.md、CHANGELOG の [3.0.0] |
| 実装 | 55k | 新規 lib/deferred-consent.mts（約 200 行）、config.mts の [consent]、progress.mts、step.mts（G1 の記録・defers と --loses・risk の自動記録・help）、engine.mts の defers と lint、architect.mts の G3・G4 の deferred と defers、risk.mts の ceilingAxes、ledger.mts の source 欄、directive の notices、config の出力、指示文 3つ、docs 5つ、CHANGELOG |
| テスト | 45k | tests/deferred-consent.test.mts（一時 Git リポジトリの結合テスト、約 350 行）と既存テストの期待値の修正 |
| 未知の領域 | 50k | step report の報告後の評価の模擬、merge-base のサイクル設定の読み出し、architect.mts の循環 import、npm test の修正ループ、コードレビューの修正ループ（2ラウンド） |
| **予測ピーク** | **390k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 372,828 |
| 開始時の固定分 | 59,497 |
| 呼び出し回数 | 142 |
| 出力トークン | 80,139 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | — |
| セッション | 2699a422（本体。ほか 2 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 2（実装 1 / テスト 1） |
| 変更ファイル数 | 22（実装 20 / テスト 2） |
| 追加行数 | 1,093（実装 518 / テスト 575） |
| 削除行数 | 21 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- コンテナの再起動で実行が途中で止まり、「中断したところから続けてください」と再開の指示を受けた（作業ツリーの未コミットの変更は残っていた）
- 監督の委任された判断として、G8 の承認と、コードレビューの未解決の指摘を「そのまま進める（handoff に残す。1・3 は確度: 要確認）」とする回答を受けた（questions.md）

## 永続化すること

- `workflow` [中]: conductor の子のセッションでは、リポジトリのスクリプト（`node scripts/hikyaku.mts step lint` / `conductor lint`）と `sed -i`・`python3` の書き換えが権限で拒否される。lint は `npm test` の中の同じコマンドの結合テストで確かめ、ファイルの書き換えは Edit で行う。直すなら `[conductor] allowed_tools` に `Bash(node scripts/hikyaku.mts step lint:*)` と `Bash(node scripts/hikyaku.mts conductor lint:*)` を足す（根拠: build-15 の handoff と、このビルドで同じ拒否が起きた。issue.md の受け入れ基準に両 lint が並ぶ）

## 役に立たなかった記述

なし
