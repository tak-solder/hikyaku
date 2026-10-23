# handoff: 申し送りの作成

- [ ] `cycles/{cycle}/build-{NN}/handoff.md` を作成する
  - テンプレートは `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/templates.md`（[templates.md](../references/templates.md)）を参照
  - 前半は後続ビルド向け: 実装内容の要約 / 公開インターフェース / 環境変更 / 意図的に残した未対応
  - 後半は close-cycle 向けの昇格素材: overview への影響 / 新たな制約 / 踏んだ落とし穴 / 覆した設計判断とその理由
  - 書かない: 実装の全詳細（コードが正）/ 一般的な進捗報告

handoff.md の後半は節ごとに昇格先が決まっている（overview・constraints・learnings・ADR）。
どこに書くか迷う発見は、後から読む人が何を直すことになるかで節を選ぶと、close-cycle が
仕分けし直さずに昇格させられる。あなたが永続ドキュメントを直接書き換えることはない。

- [ ] `done` を報告する
- [ ] コミット & push する（progress.jsonl も含める）
