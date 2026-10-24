# to-plan: このまま PLAN へ進むか

- [ ] ユーザーに確認する（既定は「はい」）

```
サイクル {NNN}-{slug} を作成しました（profile: {profile}）。
このまま企画フェーズ（PLAN）に進みますか？ [Y/n]
```

## いいえ（単独で終える）

- [ ] `skipped` を報告する（`--reason "単独で終える"`）。次の1手で PR の作成が返る

## はい（PLAN へ続ける）

このサイクルの成果物は cycles.md の1行だけなので、独立した PR にはしない。
`create` ブランチは作らず、最初から plan のブランチで作業して PLAN の PR に畳む。

- [ ] ブランチを決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify plan {NNN}-{slug}
```

`ok: true` ならそのまま、`onBaseBranch: true` なら `expected` の名前で作成する。
`onBaseBranch` が `false` / `null`（既に別の作業ブランチに居る）なら、必ずユーザーに尋ねる。
Hikyaku の規則に従う / 現在のブランチで作業する / 別のブランチを指定する、の3つを提示し、
どれが妥当かは示唆しない。実行環境が割り当てたブランチだと分かっていても自分で決めない
（別の作業のブランチに紛れ込んだ状態と、セッションの中からは区別できないため）。

- [ ] `done` を報告する。次の1手は `done` になる
- [ ] 決まったブランチで、cycles.md とサイクルのディレクトリ（progress.jsonl を含む）の変更をコミットする
- [ ] `/hikyaku:planner {NNN}-{slug}` を呼び出す

planner も Step 1 で同じ確認をするが、ここで決めたブランチをそのまま使う（同じことを二度尋ねない）。
create-cycle はここで終わる。完了の案内はしない。
