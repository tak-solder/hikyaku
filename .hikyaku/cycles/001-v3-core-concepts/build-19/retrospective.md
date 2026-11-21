# Build 19: conductor での事後同意（最後のビルドの子の同意ゲートと、最後の PR の一覧） 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 380k | issue.md の内訳 |
| builderフェーズ段階 | 450k | plan.md の内訳（下表） |

**セッション**: 2セッション（plan〜G8 のセッションと、implement〜PR のセッション。G8 の時点でコンテキストの目安を超えたため、監督が implement から新しいセッションで続けた）

**乖離**: なし（実装のセッションの実測 416k − 450k = −34k、−8%）

**乖離の要因**: 予測の帯の内。ただし G8 の時点で前のセッションが目安を超えた（289k / 250k）。plan の前に読む量（consent.mts・ledger.mts・conductor.mts の大きなファイル）が多く、plan と test-spec（611行）の作成で膨らんだ。実装のセッションでは、コードレビュー2ラウンドの指摘への対応（約 60k）が未知の領域の見込み（40k）を上回ったが、読み込みが見込み（195k）より少なく相殺した

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | ガイドの既定（実測の開始時の固定分は 59k だが、ガイドの 80k〜100k に合わせて 90k） |
| 読み込み | 195k | plan までに読んだ分（約130k）に、実装時に読む tests/consent-gate・conductor-answers・deferred-consent・deferred-objection の該当部分、scripts/lib/risk.mts の該当部分、headless-protocol.md・docs/workflow/conductor.md・docs/reference/cli.md・return.md の該当節、CHANGELOG の [3.0.0]（約65k） |
| 実装 | 65k | consent.mts のモードと切り替え（約100行）、ledger.mts の cycleConsentItems と ChildAnswer.defer（約25行）、commands/ledger.mts の consent-list・pr-section --all・出どころ・return-draft・decide の risk の同時記録と --loses・前提の検査の切り出し（約100行）、deferred-consent の子の行の削除、conductor launch の --closes の拡張と事後同意の分岐（約70行）、asks の deferredConsent、ヘルプ文、SKILL.md・consent.md・headless-protocol・docs（cli.md 含む）・CHANGELOG（約120行） |
| テスト | 60k | consent-gate（最後以外の子が止まらない・無効なら止まる・最後のビルドのサイクル全体・close-cycle の子）、deferred-consent（子で有効・G3/G4 の deferred）、deferred-objection（子の --defer）、ledger（pr-section --all と出どころ）、conductor-answers（asks の deferredConsent・launch の事後同意の分岐と DEFER・decide の risk の同時記録・--closes の同意の項目） |
| 未知の領域 | 40k | 既存の結合テストの期待値の調整、循環 import の初期化順、positionOnly での最後のビルドの評価、検証と修正のループ |
| **予測ピーク** | **450k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 415,871 |
| 開始時の固定分 | 59,497 |
| 呼び出し回数 | 147 |
| 出力トークン | 129,263 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.327 |
| Hikyaku | 3.0.0 |
| セッション | fa400376（現在のセッション。本体。ほか 2 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 1（実装 0 / テスト 1） |
| 変更ファイル数 | 15（実装 12 / テスト 3） |
| 追加行数 | 1,381（実装 490 / テスト 891） |
| 削除行数 | 113 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督から: 利用上限（429）で止まったあとの再開で、handoff を仕上げてから step next に従って PR まで進めること。PR を作れなければ本文を .tmp/ に書いて blocked で代行を依頼すること（このサイクルの監督の補足どおり）

## 永続化すること

- `upstream`: builder の review.md はレビューを Bash の run_in_background で並列に走らせるよう指示するが、conductor の子（claude -p）では結果を待つ間にターンを終えると Stop フックに引き止められ、プロセスが終わりうる。非対話の子では完了まで待つ方法（前景での待ち合わせ）を示すとよい（build-19 で Stop フックに1回引き止められた）

## 役に立たなかった記述

なし
