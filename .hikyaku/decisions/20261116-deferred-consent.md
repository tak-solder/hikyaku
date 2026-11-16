---
status: accepted
---

# 事後同意は PR を作る直前の同意ゲートで取り、conductor では最後のビルドの子が取る

- **決定**: サイクルの `.hikyaku.config` にだけ `[consent] deferred = true` を書ける（ルートに書いたらエラー）。PR の基準（merge-base）のサイクル設定にも同じ値があるときだけ有効にする（作業中のブランチで足しても効かない）。アプリケーションの状況の宣言に、マージがユーザーの関門である前提（`[app] merge_gate = "user"` 相当のキー。名前は実装で決める）が書かれていなければ有効にせず、理由を `config`・各 directive の `notices`・`conductor asks` に示し続ける。有効なとき、上限を超えるリスクの受け入れ（G3・異議・監督の答え）は止まらずに `risk` の事項（`who=user`、`when=merge`）として記録に積む。`consentStep(skill)` が PR を作る直前に同意ゲート（ask: `deferred-consent`、ユーザーに固定）を置き、`ledger consent-list` が組み立てた一覧で項目ごとに同意か退けを記録してから PR を作る。PR 本文の節は `ledger pr-section` が組み立てる。同じ作業単位の判断を退けたらそのステップへ戻り、前のフェーズの判断なら `return.md` で差し戻す。conductor のときは、最後のビルドの子が PR を作る前の同意ゲートで、サイクル全体の事項について同意を取る（監督はコミットしない）。そのうえで、ユーザーがレビューする最後の PR（conductor ブランチ→ベースブランチ）の本文に、全フェーズで受け入れたリスクの一覧と同意・退けの決定を載せる
- **文脈**: US-20 で、速度を優先するユーザーが、上限を超えるリスクの受け入れをマージの前にまとめて同意できるようにする。同意を省くのではなく遅らせる（US-10.5）
- **外の前提**:
  - Hikyaku はデプロイを行わず、マージの前の同意はリスクが利用者に届く前の引き受けになる（事実。concepts.md、2026-11-16 確認）
  - 利用者のリポジトリでマージがユーザーの関門になっているか（自動マージしない、マージがそのままリリースにならない）は、Hikyaku からは確かめない。ユーザーが宣言に書く（仮定。Q9 の回答による。GitHub の設定は確かめていない）
- **検討した案**:
  - Minimal: `post_consent`。前提が欠けたら設定エラーで止める。conductor では最後のビルドの子が同意を取る
  - Clean: `[consent] defer` と、全フェーズの PR 本文をスクリプトが組み立てる `pr body`。conductor では監督が記録をコミットする
  - Pragmatic: `[consent] deferred` と `consentStep`、`ledger pr-section`。前提が欠けたら有効にせず理由を示す
- **推奨**: Pragmatic。conductor のところだけ Minimal の形
- **採用理由**: 同意ゲートの部品が既存の `publicationStep` と同じ型に乗る。conductor で最後のビルドの子が同意を取れば、監督がコミットしない原則を保ち、退けた項目も既存の `return.md` の経路（US-20.11）に乗る
- **受け入れたこと**: PR を作る時点でユーザーが居ないと止まる（Q9 で受け入れ）。conductor で前のフェーズの判断を退けたときは、元のフェーズへ直接は戻らず、最後のビルドからの差し戻しとして architect が再設計する（拠り所: マージがユーザーの関門という宣言）
- **トレードオフ**: patch では PR を Draft で先に作るので、同意は Draft の PR ができた状態で取る
- **再評価条件**: マージがユーザーの関門という前提が、GitHub の設定などから機械で確かめられるようになったとき。退けた項目の作り直しで差し戻しが頻発したとき
- **退けた推奨で失う利点**: なし（推奨どおり採用。最後の PR の本文に全フェーズの一覧と決定を載せることは、ユーザーの追加の指示）
- **影響範囲**: `scripts/lib/config.mts`（サイクル設定でだけ書けるキーの新設）、`scripts/lib/steps/consent.mts`（新規）、architect・builder・patch の手順、`scripts/lib/conductor.mts`、`scripts/commands/ledger.mts`、各 `skills/*/steps/pr.md`、`skills/conductor/SKILL.md`、`docs/configuration/config-file.md`・`profiles.md`
