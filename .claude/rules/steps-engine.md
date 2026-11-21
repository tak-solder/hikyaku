---
paths:
  - "scripts/lib/steps/**"
  - "scripts/lib/conductor.mts"
  - "scripts/commands/step.mts"
---

# ステップエンジンと手順の定義

- gate は承認の種類を `consent`（確認なら `false`）、プロファイル・個別キーのオン・オフを `enabled`、構造の条件を `when` に分けて書く。`when` に設定の条件を書くと、同意の回まで設定で消えるが、`step lint` はこの誤りを検出しない。
- どのステップの最中にも起きる出来事のあとに尋ねるゲートは `interrupt` で定義し、並びに置かない。並びに置くと、承認が後ろのステップをやり直しにする。期限や位置を見る処理は `Evaluation.sequential` を使う。
- 位置だけを読む評価（`directiveOf` の既定、`notices: false`）は未決事項の記録を読まない。例外は割り込みのゲートのきっかけ（その作業単位の decisions.jsonl 1つ）で、読めなければそのスキルが止まる。事項を記録するコマンドの `step` は `step next` と同じ評価で求める。位置だけの評価を使うと、安全側に入れたゲートが記録に残り、退けの戻り先を誤る。
- `when` が環境変数（`HIKYAKU_CONDUCTOR_CHILD`）で変わるなら、監督が子の位置を評価する `childStep` も子と同じ条件で評価する。ずれると、正しく終えた子を違反と読む。
- `when` が書き換わりうる記録（decisions.jsonl など）を読むなら、後ろの区切りのステップ（pr など）をその回で終えたら手順から外す。外さないと、あとから記録が足されたときに承認の無いゲートが現れ、終えた pr をやり直しにする。
- ゲートを足したら、そのゲートが承認する成果物を作る run を `reworks` に書く。省くと退けたときに最も近い前の run へ戻り、作り直しが広すぎるか狭すぎる。`step lint` は書き忘れを検出しない。
- directive の args に配列やオブジェクトを載せたら、テキストの directive（`--json` なし）で中身が読めるかをテストで確かめる。スキルは `step next` をテキストで呼ぶので、`[object Object]` になると手順が黙って働かない。
