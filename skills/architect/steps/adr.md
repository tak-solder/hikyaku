# adr: 採用案を ADR に追記

確定した採用案（G3 で選ばれた案。値 `designChoiceGate` が false なら推奨案）を ADR として追記する。

- [ ] 昇格先は `document-guide.md` の `decisions` が指すパス
- [ ] `hikyaku` 管理の場合: 日付ベースのファイル名（`20260901-auth-strategy.md`）、`status: accepted`
- [ ] `repo` 管理の場合: 既存形式に合わせる。連番なら連番、独自テンプレートならそれに従う。
  既存に status 欄が無い場合、勝手に欄を足さずユーザーに提案して判断を仰ぐ（ask: adr-status）
- [ ] 記録項目: 決定 / 文脈 / 検討した案 / 採用理由 / トレードオフ / 影響範囲
  - **トレードオフ欄に「特になし」と書かない。** 書きたくなるなら `options` の分岐判定が誤っている
  - 既存エントリは書き換えない（覆すときは新エントリ + 旧を superseded）
  - `designChoiceGate` が false（G3 を行わない回。express の通常の回など）では、trade-off表と推奨理由をそのまま「検討した案」「採用理由」に残す
- [ ] 実装で確かめるまで決めきれず、暫定で決めた判断は、未決事項として記録する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger open architect {cycle} --type provisional --who <user|ai:build-NN> --when <gate:G4|phase:build-NN|merge@build-NN> --summary "<暫定の判断と、確かめること>"
```

  確かめるビルドが確定するなら `--who ai:build-NN`（そのビルドが `--by ai:build-NN` で決める）、
  ユーザーが確かめるなら `--who user`
