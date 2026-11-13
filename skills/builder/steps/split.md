# split: 分割の検討（build-manager）

見積もり直した予測ピークが `split_above` を超えていて、issue.md のスコープが実際には1セッションに
収まらない見込み（理由は directive の「理由」）。`/hikyaku:build-manager {cycle}` でビルドの分割を検討する。

- [ ] 伝える情報: 見積もり直した予測ピークとその内訳、plan.md のどこが issue.md の想定を超えているか
- [ ] 戻ったら
  - 現在のビルドのスコープが変わった場合: plan.md を修正し、`tokens estimate` で見積もり直して、`split` ではなく
    `plan` を `done` で報告し直す（`--peak` に見積もり直した予測ピーク）。分割の検討が要るかは step が判定し直す
  - 分割しなかった場合（ユーザーが分割しないと判断した、許容する理由に当たる等）: そのまま `done` を報告する
