# retrospective: 振り返り

**昇格より先に行う。** 後に回すと、この回の振り返りで出た学びを昇格させる機会が
永久に無くなる（次の close-cycle は別のサイクルを見るため）。

- [ ] `/hikyaku:retrospective {cycle} close` を呼び出す
  - 呼ばれた側は、directive の「呼ばれたスキルの手順」（`callNext`）のコマンドで自分の手順を
    進め、`done` が返ったらここに戻る。実施するかの確認や記録の形は retrospective の手順が決める
- [ ] 戻ったら `done` を報告する。振り返りを実施しないとユーザーが答えた場合も `done` でよい
- [ ] `close/retrospective.md` と progress.jsonl をコミット & push する
