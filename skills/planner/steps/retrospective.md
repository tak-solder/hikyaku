# retrospective: 振り返り

- [ ] `/hikyaku:retrospective {cycle} planning` を呼び出す
  - 呼ばれた側は、directive の「呼ばれたスキルの手順」（`callNext`）のコマンドで自分の手順を
    進め、`done` が返ったらここに戻る。実施するかの確認や記録の形は retrospective の手順が決める
- [ ] 戻ったら `done` を報告する。振り返りを実施しないとユーザーが答えた場合も `done` でよい
- [ ] retrospective.md と progress.jsonl をコミット & push する
