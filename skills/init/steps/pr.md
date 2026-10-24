# pr: ブランチ・コミット・PR

- [ ] ブランチを作成し、命名規則どおりか確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify init
```

`ok: true` ならそのまま、`onBaseBranch: true` なら `expected` の名前で作成する。
`onBaseBranch` が `false` / `null`（既に別の作業ブランチに居る）なら、必ずユーザーに尋ねる。
Hikyaku の規則に従う / 現在のブランチで作業する / 別のブランチを指定する、の3つを提示し、
どれが妥当かは示唆しない。実行環境が割り当てたブランチだと分かっていても自分で決めない
（別の作業のブランチに紛れ込んだ状態と、セッションの中からは区別できないため）。

- [ ] コミットして PR を作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title init` で生成）
  - コミットには `{HIKYAKU_ROOT}/progress.jsonl` も含める
  - コミットメッセージの形式はリポジトリの規約に従う。Hikyaku は関与しない
- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers init --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える
- [ ] `done` を報告する
- [ ] 同じブランチへコミット & push する（progress.jsonl）
- [ ] 次を案内する（`pr` の報告のあとは、初期化済みを示す `stop` が返る）

```
初期化が完了しました。

サイクルを開始するには:
/hikyaku:create-cycle <slug>

または planner が代行します:
/hikyaku:planner
```
