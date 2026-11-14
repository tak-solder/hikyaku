# triage-approval: 振り分けの承認

振り分けの結果を提示し、承認を得る。既存の文書から項目を消す・移す操作なので、**承認前に書き込まない。**

- [ ] 置き場ごとに、移すもの・消すものを分けて示す。件数と、重要度の内訳を添える

```
対象: docs/learnings.md（42 項目）

移す（14 件）:
  rule .claude/rules/backend-tests.md（paths: backend/tests/**）
    [高] （一行の要約）
    [中] （一行の要約）
  rule .claude/rules/migrations.md（paths: db/migrations/**）
    [高] （一行の要約）
  constraints:
    [高] （一行の要約）
  その場のコメント:
    [中] src/app.css の宣言行に、消してはいけない理由を書く

消す（28 件）:
  既に機械で防がれている: 13 件
  他の文書と重複している: 7 件
  重要度が低（すぐ直せる・一般的な知識）: 8 件

機械で防げるが未対応（rule に仮置きし、PR の本文に対策を並べる）: 3 件

document-guide.md: learnings の行を外す。docs/learnings.md は削除する
```

  - 「消す」の内訳は、求められたら1件ずつ示せるようにしておく
  - 元のファイルを削除するか、Hikyaku の管理から外すだけにする（ファイルは残す）かを尋ねる
- [ ] 承認の `--input` には、承認した範囲が分かるように書く
- [ ] 直す指示があれば、反映してから提示し直す
