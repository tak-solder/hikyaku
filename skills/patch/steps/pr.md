# pr: Draft PR の作成

合意した内容を PR の本文に置く。以後、依頼と合意の正は PR の本文になる。

- [ ] PR のマージ先を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr base {phase} {cycle}
```

返った値を base にする。**デフォルトブランチを決め打ちしない。** 統合ブランチから切っていれば、
そのブランチが返る。

- [ ] ここまでのコミットを push する
- [ ] PR を Draft で作成する
  - タイトル: `pr create` が `pr title` と同じ規則で付ける（`--build-title` に依頼の要約）
  - 本文: `${CLAUDE_PLUGIN_ROOT}/skills/patch/references/templates.md`（[templates.md](../references/templates.md)）の
    「PR の本文」。検証結果とドキュメントの更新は、まだ「未」のままにする（publish で埋める）
  - 本文を `.tmp/hikyaku-pr-{phase}.md` に書き（コミットしない）、`pr create` で作る。`--base` は上で取得した base。
    同じ向きで開いている PR があれば作らずにそれを返す（`created: false`。作り直しの回はこの PR を使う）。
    Draft に対応していないリポジトリではスクリプトが Draft を外して作る（`draft: false`）ので、完了の案内で
    Draft にできなかったことを伝える

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr create {phase} {cycle} --base {base} --body-file .tmp/hikyaku-pr-{phase}.md --build-title "{依頼の要約}" --json
```
- [ ] 同意ゲートで退けて作り直している回（この patch の Draft PR がすでにある）は、PR を作り直さない。既存の
  Draft PR の本文の合意を、作り直した対応方針に直す
- [ ] `done` を報告する（`--pr` に PR の URL。作り直しの回は既存の PR）
- [ ] progress.jsonl をコミット & push する
