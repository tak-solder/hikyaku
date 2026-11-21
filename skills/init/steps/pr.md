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

- [ ] コミットする
  - コミットには `{HIKYAKU_ROOT}/progress.jsonl` も含める
  - コミットメッセージの形式はリポジトリの規約に従う。Hikyaku は関与しない
- [ ] push してから、本文を `.tmp/hikyaku-pr-init.md` に書き（コミットしない）、`pr create` で作る（`--base` は
  `pr base init` の値。タイトルは `pr title` と同じ規則で付く。同じ向きで開いている PR があれば作らずに返す）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr create init --base {base} --body-file .tmp/hikyaku-pr-init.md --json
```

- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers init --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。出力の `applied` が `false` なら、できなかったことと `manual`
  （ユーザーが代わりに行うこと）を、完了の案内と一緒にユーザーに伝える
- [ ] `done` を報告する（`--pr` に PR の URL）
- [ ] 同じブランチへコミット & push する（progress.jsonl）
- [ ] 移行の回では、PR の本文に、置き場ごとの移した先・消した理由の区分と、機械で防げるが未対応の項目
  （何を入れれば防げるか）を書く。項目そのものは diff が正なので、件数や一覧を写さない。案内は
  「移行が完了しました」とし、下の案内は出さない
- [ ] 次を案内する（`pr` の報告のあとは、初期化済みを示す `stop` が返る）

```
初期化が完了しました。

サイクルを開始するには:
/hikyaku:create-cycle <slug>

または planner が代行します:
/hikyaku:planner
```
