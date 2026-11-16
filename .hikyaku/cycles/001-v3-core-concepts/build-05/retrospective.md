# Build 05: 宣言の変更の見直し・記録のテンプレート・ポインタの検査 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 330k | issue.md の内訳 |
| builderフェーズ段階 | 375k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結

**乖離**: なし（実測のピーク 354,030 − builderフェーズ段階 375k = −21k。±10% 以内）

**乖離の要因**: なし。区切りでの値は、G8 の提示が 202k（目安 250k）、実装開始前が 208k（目安 300k）、レビュー前が 293k（目安 400k）で、どれも目安を超えなかった。plan-review の指摘で読み込みを 100k → 140k、未知の領域を 25k → 35k に見直したが、実際には読み込みは見直す前の値に近かった。基準の読み方を risk.mts から再利用したため、`config.mts` と `git.mts` は全文を読まずに済んだ。レビュー対応は2ラウンドに加え、review-findings の後の修正が1回あった

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 140k | 読了: ledger.mts・commands/ledger.mts・validate.mts・risk.mts・docs.mts・architect の templates/adr/questions・5つの pr.md・close-cycle の write/G10/collect・init の pr/triage-approval・conductor SKILL と token-guide propose の該当節・ci.md。これから: config.mts（ResolvedConfig・readAppDeclaration）・toml.mts・git.mts（gitSync）・stack.mts・steps の directive/engine/locate（args の評価経路）・5スキルの pr 定義（architect は既存の args と合成）・build-manager と builder の templates・CHANGELOG・cli.md・tests/cli.test.mts と tests/risk.test.mts（一時リポジトリの先例） |
| 実装 | 65k | lib/premises.mts（risk.mts の基準を使う宣言の差分・受け入れたことの節の解析・ID の範囲の検出）、ledger premises、validate の warnings と --base、pr の args（5スキル）と pr.md、ADR・constraints・design-questions のテンプレート、件数の指示の修正、CHANGELOG・cli.md・ci.md |
| テスト | 45k | premises の単体（節の解析・拠り所・警告）、一時リポジトリでの ledger premises と validate --base の結合、範囲の警告と終了コード 0 |
| 未知の領域 | 35k | 受け入れたことの節の書式の揺れ、validate の JSON の形の変更による既存テストの修正ループ、CI の浅い clone で merge-base が無い場合 |
| **予測ピーク** | **375k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 354,030 |
| 開始時の固定分 | 59,351 |
| 呼び出し回数 | 129 |
| 出力トークン | 115,402 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.325 |
| Hikyaku | 3.0.0 |
| セッション | a918fb3a（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 3（実装 2 / テスト 1） |
| 変更ファイル数 | 35（実装 33 / テスト 2） |
| 追加行数 | 1,305（実装 829 / テスト 476） |
| 削除行数 | 47 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督から: ADR を書くときの書式（欄の名前と順）を `.hikyaku/decisions/20261116-*.md` にそろえる。ADR のテンプレートを直すときも同じ欄・順にする（このビルドの ADR のテンプレートに反映した）
- 監督から: `gh` が使えないので、PR は本文を `.tmp/hikyaku-pr-{phase}.md` に書き出し、blocked で作成を依頼する
- 監督から（review-findings への回答）: decisions のサブディレクトリにある ADR も読むよう修正する

## 永続化すること

- `workflow` [中]: このリポジトリで conductor の子が `step lint`・`conductor lint`・`validate` を回せるよう、`[conductor] allowed_tools` に `Bash(node scripts/hikyaku.mts:*)` を足す。足すまでは、子は `npm test` だけで確かめ、lint は CI に任せる（build-02・build-03・build-05 のどれでも、リポジトリのスクリプトを直接実行できず lint を回せなかった）
- `upstream` : conductor の子（`claude -p`）で、サブエージェント（doc-reviewer・test-spec の生成）が `run_in_background: false` を指定してもバックグラウンドで起動する。そのまま応答を終えると、結果を待たずにセッションが終わりかける。子は Monitor で待つか、別の作業を挟むしかない。Stop フックの引き止めは1回だけなので、2回目の待ちで子が落ちる。待ちの手順を builder の plan-review・test-spec の指示に入れるか、Stop フックがバックグラウンドのタスクの実行中は止めるようにしてほしい

## 役に立たなかった記述

なし
