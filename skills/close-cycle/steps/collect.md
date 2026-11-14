# collect: 候補の収集

サイクルの記録から、永続化の候補と「役に立たなかった記述」を集める。集めるのはスクリプトで、
あなたはファイルを読み回らない。

- [ ] 判定の基準を読む: `${CLAUDE_PLUGIN_ROOT}/skills/close-cycle/references/persistence.md`
  （[persistence.md](../references/persistence.md)）。重要度・置き場・削れる範囲はここが正
- [ ] 候補を集める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" promotions {cycle}
```

返るのは次の4つ。

| 出力 | 何か |
|---|---|
| 宛先ごとの候補 | 各ビルドの handoff.md、サイクルに属す patch の handoff.md、各フェーズの retrospective.md の「永続化すること」。重要度・`済`・出どころ付き |
| design-delta.md の更新予定 | 設計時に予定した永続ドキュメントの更新。実装の結果と照らして昇格させる |
| 役に立たなかった記述 | 振り返りで挙がった記述を、場所ごとに束ねたもの。理由（古い・自明・無関係）ごとの件数付き |
| 読めなかった行 | 書式が崩れていた行。捨てずに、内容を見て候補に含めるかを判断する |

- [ ] 候補が指す範囲だけを読む
  - 昇格先の文書は、候補が書き込まれる節と、「役に立たなかった記述」が指す節を読む（全文を読み直さない）
  - 覆した設計判断（`decisions` 宛て）があれば、該当の ADR を読む
  - handoff.md や retrospective.md の本文は、候補の根拠を確かめたいときだけ読む
