# Build 19: 質問と回答

## ask: branch — 作業ブランチ

- 状況: 現在のブランチ（hikyaku/001-v3-core-concepts/conductor）が、規則で期待するブランチ（hikyaku/001-v3-core-concepts/build-19）と一致しない
- 選択肢: 1. 規則に従い build-19 を作る（conductor から切るスタック。PR の base は conductor） / 2. 現在のブランチで作業する / 3. 別のブランチを指定する
- 回答（監督の委任された判断）: 1。hikyaku/001-v3-core-concepts/conductor から hikyaku/001-v3-core-concepts/build-19 を切る。PR の base は conductor
- 根拠: conductor の流れでは、各ビルドを conductor ブランチから切り、PR を conductor に向けて監督が取り込む。これまでのビルドもすべてこの形

## G8: plan.md と test-spec.md の承認

- 回答（監督の委任された判断）: 承認する
- 根拠: issue.md の受け入れ基準はすべて test-spec のシナリオに対応している（`gate brief G8` で未対応なし）。「（解釈）」の4件は、閉じられる ID を狭める・risk の事項を書く場合を絞る・ビルド1つのサイクルを最後とみなすもので、どれも止める向き（安全側）。監督が上限を超える受け入れを答えられるのは、事後同意が有効で子に同意ゲートの置き場があり、前提が宣言の参照だけのときに限られ、その受け入れは risk の事項（who=user・when=merge）としてスクリプトが書き、最後のビルドの同意ゲートでユーザーが決めるまで PR を完了させない（同意を遅らせるだけで省かない。ADR deferred-consent・原則11）。Step 4 の安全網も入っている。残るリスク（同意の値の読み取り違いは検出しない）は handoff の「残したこと」に書く。予測ピーク 450k は split_above 以下
- 進め方（G8 の時点）: このセッションのコンテキストが大きい（G8 の時点で 284k / 目安 250k）ため、implement には進まずに終え、監督が新しいセッションで implement から続ける

## ask: review-findings — コードレビュー2ラウンド後の未解決の指摘

- 状況: コードレビュー（上限2ラウンド）の後、不採用にした4件（性能の読み直し／退けた項目を見ない安全網／未マージのビルドの記録／最後の PR の前の undecided の確認が指示文だけ）が残った
- 選択肢: proceed / fix / new-build
- 回答（監督の委任された判断）: proceed。不採用の4件は理由を handoff の「残したこと」に書き、handoff → PR へ進む。test-spec からの安全側の変更（deferred の子の --defer を PR の前だけにした）も handoff に記録する
- 根拠: 1 はセッションのコストで、害が成果物に残らない。2・3 はスクリプトの accepts と conductor の取り込みの順序で起きないか、既存の設計どおり。4 は経路の側で先送りしない形に直っており、CLI に持たせるのは新ビルド（スコープの拡大）になるので監督は選ばない。最後の PR では監督が Step 4 で `pr-section --all --json` の undecided を確かめ、4 を新ビルドにするかはそこでユーザーに示す
