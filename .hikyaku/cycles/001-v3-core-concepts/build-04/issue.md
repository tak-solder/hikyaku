# Build 04: 異議と、各フェーズが未決事項を記録する手順

## やること

- `hikyaku ledger object`: `objection` の事項（根拠の宣言・記録の参照、失うもの、害の重さ）とユーザーの決定を対で書く。害が高なら `--accepts`（ユーザーの言葉）と `--premises` が必須
- すべてのゲートの `accepts` に「そのステップの高の異議に `accepts` 付きの決定がある」を足す
- gate の directive に、スクリプトが固定の短い指示（どの宣言・記録と食い違うときに異を唱えるか、好みの違いには唱えない、`ledger object` の呼び方）と、照合に使える宣言・記録のポインタを載せる。各スキルの指示文には写さない
- 委任の前提が崩れた出来事: builder の `（ask: design-conflict）` で `ledger open --type question --ask design-conflict` を記録する。architect の差し戻しからの再設計の回の先頭と、design-conflict の事項が記録された直後の builder に、gate `delegation`（`（ask: delegation）`、ユーザーに固定）を置く
- planner の G1 の args に profile を添え、提示に「このプロファイルのままでよいか」を1行出す
- 記録する側の手順に `ledger open` を差し込む: planner（未回答の質問）、architect（暫定の設計判断）、build-manager（G6 での受け入れ）、builder（handoff の「残したこと」を事項にし、handoff には ID のポインタだけを書く）、サイクルに属す patch（`persist`）、close-cycle（`close` 期限の事項を示して決定を記録）
- `skills/conductor/references/headless-protocol.md` の監督の判断の記録先を `decisions.jsonl` に改める
- ASKS とタグを同期する（`delegation`）。docs の各フェーズの説明を直す。CHANGELOG に追記する

## やらないこと

- 事後同意に回す異議（build-06）、conductor の監督の答えの検査（build-07）
- 異議の害の段階の新設（Q3 で persistence.md の重要度を流用）
- handoff の「レビューの記録」の見出し（build-10）

## 対応する受け入れ基準

- US-1.1, US-1.2, US-1.3, US-1.4, US-1.5, US-1.6, US-14.1, US-14.2, US-19.1

## 受け入れ基準

- [ ] 害が高の異議があるゲートは、ユーザーが受け入れることを書いた決定が無ければ承認を受け付けない。中の異議は記録だけで進む
- [ ] 異議と決定の両方が `decisions.jsonl` に残り、`ledger list` で追える
- [ ] 再設計の回の先頭と design-conflict の記録の後に `delegation` が出て、conductor ではユーザーに上がる
- [ ] G1 の提示にプロファイルの確認が出る
- [ ] 記録する側の各手順が `ledger open` を呼ぶ（指示文の差し込みと、builder・planner の結合テスト）
- [ ] `conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「1. 承認の種類と上限」（委任の前提が崩れた出来事の項）と「2. 未決事項と決定の記録」（異議を出す範囲・異議・記録する側の項）
- `decisions` の `20261116-pending-items-ledger.md` — 異議の記録先と付け替えの禁止がこの判断に従う
- `conventions`（AGENTS.md）の「スクリプト」の ask タグと ASKS の規約

## 予測ピーク

読むファイル: `scripts/lib/ledger.mts`、`scripts/lib/steps/directive.mts`・`engine.mts`・`planner.mts`・`architect.mts`・`builder.mts`・`build-manager.mts`・`close-cycle.mts`・`patch.mts`（各ゲートの accepts と delegation の置き場）、`scripts/commands/step.mts`、`docs/workflow/` の各フェーズ、`skills/planner/steps/user-stories.md`・`G1.md`、`skills/architect/steps/adr.md`・`design-delta.md`・`references/return.md`、`skills/build-manager/steps/G6.md`、`skills/builder/steps/handoff.md`・`references/templates.md`・`references/return.md`、`skills/patch/steps/persist.md`、`skills/close-cycle/steps/collect.md`・`G10.md`、`skills/conductor/references/headless-protocol.md`、`scripts/lib/conductor.mts`
作成・変更するファイル: `scripts/commands/ledger.mts`（object）、上記の lib・手順、`skills/architect/steps/delegation.md`・`skills/builder/steps/delegation.md`、docs の各フェーズ、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 120k | ledger.mts・directive.mts・engine.mts と各スキルの steps 定義（planner・architect・builder・build-manager・close-cycle・patch）・commands/step.mts・planner の user-stories と G1・architect の adr/design-delta/return・build-manager の G6・builder の handoff/templates/return・patch の persist・close-cycle の collect と G10・conductor の headless-protocol・conductor.mts の ASKS・docs/workflow の各フェーズ |
| 実装 | 70k | ledger object、gate の accepts（高の異議）、directive の異議の固定指示、delegation ゲート（architect の再設計回・builder の design-conflict の後）、G1 のプロファイル表示、記録する側の手順の差し込み（md 約10ファイル）、ASKS とタグ |
| テスト | 55k | 異議の accepts、delegation の出現条件、builder・planner の結合テスト、conductor lint |
| 未知の領域 | 30k | 既存の指示文の書式（questions.md の見出しの深さの違い）をそろえる範囲 |
| **予測ピーク** | **365k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
