# conductor（監督）振り返り

ARCHITECT 後の BUILD（build-01〜19）を conductor で走らせた監督セッションの振り返り。conductor にも close-cycle にも振り返りのステップは無く、ユーザーの指示（「振り返りまで実施」）で書いた。`promotionSources`（`scripts/lib/promotions.mts`）はこのディレクトリを読まないので、close-cycle の G10 で監督がこのファイルを示す。

## セッション中にスキル外で受けた指示

- 今回のサイクルで変わる conductor の振る舞い（同意ゲートはユーザーに固定、G6・G8 は監督が答える確認、安全側にだけ倒す、新ビルドやスコープの拡大はユーザーへ、問いを積んで独立なビルドを進める、「ユーザー」の用語）を、インストール済みの版より先に取り込んで振る舞う
- 子のビルドにも ADR を `.hikyaku/decisions/20261116-*.md` と同じ書式で書かせる（テンプレートも含む）
- 子が PR を作れないとき（`gh` の認証が無効）は、監督が GitHub の API で代行する
- 子にテストと型チェックの実行を許可する設定（`[conductor] allowed_tools`）は conductor ブランチにコミットし、その digest で進める
- build-07 の G8 で、子の中の `ledger decide --by user` はユーザーが答えた事項に限る（「子だけ厳しくする」）、`--no-risk` は残して使用をスクリプトが記録し、最後の PR の一覧もスクリプトが組み立てる（「B」）
- 最後の PR の後、監督の振り返りを書き、最後の PR をマージして close-cycle まで進める

## 永続化すること

- `upstream`: conductor の子はインストール済みの版の CLI とスキルで動くので、Hikyaku 自身を直すサイクルでは、そのサイクルで足した仕組み（agreement-review・ledger・行き詰まりの報告の検査・conductor の答えの出どころ）がそのサイクル自身には働かない。決定の記録（decisions.jsonl）も残らず、最後の PR の `ledger answers` / `pr-section --all` が空になる。監督の答えは各ビルドの questions.md にしか残らなかった
- `upstream`: `gh` が使えない環境では子が PR を作れない。build-09 で `pr ready` / `request-reviewers` は止まらなくなったが、`gh pr create` そのものの代わりは無い。監督の補足（本文を `.tmp/hikyaku-pr-{phase}.md` に書き、`<hikyaku-blocked>` で代行を依頼する。子は `/tmp` に書けないことがある）で回した。非対話規約にこの経路を入れる候補
- `upstream`: 子（`claude -p`）が G8 の承認を待たずに実装を書き始めた（build-04・build-08）。非対話規約の補足に「承認が先、実装が後」を足してからは起きていない。step の側で、G8 の承認の記録より前の実装の差分を検出する候補
- `upstream`: レビューの記録より先に handoff.md を作ると `step next` が stop を返す（build-01・05・06・11）。子は手順の順序を取り違えやすいので、stop のメッセージで「レビューの記録を先に」と案内するか、順序に依存しない判定にする候補
- `upstream`: G8 の時点でコンテキストが目安を超えたビルド（build-06・07・16・19）は、G8 の承認を記録して止めさせ、新しいセッションで implement から始めると最後まで通った。分割と G8 の差し戻しを同じセッションで重ねた build-07 は約 $25 かかった。G8 の後のセッションの切り替えを step が勧める候補
- `upstream`: 利用上限（429）やコンテナの再起動で子が止まると、結果ファイルは `is_error: true`・`api_error_status: 429` になるが、`conductor parse` はこれを出来事として分類しない。監督が結果ファイルを読んで同じ session-id を再開した。parse が API の失敗を `error` として返す候補
- `workflow` [中]: conductor の子では `node scripts/hikyaku.mts`（リポジトリの CLI）を実行できないので、`step lint`・`conductor lint` は監督が取り込みの前に実行する。conductor ブランチ向けの PR には CI が走らないので、監督の検証（tsc・step lint・conductor lint・npm test・`diff facts`）が唯一の検査になる（根拠: build-01〜19 の取り込み）（防ぐ: lint の食い違いが検査されずに conductor ブランチへ入る / 立つ: 既定の allowed_tools がプラグインの CLI だけ・CI の対象ブランチ）
- `upstream`: Step 2 の「子を起動する前にブランチを用意する」を飛ばすと、子が `branch` の問いで止まって起動が1回増える（build-19・14）。監督のスキルでブランチの用意を launch の前提として検査する候補

## 役に立たなかった記述

なし
