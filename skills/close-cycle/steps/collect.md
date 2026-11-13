# collect: 素材の収集

サイクルが長い（ビルドが10本ある等）とコンテキストが厳しくなるため、
昇格候補の抽出はサブエージェントに委任する。

- [ ] エージェントに次のファイルを渡し、昇格候補を抽出させる
  - `cycles/{cycle}/design/design-delta.md` — このサイクルが作った差分
  - `cycles/{cycle}/design/codebase-survey.md` — 調査で得た知見（存在する場合）
  - `cycles/{cycle}/build-*/handoff.md` — 全ビルドの申し送り
  - `cycles/{cycle}/*/retrospective.md` — 振り返り（存在する場合）
  - `document-guide.md` — 昇格先の所在
- [ ] retrospective.md からは「リポジトリ固有の学び（L-N）」と、対象が `doc:` の
      改善提案だけを拾わせる
  - `workflow` は本セッションが直接捌く。`記録のみ` は読ませる必要がない
  - ビルドが10本あれば retrospective.md は12ファイルになる。委任してコンテキストを
    守る意味が、渡す量を絞らないと消える
- [ ] handoff.md からは「昇格素材（close-cycle 向け）」の節だけを拾わせる
  - 前半の「後続ビルド向け」はビルド間の引き継ぎで、昇格の素材ではない
  - 節ごとに昇格先が決まっている（organize の表）。節の外に書かれた発見は、内容で昇格先を判断させる
- [ ] build-*/retrospective.md からは「予測ピークの振り返り」の「乖離」と「乖離の要因」も拾わせる
  - 見積もりのガイド（token-guide）の補正の素材にする。表の数値は拾わせない（下の `tokens history` で読む）
- [ ] エージェントには「候補リスト」だけを返させ、本文の執筆は本セッションで行う
- [ ] `workflow` 分類の改善提案は、本セッションが各 retrospective.md から直接読む
- [ ] 予測と実測を、本セッションで直接読む（短い表なので委任しない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tokens history {cycle}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tokens guide {cycle}
```

  - `tokens history` は、このサイクルの各ビルドの予測（architect / builder 段階）・実測のピーク・乖離・比率・
    見積もりに使ったガイドの版を並べる。`tokens guide` は今有効なガイドとその版を示す
