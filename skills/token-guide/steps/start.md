# start: 回の開始とブランチの確認

ガイドの校正は1回ごとに1つのブランチと PR にまとめる。ここで今回のブランチを決める。

- [ ] ブランチを作成し、命名規則どおりか確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify token-guide
```

`token-guide` はサイクルに属さないフェーズで、ブランチは `init` と同じ形（`{prefix}{separator}token-guide`）。
`ok: true` ならそのまま、`onBaseBranch: true` なら `expected` の名前で作成する。
close-cycle から呼ばれた回（`auto`）では、close-cycle がベースブランチへ切り替えてから呼ぶので、
`onBaseBranch: true` になる。そうなっていなければ、close-cycle の変更が残ったブランチに居るので、
続けずに呼び出し元へ戻る（ガイドの変更を close の PR に混ぜない）。

`onBaseBranch` が `false` / `null`（既に別の作業ブランチに居る）なら、必ずユーザーに尋ねる。
Hikyaku の規則に従う / 現在のブランチで作業する / 別のブランチを指定する、の3つを提示し、
どれが妥当かは示唆しない。
