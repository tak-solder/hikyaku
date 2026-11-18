# Build 07: conductor の走りきりと、監督は安全側にだけ倒すこと

## やること

- 監督が答えてよい問い（confirm・spec）の directive に、スクリプトが決めた安全側の既定（推奨案、unsafe-split なら安全な分割、design-conflict なら差し戻し）を載せる。`conductor launch --from user|supervisor --choice <値>` を足し、`--from supervisor` で安全側の既定以外の値なら受け付けずにユーザーに上げるよう返す。handler がユーザーの問いに `--from supervisor` も弾く。子の環境変数 `HIKYAKU_ANSWER_FROM` を設定する
- `ledger decide --by user` は、conductor の子（`HIKYAKU_CONDUCTOR_CHILD=1`）の中では `HIKYAKU_ANSWER_FROM=user` を要する（設定する側と同じ build で入れ、記録できない期間を作らない）。`HIKYAKU_ANSWER_FROM` の値を決定のレコード（`from`）に残す（最後の PR の本文への表示は build-19）。この検査は取り違えを防ぐもので、子が環境変数を自分で付ける偽装は防げない（ADR で受け入れ済み。防ぐ仕組みは足さない）
- ユーザーに上げる問いは `AskUserQuestion` を出さず、固定文で子を再開して `ledger open --type question --who user --when now --ask <id>` を記録させ、コミット・push して blocked で終えさせる（error・2回目の violation・check-pr の不合格は従来どおりその場で上げる）。この「答えを待つ blocked」は本文に記録した事項の ID（`waiting: <id>`）を持たせ、build-09 の行き詰まりの報告の検査（3節）から外す。`parseFinalText` で、ID が実在する未決の事項を指すときだけ外す
- 監督の答えの検査（安全側の既定）で、上限を超える受け入れになる答えは `risk.mts` の上限と比べて判定する（US-13.3。build-18 の `exceedsCeilingFor`・`isHighObjection` を使う）。このビルドでは、上限を超える申告は事後同意の有無に関わらず拒否する（ユーザーに上げる）。事後同意が有効なときに子へ risk の事項を積ませて受け付ける分岐は build-19（子の事後同意の有効化と同じビルドで入れ、監督と子の判定を割らない）
- `hikyaku conductor waiting <cycle>` と `next --json` の `waiting`: 作業ツリーと、tasklist の各ビルド・architect の origin のブランチの記録から、決定の無い `now` のユーザーの事項と、それを待つビルド（問いを出したビルドと推移的に依存するもの。ARCHITECT の問いは全ビルド）を導く。状態は保存しない
- `skills/conductor/SKILL.md`: Step 1 で `available` が空になったら待っている問いをまとめて尋ねる。答えごとに conductor ブランチを待っているビルドのブランチへ取り込み、`--from user` で子を再開する（session-id は保存しない）。逐次実行は保つ。Step 0 の委任の範囲の確認に、問いを積む方針の行を足す（`conductor asks` の JSON の `queueing` とテキストの1行。asks のこの部分はこのビルド）
- `skills/conductor/references/headless-protocol.md`（ユーザーに上げる問いの記録と `waiting:` の blocked、`HIKYAKU_ANSWER_FROM` と `--by user`）・`docs/workflow/conductor.md` を直す。CHANGELOG に追記する
- 詳細は plan.md（plan-review の指摘を反映した版）。plan.md のうち次は build-19 へ移した: 「最後のビルドの同意ゲート」「`ledger consent-list` / `ledger pr-section`」の節（`cycleConsentItems`・consent.mts・deferred-consent.mts・pr-section `--all` を含む）、`conductor asks` の `deferredConsent`、launch の検査4の「事後同意が有効なら受け付ける」分岐、SKILL.md の Step 0 の事後同意の行と「同意ゲートの答えも問いを積む経路に乗る」、Step 1 の `deferred-consent` の待ち（`consent-list --full` を示す処理）、Step 4 の書き換え、headless-protocol の最後のビルドの同意ゲート

## やらないこと

- ビルドの並行実行（走りきりは止まらないことの要件で、並行は要件にしていない）
- 監督のセッションのファイルへの session-id の保存（状態を保存しない原則）
- 監督が記録をコミットすること（最後のビルドの子が同意を取る形にした）
- 事後同意の conductor の形（最後のビルドの子の同意ゲート、最後以外の子で merge@ の事項を最後へ回すこと、子での事後同意の有効化、最後の PR の本文の全フェーズの一覧、`conductor asks` の `deferredConsent`）。build-19 で行う。このビルドの時点では、conductor の子は従来どおり同意ゲートを置かず、決定の無い項目は pr の `accepts` で止まってユーザーに上がる

## 対応する受け入れ基準

- US-13.3, US-15.1, US-15.2, US-15.3, US-19.7, US-21.2, US-21.3, US-21.4

## 受け入れ基準

- [ ] `--from supervisor` で安全側の既定以外の答え、またはユーザーの問いへの答えを渡すと、launch が拒否する
- [ ] conductor の子で、`HIKYAKU_ANSWER_FROM=user` が無いと `ledger decide --by user` が拒否される
- [ ] 答えを待つ blocked（実在する未決の事項の ID を持つ）は violation にならず、ID の無い・指す先の無い blocked は従来どおり検査される
- [ ] ユーザーに上げる問いが出ても、それに依存しないビルドが `available` に残り、依存するビルドは `waiting` に何の答えを待っているかが出る
- [ ] 監督がリスクを受け入れうる答え（questions・review-findings の「そのまま進める」）は、リスクの申告が無いと launch が拒否し、上限を超える申告は拒否される
- [ ] `conductor lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「4. conductor の走りきり」、「1. 承認の種類と上限」（監督の答えは安全側だけ・答えの出どころの項）
- `decisions` の `20261116-conductor-runs-to-end.md` — 問いを積む・待ちの導出・再開がこの判断に従う
- `decisions` の `20261116-pending-items-ledger.md` — 答えの出どころの検査がこの判断に従う
- `decisions` の `20261116-escalation-report-check.md` — 答えを待つ blocked を検査から外すことが、この判断の補足になる
- `decisions` の `20261116-risk-ceiling-table.md` — 監督の答えを上限と比べる検査がこの判断に従う

## 予測ピーク

読むファイル: `skills/conductor/SKILL.md`・`references/headless-protocol.md`、`scripts/lib/conductor.mts`・`scripts/commands/conductor.mts`、`scripts/commands/next.mts`、`scripts/lib/ledger.mts`・`scripts/commands/ledger.mts`（該当部分）、`scripts/lib/tasklist.mts`・`risk.mts`・`escalation.mts`・`branch.mts`・`git.mts`・`steps/locate.mts`・`steps/engine.mts`（該当部分）、build-06・09・16・17・18 の handoff、`docs/workflow/conductor.md`・`docs/reference/cli.md`、`tests/conductor.test.mts`・`tests/ledger.test.mts`（該当部分）
作成・変更するファイル: 上記の lib・commands・手順・docs、`scripts/lib/waiting.mts`（新規）、`tests/conductor.test.mts`・`tests/ledger.test.mts`、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 160k | 読んだもの（約 110k）: conductor の lib・commands・SKILL.md・headless-protocol、next、ledger と commands/ledger の該当部分、consent・directive・builder steps、deferred-consent・git の一部、handoff 5件と ADR。残り（約 50k）: tasklist・risk・escalation・locate・engine・branch の該当部分、docs/workflow/conductor.md・docs/reference/cli.md、tests/conductor.test.mts・tests/ledger.test.mts の該当部分 |
| 実装 | 80k | lib/conductor.mts（SAFE_ANSWERS・waiting の解析 約120行）、commands/conductor.mts（launch の検査・--escalate/--closes・waiting コマンド 約180行）、waiting.mts 新規（約150行）、ledger の出どころの検査と from（約40行）、next（約30行）、SKILL.md Step 0/1/3・headless-protocol・docs・CHANGELOG（約150行） |
| テスト | 50k | conductor.test.mts（launch の拒否・リスクの申告・--escalate・waiting の blocked・waiting の導出）、ledger.test.mts（出どころの検査と from） |
| 未知の領域 | 40k | 子の再開と取り込みの手順、既存の conductor の結合テストの調整（--from 必須化）、origin のブランチを使う waiting の結合テストの準備 |
| **予測ピーク** | **420k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

依存の build-17 はマージ済みで着手可否に影響しない。退けの扱い（build-17 の handoff の問い）は build-19 へ移したが、依存は残す（完了済みのため変えても意味が無い）。

builder の plan で 480k と見積もり直したため、事後同意の conductor の形を build-19 へ分けた（build-manager）。
