# Build 10: 知見の置き場の「なくす」と、rule を移すきっかけ・領域の開発頻度 振り返り

## 予測ピークの振り返り

| 段階 | 予測ピーク | 根拠 |
|------|------------|------|
| architectフェーズ段階 | 345k | issue.md の内訳 |
| builderフェーズ段階 | 400k | plan.md の内訳（下表） |

**セッション**: 1セッションで完結

**乖離**: なし（実測 374,295 − builder 段階 400k = −25,705、−6%）

**乖離の要因**: なし。区切りの目安はどれも超えていない。plan のレビューで読み込み（+15k）と未知の領域（+15k）を上げたが、未知の領域に見込んだ glob の意味の差とコミット日時のテストの修正ループは、ほぼ一度で通った

### builderフェーズ段階の内訳

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 標準ガイドの出発点 80k〜100k の中央。plan までで既に約 150k が載っている |
| 読み込み | 135k | promotions・rules・commands/rules・commands/promotions・git・tokens-history・config・premises・patch.mts の該当節、tests の rules・promotions・helpers・config、persistence.md・constraints-template・architect の templates・doc-triager、builder の SKILL.md・templates・plan/handoff/review、retrospective の write、architect の survey、close-cycle の collect・G10・write・pr、init の triage-write、docs の persistence・config-file・cli・workflow の build・architect・close |
| 実装 | 85k | review-records.mts・areas.mts（lib と command）新規、rules.mts の frontmatter の理由と ruleCandidates、lastTouched、config の [rules]/[areas]、promotions の refactor と理由の欄、rules candidates コマンド、手順書 10 本・persistence.md・doc-triager・docs 6 本・CHANGELOG |
| テスト | 50k | promotions の refactor と理由、review-records のサイクルをまたいだ結合、rules candidates、areas dormant（一時リポジトリのコミット日時）、config の [rules]/[areas] |
| 未知の領域 | 40k | rule の glob（matchesRule）と git の pathspec の意味の差を避けるため追跡ファイルを JS で絞ってから git log に渡す実装、コミット日時（GIT_COMMITTER_DATE）と now を注入するテストの修正ループ、rule の frontmatter の解析と既存実装の整合 |
| **予測ピーク** | **400k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

### セッションの実測

| 計測項目 | 値 |
|------|------|
| ピーク | 374,295 |
| 開始時の固定分 | 59,496 |
| 呼び出し回数 | 174 |
| 出力トークン | 131,194 |
| コンパクション | 0 |
| モデル | claude-opus-5-5 |
| ホスト | Claude Code 2.1.326 |
| Hikyaku | 3.0.0 |
| セッション | 3ca4f49c（現在のセッション。本体。ほか 1 件） |

### 差分の集計

| 差分の集計 | 値 |
|------|------|
| 新規ファイル数 | 5（実装 3 / テスト 2） |
| 変更ファイル数 | 36（実装 31 / テスト 5） |
| 追加行数 | 1,471（実装 895 / テスト 576） |
| 削除行数 | 45 |
| 生成物（数えていない） | 0 ファイル・0 行 |

## セッション中にスキル外で受けた指示

- 監督（conductor）の補足: ADR の書式・PR 作成の代行（`gh` が使えない）・用語「ユーザー」。手順どおりに従った
- 監督の委任された判断: G8 の承認と、コードレビューの未対応の指摘を「そのまま進める」（questions.md の Q1・Q2）

## 永続化すること

- `workflow` [中]: Hikyaku 自身を開発するサイクルでは、インストール済みのプラグイン（`${CLAUDE_PLUGIN_ROOT}`）の版がリポジトリの手順より古いことがある。手順が求める CLI のコマンド（`ledger open` など）がインストール済みの CLI に無ければ、記録は本文で残し、handoff の「後続ビルドが前提にすること」にそのことを書く（build-10 で `ledger open` が「不明なコマンド」になった）（防ぐ: 手順が求める記録を、コマンドが無いまま黙って省く / 立つ: このリポジトリはプラグイン自身で、手順をインストール済みの版で回していること）
- `workflow` [中]: conductor の子として builder を動かすときは、`[conductor] allowed_tools` にリポジトリの CLI（`node scripts/hikyaku.mts conductor lint`・`step lint` と、足したコマンドの手動確認）を許す項目を足す。今の設定では子が CI と同じ lint を走らせられず、verify で確かめられない（build-10 で `conductor lint` が許可されずに止まった）（防ぐ: CI でだけ落ちる lint の食い違いを、ビルドの PR に持ち込む / 立つ: いまの `.hikyaku.config` の `[conductor] allowed_tools`）
- `upstream`: 非対話（`claude -p`）の子で doc-reviewer・test-spec の Agent を起動すると、`run_in_background: false` でもバックグラウンドで返り、ターンを終えるたびに Stop フックが引き止める。待つ手段が Monitor の sleep しか無く、通知が来るまで同じ待機を繰り返した（build-10 の plan-review・test-spec・test-spec-review）

## 役に立たなかった記述

なし
