# Build 06: 事後同意（PR を作る直前の同意ゲート） 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 435k | issue.md の内訳（分割後） |
| builderフェーズ段階 | 390k | plan.md の内訳（下表）。新しいセッションで test-spec から再開する前提 |

**セッション**: 2セッション（plan と分割の検討（G6）を前のセッション、test-spec から PR までをこのセッション）。途中でビルドを分割（build-16・build-17 を追加）

**乖離**: 309,601 − 390k = 約 −80k（このセッションの実測）

**乖離の要因**: 読み込みを 130k と見たが、`docs/workflow` と CHANGELOG は該当箇所だけを grep で読み、steps 定義（architect・close-cycle）も pr の周辺だけを読んだので少なかった（−40k 前後）。test-spec の生成とレビューをサブエージェントに委ね、本体には要約だけが返った（固定費の想定より小さい）。一方で、コードレビューを2ラウンド回し、指摘の反映で consent.mts・各 pr.md を2度直した分は未知の領域の 40k の内に収まった。区切りでは目安を超えていない（G8 163,838 / 250,000、レビュー前 240,254 / 400,000）。

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 110k | 新しいセッションで test-spec から再開する前提。標準ガイドの出発点 90k に、残りの手順の進行分（test-spec の委任と review・G8・agreement-review・コードレビュー2ラウンドの結果・handoff・retrospective・pr・publish）20k |
| 読み込み | 130k | plan.md・issue.md・design-delta 3節・ADR deferred-consent・build-04 の handoff、steps/engine.mts・architect.mts・builder.mts・patch.mts・planner.mts・close-cycle.mts・publication.mts・index.mts・locate.mts、lib/ledger.mts、commands/ledger.mts・step.mts、conductor.mts の ASKS、各 pr.md・publish.md、tests の helpers・objection.test.mts・期限のテスト・手順の並びのテスト、docs/workflow の architect・build・patch・reference/cli.md・CHANGELOG |
| 実装 | 60k | 新規 steps/consent.mts（約 120 行。reopens を含む）、lib/ledger.mts（同意の対象・objectionSettled の export）、5つのスキルの steps 定義と pr / publish の accepts、step.mts（gate の approved で accepts）、commands/ledger.mts（consent-list・pr-section、約 150 行）、consent.md 3つ・pr.md 4つ・publish.md・docs・CHANGELOG |
| テスト | 50k | tests/consent-gate.test.mts（一時 Git リポジトリ。同意ゲートの出現と accepts・reopens、高の異議の受け入れの言葉、conductor の子、planner の pr の accepts、pr-section の節、約 350 行）と、期限・手順の並びの既存テストの修正 |
| 未知の領域 | 40k | steps/consent.mts → ledger.mts → steps/index.mts の循環 import、mergeAnchor が consent に変わる期限の判定、コードレビューの修正ループ |
| **予測ピーク** | **390k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 309,601 |
| 開始時の固定分 | 59,497 |
| 呼び出し回数 | 164 |
| 出力トークン | 93,904 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | 3.0.0 |
| セッション | 62d86b14（現在のセッション。本体。ほか 2 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 5（実装 4 / テスト 1） |
| 変更ファイル数 | 27（実装 26 / テスト 1） |
| 追加行数 | 994（実装 506 / テスト 488） |
| 削除行数 | 11 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督から、G8 の承認とコードレビューの未解決の指摘（review-findings）への答えを、委任された判断として受けた（questions.md の Q1・Q2 に記録）
- 監督から、`step next` が stop（review より後の成果物 handoff.md が先にある）を返しているので、review の done を記録してから続けるよう補足を受けた。handoff.md をレビューの待ち時間に先に書いたため。後ろのステップの成果物は、そのステップに来てから書く

## 永続化すること

- `conventions` [中]: 「スクリプト」に、ステップの `when` が環境変数（`HIKYAKU_CONDUCTOR_CHILD`）で変わるときは、監督が子の手順の位置を評価する経路（`conductor` の `childStep`）も子と同じ条件で評価することを足す（根拠: build-06 のコードレビュー1回目。評価がずれると正しく終えた子を違反と読む）
- `conventions` [中]: 「スクリプト」に、ステップの `when` が書き換わりうる記録（decisions.jsonl など）を読むときは、後ろの区切りのステップ（pr など）をその回で終えたら手順から外すことを足す（根拠: build-06 のコードレビュー2回目。外さないと、あとから記録が足されたときに承認の無いゲートが現れ、終えた pr をやり直しにする）
- `conventions` [中]: 「スクリプト」のテストの規約に、環境変数で振る舞いが変わる関数をテストのプロセス内で評価するテストは、ファイルの先頭で `HIKYAKU_CONDUCTOR_CHILD` を消すことを足す（根拠: conductor の子の中で `npm test` を走らせたら、子の環境変数が単体テストに入って失敗した。`testEnvironment()` が消すのは CLI を起動する子プロセスの分だけ）
- `workflow` [中]: conductor の子では、リポジトリの CLI（`node scripts/hikyaku.mts conductor lint` / `step lint`）を直接実行できない（`allowed_tools` に無い）。`node --test` から CLI を起動するテストファイルを書いて実行すれば確かめられる。`[conductor] allowed_tools` に `Bash(node scripts/hikyaku.mts:*)` を足すかをユーザーが決める（根拠: build-04 と build-06 の両方で拒否された）

## 役に立たなかった記述

なし
