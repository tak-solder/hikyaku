# Build 06: 事後同意（PR を作る直前の同意ゲート） 申し送り

## 後続ビルドが前提にすること

- 決定として数えるかは `ledger.mts` の `consentDecided` が唯一の正。最新の決定が `by: user` の `consented` / `decided` / `resolved` で数え、`rejected` は数えない。害が高の異議の `consented` は `objectionSettled`（受け入れの言葉が要る）で判定する。`resolved` は異議でも数える。build-16（有効の判定・積み上げ）と build-17（作り直しの経路）は、この関数を変えずに使う
- 同意ゲートの `when` は、その作業単位の `decisions.jsonl` 1つだけで判定する（読めなければ手順に入れる）。ほかの単位で記録した `merge@<この単位>` の事項はゲートを出さず、pr（patch は publish）の `accepts`（サイクル全体を読む）と、各 pr.md の「PR を作る前の確認」（`ledger consent-list`）が拾う。requested のサイクルでゲートの範囲を全体へ広げるのは build-16
- 同意ゲートは conductor の子（`HIKYAKU_CONDUCTOR_CHILD=1`）では手順に入らない。監督（親）が子の手順の位置を確かめる `conductor` の `childStep` は `asConductorChild` で子と同じ条件で評価する（コードレビュー1回目の指摘。そのまま評価すると、正しく終えた子を「手順が終わっていない」と違反にする）。build-07 で最後のビルドの子にゲートを入れるときは、この2か所（`consentStep` の `when` と `childStep`）をそろえて変える
- `step report` は gate の `approved` でもステップ定義の `accepts` を確かめる。gate で `accepts` を持つのは今は consent だけ
- `reopens` は、承認のあとにその単位のファイルへ決定の足りない対象が足されたら承認を取り直す。ファイル1つだけを読むので、足された事項にほかの単位のファイルで決定を記録すると、決定が見えず取り直しになる（安全側。consent.md は同じ単位に記録する）
- 期限の判定（`mergeAnchor`）の区切りは、consent が手順の定義にあれば consent になる（builder・architect・patch）。既存の `merge@` の question・provisional は、consent に来た時点で「期限が来た」になる（consent が off の回も、並びの位置で判定するので同じ位置）
- `ledger pr-section --json` は `section`（Markdown）と、節ごとの ID の一覧（`accepted` / `undecided` / `rejected` / `beforeMerge` / `overdue`）を返す。`undecided` は最新が rejected の項目を含まない（「未解決の退け」に出すため）
- このビルド自身は、実行中のプラグイン（インストール済みの 3.0.0）に同意ゲートが無いので、従来の手順で進めた。リポジトリの CLI は権限で直接実行できず、`conductor lint`・`step lint` は `node --test` から起動して確かめた

## 残したこと

- コードレビュー2回目（最終ラウンド）で反映した指摘: 同意ゲートは今回の回で pr（patch は publish）を done にしたら手順に入れない（あとから対象が足されたときや、conductor の子が終えた単位を子でない環境で評価したときに、終えた pr をやり直しにしないため）/ ゲートの承認のあとに pr が止めたときの案内をその場で示す形に / ゲートの args が記録を読めないときに `error` を返す / `ledger consent-list` の最後の行に「決定が足りない項目」を必ず出し、指示文は件数を比べずにその行を読む
- 確度: 要確認 — CLI は PR の作成・公開そのものを止められない（`accepts` は報告の時だけ。ほかの単位で記録した `merge@<この単位>` の項目ではゲートも出ない）。止めるには `pr title` / `pr ready` などの手前に検査を挟む変更が要る。build-16（ゲートの範囲を全体へ広げる）で扱う候補。監督が build-16 の G8 で範囲に入っているかを確かめ、入っていなければユーザーに上げる（questions.md の Q2）
- コードレビュー2回目で採らなかった指摘（questions.md の Q2 で監督が「そのまま進める」と決定）
  - `reopens` がほかの単位で記録した決定を見ない（1回目と同じ指摘）
  - 1回の評価で同じ `decisions.jsonl` を `when` と `reopens` で2回読む（性能。振る舞いは変わらない）
- コードレビュー1回目で採らなかった指摘
  - `reopens` がほかの単位で記録した決定を見ない: 手順の位置だけを読む経路でも評価されるので、ファイル1つだけを読む設計（issue.md・plan.md）を守る。誤って取り直すのは安全側
  - `isConsentItem` が `isConsentRecord` の薄い包み: test-spec と後続ビルドが使う公開の関数として残す
  - ゲートの `when` と pr の `accepts` の範囲の違い: issue.md が定めた範囲（全体へ広げるのは build-16）。ゲートが外れているときの案内を、consent.md ではなくその場で示す案内に直した
- PR を作る前の確認（各 pr.md の `ledger consent-list`）は指示文の手順で、機械では止めない。PR の作成そのものを止めるのは `gh pr create` の前に CLI を挟む変更になり、このビルドの範囲を超える（`pr` の完了の記録は CLI が止める）
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない）

## 永続化すること

- `conventions` [中]: 「スクリプト」に、ステップの `when` が環境変数（`HIKYAKU_CONDUCTOR_CHILD`）で変わるときは、監督が子の手順の位置を評価する経路（`conductor` の `childStep`）も子と同じ条件で評価することを足す（評価がずれると、正しく終えた子を違反と読む。build-06 のコードレビュー1回目の指摘）
- `conventions` [中]: 「スクリプト」の ask タグの規約に、`（ask: deferred-consent）` は consent の種別（ユーザー固定）で、`（ask: delegation）` と同じく `[conductor] delegate` の対象にならないことを書く（build-04 の handoff の候補と合わせて）
- `decisions` [高]: ADR 20261116-deferred-consent に、同意ゲートの対象・決定として数えるもの（ユーザーの consented / decided / resolved、rejected は数えない、高の異議は受け入れの言葉つき）・ゲートが現れる範囲（その作業単位のファイル1つ。ほかの単位の事項は pr の accepts と PR 前の確認が拾う）・conductor の子での扱い（この時点ではゲートを置かず accepts だけ）を、実装済みの現実として足す（build-07・16 の結果に合わせて書く）
