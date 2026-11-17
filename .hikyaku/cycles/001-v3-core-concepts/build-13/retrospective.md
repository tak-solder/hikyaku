# Build 13: 中身を含まないフィードバックと、document-guide のアンカー 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 295k | issue.md の内訳 |
| builderフェーズ段階 | 320k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結（途中でコンテナの再起動があり、同じセッションを再開した）

**乖離**: なし（実測 303,942 − 予測 320k = 約 −16k。±10% 以内）

**乖離の要因**: なし。区切りでのコンテキストは G8・実装開始前・レビュー前のどれも目安の内に収まった。レビューが2ラウンドとも指摘を返し、その修正（実装とテストの書き足し）で、レビュー前の 245k から 300k 前後まで増えた。plan-review の指摘で読み込みを 70k → 95k、未知の領域を 20k → 30k に積み増した分が、この修正ループを吸収した

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 95k | 読了の docs.mts・progress.mts・context.mts・validate.mts・commands/docs.mts・init.mts・promotions.mts 前半（約 60k）＋ git.mts・directive.mts・quality-metrics.mts・rules.mts の該当箇所・steps/init.mts・tests/cli.test.mts・document-guide.md・CHANGELOG・docs 4 本（documents・cli・directory-layout・getting-started）・init の SKILL.md と cleanup.md |
| 実装 | 60k | feedback.mts（集計・固定の枠の下書き、約 200 行）、commands/feedback.mts（約 80 行）、docs.mts の anchor・githubAnchor・節の検査（約 60 行）、context・directive の表示、planGitignore の行ごとの判定、docs 4 本・init のスキル・CHANGELOG |
| テスト | 45k | tests/feedback.test.mts（中身が混ざらないこと・check-ignore で止まる）、tests/docs-anchor.test.mts（アンカー生成・validate・context）、tests/cli.test.mts の .gitignore 追記 |
| 未知の領域 | 30k | 日本語見出しの GitHub 式アンカー、check-ignore の判定、型エラー・既存テストの期待値の修正ループ |
| **予測ピーク** | **320k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 303,942 |
| 開始時の固定分 | 59,496 |
| 呼び出し回数 | 140 |
| 出力トークン | 98,631 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | 3.0.0 |
| セッション | b9286b9b（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 4（実装 2 / テスト 2） |
| 変更ファイル数 | 20（実装 16 / テスト 4） |
| 追加行数 | 1,014（実装 497 / テスト 517） |
| 削除行数 | 37 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督の補足（このサイクル固有）: `gh` が使えないので、PR は本文を `.tmp/hikyaku-pr-{phase}.md` に書き出して blocked で代行を依頼する
- コンテナの再起動のあと「中断したところから続けて」と再開の指示を受けた（作業ツリーの変更は残っていた）

## 永続化すること

- `conventions` [中]: 「patch の記録を全件走査する処理を足さない」は Stop フックに限らず、ユーザーが手で呼ぶコマンドにも当てはまる。HIKYAKU_ROOT 直下の `patches/` を読む処理は、現在のブランチの patch か、サイクルの中の patch に絞る（build-13 で feedback export が全件走査を足し、plan-review を通ってコードレビューのラウンド 2 で初めて指摘された。規約の文が Stop フックを主語にしていて、手で呼ぶコマンドは対象外と読めた）
- `workflow` [中]: conductor の子では `[conductor] allowed_tools` に無いコマンドが自動で拒否され、`node scripts/hikyaku.mts <command>`（作業中の CLI を直接試す）・`sed -i`・複数の操作をつないだ Bash が通らない。作業中の CLI の確認は `node --test` で一時のテストファイルから呼ぶか、`tests/` の CLI 結合テストで行う（build-13 で docs validate・feedback export の手元確認が拒否され、scratchpad のテストで代えた）

## 役に立たなかった記述

なし
