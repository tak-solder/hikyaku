# persist: 知見と永続ドキュメントの仕分け

基準は `${CLAUDE_PLUGIN_ROOT}/skills/close-cycle/references/persistence.md`（[persistence.md](../../close-cycle/references/persistence.md)）。
機械で防げるものとパス指定の rule は implement で片づけている。ここで扱うのは、それ以外の置き場に
残すものと、この変更で事実でなくなった記述。

- [ ] 残す候補を挙げる
  - 実装で踏んだ落とし穴・判明した制約・取り決めのうち、重要度が高か中のもの（低は書かない）
  - この変更で事実でなくなった永続ドキュメントの記述（挙動を変えたので overview の説明が古くなった等）。
    置き換えか削除の候補にする。根拠はこの変更そのもの
  - 宛先は `document-guide.md` の論理名・`workflow`・`skill:<名前>`・`hook`・`upstream`。
    `hook` と `upstream` はこの PR では書かず、PR の本文に並べる（publish）
- [ ] 候補が無ければ `skipped` を報告する（`--reason "永続化するものなし"`）

## サイクルに属さない patch（directive の `値` の `cycle` が null）

- [ ] 候補の文面と置き場を整理して `done` を報告する。次の P2 で提示して承認を得る

## サイクルに属す patch

永続ドキュメントは書かない。そのサイクルの close-cycle が、ビルドの handoff.md と同じく昇格させる。

- [ ] `{unitDirectory}/handoff.md` を書く（`${CLAUDE_PLUGIN_ROOT}/skills/patch/references/templates.md` の「handoff.md」）
  - 「永続化すること」の行の形は persistence.md の「記録の書式」に従う。`hikyaku promotions` が読むので形を変えない
  - サイクルの design-delta.md が予定していた永続ドキュメントの更新と、この変更の結果が食い違うなら、
    結果のほうを候補に書き、根拠に「design-delta の予定から変更」と添える
- [ ] `done` を報告し、handoff.md と progress.jsonl をコミット & push する
