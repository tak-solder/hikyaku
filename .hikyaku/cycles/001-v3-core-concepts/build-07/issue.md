# Build 07: conductor の走りきりと、監督は安全側にだけ倒すこと

## やること

- 監督が答えてよい問い（confirm・spec）の directive に、スクリプトが決めた安全側の既定（推奨案、unsafe-split なら安全な分割、design-conflict なら差し戻し）を載せる。`conductor launch --from user|supervisor --choice <値>` を足し、`--from supervisor` で安全側の既定以外の値なら受け付けずにユーザーに上げるよう返す。handler がユーザーの問いに `--from supervisor` も弾く。子の環境変数 `HIKYAKU_ANSWER_FROM` を設定する
- `ledger decide --by user` は、conductor の子（`HIKYAKU_CONDUCTOR_CHILD=1`）の中では `HIKYAKU_ANSWER_FROM=user` を要する（設定する側と同じ build で入れ、記録できない期間を作らない）。`HIKYAKU_ANSWER_FROM` の値を決定のレコードに残し、最後の PR の本文の決定の一覧に答えの出どころを添える。この検査は取り違えを防ぐもので、子が環境変数を自分で付ける偽装は防げない（ADR で受け入れ済み。防ぐ仕組みは足さない）
- ユーザーに上げる問いは `AskUserQuestion` を出さず、固定文で子を再開して `ledger open --type question --who user --when now --ask <id>` を記録させ、コミット・push して blocked で終えさせる（error・2回目の violation・check-pr の不合格は従来どおりその場で上げる）。この「答えを待つ blocked」は本文に記録した事項の ID（`waiting: <id>`）を持たせ、build-09 の行き詰まりの報告の検査（3節）から外す。`parseFinalText` で、ID が実在する未決の事項を指すときだけ外す
- 監督の答えの検査（安全側の既定）で、上限を超える受け入れになる答えは `risk.mts` の上限と比べて判定する（US-13.3）
- `hikyaku conductor waiting <cycle>` と `next --json` の `waiting`: 作業ツリーと、tasklist の各ビルド・architect の origin のブランチの記録から、決定の無い `now` のユーザーの事項と、それを待つビルド（問いを出したビルドと推移的に依存するもの。ARCHITECT の問いは全ビルド）を導く。状態は保存しない
- `skills/conductor/SKILL.md`: Step 1 で `available` が空になったら待っている問いをまとめて尋ねる。答えごとに conductor ブランチを待っているビルドのブランチへ取り込み、`--from user` で子を再開する（session-id は保存しない）。逐次実行は保つ
- 事後同意（conductor の形）: 最後のビルドの子のときだけ同意ゲートを有効にし、サイクル全体の事項を対象にする（最後以外のビルドでは無効）。conductor の子での事後同意の有効化（build-16 で無効にしていたもの）と、同意ゲートを手順に入れること（build-06 で外していたもの）。最後以外のビルドの子では、`pr` の `accepts` の対象を最後のビルドの同意ゲートへ回す（`merge@` の事項で止めない）。前のフェーズの退けは build-17 の return.md の経路で最後のビルドから差し戻す。Step 4 で、ユーザーがレビューする最後の PR（conductor ブランチ→ベースブランチ）の本文に、`ledger pr-section` の全フェーズの一覧と同意・退けの決定と、宣言の変更（build-05 の `declarationChanged`。conductor ブランチとベースブランチの差分で導く）を載せる
- `conductor asks` の JSON に `deferredConsent` を足し、Step 0 の委任の範囲の確認に事後同意の有効・無効と、問いを積む方針の行を足す
- `skills/conductor/references/headless-protocol.md`・`docs/workflow/conductor.md` を直す。CHANGELOG に追記する

## やらないこと

- ビルドの並行実行（走りきりは止まらないことの要件で、並行は要件にしていない）
- 監督のセッションのファイルへの session-id の保存（状態を保存しない原則）
- 監督が記録をコミットすること（最後のビルドの子が同意を取る形にした）

## 対応する受け入れ基準

- US-13.3, US-15.1, US-15.2, US-15.3, US-15.4, US-19.7, US-20.6, US-20.9, US-21.1, US-21.2, US-21.3, US-21.4

## 受け入れ基準

- [ ] `--from supervisor` で安全側の既定以外の答え、またはユーザーの問いへの答えを渡すと、launch が拒否する
- [ ] conductor の子で、`HIKYAKU_ANSWER_FROM=user` が無いと `ledger decide --by user` が拒否される
- [ ] 答えを待つ blocked（実在する未決の事項の ID を持つ）は violation にならず、ID の無い・指す先の無い blocked は従来どおり検査される
- [ ] ユーザーに上げる問いが出ても、それに依存しないビルドが `available` に残り、依存するビルドは `waiting` に何の答えを待っているかが出る
- [ ] 事後同意のサイクルでは、上限を超える受け入れで止まらず、最後のビルドの同意ゲートで全フェーズの一覧が示される
- [ ] 最後の PR の本文の節に、全フェーズで受け入れたリスクと同意・退けの決定が載る（`pr-section` の出力）
- [ ] サイクルの中で宣言を変えていれば、最後の PR の本文に、変わったキーとそれを拠り所にした受け入れが載る
- [ ] Step 0 の表示に事後同意が出る
- [ ] `conductor lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「4. conductor の走りきり」、「1. 承認の種類と上限」（監督の答えは安全側だけ・答えの出どころの項）、「3. 事後同意」（conductor の項）
- `decisions` の `20261116-conductor-runs-to-end.md` — 問いを積む・待ちの導出・再開がこの判断に従う
- `decisions` の `20261116-deferred-consent.md` — conductor での同意の取り方と最後の PR の本文がこの判断に従う
- `decisions` の `20261116-pending-items-ledger.md` — 答えの出どころの検査がこの判断に従う

## 予測ピーク

読むファイル: `skills/conductor/SKILL.md`、`skills/conductor/references/headless-protocol.md`、`scripts/lib/conductor.mts`、`scripts/commands/conductor.mts`、`scripts/commands/next.mts`、`scripts/lib/tasklist.mts`、`scripts/lib/ledger.mts`・`scripts/commands/ledger.mts`、`scripts/lib/steps/consent.mts`・`directive.mts`・`build-manager.mts`・`builder.mts`（安全側の既定を出すステップ）、`scripts/lib/deferred-consent.mts`、`skills/builder/steps/consent.md`・`references/return.md`、build-06・build-16・build-17 の handoff、`scripts/lib/escalation.mts`、`scripts/lib/risk.mts`、`docs/workflow/conductor.md`
作成・変更するファイル: 上記の lib・commands・手順・docs、`tests/conductor.test.mts`、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 155k | conductor SKILL.md（約450行）・headless-protocol.md・lib と commands の conductor.mts・commands/next.mts・tasklist.mts・ledger.mts と commands/ledger.mts・consent.mts・deferred-consent.mts・directive.mts と build-manager・builder の steps 定義（安全側の既定）・builder の consent.md と references/return.md・escalation.mts・risk.mts・docs/workflow/conductor.md・ADR conductor-runs-to-end と deferred-consent・build-06・build-16・build-17 の handoff |
| 実装 | 85k | 安全側の既定と launch --from/--choice の検査、HIKYAKU_ANSWER_FROM の設定と ledger の検査、待ちの blocked の除外、conductor waiting と next の waiting、Step 0・1・3・4 の手順の書き換え、最後のビルドでの同意（事後同意の有効化・同意ゲート・pr の accepts の対象をサイクル全体へ）と、前のフェーズの退けを最後のビルドから差し戻す経路、最後の PR の本文 |
| テスト | 60k | 偽の gh と一時リポジトリでの waiting・launch の拒否・出どころの検査・待ちの blocked・asks の表示・最後以外の子が merge の事項で止まらないこと・最後のビルドの同意ゲート |
| 未知の領域 | 40k | 子の再開と取り込みの手順、既存の conductor の結合テストの調整 |
| **予測ピーク** | **430k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
