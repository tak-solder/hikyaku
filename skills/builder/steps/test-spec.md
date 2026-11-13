# test-spec: テストシナリオの生成

テストシナリオを Agent に委任して `cycles/{cycle}/build-{NN}/test-spec.md` を生成させる。
洗い出し過程のコンテキスト消費を避けるため、メインセッションでは直接作成しない。

- [ ] Agent に渡す情報: `plan.md`, `issue.md`, `design-delta.md`, 関連する永続ドキュメント、
  [templates.md](../references/templates.md) の「test-spec.md」節（フォーマットと記載ガイドライン。必ず従わせる）
- [ ] テスト対象が無いビルド（ドキュメントのみ等）では生成せず、`skipped` を報告する
