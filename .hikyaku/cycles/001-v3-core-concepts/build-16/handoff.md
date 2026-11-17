# Build 16: 事後同意の有効の判定と、上限を超える受け入れの積み上げ 申し送り

## 後続ビルドが前提にすること

- 事後同意の有効の判定は `deferredConsent(config, cycleDirectory)`（`scripts/lib/deferred-consent.mts`）だけが行う。`ResolvedConfig.consent.deferred` は書いた素の値で、有効かどうかではない。`config --json` の `deferredConsent` も同じ関数の値
- G1 の承認の記録（planning/progress.jsonl の `deferredConsent`）は、planner の今回の回（最後の `step restart` より後）の、G1 の最新の記録だけを読む。最新が `rejected` なら前の承認は数えない
- G1 で事後同意の値を変える手順は「設定を直してコミット → ユーザーの答えを `rejected` で報告 → 提示し直す」の順（`skills/planner/steps/G1.md`）。`step report` は、サイクル設定の最後のコミットが、最後の提示の起点（G1 の直前に完了したステップか G1 の差し戻しのうち最後の記録）より前のときだけ値を記録する。提示と同じ秒のコミットは後とみなす。design-delta 3節の「G1 の提示に出し、承認の記録に残す」を、提示の時刻が記録に無い制約の中で実現した形（コードレビュー1・2回目の指摘）
- G3・G4 が `deferred` になるのは、`step report` が自動で積んだ事項（`source: "step-report"`、`ask` がそのゲート、その回の options / design-delta の最後の done 以後、最新の決定が `rejected` でない）の `premises` が、いまの判定の前提をすべて覆うときだけ。事項は design/ の decisions.jsonl 1つだけを読み、手順の位置だけを読む経路でも同じ結果を返す。build-18 が異議を積むときも `source` で手書きと区別できる
- 事後同意が無効な回の G3 は、害の申告が上限を超えたら重い領域を照合せずに返す（理由の文面は害の超過だけになる）。有効な回は、積む事項の前提のために両方を照合する
- directive の notices の「事後同意が有効になっていません」は、planner では出さない（G1 で値を提示して合意する場なので）
- `step report` には `options` の宣言が無く、知らないオプションはエラーにならない（`--deferred-consent` を渡しても無視され、記録の値は設定から読む）。test-spec のこのシナリオは、この挙動で確かめていない

## 残したこと

- 確度: 要確認 — options / design-delta を done で報告し直すたびに新しい risk の事項が積まれ、前の事項は取り下げられない。古い事項にも同意ゲートでユーザーの決定が要る（who=user の事項を AI が閉じる経路は無い）。直すには ledger に取り下げの記録の種類を足す設計の変更が要る（コードレビュー1・2回目の指摘。questions.md の review-findings。監督が最後の PR でユーザーに示す）
- 確度: 要確認 — rebase・amend・cherry-pick でサイクル設定のコミットの committer date が変わると、ユーザーが G1 の前に選んだ値でも `false` で記録されうる（有効にならない側に外れる）。そのときは G1 を取り直すか、ベースブランチへマージする（コードレビュー2回目の指摘。questions.md の review-findings。監督が最後の PR でユーザーに示す）
- 作業ブランチの planning/progress.jsonl を書き換えて G1 の記録を偽装することは防がない。ADR pending-items-ledger の「受け入れたこと」と同じ種類（plan で受け入れ済み。コードレビュー1回目の指摘）
- 事後同意を選んだサイクルでは、手順の位置だけを読む経路（Stop フック・step where・conductor parse）でも、G3・G4 の判定で基準と decisions.jsonl を読む。各 directive の notices を組み立てるときも基準を読み直す。G3・G4 の位置をずらさないこと、有効でない理由を出し続けることを優先した plan の設計どおり（コードレビュー1・2回目の指摘）
- `isConductorChild`（steps/consent.mts）と `CONFIG_FILE`（risk.mts）を deferred-consent.mts に重複して持つ。consent.mts は ledger.mts 経由で steps/ と循環するので import しない（コードレビュー2回目の指摘）
- 基準のコミットからファイルを読む処理（`git show` と `parseToml`）が risk.mts と deferred-consent.mts に別々にある。読めない基準の扱いは、どちらも有効にしない・同意にする側で揃っている（コードレビュー1回目の指摘）
- `step lint`・`conductor lint` は、このセッションの権限では直接実行できなかった。`npm test` の中の同じコマンドの結合テスト（`tests/step.test.mts`・`tests/step-consent.test.mts`・`tests/conductor.test.mts`）で通ることを確かめた
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない。変更はワークフローの承認ゲートで、アプリケーションのアクセス制御ではない）

## レビューの記録

- [重] `-`: G1 で値を直して提示し直す流れが、常に false で記録されていた
- [重] `-`: G1 の判定が、restart や差し戻しのあとも古い承認を数えていた
- [軽] `-`: コミットの時刻の秒の精度で、提示と同じ秒の書き換えを見逃していた
- [軽] `-`: 事後同意が無効な回にも、G3 が重い領域の照合（リポジトリ全体のファイル一覧）を行っていた
- [軽] `-`: docs の [consent] の節で、条件と理由を入れ子の箇条書きにしていた（AGENTS.md の docs の書き方）
- [重] `-`: 差し戻しのあとに提示し直してからコミットした値も、承認した値として記録していた
- [重] `-`: ユーザーが退けた事項でも、G3・G4 を deferred にしていた
- [軽] `-`: planner で G1 の前から「事後同意が有効になっていません」を出していた

## 永続化すること

- `decisions` [高]: ADR 20261116-deferred-consent に補う。G1 の承認の記録に値を残すのは、サイクル設定の最後のコミットが最後の提示の起点（G1 の直前に完了したステップか G1 の差し戻しのうち最後の記録）より前のときだけで、値を変えるときは設定をコミットしてから差し戻しを報告して提示し直す（提示の時刻が記録に無いため）。(b) のマージされた値は、デフォルトブランチと defaultBase の読めたすべての ref の merge-base に値があるときだけ成り立つ。G3・G4 の deferred は、step report が自動で積み、ユーザーが退けていない事項の前提が判定の前提を覆うときだけ（覆わなければ now に戻る）。conductor の子では build-07 まで有効にしない（コードレビュー1・2回目の指摘、questions.md の review-findings）
