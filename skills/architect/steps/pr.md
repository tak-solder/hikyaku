# pr: PR の作成とレビュアーのアサイン

- [ ] コミット前にブランチを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify architect {cycle}
```

- [ ] 外部連携が有効なら、参照行を生成する（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref architect {cycle}`）
- [ ] PR を Draft で作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title architect {cycle}` で生成）
  - `external ref` が返した行（`Refs #12` など）を本文の末尾に入れる。空なら入れない
  - 向き先は `pr base` に従う（値 `round` が `add` で conductor から動いているなら conductor ブランチ）
  - 値 `designChoiceGate` が false（express）なら、採用案と退けた案を本文に一行で示す
    （express では PR レビューが人間の目になる）
  - `gh pr create --draft` で作る。Draft に対応していないリポジトリで作成に失敗したら、`--draft` を外して作り直し、Ready への切り替えは飛ばす。完了の案内で Draft にできなかったことを伝える

- [ ] `done` を報告し（`--pr` に PR の URL）、progress.jsonl をコミット & push する（PR に含める）

`done` の報告後も、Ready への切り替えとレビュアーのアサインまで行ってから完了の案内へ進む。

- [ ] `config` 出力の `pr.autoReady`（`[pr] auto_ready`、既定 true）が true なら、PR を Ready for Review にする（conductor の子なら飛ばす）

```bash
gh pr ready {PR の URL}
```

  - true なら省略しない。false なら Draft のまま残し、完了の案内で「確認後に `gh pr ready {PR の URL}` で Ready にする」と伝える。**false のときに自分の判断で Ready にしない**
  - 失敗したら、Draft のままであることと再実行のコマンドを完了の案内で伝える
  - conductor の子は `pr.autoReady` に関わらず Ready にしない。監督が取り込む前に Ready にする

- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers architect {cycle} --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える

この PR も速やかにマージすることを想定している。 tasklist.md がデフォルトブランチに
入らないと、他のサイクルからも外からもこのサイクルの進捗が見えない。

マージ前に builder を始めることはできる（このブランチから積めば、着手判定は成果が
履歴に在るかで行うため通る）。ただしサイクルの完了判定はデフォルトブランチを見るので、
マージするまでサイクルは締められない。
