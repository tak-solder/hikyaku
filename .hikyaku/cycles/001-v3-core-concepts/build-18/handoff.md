# Build 18: 上限を超える異議と、事後同意の同意ゲートの範囲 申し送り

## 後続ビルドが前提にすること

- 「高として扱う異議か」は `isHighObjection`（`scripts/lib/ledger.mts`。害が高か `exceedsCeiling: true`）だけが判定する。`unacceptedObjections`・`consentDecided` はこれを呼ぶ。build-06 の handoff は `consentDecided` を変えずに使うとしていたが、条件だけをこの述語に置き換えた（rejected・resolved の扱いは同じ）
- 異議の上限との比較は `exceedsCeilingFor(effectiveDeclaration(config), harm, premises)`（`risk.mts`）。build-07 が監督の答えを上限と比べるときもこれを使える。基準の宣言を読めない回は超える、宣言が無ければ超えない
- `unacceptedObjections` がゲートの承認の検査から外すのは、`ledger object --defer` が書く形（`who=user`・`when=merge@<記録した単位>`・`exceedsCeiling: true`）の異議だけ。`ledger open --type objection` は `--when merge…` を拒む
- 同意ゲートの置き場（`consentGateSlot`）は consent ステップの定義の `slot` から引く。consent ステップを持たないスキルは置き場が無い
- `directiveOf` は既定で `positionOnly` の評価をする。記録を書くコマンド（`ledger open` / `object` の `currentStep`）は `positionOnly: false` を渡し、`step next` と同じ現在地を記録する（コードレビュー1回目の指摘）

## 残したこと

- 確度: 要確認 — 異議の重い領域は、AI が `--premises` に `area:<name>` を挙げたときだけ上限を超える判定に効き、G4 のような裏取りは無い。LLM の申告は上げる向きにしか効かない（ADR risk-ceiling-table の範囲内）。plan-review の懸念とコードレビュー2回目の指摘。G8 と review-findings で監督が進めると判断（questions.md）
- 確度: 要確認 — 事後同意を選んだサイクルで同意ゲートを承認したあと、ほかの作業単位で `when=merge@<この単位>` の事項が足されても、ゲートは開き直さない（`reopens` は単位のファイル1つだけを読む）。pr の accepts が止め、その場で一覧を示す案内になるので、同意を経ずに PR は完了しない（plan-review とコードレビュー2回目の指摘。questions.md）
- 事後同意を選んだサイクルでは、手順の位置だけを読む経路（Stop フック・step where・conductor parse の親の評価）は記録を読まずに同意ゲートを手順に入れるので、対象が無いときは `step next`（pr）と食い違う。issue.md が安全側として定めた設計どおり（コードレビュー1・2回目の指摘）
- `ledger object --defer` はゲートの最中以外からも呼べる。異議はユーザーに選ばせる問い（gate 以外）でも唱えるので、gate だけには絞らなかった。同意の一覧に事項を増やすだけで、同意を省く経路にはならない（コードレビュー2回目の指摘）
- 事後同意を選んだサイクルでは、1回の評価でサイクル全体の decisions.jsonl を複数回読む（同意ゲートの when・accepts・args）。正しさには影響しない（コードレビュー2回目の指摘）
- 「高として扱う異議には前提が要る」の検査が `ledger open` と `ledger object` に別々にある（コードレビュー2回目の指摘）。`risk.mts` は循環 import を避けるため `area:` を自前で解析する（コメントに理由）
- `step lint`・`conductor lint` は、このセッションの権限では直接実行できなかった。`npm test` の中の同じコマンドの結合テストで通ることを確かめた
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない。変更はワークフローの承認の記録）

## レビューの記録

- [重] `-`: 事項に記録する step が、位置だけの評価が安全側に入れた同意ゲート（consent）になっていた
- [重] `-`: who=user・merge@ の高の異議を、--defer の形でなくてもゲートの承認の検査から外していた
- [軽] `-`: ledger open が空の --premises で分かりにくいエラーを出していた
- [軽] `-`: isHighObjection が objectionSettled のコメントの間に入っていた
- [軽] `-`: cli.md に引数の要件を書いていた（help が正）
- [重] `-`: consent-list が、同意に受け入れの言葉が要る中の異議を示していなかった
- [軽] `-`: --defer が宣言に無い領域名を前提に受け付けていた

## 永続化すること

- `decisions` [高]: ADR 20261116-deferred-consent に補う。上限を超える異議の受け入れは、ADR・design-delta 3節の書く `risk` の事項ではなく `objection` の事項（`who=user`・`when=merge@<記録した単位>`・`exceedsCeiling: true`、basis・harm・loses つき）として `ledger object --defer` だけが積む。根拠と害を同意ゲートの一覧に残すため。積めるのは事後同意が有効で、前提が宣言（`app.*`・宣言済みの `area:*`）だけで、上限を超え、今の回に同意ゲートの置き場があるときだけ。事後同意を選んだサイクルでは、同意ゲートの対象をサイクル全体から探す（G8 で監督が判断。questions.md）
- `decisions` [高]: ADR 20261116-risk-ceiling-table に補う。上限は異議にも効き、害が中でも上限を超える異議（前提に宣言済みの重い領域を挙げた、または基準の宣言を読めない回を含む）は、高と同じく受け入れの言葉と前提が要る（US-13.3）
