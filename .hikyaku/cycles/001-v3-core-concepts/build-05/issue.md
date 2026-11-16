# Build 05: 宣言の変更の見直し・記録のテンプレート・ポインタの検査

## やること

- `hikyaku ledger premises --changed-from <base>`: merge-base と HEAD の `[app]`・`[[app.areas]]` の差分から変わったキーを出し、それを拠り所にした受け入れを並べる。対象は作業ツリーにある全サイクルの `decisions.jsonl` の受け入れと、`decisions`（ADR）・`constraints` の「受け入れたこと」の行（`（拠り所: \`<参照>\`）` で終わる行。所在は `loadGuide` で引く）
- 各フェーズの `pr` の args に `declarationChanged` を添え、PR 本文に載せる手順を pr.md に足す。`validate --base <ref>` でも同じ一覧を警告する。`docs/operations/ci.md` に CI での例を足す
- `validate` に警告の段階（JSON の `warnings`、終了コード 0）を足し、永続ドキュメントとサイクルドキュメントのポインタに ID の範囲（`X-1〜X-5` の形）が添えられていれば警告する
- ADR のテンプレート（`skills/architect/references/templates.md`）に、外の前提（事実か仮定か・確かめた日）・推奨・受け入れたこと（拠り所）・再評価条件・退けた推奨で失う利点・領域（任意。`領域: \`<glob>\`` の行。build-10 の `areas dormant` が読む書式はここで決める）の欄を足す。`skills/architect/steps/adr.md` の記録項目も直す
- constraints のテンプレートを `skills/close-cycle/references/` に新しく作り（前提・事実か仮定か・確かめた日・受け入れたこと・再評価条件・領域（任意。ADR と同じ `領域:` の行））、close-cycle の write から指す
- design-questions.md のテンプレートに、選択肢・各案の欠点・推奨・回答と、推奨を退けたときに失う利点の欄を足す。`skills/architect/steps/questions.md` も直す
- ポインタに件数や範囲を添えさせている指示文を直す（build-manager と builder の templates、close-cycle の G10 と collect、init の pr と triage-approval、conductor の SKILL.md、token-guide の propose。予測ピークの根拠の列挙は、ポインタではなく見積もりの根拠として残す）
- CHANGELOG に追記する

## やらないこと

- サイクルをまたぐ未決を、ADR の再評価条件などから知らせること（スコープ外 Q12）
- 既存の旧形式の ADR・constraints の書き換え（スコープ外 Q5）
- 外の前提と受け入れたリスクを AI が書き換え・削除する手順（US-6.4 により作らない）

## 対応する受け入れ基準

- US-5.5, US-6.1, US-6.2, US-6.3, US-6.4, US-6.6, US-7.1, US-7.2, US-8.1, US-8.2, US-13.5

## 受け入れ基準

- [ ] 宣言を変えたブランチで `ledger premises` が、拠り所にした受け入れ（記録と ADR・constraints の行）を並べる（一時リポジトリの結合テスト）
- [ ] `validate` が ID の範囲を警告として示し、終了コードは 0 のまま
- [ ] ADR・constraints・design-questions のテンプレートに、前提・判断・推奨・受け入れたこと・再評価条件・失う利点を分けて書ける
- [ ] ADR と constraints のテンプレートに、前提と基準を領域（パス）に結び付ける `領域:` の行を書ける
- [ ] ポインタに件数や範囲を添えさせる指示が残っていない（grep で確かめる）
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「1. 承認の種類と上限」（宣言の変更の項）と「8. 記録のテンプレート」
- `decisions` の `20261116-risk-ceiling-table.md` — 「受け入れたこと」の行の書式の実例
- `decisions` の `20261116-pending-items-ledger.md` — 前提の参照の書式がこの判断に従う
- `conventions`（AGENTS.md）の「設計の原則（v3）」7・9

## 予測ピーク

読むファイル: `scripts/lib/ledger.mts`、`scripts/lib/docs.mts`、`scripts/commands/validate.mts`、`scripts/lib/config.mts`、`scripts/lib/risk.mts`（基準側の宣言の読み取り）、`scripts/lib/git.mts`・`stack.mts`（`resolvePrBase`）、`scripts/lib/steps/` の各スキルの定義（`pr` の args）、各スキルの `steps/pr.md`、`skills/architect/references/templates.md`・`steps/adr.md`・`steps/questions.md`、`skills/close-cycle/references/`・`steps/write.md`、件数を書かせている指示文（`skills/build-manager/references/templates.md`、`skills/builder/references/templates.md`、`skills/close-cycle/steps/G10.md`・`collect.md`、`skills/init/steps/pr.md`・`triage-approval.md`、`skills/conductor/SKILL.md`、`skills/token-guide/steps/propose.md`）、`docs/operations/ci.md`
作成・変更するファイル: `scripts/commands/ledger.mts`（premises）、`scripts/commands/validate.mts`、`skills/close-cycle/references/constraints-template.md`、上記の手順・テンプレート・docs、テスト、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 110k | ledger.mts・docs.mts（loadGuide）・commands/validate.mts・config.mts・risk.mts（基準側の宣言）・git.mts と stack.mts（resolvePrBase）・各スキルの steps 定義（pr の args）と steps/pr.md・architect の templates/adr/questions・close-cycle の references・件数を書かせている指示文（build-manager と builder の templates、close-cycle の G10 と collect、init の pr と triage-approval、conductor SKILL、token-guide の propose）・ci.md |
| 実装 | 60k | ledger premises（decisions.jsonl と ADR・constraints の受け入れの行）、validate --base と警告の段階・ID 範囲の検査、pr の args declarationChanged、ADR（領域の欄を含む）・constraints・design-questions のテンプレート、件数の指示の修正 |
| テスト | 45k | premises の差分と照合、validate の警告（終了コード 0）、範囲の検出 |
| 未知の領域 | 25k | ADR の受け入れの行の書式の揺れ |
| **予測ピーク** | **330k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
