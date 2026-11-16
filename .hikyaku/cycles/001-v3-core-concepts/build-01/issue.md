# Build 01: 承認の種類の基盤（エンジン・G1・conductor の同意）

## やること

- `StepDefinition` に `consent(ctx)`（`"now" | "deferred" | false` と理由）と `enabled(ctx)` を足し、エンジンの評価を `on = when && (consent || enabled !== false)` にする。同意の回はどの設定でも外さない
- 各ゲートの定義（planner・architect・builder・build-manager・close-cycle・patch）の `when` から `gates.*` の条件を `enabled` に移す。`when` は構造の条件だけにする
- G1 を `consent: now` に固定し、`user_stories_gate` キーを廃止する（書かれていれば移行のヒントつきのエラー）
- G3・G4 の `consent`: 差し戻しからの再設計の回（`roundOf(ctx) === "return"`）なら `now`（US-14.4）。上限・境界による同意は build-02・build-12 が足す
- directive に `approval`（確認 / 同意）と理由を出す
- conductor: `Handler` の値を `"human"` から `"user"` に改める。`DEFAULT_HANDLERS.consent = "user"`、`consent` を `FIXED_CATEGORIES` に入れ、`delegate` でも上書きできないようにする。ASKS の G6・G8 を confirm に直す。`conductor parse` が子のステップの `approval` を `resolveAsk` に渡す
- `step lint` に「gate は承認の種類を持つ」の検査を足す
- `skills/conductor/SKILL.md` の Step 0 から、同意ゲートを監督に委任させる文面を除く
- `docs/configuration/profiles.md` のゲート表に確認か同意かの列を足し、G1 の扱いの記述を実装に合わせる。`config-file.md` から `user_stories_gate` を除く
- CHANGELOG の `[3.0.0]` に追記する

## やらないこと

- 上限（アプリケーションの状況）による G3 の同意（build-02）、外との境界による G4 の同意（build-12）
- 事後同意の `deferred` の扱い（build-06。この build では `consent` が `deferred` を返す経路を作らない）
- G10 の候補ごとの区分（build-11）
- 文面の「人間」→「ユーザー」の全体の置き換え（build-14。この build で触れる行は「ユーザー」で書く）
- 既存のワークスペースとの互換（スコープ外 Q5）

## 対応する受け入れ基準

- US-10.1, US-10.2, US-10.4, US-14.3, US-14.4

## 受け入れ基準

- [ ] どのプロファイル・個別キーの組み合わせでも、`consent` が `now` を返すゲートは手順から外れない（G1、再設計回の G3・G4）
- [ ] `user_stories_gate` を書いた設定は、移行のヒントつきのエラーになる
- [ ] conductor の振り分けで、同意のゲートは `escalate`・`delegate` の設定に関わらずユーザーに上がる。G6・G8 は監督が答えられる
- [ ] express の再設計回で G3 と G4 がユーザーに上がる
- [ ] `step lint`・`conductor lint`・`npx tsc --noEmit`・`npm test` が通る
- [ ] profiles.md から、各ゲートが確認か同意かが分かる

## 参照する設計ドキュメント

- `design/design-delta.md` の「1. 承認の種類と上限」（ステップ定義が承認の種類を持つ・directive・conductor の項）
- `decisions` の `20261116-approval-kind-in-step-definitions.md` — エンジンの評価式・G1・conductor の固定がこの判断に従う
- `conventions`（AGENTS.md）の「設計の原則（v3）」11 と「スクリプト」の ask タグの規約

## 予測ピーク

読むファイル: `scripts/lib/steps/engine.mts`、`scripts/lib/steps/directive.mts`、`scripts/lib/steps/` の各スキルの定義、`scripts/lib/conductor.mts`、`scripts/commands/conductor.mts`、`scripts/lib/config.mts`、`scripts/commands/step.mts`、`tests/step*.test.mts`・`tests/conductor.test.mts`・`tests/config.test.mts`、`docs/configuration/profiles.md`、`skills/conductor/SKILL.md`
作成・変更するファイル: 上記の lib・commands・テスト、`docs/configuration/profiles.md`・`config-file.md`、`skills/conductor/SKILL.md`、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 110k | engine.mts・directive.mts・各スキルの steps 定義（planner・architect・builder・build-manager・close-cycle・patch）・lib と commands の conductor.mts・config.mts（Gates・PROFILES・finalize）・commands/step.mts（step lint）・関連テスト（step 系・conductor・config）・profiles.md・conductor SKILL.md の Step 0・ADR approval-kind |
| 実装 | 70k | engine の consent/enabled と評価、各ゲート定義の when から enabled への移し替え、G1 固定と user_stories_gate の廃止、ASKS の再分類と同意の固定・Handler を user に、step lint の検査、profiles.md の列、conductor SKILL.md の委任の文面 |
| テスト | 60k | 同意を外せない、G4 の再設計回、conductor の振り分け、廃止キーのエラー。既存の期待値の書き換え |
| 未知の領域 | 30k | ゲート定義の when を分けたときに巻き戻る結合テストの調整 |
| **予測ピーク** | **360k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
