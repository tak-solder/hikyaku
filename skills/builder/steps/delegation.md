# delegation: 委任を続けるかの確認（設計と要件の衝突のあと）

設計と要件の衝突（design-conflict）を記録すると、どのステップの最中でもこのゲートが返る。委任の前提
（プロファイルで決めた承認とレビューの量、conductor に任せたこと）が崩れた出来事なので、委任を
続けるかをユーザーに尋ねる（ask: delegation）。プロファイルを切り替えるかはユーザーが決める。
あなたは切り替えない。

- [ ] 次をユーザーに提示する
  - 起きた出来事: design-conflict の事項（`hikyaku ledger show <ID>` の要約。何と何が矛盾しているか）
  - 現在のプロファイル（`hikyaku config {cycle}` の `profile`）と、conductor で進めているか
  - 選択肢: このまま委任を続ける / ユーザーがプロファイルや委任の範囲を変える（変えるのはユーザー。
    頼まれればサイクル設定を書き換えてよい）/ conductor を止めて対話で進める
  - design-conflict の選択肢（`references/return.md`）も並べ、同じ答えで決められるようにする
- [ ] 答えを `approved` の `--input` に書いて報告する。答えに design-conflict の選択が含まれていれば、
  その事項に `ledger decide build-{NN} <ID> {cycle} --decision decided --by user --input "<答え>"` で決定を記録する
- [ ] 報告したら、`references/return.md` の続き（選んだ選択肢の手順）に戻る
