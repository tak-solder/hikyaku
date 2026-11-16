---
status: accepted
---

# 行き詰まりの報告の形式を、1つの検査関数で既存の関門に差し込んで確かめる

- **決定**: `scripts/lib/escalation.mts` の `checkEscalation(text)` が、「試したこと」（1項目以上）・「選択肢」（各項目に `失うもの:`）・「推奨」（空でない）が揃っているかの形式だけを判定する。差し込む先は4つ: return.md（`readReturn` が欠けを返し、builder の `stop` と `step restart architect --round return` が受け付けない）、retry-limit（`escalates: true` のステップの `failed --reason`）、conductor の `<hikyaku-blocked>`（`parseFinalText` で欠けを `violation` にする。violation はユーザーに上がるので安全側）。テンプレート（return.md・retry-policy・headless-protocol）を同じ3つの節にそろえる
- **文脈**: US-3.4 と原則3。行き詰まってユーザーに上げる報告に、問題を変える選択肢と失うもの、推奨が欠けていても、今は手順の完了として通ってしまう
- **外の前提**: なし
- **検討した案**:
  - Minimal: 検査関数を1つ作り、restart・stop・conductor parse に差し込む
  - Clean: 同上に加え、return.md の作成を `return create` の CLI 経由にする
  - Pragmatic: 上記の決定（Minimal に retry-limit の検査を足す）
- **推奨**: Pragmatic
- **採用理由**: 新しいコマンドもステップも足さず、既存の関門（`stop`・restart・`buildEvent`・`parseFinalText`）に差し込むだけで、行き詰まりの経路のすべてに同じ検査が効く
- **受け入れたこと**: return.md は手順の外で書かれるので、受け付けを拒むのは書いた直後ではなく、次の回を始めるときになる。選択肢が本当に問題を変えるものかまでは検査しない
- **トレードオフ**: 見出しの語を固定するので、テンプレートと検査を同時に直す必要がある
- **再評価条件**: 行き詰まりの報告の経路が、いまの4つ以外に増えたとき
- **退けた推奨で失う利点**: なし（推奨どおり採用）
- **影響範囲**: `scripts/lib/escalation.mts`（新規）、`scripts/lib/phase.mts`、`scripts/lib/steps/{engine,builder,architect}.mts`、`scripts/commands/step.mts`、`scripts/lib/conductor.mts`、`skills/builder/references/{templates,return,retry-policy}.md`、`skills/conductor/references/headless-protocol.md`
