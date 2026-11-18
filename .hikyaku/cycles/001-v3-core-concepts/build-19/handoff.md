# Build 19: conductor での事後同意（最後のビルドの子の同意ゲートと、最後の PR の一覧） 申し送り

## 後続ビルドが前提にすること

- conductor の子の同意の扱いは `conductorConsentMode`（`scripts/lib/steps/consent.mts`）だけが決める。`last`（最後のビルドの子。同意ゲートあり・対象はサイクル全体）／`deferred`（architect と最後以外のビルドの子。同意ゲートなし・pr は決定の無い項目で止めない）／`none`（従来どおり）。同意の対象を読む処理は `consentTargets` を通す。監督の評価は `asConductorChild` の中で同じ関数を呼ぶので、子と監督の現在地は割れない
- 「最後のビルド」は作業ツリーの tasklist の PR 列で決める。conductor では、ビルドの PR 列は conductor ブランチへ取り込まれて初めて見えるので、取り込みの順序が前提になる（ビルドを並行して取り込む形にするなら、この判定を見直す）
- 全ビルドの PR 列が埋まった後と、tasklist を読めないときの architect の子は `none`。後ろに同意ゲートが無いので、その場で止める（指摘からの追加設計の回など。コードレビュー2回目の指摘）
- サイクル全体の同意の対象（`cycleConsentItems`）は `merge@architect` と `merge@build-NN` だけ。`merge@close` とサイクルに属す patch の項目は、それぞれの単位の pr と同意ゲートが扱う
- 監督の上限を超える答えの risk の事項は、子の `ledger decide --by supervisor` が `HIKYAKU_ANSWER_DEFER=1` のときに書く（`source: "supervisor-answer"`・`token`）。同じ token の事項が既にあれば書かない。G3・G4 の deferred の根拠には数えない（`source: "step-report"` だけを数える）
- test-spec からの変更（安全側）: 「deferred の子は置き場を問わず `--defer` を受け付ける（pr を終えた後も）」を、「差し戻しの回でなく、PR を作る前（自分の PR 列も空）だけ受け付ける」に絞った。PR 列が埋まると、ほかのビルドが最後になって同意ゲートを過ぎているかもしれないため（コードレビュー1回目の指摘。review-findings で監督が受け入れた。questions.md）
- 監督が最後のビルドの同意ゲートの一覧を示すときは `ledger consent-list <build> --all --full`（子を装う環境変数を付けない）

## 残したこと

- 確度: 要確認 — 最後の PR を作る前の `undecided` の確認（`pr-section --all --json`）は、conductor スキルの Step 4 の指示文にあり、CLI のコマンドにはしていない。経路の側では、後ろに同意ゲートが無い子では先送りしない形に直した。CLI に持たせるかは、監督が最後の PR でユーザーに示す（コードレビュー2回目の指摘。review-findings で監督が proceed。questions.md）
- 同意の判定のたびに tasklist とサイクルの記録を読み直す（読むのは conductor の子だけ。害は成果物に残らない。コードレビュー1・2回目の指摘）
- 最後の PR の安全網は `undecided` だけを見て、退けた項目を見ない。作り直していない退けは最後のビルドの pr の accepts が拒み、作り直した退けは resolved の前でも通る（conductor 以外と同じ設計。「未解決の退け」の節に出る。コードレビュー1・2回目の指摘）
- 同意の項目ごとの決定の値（consented / rejected など）は、子がユーザーの答えの文面から読み取って記録する。`--by user` を書ける ID は launch の `--closes` で縛るが、値の取り違えは検出しない（plan の非機能要件で受け入れた残り）
- review-findings の監督の判断は decisions.jsonl に記録できず questions.md に残した（このセッションに監督の答えの環境変数が無い。build-07・17・18 と同じ事情）
- `step lint`・`conductor lint` は直接実行できなかった。`npm test` の中の同じコマンドの結合テストで通ることを確かめた
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない。変更はワークフローの承認の記録）
- コンテキストの目安を超えたまま継続した（G8 289k / 250k は前のセッション。このセッションはレビュー前 342k / 400k で目安の内）

## レビューの記録

- [重] `-`: deferred の子の `--defer`・監督の上限を超える答えを、PR を作った後や差し戻しの回でも受け付け、拾う同意ゲートが無くなりえた
- [重] `-`: 全ビルドの PR 列が埋まった後の architect の子（追加設計）も先送りでき、同意を取る場面が無くなりえた
- [重] `-`: 1つの監督の答えで複数の事項を閉じると risk の事項が重なり、書く順で決定だけが残りえた
- [重] `-`: `--closes` で決定済みの同意の項目を渡せ、受け入れの言葉つきの決定を弱められた
- [軽] `-`: サイクル全体の対象・`pr-section --all` の範囲に merge@close・patch の項目が入った
- [軽] `-`: 最後のビルドの取り直しが記録時刻で比べ、承認の後に取り込んだ前の時刻の項目を見落とした
- [軽] `-`: 監督が consent-list のために子の環境変数を付けていた（`--all` を足した）、tasklist の完了の判定の重複、docs の close-cycle の記述

## 永続化すること

- `decisions` [高]: ADR 20261116-deferred-consent に補う。conductor では、事後同意が有効なサイクルの最後のビルド（作業ツリーの tasklist で、ほかの全ビルドの PR 列が埋まっている）の子だけが同意ゲートを持ち、対象はサイクル全体（merge@architect・merge@build-NN）。architect と最後以外のビルドの子は同意ゲートを持たず、PR を作る前なら上限を超える受け入れを最後のビルドの同意ゲートへ回せる。後ろに同意ゲートが無い子（全ビルドの PR 列が埋まった後の architect・close-cycle）と、有効でないサイクルの子は、その場で止める（build-19。test-spec からの安全側の変更とコードレビューの指摘）
- `decisions` [高]: ADR 20261116-conductor-runs-to-end に補う。監督の上限を超える答えは、事後同意が有効で、子に同意ゲートの置き場があり、前提が宣言の参照だけのときだけ受け付け、その受け入れは子の `ledger decide --by supervisor` が risk の事項（who=user・when=merge@<unit>）としてスクリプトで書く。最後の PR の本文には `ledger pr-section --all` と `ledger premises --changed-from <ベースブランチ>` の出力を貼る（build-19）
