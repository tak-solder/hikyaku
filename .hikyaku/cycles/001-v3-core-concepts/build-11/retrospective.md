# Build 11: G10 の同意と確認の区分、基準を消す経路と指標の比較 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 340k | issue.md の内訳 |
| builderフェーズ段階 | 400k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結

**乖離**: +72k（実測 471,640 − 400k、+18%）

**乖離の要因**: 実装とテストの見積もりは差分の集計（追加 1,585 行・変更 34 ファイル）とほぼ見合っていた。膨らんだのは未知の領域（40k と見た）で、コードレビューが2ラウンドとも指摘を多く返し（9件・10件）、git の基準コミットの選び方（記録を含むコミット → 時刻で区切る → first-parent）と閉じたあとの差分の扱いを3回作り直した（+50k 前後）。G8 の時点で目安 250k を超えていた（289k）のは、plan-review・test-spec の生成とレビューのサブエージェントを待つあいだに、実装で読むファイルを先に読んでいたため（読み込みが前倒しになっただけで、総量は見積もりの範囲）。

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 125k | close-cycle・engine・step report・promotions・rules・review-records・directive は読み済み。config・progress・ledger・git・conductor（lib・commands）・commands/config の該当節、tests の promotions・rules・step-planner-close・step-consent・conductor・step-hook・config・helpers、skills の conductor の headless-protocol・close-cycle の SKILL.md と pr.md、docs の close・profiles・config-file・cli・conductor |
| 実装 | 90k | consentChanges と docChanges（基準コミット・closed 後の打ち切り）・cycleAdrNames、G10 の consent/enabled/reopens/args、write の accepts、エンジンの reopens と recordsPr optional、承認の種類の記録、ASKS の G10 と G10 前提の記述の修正、removalCandidates、quality-metrics.mts 新規（文書の削除行の導出を含む）、手順6本・docs5本・CHANGELOG |
| テスト | 55k | G10 の同意の判定と write の拒否・戻り・closed 後に戻らない（一時リポジトリ）、消す候補の高の除外、指標の比較と比較できない（一時リポジトリのマージコミット）、config、conductor の期待値 |
| 未知の領域 | 40k | git の基準コミットと追跡外ファイルの扱い、マージコミットの第1親との差分と cycles.md の日付の突き合わせ、既存の step・conductor テストの期待値の修正ループ |
| **予測ピーク** | **400k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 471,640 |
| 開始時の固定分 | 59,497 |
| 呼び出し回数 | 404 |
| 出力トークン | 182,789 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | 3.0.0 |
| セッション | 88b342c6（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 3（実装 1 / テスト 2） |
| 変更ファイル数 | 34（実装 28 / テスト 6） |
| 追加行数 | 1,585（実装 959 / テスト 626） |
| 削除行数 | 68 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督から: G8 で承認するとき、解釈1（理由の欠けた基準を rule に限る）を handoff の「残したこと」に「確度: 要確認」として残すこと（questions.md の Q1）
- 監督から: コードレビューのラウンド 2（上限）の指摘を直したあとは再レビューせず、tsc と npm test で確かめること。`step next` が stop を返していても（後のステップの handoff.md が先にあるため）、review の done を記録してから現在地を確かめること（questions.md の Q2）

## 永続化すること

- `conventions` [中]: 「スクリプト」に、ステップの判定（consent・accepts など）で git の履歴から「フェーズが書く前の状態」を導くときは、記録を含むコミットではなく記録の時刻で区切り、`--first-parent` で辿ること、閉じたあとはマージ後のベースブランチの変更を拾わないよう打ち切ることを足す（防ぐ: 基準コミットの選び方を誤って、先にコミットした変更の見落としや、他の PR の変更の取り込みが起きる / 立つ: 作業単位の記録が progress.jsonl にあり、ブランチがスタック・取り込み・squash merge されうること / 重要度: 中）（根拠: build-11 のコードレビューで基準コミットを3回作り直した）
- `conventions` [中]: 「スクリプト」に、directive の args に配列やオブジェクトを載せたら、テキストの directive で中身が読めるか（JSON で出るか）をテストで確かめることを足す（防ぐ: `--json` を付けずに `step next` を呼ぶスキルで、args が `[object Object]` になり手順が黙って働かない / 立つ: スキルの指示文が `step next` をテキストで呼んでいること / 重要度: 中）（根拠: build-11 のコードレビュー ラウンド 2）

## 役に立たなかった記述

なし
