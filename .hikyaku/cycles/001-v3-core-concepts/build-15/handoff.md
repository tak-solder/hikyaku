# Build 15: G3・G4 を宣言の上限で同意にする（害とパスの申告と裏取り） 申し送り

## 後続ビルドが前提にすること

- options の申告（`--harm` / `--paths`）は、推奨案だけでなく G3 に提示する全案についての申告（最も重い害と、全案が触れるパスの和）。G3 でどの案を選んでも、上限を超える案があれば同意になる（plan-review の指摘から決めた。questions.md の G8）
- G3・G4 の宣言による同意は、ゲートを通り過ぎたあとは付け直さない。G3 は、この回の options の最後の done より後に adr の done があれば、G4 は design-delta の最後の done より後に build-split の done があれば、その時点の判定のまま（`architect.mts` の `passedOver`）。差し戻しからの再設計の回の同意はこれに関わらない。build-06 が `deferred` を足すときも、同じ固定に乗せる
- G4 の裏取りで申告として数えるのは、この回の options の申告（スキップ・`--paths` 無しなら空）と、前の回の options の申告の和。design-delta.md と ADR はサイクルで積み上がるため（追加設計の回で、前の回に申告済みの領域まで毎回上げない）
- G3 は options の done の前、G4 は design-delta の done の前には、宣言を読まずに false を返す（Stop フックで git を読まないため）。この前提で、G3・G4 の位置は変わらない（どちらもそのステップより後ろにある）
- G4 の args は `undeclaredAreas`（`{ name, touched }[]`）と、裏取りできなかった回だけ `verified: false`。build-12 が G4 の提示（gate brief）を組むときはこの値を使う
- `steps/architect.mts` は `risk.mts` 経由で `steps/index.mts` と循環する。テストで `architect.mts` を最初に import すると `ARCHITECT_STEPS` の初期化前参照になるので、`steps/index.mts` の `stepsOf` から引く（`tests/step-risk-gates.test.mts` の冒頭にコメント）

## 残したこと

- 確度: 要確認 — options をスキップした回（分岐する判断が無い回）は、害の重さを上限と比べない。G3 は手順から外れ、G4 はパスと重い領域しか照合しないので、上限が「中まで」か「何も任せない」の宣言で、重い領域に触れない害「高」の設計が同意なしで通りうる。design-delta.md 1節と ADR approval-kind-in-step-definitions のとおりの振る舞いで、変えるには設計の変更が要る（コードレビューの指摘。questions.md の review-findings）。ユーザーが最後の PR で判断する。問題を変える選択肢と、それぞれで失うもの:
  - そのまま（現状）: 分岐の無い設計は、重い領域に触れない限り express・conductor で止まらない。失うのは、上限を超える害の設計を止める保証（申告の場が無い）
  - 上限が「何も任せない」の宣言では、options をスキップした回も G4 を同意にする: 上限の表の「すべてユーザーに上げる」と揃う。失うのは、`public` など最上段の軸を持つワークスペースで、分岐の無い小さな設計でも毎回 G4 で止まること（conductor の再開の回数と費用が増える）
  - 上限が「中まで」または「何も任せない」の宣言では、options をスキップした回も done に `--harm` を必須にし、上限を超えれば G4 を同意にする: 害の申告の場ができる。失うのは、skipped の報告の意味（分岐なし）と申告が混ざることと、architect の手順・ステップ定義の変更（design-delta と ADR の改訂が要る）
- 確度: 要確認 — `cycleAdrs`（build-02）は、基準との merge-base より後に変わった decisions のファイルをすべて「このサイクルの ADR」として扱う。別のサイクルの未マージの ADR が同じブランチに積まれていると、その ADR の触れる重い領域で G4 が余計に同意になる。外れても上げる側（コードレビューの指摘。questions.md の review-findings）
- 確度: 要確認 — `touchedPaths` は design-delta.md で「変えない」と書いたパスも拾うので、そのパスが重い領域に当たると G4 が同意になる。外れても上げる側。避けるなら文書に書くパスを絞る運用（コードレビューの指摘。questions.md の review-findings）
- コードレビューで不採用にした指摘: G4 を確認として承認したあとに design-delta.md を書き換えても、G4 は開き直らない。エンジンの既存の扱い（承認したあとの変更は Git の履歴で追い、取り直すときは前のステップを報告し直す）と同じなので変えない
- `repositoryFiles`（risk.mts）と `trackedFiles`（rules.mts）の返り方の違い（空と undefined）は揃えていない。このビルドは `repositoryFiles` だけを使い、git が使えず空が返っても、重い領域との照合は字義どおり・見本の照合で当たる側に倒れる（build-02 から持ち越し）
- `step lint`・`conductor lint` は、このセッションの権限ではリポジトリのスクリプトを実行できず、回していない。ステップ定義の検査は `npm test`（`step lint: プラグイン本体のゲートはすべて承認の種類を持つ`・`lintApproval(architect)`）で確かめた。`（ask: …）` のタグは足していない
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない。変更はワークフローの承認ゲートで、アプリケーションのアクセス制御ではない）

## 永続化すること

- `decisions` [高]: ADR 20261116-approval-kind-in-step-definitions に補う。G3 の `--harm` / `--paths` は、G3 に提示するすべての案のうち最も重い害と全案が触れるパスの和を申告する（どの案を選んでも上限を超える案があれば同意にするため。受け入れ基準「上限を超える案が無ければ確認として省ける」）。宣言による同意は、ゲートを通り過ぎたあと（G3 は adr の done、G4 は build-split の done のあと）は付け直さない（承認の記録の無いゲートが現在地に戻り、後ろの作業がやり直しになるのを防ぐ。前のステップを報告し直せば判定し直す）。G4 の裏取りは、前の回の options の申告も申告として数える（plan-review とコードレビューの指摘、questions.md の G8・review-findings）
