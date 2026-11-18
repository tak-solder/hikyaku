# Build 14: 質問と回答

## ask: branch — 作業ブランチ

- 状況: 現在のブランチ（hikyaku/001-v3-core-concepts/conductor）が、規則で期待するブランチ（hikyaku/001-v3-core-concepts/build-14）と一致しない
- 選択肢: 1. 規則に従い build-14 を作る（conductor から切るスタック。PR の base は conductor） / 2. 現在のブランチで作業する / 3. 別のブランチを指定する
- 回答（監督の委任された判断）: 1。hikyaku/001-v3-core-concepts/conductor から hikyaku/001-v3-core-concepts/build-14 を切る。PR の base は conductor
- 根拠: conductor の流れでは、各ビルドを conductor ブランチから切り、PR を conductor に向けて監督が取り込む。これまでのビルドもすべてこの形
