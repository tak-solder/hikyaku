# split: 分割の検討（build-manager）

再算出した BP が大きく、issue.md のスコープが実際には BP を超えている（理由は directive の「理由」）。
`/hikyaku:build-manager {cycle}` でビルドの分割を検討する。

- [ ] 戻ったら
  - 現在のビルドのスコープが変わった場合: plan.md を修正し、`bp estimate` で算出し直して、`split` ではなく
    `plan` を `done` で報告し直す（`--bp` に算出し直した BP）。分割の検討が要るかは step が判定し直す
  - 分割しなかった場合（ユーザーが分割しないと判断した等）: そのまま `done` を報告する
