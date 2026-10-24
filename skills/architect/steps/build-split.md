# build-split: ビルド分割（build-manager）

ビルド分割の承認は build-manager の G6 だけで取る。build-manager は `--dry-run` で差分を提示し、
承認後に初めて書き込むので、拒否されても外部に何も残らない。

- [ ] 設計に基づいてビルドの論理的な単位（タイトル・スコープ・依存関係）を整理する
  - 各ビルドをマージした時点で本番データを壊さないことを、分割の前提にする（SKILL.md の「守る原則」）
- [ ] `/hikyaku:build-manager {cycle}` を呼び出す
  - 伝える情報: 各ビルドのタイトル・スコープ・依存関係・参照すべき設計ドキュメント・
    design-delta.md の移行の段階
  - build-manager が BP見積もり、tasklist の更新、issue.md の作成、承認（G6）までを行う
  - build-manager は directive の「呼ばれたスキルの手順」（`step next architect {cycle} --skill build-manager`）
    から始め、architect と同じ design/progress.jsonl に記録する
- [ ] 値 `round` に応じて、build-manager に伝える操作を変える
  - `return`（差し戻しからの再設計）: 影響を受けるビルドは、追加よりも更新で扱う。差し戻し元の issue.md・BP・
    依存を改める。他のビルドに波及する場合はそれも更新する
  - `add`（指摘からの追加設計）: 指摘に対応するビルドを追加する。既存のビルドは完了しているので更新しない。
    issue.md の「やること」に、対応する指摘（PR のコメントの URL があればそれも）を書く。
    未完了のビルドが足されるまで `done` を受け付けない
- [ ] 戻ったら、G6 でのフィードバックの内容に応じて対応する
  - ビルド分割へのフィードバック → build-manager の中で反映済み（G6 の差し戻しとして扱われる）
  - 設計へのフィードバック → 設計に関する質問に戻る。`questions` を `done` で報告し直し、`step next` に従う。
    追加設計で `design-change` をスキップしていたら、`design-change` を `done` で報告し直す
- [ ] tasklist.md にビルドが書き込まれたら `done` を報告する（ビルドが無ければ受け付けない）
- [ ] コミット & push する（progress.jsonl も含める）
