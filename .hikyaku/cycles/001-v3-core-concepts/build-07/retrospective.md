# Build 07: conductor の走りきりと、監督は安全側にだけ倒すこと 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 420k | issue.md の内訳 |
| builderフェーズ段階 | 435k | plan.md の内訳（下表） |

**セッション**: 2セッション（plan〜G8 で1セッション、implement〜PR で1セッション。G8 の時点で 407k に達したため、監督が新しいセッションで implement から続けた）

**乖離**: 413,523 − 435k = 約 −21k（約 −5%）。なし

**乖離の要因**: なし。ただし実測に選ばれた本体（351a4dcd）は plan〜G8 のセッションで、G8 の差し戻し（ユーザーの判断2件を反映して plan と test-spec を作り直し、再レビュー）で膨らんだ。実装〜レビューのセッションも、区切りの記録でレビュー前に 341k（目安 400k）まで達した。1ビルドの読み込み（conductor・ledger の lib と commands の全文、SKILL.md、テストの土台）が大きく、plan〜G8 と実装を1セッションに収めるには、予測ピークの帯の上限（450k）に近いビルドでは足りなかった

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 160k | 読んだもの（約 110k）: conductor の lib・commands・SKILL.md・headless-protocol、next、ledger と commands/ledger の該当部分、consent・directive・builder steps、deferred-consent・git の一部、handoff 5件と ADR。残り（約 50k）: tasklist・risk・escalation・locate・engine・branch の該当部分、docs/workflow/conductor.md・docs/reference/cli.md、tests/conductor.test.mts・tests/ledger.test.mts の該当部分 |
| 実装 | 90k | lib/conductor.mts（SAFE_ANSWERS・waiting の解析 約120行）、commands/conductor.mts（launch の検査・--escalate/--closes・答えの環境変数・parse の --expect-answer・waiting コマンド 約220行）、waiting.mts 新規（約150行）、ledger の答えの検査と from・ask・risk・token・object の --answers・ledger answers（約110行）、next（約30行）、SKILL.md Step 0/1/3/4・headless-protocol・docs・CHANGELOG（約160行） |
| テスト | 55k | conductor.test.mts（launch の拒否・リスクの申告・--escalate・答えの環境変数・--expect-answer・waiting の blocked・waiting の導出・`next --json` の available と waiting）、ledger.test.mts（子の --by user の ID の縛り・object の --answers・supervisor の決定の risk と token・ledger answers） |
| 未知の領域 | 40k | 子の再開と取り込みの手順、既存の conductor の結合テストの調整（--from 必須化）、origin のブランチを使う waiting の結合テストの準備 |
| **予測ピーク** | **435k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 413,523 |
| 開始時の固定分 | 59,499 |
| 呼び出し回数 | 173 |
| 出力トークン | 109,969 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | — |
| セッション | 351a4dcd（本体。ほか 2 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 3（実装 1 / テスト 2） |
| 変更ファイル数 | 15（実装 12 / テスト 3） |
| 追加行数 | 1,839（実装 1,036 / テスト 803） |
| 削除行数 | 74 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督（conductor）からの補足: `gh` が使えないので PR の作成は監督が代行する（PR 本文を `.tmp/hikyaku-pr-{phase}.md` に書いて blocked で止まる）。ADR を書くときの書式。監督の委任された判断は `build-NN/questions.md` に記録する
- 監督の回答（review-findings）: 残った4件を「そのまま進める」とし、1・2 は「確度: 要確認」として handoff に残す

## 永続化すること

- `workflow` [中]: conductor の子（`claude -p`）では、レビューの実行（review.md の「Bash の `run_in_background` で並列に実行する」）をバックグラウンドにしない。ターンを終えるとプロセスごと終わり、完了の通知を待てない。子はフォアグラウンドで（`timeout` は最大値で）実行する（根拠: build-07 でバックグラウンドのレビューの完了を待てず、Stop フックに引き止められて止めてやり直した）

## 役に立たなかった記述

なし
