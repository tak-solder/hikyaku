# split: 分割の検討（build-manager）

再算出した BP が `bpMax − 2` 以上（既定では 6 以上）で、issue.md のスコープが実際には BP を
超えている。`/hikyaku:build-manager {cycle}` を呼び出し、ビルドの分割を検討する。

- [ ] `/hikyaku:build-manager {cycle}` を呼び出す
  - 伝える情報: 再算出した BP と、plan.md のどこが issue.md の想定を超えているか
  - build-manager は directive の「呼ばれたスキルの手順」（`step next build-{NN} {cycle} --skill build-manager`）
    から始め、このビルドの progress.jsonl に記録する。G6 も build-manager の手順の中で取る
- [ ] 呼び出し後の対応
  - 現在のビルドのスコープが変わった場合: plan.md を修正し、`bp estimate` で算出し直す。
    承認は plan.md のハッシュに結びついているので、修正すれば承認は取り直しになる
  - 分割しなかった場合（ユーザーが分割しないと判断した等）: そのまま続ける
- [ ] build-manager が戻ったら `done` を報告する
- [ ] コミット & push する（progress.jsonl も含める）
