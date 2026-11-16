# Build 04: 異議と、各フェーズが未決事項を記録する手順 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 365k | issue.md の内訳 |
| builderフェーズ段階 | 395k | plan.md の内訳（下表。plan-review の指摘を反映して 365k から見積もり直した） |

**セッション**: 完結

**乖離**: なし（実測 399,569 − builder 段階 395k = +4,569。±10% 以内）

**乖離の要因**: 合計は合ったが、内訳はずれた。読み込みは過小だった。G8 の時点で実測は約 274k あり、目安（250k）を超えた。plan の作成までに、ledger.mts・commands/ledger.mts・engine.mts・directive.mts・commands/step.mts・steps 定義の全部・conductor.mts・design-delta・ADR・指示ファイル約12本を読んだ。そのうえ、plan-review と test-spec-review の長い報告（test-spec は 80 シナリオ）を読み込んだ。実装とテストは見込みどおりだった。未知の領域（40k）は、evaluate の変更で architect の再設計の回の既存テスト5件が落ちた修正と、コードレビュー2回（8件・10件）の対応で使った。実装開始前は 278k / 300k、レビュー前は 338k / 400k で、どちらも目安の内だった

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 130k | 読んだ ledger.mts・commands/ledger.mts・engine.mts・directive.mts・commands/step.mts・steps/*.mts・conductor.mts の ASKS・design-delta・ADR・各指示ファイル（約 100k）に、locate.mts・index.mts・docs.mts、builder の review.md・pr.md、docs/workflow の各フェーズ・cli.md、既存テスト（step / step-hook / conductor / step-architect / step-planner-close / ledger）の該当箇所 |
| 実装 | 80k | ledger object と unacceptedObjections・latestOpenAt、engine の割り込みゲート、directive の異議の指示とポインタ、step report の高の異議の検査、architect・builder の delegation、G1 の profile、ASKS、指示文の差し込み約14ファイル、docs 6〜7ファイル、CHANGELOG |
| テスト | 55k | ledger object の CLI、ゲートの承認の拒否、delegation の出現（builder 割り込み・architect 再設計の回・記録が壊れたとき）、G1 の args、directive の異議、resolveAsk、記録する側の指示ファイルと planner・builder の結合テスト。npm test は1回約4分 |
| 未知の領域 | 40k | 全スキルの評価に効く evaluate を変えたことによる既存テストの修正ループ、割り込みゲートと floor・orphans・publication の干渉、ledger と steps の循環 import |
| **予測ピーク** | **395k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 399,569 |
| 開始時の固定分 | 59,254 |
| 呼び出し回数 | 156 |
| 出力トークン | 133,585 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.325 |
| Hikyaku | 3.0.0 |
| セッション | b3515250（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 3（実装 2 / テスト 1） |
| 変更ファイル数 | 38（実装 34 / テスト 4） |
| 追加行数 | 1,101（実装 541 / テスト 560） |
| 削除行数 | 40 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- G8（監督の委任された判断）の条件: 害が高の異議で `decided` のときも、ユーザーの言葉（`--input`）を必須にし、テストを1つ足すこと。G8 の前に作業ツリーで書き始めていた変更は、plan.md に沿うかを確かめ直してから実装として扱うこと。delegation の判定で decisions.jsonl を読む逸脱は、handoff の「残したこと」に「確度: 要確認」で残すこと

## 永続化すること

- `workflow` [中]: Hikyaku 自身のサイクルでは、実行中のプラグイン（インストール済みの版）にまだ無いコマンドを、手順が使うことがある（build-04 で skills/ に足した `ledger open` を、このビルドの handoff で使えなかった）。conductor の `allowed_tools` にリポジトリの CLI（`Bash(node scripts/hikyaku.mts:*)`）を足し、新しい手順はリポジトリの CLI で回せるようにする（build-02・03 の `step lint`・`conductor lint` と同じ原因。build-04 では `ledger` と、リポジトリの CLI でのデバッグも権限で拒否された）
- `workflow` [中]: ステップの並びを変えるとき（先頭にゲートを足すなど）は、`tests/step-architect.test.mts`・`tests/step-consent.test.mts` の回ごとの進め方（`redesignUpToOptions` など）も直す。これらは並びを前提に報告を順に書いている（build-04 で architect の再設計の回の先頭に delegation を足し、5件が落ちた）

## 役に立たなかった記述

なし
