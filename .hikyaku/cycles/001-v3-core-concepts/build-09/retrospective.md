# Build 09: 行き詰まりの報告の検査と、gh が使えないときの扱い 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 305k | issue.md の内訳 |
| builderフェーズ段階 | 340k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結

**乖離**: 327,948 − 340k = 約 −12k（±10% 以内のため なし）

**乖離の要因**: なし。成分ごとには、読み込み（90k）はサブエージェント（doc-reviewer 2回・test-spec 生成）に委ねた分だけ小さく、コードレビュー2ラウンドの指摘への対応（9件＋9件の検討と修正）が実装・テストの側を押し上げて相殺した。区切りでの値はどれも目安以内（G8 191k / 250k、実装開始前 196k / 300k、レビュー前 279k / 400k）

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 90k | phase/builder/architect/engine/patch/step.mts/conductor.mts parseFinalText・hook.mts・reviewers(commands/lib)・pr-ready・external（手本）・github.mts・templates/return/retry-policy/headless-protocol・conductor SKILL の pr ready と violation・init/create-cycle/token-guide の pr.md・publish.md 5つ・conductor/pr-ready/step/objection/step-consent テストと helpers.mts・docs 6ファイル（約 70k は読了） |
| 実装 | 60k | escalation.mts 新規（約120行）、readReturn・builder/architect stop・restart・failed・parseFinalText の差し込み、reviewers の事前判定と gh 失敗の扱い、pr-ready の gh 失敗と for-merge の例外、テンプレート3つ・手順 約10ファイル・docs 6ファイル・CHANGELOG |
| テスト | 55k | escalation の unit、restart/stop/failed の拒否、parseFinalText、偽の gh（無い・失敗）、既存 return.md のフィクスチャ約20か所の書き換え |
| 未知の領域 | 45k | 既存テストの return.md フィクスチャと終了コード 1 の期待値の波及、gh が無い環境の PATH の隔離、gh-unavailable と gh-failed の判別（stage ごと） |
| **予測ピーク** | **340k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 327,948 |
| 開始時の固定分 | 59,498 |
| 呼び出し回数 | 147 |
| 出力トークン | 106,044 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | 3.0.0 |
| セッション | 2242097c（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 4（実装 2 / テスト 2） |
| 変更ファイル数 | 44（実装 33 / テスト 11） |
| 追加行数 | 867（実装 502 / テスト 365） |
| 削除行数 | 129 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督の補足: `gh` は使えないので、PR は本文を `.tmp/hikyaku-pr-{phase}.md` に書き出し、blocked で監督に作成の代行を依頼する
- 監督の補足: 委任された判断は builder では `build-NN/questions.md` に記録する（headless-protocol の `decisions.jsonl` より優先）

## 永続化すること

- `workflow` [中]: conductor の子（非対話）では、Bash に変数・ブレース展開・複数コマンドの連結（`;`・パイプの後段の別コマンド）・`sed -i`・`python3`・プラグインのディレクトリへの `cat` を使うと許可が無く拒否される。ファイルの読み書きは Read / Edit / Write で行い、Bash は単一のコマンド（`&&` でつなぐ CLI の呼び出しは可）にする（根拠: build-09 で6回拒否され、そのたびに書き直した）
- `upstream`: conductor の子でバックグラウンドのサブエージェントやレビュー（`review run` の `run_in_background`）を待っているあいだに、Stop フックが「手順がまだ途中」と引き止める。待ちの最中であることを判定できず、待つ手段（Monitor の sleep）で時間をつなぐ必要があった

## 役に立たなかった記述

なし
