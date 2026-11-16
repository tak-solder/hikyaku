# Build 09: 行き詰まりの報告の検査と、gh が使えないときの扱い

## やること

- `scripts/lib/escalation.mts` を新しく作る: `checkEscalation(text)` が「試したこと」（1項目以上）・「選択肢」（各項目に `失うもの:`）・「推奨」（空でない）の形式だけを判定する（見出しと行頭のラベルのどちらでも読める）
- 差し込む先: `readReturn` が欠けを返し、builder の `stop` が「差し戻しの記録が欠けている」と返す。`step restart architect --round return` は欠けがあれば受け付けない。`StepDefinition.escalates` が付いたステップ（builder の implement・verify）の `failed --reason` を検査する。`parseFinalText` で `<hikyaku-blocked>` の本文を検査し、欠けていれば `violation`
- return.md・retry-policy・headless-protocol の書式を、同じ3つの節にそろえる
- `pr request-reviewers`: skip と空の一覧を `gh` より前に判定する。`gh` の失敗（無い・認証・GraphQL・`gh pr edit`）は、`external sync` と同じく `applied: false`・理由・ユーザーが代わりに行うこと・終了コード 0 で返す。`tests/conductor.test.mts` の期待値（終了コード 1）を改める
- `pr ready` の `gh pr view` を try で囲み、`gh` が無いときに何ができなかったかとユーザーが代わりに行うことを示す。各 publish.md の扱いを合わせる
- docs（`operations/troubleshooting.md`・`reference/cli.md`）を直す。CHANGELOG に追記する

## やらないこと

- 選択肢が本当に問題を変えるものかの判定（LLM とユーザーが読む）
- `gh pr create` 自体の代替（各 pr.md で LLM が実行するもの。PR を作れないときは本文を用意して止まる既存の扱いのまま）

## 対応する受け入れ基準

- US-3.1, US-3.2, US-3.3, US-3.4, US-18.1, US-18.2

## 受け入れ基準

- [ ] 3つのどれかが欠けた return.md では、builder が止まる理由に欠けが示され、architect の再設計の回を始められない
- [ ] 欠けた `<hikyaku-blocked>` は violation になる。欠けた retry-limit の `failed --reason` は受け付けない
- [ ] `gh` が無い環境で `pr request-reviewers` と `pr ready` が手順を止める失敗にならず、代わりに行うことが示される（偽の gh の結合テスト）
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「6. 行き詰まりの報告」と「11. 文書の登録と `gh`」（`gh` の項）
- `decisions` の `20261116-escalation-report-check.md` — 検査の形と差し込む先がこの判断に従う

## 予測ピーク

読むファイル: `scripts/lib/phase.mts`、`scripts/lib/steps/builder.mts`・`architect.mts`・`engine.mts`、`scripts/commands/step.mts`、`scripts/lib/conductor.mts`、`skills/builder/references/templates.md`・`return.md`・`retry-policy.md`、`skills/conductor/references/headless-protocol.md`、`scripts/commands/reviewers.mts`、`scripts/lib/reviewers.mts`、`scripts/lib/github.mts`、`scripts/commands/pr-ready.mts`、`scripts/commands/external.mts`、`tests/conductor.test.mts`
作成・変更するファイル: `scripts/lib/escalation.mts`、`tests/escalation.test.mts`、上記の lib・commands・テンプレート・手順・テスト・docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 90k | phase.mts の readReturn・builder と architect と engine の steps 定義・commands/step.mts（restart・failed）・conductor.mts の parseFinalText・builder の templates/return/retry-policy・headless-protocol・commands/reviewers.mts・lib/reviewers.mts・github.mts・commands/pr-ready.mts・commands/external.mts（手本）・conductor.test の該当 |
| 実装 | 50k | escalation.mts 新規（約150行）と4か所への差し込み、テンプレートの3節、request-reviewers の skip と gh の失敗の扱い、pr-ready の gh の扱い |
| テスト | 50k | escalation の unit、restart の拒否、偽の gh での終了コード 0 |
| 未知の領域 | 25k | 既存テストの期待値（終了コード 1）の変更の波及 |
| **予測ピーク** | **305k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
