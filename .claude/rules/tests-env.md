---
paths:
  - "tests/**/*.test.mts"
---

# スクリプトのテスト

- 環境変数で振る舞いが変わる関数をテストのプロセス内で評価するなら、ファイルの先頭で `delete process.env["HIKYAKU_CONDUCTOR_CHILD"]` を置く。`helpers.mts` の `testEnvironment()` が消すのは CLI を起動する子プロセスの分だけで、conductor の子の中で `npm test` を走らせると子の環境変数が入って失敗する。
- `scripts/lib/steps/<skill>.mts` を最初に import すると、`steps/index.mts` との循環 import で未初期化の値を読んで `ReferenceError`（TDZ）で落ちる。`ledger.mts` か `steps/index.mts` を先に import する。
