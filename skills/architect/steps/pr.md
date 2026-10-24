# pr: PR の作成とレビュアーのアサイン

- [ ] コミット前にブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify architect {cycle}
```

- [ ] 外部連携が有効なら、参照行を生成する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref architect {cycle}`）
- [ ] PR を作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title architect {cycle}` で生成）
  - `external ref` が返した行（`Refs #12` など）を本文の末尾に入れる。空なら入れない
  - 向き先は `pr base` に従う（値 `round` が `add` で conductor から動いているなら conductor ブランチ）
  - 値 `designChoiceGate` が false（express）なら、採用案と退けた案を本文に一行で示す
    （express では PR レビューが人間の目になる）
- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers architect {cycle} --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える
- [ ] `done` を報告し、progress.jsonl をコミット & push する（PR に含める）

この PR も速やかにマージすることを想定している。 tasklist.md がデフォルトブランチに
入らないと、他のサイクルからも外からもこのサイクルの進捗が見えない。

マージ前に builder を始めることはできる（このブランチから積めば、着手判定は成果が
履歴に在るかで行うため通る）。ただしサイクルの完了判定はデフォルトブランチを見るので、
マージするまでサイクルは締められない。
