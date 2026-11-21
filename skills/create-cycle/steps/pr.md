# pr: 単独で終える場合のコミットと PR

- [ ] ブランチを作成し、命名規則どおりか確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify create {NNN}-{slug}
```

`ok: true` ならそのまま、`onBaseBranch: true` なら `expected` の名前で作成する。
`onBaseBranch` が `false` / `null`（既に別の作業ブランチに居る）なら、必ずユーザーに尋ねる。
Hikyaku の規則に従う / 現在のブランチで作業する / 別のブランチを指定する、の3つを提示し、
どれが妥当かは示唆しない。実行環境が割り当てたブランチだと分かっていても自分で決めない
（別の作業のブランチに紛れ込んだ状態と、セッションの中からは区別できないため）。

- [ ] コミットする（サイクルのディレクトリの progress.jsonl も含める）
- [ ] push してから、本文を `.tmp/hikyaku-pr-create.md` に書き（コミットしない）、`pr create` で作る（`--base` は
  `pr base create {NNN}-{slug}` の値。タイトルは `pr title` と同じ規則で付く。同じ向きで開いている PR があれば作らずに返す）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr create create {NNN}-{slug} --base {base} --body-file .tmp/hikyaku-pr-create.md --json
```

- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers create {NNN}-{slug} --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。出力の `applied` が `false` なら、できなかったことと `manual`
  （ユーザーが代わりに行うこと）を、完了の案内と一緒にユーザーに伝える

cycles.md がデフォルトブランチに入らないと、他サイクルからこのサイクルが見えない。
並行サイクルの検出が機能しなくなるため、この PR は速やかにマージするよう案内する。

- [ ] `done` を報告する（`--pr` に PR の URL）
- [ ] 同じブランチへコミット & push する（progress.jsonl）
