---
name: retrospective
description: "Hikyaku 振り返り: セッション中のスキル外指示と、役に立たなかった記述を記録する内部スキル。各フェーズから呼び出される。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: false
argument-hint: "{cycle} {SUB_DIR}"
---

# Hikyaku Retrospective

セッション全体を振り返り、以後に効く知見と、役に立たなかった記述を記録する。

このスキルは hikyaku:planner / hikyaku:architect / hikyaku:builder からモデル呼び出しで使用される内部スキルです。
ユーザーが直接呼び出すことは想定していません。hikyaku ワークフロー以外のコンテキストから呼び出された場合は、その旨をユーザーに伝えて終了してください。

## 引数

- `$ARGUMENTS[0]`: cycle — 対象サイクル（`{NNN}-{slug}`）
- `$ARGUMENTS[1]`: SUB_DIR — 出力先サブディレクトリ（`planning`, `design`, `build-{NN}`）

HIKYAKU_ROOT は受け取らない。`.hikyaku.config` から解決される。

出力先: `{HIKYAKU_ROOT}/cycles/$ARGUMENTS[0]/$ARGUMENTS[1]/retrospective.md`（step が `output` として返す）

## 何を記録するか

振り返りは、このセッションの経験から次の2つを取り出して記録する。どちらも close-cycle が
`hikyaku promotions` で集めるので、見出しと行の形を変えない。

| 節 | 何か | close-cycle の扱い |
|---|---|---|
| 永続化すること | 以後に効く知見。ユーザーから受けたスキル外の指示が最重要の入力 | 重複を束ね、置き場ごとに反映する |
| 役に立たなかった記述 | 読み込まれた・読んだ記述のうち、古い・自明・無関係だったもの | 削除・置き換え・glob の見直しを提案する |

重要度と置き場の基準、行の書式は
`${CLAUDE_PLUGIN_ROOT}/skills/close-cycle/references/persistence.md`（[persistence.md](../close-cycle/references/persistence.md)）が正。
ここには写さない。要点だけ挙げる。

- 重要度が低（すぐ失敗して、すぐ直せる）の知見は書かない。永続化の置き場は、読むたびにコンテキストを使う
- 機械で防げるもの・パス指定の rule にするものは、builder がビルドの PR で片づけている。振り返りで
  新たに気づいたものだけを書く
- 「役に立たなかった記述」は使った本人にしか書けない証言。ただし「今回は使わなかった」だけでは書かない

retrospective.md はコミット対象。

実装フェーズ（`build-{NN}`）ではこれに加えて、予測ピークと実測を並べて記録する
（ステップ peak-actual と write）。close-cycle は実測の乖離を見て、見積もりのガイドの見直しが
必要かを判定する。

## 作業ステップ: step に従って進める

手順（確認 → 予測ピークの実測の収集 → 分析と分類 → 書き込み）は、`step next` が設定と進捗から1手ずつ返す。
**手順を自分で組み立てない。** 実施するかの確認（`retrospective` が `prompt` のとき）と、
予測ピークの実測の収集（`build-{NN}` のとき）を行うかは step が決める。`skip` なら呼び出し元が呼ばない。

呼び出し元の directive の「呼ばれたスキルの手順」（`callNext`）にあるコマンドで始める。
無ければ SUB_DIR をフェーズに読み替えて呼ぶ（`planning` → `plan`、`design` → `architect`、
`build-{NN}` → `build-{NN}`）。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next {phase} $ARGUMENTS[0] --skill retrospective
```

記録は呼び出し元と同じ progress.jsonl に入る。呼び出し元が最後に報告したあと（または `step restart` の
区切りのあと）の記録だけが今回の分として数えられる。PR レビュー対応のように呼び出し元が報告しないまま
呼び直すときは、呼び出し元が `step restart ... --skill retrospective` で区切ってから呼ぶ。
`done` がすぐ返ったのに今回の振り返りをしていなければ、区切りが抜けている。呼び出し元に伝えて戻る。

返った1手（directive）の種類ごとに動く。

報告のコマンドは directive の「報告」にあるものを使う。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら `done` を報告する |
| `done` | 手順をすべて終えた。呼び出し元に制御を返す（呼び出し元が自分の call のステップを報告する） |
| `stop` | メッセージをユーザーに伝え、呼び出し元に制御を返す。呼び出し元は call のステップを報告せずに止まる |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 成果物（retrospective.md）が無ければ、CLI が `write` の報告を受け付けない。メッセージに従って直す
- `skipped` は、指示ファイルがスキップを指示する場合だけ。理由を `--reason` に書く
- コミットは呼び出し元が行う
- 報告のコマンドには `--skill retrospective` が付いている。外さない（外すと呼び出し元のスキルのステップとして解釈され、受け付けられない）
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る

## 記載ガイドライン

- スキルの手順通りに進んだ部分は書かない。差分だけを記録する
- 「スキル外で受けた指示」が最重要のインプット。ユーザーが追加で指示したことは、スキルに欠けている情報の証拠
- 文面は、そのまま置き場に書けるレベルの具体性で書く
- 該当が無ければ、節に「なし」と書く（節は省かない）
- 同じ知見が前のフェーズの retrospective.md や handoff.md にもあれば、重ねて書いてよい。
  close-cycle が束ね、挙がった回数を根拠にする
- 実測は集計コマンドの出力をそのまま書く。予測に寄せて丸めない。
  乖離が残っていることが次のサイクルの材料になるのであって、揃った表に価値は無い
- セッションの実測は `tokens session` の値だけを、差分の集計は `tokens history build-{NN}` の値だけを書く。
  会話の長さからの見積もりや、差分を目で見た概算で埋めない
