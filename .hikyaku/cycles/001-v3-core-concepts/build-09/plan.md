# Build 09: 行き詰まりの報告の検査と、gh が使えないときの扱い

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/escalation.mts`（新規）

```ts
/** 3つの節の名前（表示と検査の両方で使う） */
export const ESCALATION_SECTIONS: { tried: "試したこと"; options: "選択肢"; recommendation: "推奨" };

export interface EscalationCheck {
  ok: boolean;
  /** 欠けの説明（1件1行。例: 「選択肢: 2件目に「失うもの:」がありません」） */
  problems: string[];
}

/** 形式だけを判定する。中身が問題を変えるものかは判定しない */
export function checkEscalation(text: string): EscalationCheck;

/** 欠けを、書き直しの案内つきの複数行にする（stop / restart / failed / violation の理由で共有） */
export function describeEscalationProblems(problems: string[]): string;
```

読み方:

- 節は、見出し（`#`〜`######` の行で、名前を含む。`問題を変える選択肢` も「選択肢」として読む）と、行頭のラベル（`試したこと:` / `**試したこと**：` など。コロンの後の同じ行の本文も中身に数える）のどちらでも始まる。次の見出しか、ほかの節のラベルで終わる
- テンプレートの置き場所の印（行全体が `（…）` の行）と空行は中身に数えない（テンプレートを埋めずに出したものを通さないため）
- 試したこと: 中身が1項目以上（リストの項目、またはリストが無ければ空でない本文を1項目と数える）
- 選択肢: 項目（行頭の `-` / `*` / `1.`）が1つ以上あり、各項目（続きの字下げ行を含む）に `失うもの:`（全角コロン可）がある。リストが無く同じ行の本文だけなら、それを1項目と数える
- 推奨: 中身が空でない

### 差し込む先

- `scripts/lib/phase.mts`: `ReturnRecord` に `problems: string[]`（checkEscalation の結果）を足す。`readReturn` が本文を検査する。見出しの読み方は変えない
- `scripts/lib/steps/builder.mts` の `stop`: return.md があり `problems` が空でなければ、「差し戻しの記録が欠けている」と欠けを示し、return.md を直して push するよう返す（差し戻し中で止まるのは同じ。理由の文面に欠けを足す）
- `scripts/lib/steps/architect.mts`: `stop` の案内の前に、欠けがあれば「return.md を直してから restart する」を示す
- `scripts/commands/step.mts` の `step restart`: `--round return` で、return.md が無い、または欠けがあれば受け付けない（`HikyakuError`）
- `scripts/lib/steps/engine.mts`: `StepDefinition.escalates?: boolean`（行き詰まりでユーザーに上げるステップ。`failed --reason` を checkEscalation で確かめる）。`lintApproval` は gate に付いたら問題として返す
- `scripts/commands/step.mts` の `buildEvent`: `failed` かつ `escalates` なら `--reason` を検査し、欠けがあれば受け付けない
- `scripts/lib/steps/builder.mts`・`scripts/lib/steps/patch.mts`: `implement`・`verify` に `escalates: true`（retry-policy は patch の verify も参照するため、両方に付ける）
- `scripts/lib/conductor.mts` の `parseFinalText`: `blocked` の本文を検査し、欠けがあれば `{ outcome: "violation", body, reason }`（reason に欠け）
- `scripts/lib/steps/hook.mts`: 変更しない（violation は「ブロックで終わっていない」と同じ扱いで、次の1手が run / call なら1回だけ引き止める既存の動きのまま）

### `pr request-reviewers`（`scripts/commands/reviewers.mts`・`scripts/lib/reviewers.mts`）

```ts
/** gh を呼ぶ前に決まる結果（skip・どちらの一覧も空）。決まらなければ undefined */
export function planWithoutPr(input: Pick<ReviewerInput, "phase" | "conductorBranch" | "reviewers" | "skip" | "phaseReviewers">): ReviewerPlan | undefined;
```

- `planWithoutPr` が結果を返せば、`gh` を一度も呼ばずに出力する
- `gh pr view` / `gh api graphql` / `gh pr edit` の失敗は投げずに、`applied: false`・`reason`（`gh-unavailable`: gh が無い / `gh-failed`: それ以外）・`stage`（どの呼び出しか）・`error`（1行目）・`manual`（ユーザーが代わりに行うこと: GitHub の PR 画面で依頼するレビュアーの一覧。マージ先が分からない段階なら、conductor ブランチ向けとそれ以外の両方の一覧）を出し、終了コード 0
- 成功時と何もしないときは `applied: true`（出力の既存の欄は変えない）
- `--pr` が無いときは従来どおり終了コード 1

### `pr ready`（`scripts/commands/pr-ready.mts`）

- conductor の子は `gh` を呼ばずに `conductor-child` を返す（子では Ready にしないので、状態を読む必要が無い）
- `gh pr view` を try で囲む。失敗したら `ready: false`・`applied: false`・`reason`（`gh-unavailable` / `gh-failed`）・`stage`・`error`・`manual`（`gh pr ready <PR>` を手で実行するか、GitHub の PR 画面で Ready for Review にする）を出し、終了コード 0
- `gh pr ready` の失敗も同じく `applied: false`・`manual`・終了コード 0（design-delta 11節「pr-ready の gh の呼び出しも同じ扱い」。Draft のまま残るだけで、取り込み前に監督かユーザーが Ready にする）
- 例外: 監督が取り込む直前の `--for-merge` は、view の失敗も `gh pr ready` の失敗も従来どおり終了コード 1（向き先が conductor ブランチであることを view で確かめられないまま正常終了にしない。conductor/SKILL.md の「失敗したら取り込まない」と揃える）
- 応答の形が不正（既存の検査）は従来どおり終了コード 1（gh は使えるのに状態が想定外で、推測で先へ進めない）

### 指示文・テンプレート

- `skills/builder/references/templates.md` の return.md: 「何が崩れたか」「試したこと」「問題を変える選択肢」（各項目に `失うもの:`）「推奨」「このビルドの状態」にする。「architect で決め直すこと」は選択肢に吸収する
- `skills/builder/references/return.md`: return.md は3つの節を CLI が確かめること（欠けていると architect の回を始められない）を1行足す
- `skills/builder/references/retry-policy.md`: 報告フォーマットを「問題 / 試したこと / 考えられる原因 / 問題を変える選択肢（失うもの） / 推奨」にし、上限に達したら報告を `failed --reason` に添えて記録してから提示する
- `skills/conductor/references/headless-protocol.md`: blocked の本文を3つの節の形にする（欠けると violation になる）
- `skills/conductor/SKILL.md` の violation: 再開のメッセージに `reason` を添える（欠けた節を子が知るため）
- 各 `steps/publish.md`（architect / builder / close-cycle / patch / planner）: `applied: false` なら、何ができなかったかと `manual` をユーザーに伝えて `done` を報告してよい
- `pr request-reviewers` を呼ぶほかの手順（`skills/init/steps/pr.md`・`skills/create-cycle/steps/pr.md`・`skills/token-guide/steps/pr.md`・`skills/conductor/SKILL.md` の最後の PR・`headless-protocol.md` の注記）: `applied: false` なら `manual` を伝える
- `skills/conductor/SKILL.md` の `pr ready --for-merge`: 終了コードで失敗を判定する既存の書き方のまま（`--for-merge` は終了コード 1 を保つため）。それ以外の `pr ready` の呼び出しがあれば `applied: false` の扱いを足す

### docs・CHANGELOG

- `docs/operations/troubleshooting.md`: gh が使えないときの `pr request-reviewers` / `pr ready` の出力と代わりに行うこと、blocked / return.md の欠けで止まったとき
- `docs/reference/cli.md`: `pr request-reviewers`・`pr ready` が gh の失敗で止めないこと
- `docs/workflow/architect.md`（restart は return.md の欠けで受け付けない）・`docs/workflow/build.md`（return.md の3つの節）・`docs/reference/directory-layout.md`（return.md で読むもの）・`docs/workflow/conductor.md`（blocked の欠けは violation）
- `CHANGELOG.md` の `[3.0.0]` に追記（バージョンは 3.0.0 のまま）

## 解釈したこと（G8 で確かめたい点）

- **すべての `<hikyaku-blocked>` を検査する。** ADR（escalation-report-check）と issue どおり、blocked の種類を区別しない。PR 作成の代行の依頼や権限不足のように「行き詰まり」に見えない blocked も、3つの節（試したこと / 選択肢と失うもの / 推奨）で書く必要がある。監督が環境ごとに補足する blocked の書式（この環境の「PR 作成の代行を依頼します」など）は、取り込み後はこの形に合わせないと violation（1回目は再開、2回目はユーザーに上がる。安全側）になる。handoff の「残したこと」に書く
- **`gh pr ready` 自体の失敗も止めない（`--for-merge` を除く）。** issue は `gh pr view` を try で囲むことだけを挙げるが、design-delta 11節は「pr-ready の gh の呼び出しも同じ扱い」とし、request-reviewers の書き込み（`gh pr edit`）の失敗も止めないので揃える。監督が取り込む直前の `--for-merge` だけは、向き先の確認と取り込みの判定に使うので従来どおり止める。`tests/pr-ready.test.mts` の「公開失敗は終了コード 1」の期待値を改める
- **欠けのある差し戻しの blocked は、conductor ではユーザーに上がる。** conductor/SKILL.md は violation を `returned` の判定より先に扱うので、Step 1（architect）へ進まず再開を経てユーザーに上がる（安全側）。handoff の「残したこと」に書く

## 非機能要件

- **セキュリティ**: 該当なし（gh の出力は1行目だけを出力に載せる。新しい外部送信は無い）
- **エラーハンドリング**: 検査の欠けは、どの経路でも `describeEscalationProblems` の同じ文面で示す
- **マージ時点のデータ安全**: プラグインのコードとテストだけの変更で、本番データに触れない。既存の return.md が3節の形でなければ、マージ後は builder が止まり architect の回を始められない（このブランチで差し戻し中のものは無い。`cycle status` で returned は無い）。progress.jsonl・tasklist.md・cycles.md の形は変えない

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 305k |
| builderフェーズ段階 | 340k |

**読むファイル**

- `scripts/lib/phase.mts`（約 220 行）、`scripts/lib/steps/builder.mts`・`architect.mts`・`engine.mts`・`hook.mts`
- `scripts/commands/step.mts`（約 520 行）、`scripts/lib/conductor.mts` の `parseFinalText`
- `scripts/commands/reviewers.mts`・`scripts/lib/reviewers.mts`・`scripts/commands/pr-ready.mts`・`scripts/commands/external.mts`（手本）・`scripts/lib/github.mts`
- `skills/builder/references/templates.md`・`return.md`・`retry-policy.md`、`skills/conductor/references/headless-protocol.md`・`SKILL.md` の violation、各 `steps/publish.md`
- `tests/conductor.test.mts`・`tests/pr-ready.test.mts`、return.md を書く既存テスト（phase / step / step-architect / step-consent / cli / objection）
- `docs/operations/troubleshooting.md`・`docs/reference/cli.md`・`docs/workflow/{architect,build,conductor}.md`・`docs/reference/directory-layout.md`
- `scripts/lib/steps/patch.mts`、`skills/{init,create-cycle,token-guide}/steps/pr.md`、`skills/conductor/SKILL.md` の pr ready と violation、`tests/helpers.mts`

**作成するファイル**

- `scripts/lib/escalation.mts`（約 120 行）
- `tests/escalation.test.mts`（約 120 行）
- 上記の lib・commands・テンプレート・手順・テスト・docs の変更、`CHANGELOG.md`

**builderフェーズ段階の内訳**（plan-review の指摘で、読むファイルと未知の領域を見積もり直した）

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 90k | phase/builder/architect/engine/patch/step.mts/conductor.mts parseFinalText・hook.mts・reviewers(commands/lib)・pr-ready・external（手本）・github.mts・templates/return/retry-policy/headless-protocol・conductor SKILL の pr ready と violation・init/create-cycle/token-guide の pr.md・publish.md 5つ・conductor/pr-ready/step/objection/step-consent テストと helpers.mts・docs 6ファイル（約 70k は読了） |
| 実装 | 60k | escalation.mts 新規（約120行）、readReturn・builder/architect stop・restart・failed・parseFinalText の差し込み、reviewers の事前判定と gh 失敗の扱い、pr-ready の gh 失敗と for-merge の例外、テンプレート3つ・手順 約10ファイル・docs 6ファイル・CHANGELOG |
| テスト | 55k | escalation の unit、restart/stop/failed の拒否、parseFinalText、偽の gh（無い・失敗）、既存 return.md のフィクスチャ約20か所の書き換え |
| 未知の領域 | 45k | 既存テストの return.md フィクスチャと終了コード 1 の期待値の波及、gh が無い環境の PATH の隔離、gh-unavailable と gh-failed の判別（stage ごと） |
| **予測ピーク** | **340k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [x] Step 1: `escalation.mts` と unit テスト
- [x] Step 2: `readReturn`・builder / architect の `stop`・`step restart --round return` の拒否、既存テストの return.md フィクスチャを3節の形に（共通の定数を `tests/helpers.mts` に置く）
- [x] Step 3: `escalates` と `failed --reason` の検査、`step lint` の検査
- [x] Step 4: `parseFinalText` の blocked の検査とテスト
- [x] Step 5: `pr request-reviewers` の事前判定と gh の失敗の扱い、`tests/conductor.test.mts` の期待値の変更、gh が無い環境の結合テスト
- [x] Step 6: `pr ready` の子の扱いと gh の失敗、`tests/pr-ready.test.mts`
- [x] Step 7: テンプレート・retry-policy・headless-protocol・conductor SKILL・publish.md
- [x] Step 8: docs と CHANGELOG
