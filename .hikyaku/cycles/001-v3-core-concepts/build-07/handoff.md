# Build 07: conductor の走りきりと、監督は安全側にだけ倒すこと 申し送り

## 後続ビルドが前提にすること

- 子の決定の記録は、`conductor launch` が置く環境変数（`ANSWER_ENV`。`scripts/lib/conductor.mts`）で縛られる。判定は `answerProblem`、決定に足す欄は `answerFields`（`scripts/lib/ledger.mts`）。子でないセッションでは何も変わらない。build-19 の同意ゲートで監督が一覧の全項目を閉じるときも、`--from user --closes <全項目の ID>` で渡す。ただし `--closes` は今は「question・who=user・when=now で、再開する子の作業単位の事項」だけを受け付けるので、build-19 で同意の項目（risk・objection・merge@）を閉じるならこの条件を広げる必要がある
- 監督の答えは、子が止まっているゲートの問い（`--ask`）の事項にだけ記録できる。`ledger decide --by supervisor` は、事項の `ask` と `HIKYAKU_ANSWER_ASK` が違えば拒む（コードレビュー1回目の指摘）
- 上限を超える監督の申告は、事後同意の有無に関わらず `checkSupervisorAnswer`（`scripts/commands/conductor.mts`）の4番目の検査で拒む。build-19 が「事後同意が有効なら子に risk を積ませて受け付ける」分岐を足すのはここ
- 「答えを待つ事項」の判定は `isWaitingRecord` / `isWaitingItem`（ledger.mts）だけで、`conductor parse`・`launch --closes`・`deriveWaiting` が共有する
- 待ちの導出（`deriveWaiting`）が読む origin の断面は、architect・close・各ビルドのブランチと、各ビルドのブランチの `design/decisions.jsonl`（差し戻しの再設計の記録先）

## 残したこと

- 確度: 要確認 — `[app]` の宣言が無いワークスペースでは、監督が害「高」の申告（questions、review-findings の proceed）を受け付ける。ADR risk-ceiling-table の「宣言が無ければ上限を設けない」と、G8 で承認した test-spec のシナリオどおり。`ledger object` は害が高ならユーザーの `--accepts` を求めるので、扱いが食い違う。新ビルドにするかはユーザーが決める（コードレビュー2回目の指摘。review-findings で監督が「そのまま進める」と判断。questions.md）
- 確度: 要確認 — plan の単位で決定の無い who=user・when=now の question があると、全ビルドが待ちになる。監督は `--closes` で plan の事項を閉じられないので、そこで止まりうる（止まる向きで、安全側）。G8 で承認したシナリオ。create の単位は数えないように直した（コードレビュー2回目の指摘。questions.md）
- `next` が毎回、origin の各ブランチを git で読む（並列にはした）。conductor を使わない人も、その時間を払う（コードレビュー2回目の指摘。害は成果物に残らない）
- リスクの申告が要る問いの判定が、`RISK_DECLARING_ASKS`（`declaresRisk`）と `needsRiskDeclaration` の2か所にある（コードレビュー2回目の指摘。保守のしやすさの問題）
- G8 1回目のユーザーの判断2件と review-findings の監督の判断は、decisions.jsonl に記録できず questions.md に残した。インストール済みのプラグイン（3.0.0）に `ledger` が無く、リポジトリの CLI はこのセッションの権限で実行できない（build-17・18 と同じ事情）
- `step lint`・`conductor lint` は直接実行できなかった。`npm test` の中の同じコマンドの結合テストで通ることを確かめた
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない。変更はワークフローの承認の記録）
- コンテキストの目安を超えたまま継続した（G8 367k / 250k、実装開始前 412k / 300k）。承認済みで残りが PR までだったため

## レビューの記録

- [重] `-`: `--closes` の答えをダブルクォートで子のシェルに渡しており、`$` やバッククォートが展開され、先頭の `-` でフラグと読まれた
- [重] `-`: 監督の答えを、渡した問いと違う事項にも記録でき、申告の要る答えが申告なしで残った
- [重] `-`: 子が止まっているゲートと違う `--ask` を名乗ると、同意の回を確認として通せた
- [重] `-`: `--closes` で別の作業単位の事項を閉じられ、事項と決定が別のブランチに分かれた
- [重] `-`: `ledger object --answers` が待ちの事項を閉じず、待ちが残り続けた
- [重] `-`: 待ちの導出が close のブランチと差し戻しの再設計の記録（ビルドのブランチの design/）を読まず、その問いが消えた
- [軽] `-`: ほかの答え方のフラグ（`--closes`・`--choice`・`--ask` など）を黙って落としていた
- [軽] `-`: `waiting:` の行が改行をまたいで次の行の語を ID と読み、1行の複数 ID を読まなかった
- [軽] `-`: `--expect-answer` が error・violation でも、記録を読めないときも「記録が無い」と報告した
- [軽] `-`: 待ちの判定の述語の重複、`escalateUnit` の書式の重複、origin の断面の直列の読み込み

## 永続化すること

- `decisions` [高]: ADR 20261116-escalation-report-check に補う。conductor の blocked のうち、本文の行頭 `waiting: <ID>` が作業ツリーの記録にある未決のユーザーの問い（question・who=user・when=now）を指すもの（答えを待つ blocked）は、行き詰まりの報告の検査から外す。問いを ID で記録に裏取りでき、行き詰まりではなくユーザーの答えを待つだけのため。指す先が1つでも無ければ従来どおり検査する（ADR の再評価条件「検査する経路が増減したとき」に当たる）
- `decisions` [高]: ADR 20261116-pending-items-ledger に補う。conductor の子の `--by user` は、ユーザーの答えで再開された起動（`HIKYAKU_ANSWER_FROM=user`）が `--closes` で渡された事項（`HIKYAKU_ANSWER_ITEMS`）にだけ書ける。`--by supervisor` は監督の答えの起動だけが書け、問い・値・リスクの申告・起動の印を環境変数から決定に必ず残す（G8 1回目のユーザーの判断。questions.md）
- `decisions` [中]: ADR 20261116-conductor-runs-to-end に補う。最後の PR の本文の「監督が答えた問い」は `ledger answers --format pr` の出力を貼り、`--no-risk` の答えもスクリプトが記録から示す（監督は書き写さない。G8 1回目のユーザーの判断）
