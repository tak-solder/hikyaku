# Build 03: 未決事項と決定の記録（ledger の中核） 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 355k | issue.md の内訳 |
| builderフェーズ段階 | 425k | plan.md の内訳（下表。plan-review の指摘を反映して 385k から見積もり直した） |

**セッション**: 完結

**乖離**: なし（実測 383,305 − builder 段階 425k = −41,695。±10% 以内）

**乖離の要因**: 読み込みは過小だった。G8 の時点で実測は約 254k あり、目安（250k）を超えた。plan の作成までに、design-delta・ADR・engine・directive・locate・cycle status を読んだ。そのあとで plan-review と test-spec-review の結果（どちらも長い報告）を読み込み、plan と test-spec を直した。実装とテストは見込みより小さかった。ledger.mts と commands/ledger.mts は一度に書き、テストもほぼ一度で通った。一方で、コードレビューを2回まわし、どちらも8件の指摘を直した。未知の領域（50k）は、主にこのレビュー対応で使った。実装開始前は 258k / 300k、レビュー前は 317k / 400k で、どちらも目安の内だった

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 130k | 読了: progress.mts・directive.mts・locate.mts・engine.mts 冒頭・design-delta・ADR・cycle.mts status・builder steps・navigator の表・build-04〜07 の issue。これから: planner/architect/build-manager/close-cycle/patch/publication の steps 定義・tasklist.mts・cycles.mts・risk.mts（Harm）・hikyaku.mts・engine.mts の回（startOf/currentEvents）・tests/helpers.mts・step.test/cli.test の一部・docs の cli.md・directory-layout.md・CHANGELOG [3.0.0] |
| 実装 | 95k | jsonl.mts（progress から切り出し・parseJsonl）、ledger.mts 新規（約550行: 欄・語彙・前提の参照・参照先の検査・導出・期限）、commands/ledger.mts（約300行）、directive の notices、cycle status の節、navigator の1行、docs 2本と CHANGELOG |
| テスト | 60k | ledger の unit（語彙・付け替え・導出・期限）、CLI 結合（dry-run・decide の置き場・2ブランチのマージで衝突しない・notices・Stop フックで読まない・status --json） |
| 未知の領域 | 50k | plan-review の指摘で増えた判定: 回（事項の at より後だけ）、外れたゲートを過ぎたとする位置の近似、内部スキル G6 の現在地、merge の区切り（consent / publish / pr）とマージの導出、ledger と directive の循環 import の回避 |
| **予測ピーク** | **425k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 383,305 |
| 開始時の固定分 | 59,212 |
| 呼び出し回数 | 136 |
| 出力トークン | 138,119 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.325 |
| Hikyaku | 3.0.0 |
| セッション | 603473f3（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 4（実装 3 / テスト 1） |
| 変更ファイル数 | 13（実装 12 / テスト 1） |
| 追加行数 | 1,578（実装 1,088 / テスト 490） |
| 削除行数 | 33 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- review-findings（監督の委任された判断）の補足: 成果物（handoff.md・questions.md・retrospective.md・コミットメッセージ・PR 本文）と、最後に出すブロックの本文は日本語で書くよう指示された（その前の review-findings の gate の本文を英語で書いていた）

## 永続化すること

- `workflow` [中]: conductor の `allowed_tools` に、リポジトリのスクリプト（`node scripts/hikyaku.mts step lint`・`conductor lint`）を足す。足さないと子のセッションが verify でこの2つを回せず、CI で初めて食い違いが分かる（build-02 と build-03 で同じく回せなかった）
- `upstream`: 非対話規約（headless-protocol）に、gate・done・blocked のブロックの本文と成果物を、ワークスペースの言語（このリポジトリでは日本語）で書くことを明記する。書いていないと、子が会話の言語に引きずられてブロックの本文を英語で書くことがある（build-03 の review-findings の gate で起きた）
- `upstream`: 非対話（`claude -p`）の子は、Bash の待機のループや Monitor が権限で拒否されるので、バックグラウンドのサブエージェント・レビューの完了を待つにはターンを終えて通知を待つしかない。そのたびに Stop フックが1回引き止める。step の `run` の中で非同期の作業を待つときの扱い（フックが待ちを知る、または子では Agent を前景で起動できるようにする）を決める（build-03 で doc-reviewer・test-spec・コードレビューのたびに起きた）

## 役に立たなかった記述

なし
