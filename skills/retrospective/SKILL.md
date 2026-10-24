---
name: retrospective
description: "Hikyaku 振り返り: セッション中のスキル外指示を分析し、改善提案を分類・記録する内部スキル。各フェーズから呼び出される。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: false
argument-hint: "{cycle} {SUB_DIR}"
---

# Hikyaku Retrospective

セッション全体を振り返り、改善提案を分類・記録する。

このスキルは hikyaku:planner / hikyaku:architect / hikyaku:builder / hikyaku:close-cycle からモデル呼び出しで使用される内部スキルです。
ユーザーが直接呼び出すことは想定していません。hikyaku ワークフロー以外のコンテキストから呼び出された場合は、その旨をユーザーに伝えて終了してください。

## 引数

- `$ARGUMENTS[0]`: cycle — 対象サイクル（`{NNN}-{slug}`）
- `$ARGUMENTS[1]`: SUB_DIR — 出力先サブディレクトリ（`planning`, `design`, `build-{NN}`, `close`）

HIKYAKU_ROOT は受け取らない。`.hikyaku.config` から解決される。

出力先: `{HIKYAKU_ROOT}/cycles/$ARGUMENTS[0]/$ARGUMENTS[1]/retrospective.md`（step が `output` として返す）

## 2種類を分けること

振り返りには性質の異なる2種類が混ざる。分けて記録する。

| 種類 | 何か | 行き先 |
|---|---|---|
| 改善提案（R-N） | 以後の取り決め。「次からこう書く / こう進める」 | close-cycle が `conventions` などの永続ドキュメントか `instructions.md` へ反映する |
| リポジトリ固有の学び（L-N） | 踏んだ地雷。再現条件が明確な落とし穴 | close-cycle が `learnings` へ昇格させる |

軸は「提案か、事実か」。提案は R-N、踏んだ地雷は L-N。R-N に `doc:learnings` は
指定しない（落とし穴は L-N で書く）。

L-N には次を書く。書けないものは L-N にしない。

- 再現条件が明確であること（「なんとなく遅い」ではなく「N=1000 でタイムアウトする」）
- どのビルドで、いつ判明したか

一般的なプログラミング知識や、「気をつける」だけの曖昧な注意は書かない。

retrospective.md はコミット対象で、close-cycle が素材として読む。

実装フェーズ（`build-{NN}`）ではこれに加えて BP見積もりの実績を記録する。
見積もりと実績を並べた事実の記録で、R-N でも L-N でもない（ステップ bp-actual と write）。

## 事実の昇格は handoff.md が担う

`overview` / `constraints` に載るような事実（新しい制約が判明した、責務が動いた）は
`handoff.md` に書く。振り返りで扱うのは提案（R-N）と落とし穴（L-N）だけで、
昇格の経路を二重に持たない。

## 作業ステップ: step に従って進める

手順（確認 → BP 実績の収集 → 分析と分類 → 書き込み）は、`step next` が設定と進捗から1手ずつ返す。
**手順を自分で組み立てない。** 実施するかの確認（`retrospective` が `prompt` のとき）と、
BP 実績の収集（`build-{NN}` のとき）を行うかは step が決める。`skip` なら呼び出し元が呼ばない。

呼び出し元の directive の「呼ばれたスキルの手順」（`callNext`）にあるコマンドで始める。
無ければ SUB_DIR をフェーズに読み替えて呼ぶ（`planning` → `plan`、`design` → `architect`、
`build-{NN}` → `build-{NN}`、`close` → `close`）。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next {phase} $ARGUMENTS[0] --skill retrospective
```

記録は呼び出し元と同じ progress.jsonl に入る。呼び出し元が最後に報告したあと（または `step restart` の
区切りのあと）の記録だけが今回の分として数えられる。PR レビュー対応のように呼び出し元が報告しないまま
呼び直すときは、呼び出し元が `step restart ... --skill retrospective` で区切ってから呼ぶ。
`done` がすぐ返ったのに今回の振り返りをしていなければ、区切りが抜けている。呼び出し元に伝えて戻る。

返った1手（directive）の種類ごとに動く。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら「報告」のコマンドを実行する |
| `done` | 手順をすべて終えた。呼び出し元に制御を返す（呼び出し元が自分の call のステップを報告する） |
| `stop` | メッセージをユーザーに伝え、呼び出し元に制御を返す |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 報告のコマンドには `--skill retrospective` が付いている。外さない（外すと呼び出し元のスキルのステップとして解釈され、受け付けられない）
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る

## 記載ガイドライン

- スキルの手順通りに進んだ部分は書かない。差分だけを記録する
- 「スキル外で受けた指示」が最重要のインプット。ユーザーが追加で指示したことは、スキルに欠けている情報の証拠
- 具体案は、そのまま適用できるレベルの具体性で書く
- 改善提案がなければ「改善提案なし」と記載する
- L-N は再現条件で判定する。具体的に書けないものは書かない。close-cycle が
  そのまま `learnings` へ昇格させるため、曖昧なものを入れると永続ドキュメントが濁る
- 同じ提案が前のフェーズの retrospective.md にもあれば、その旨を書く。
  言われた回数は優先度そのものなので、close-cycle が束ねるときの材料になる
- BP の実績は集計コマンドの出力をそのまま書く。見積もりに寄せて丸めない。
  乖離が残っていることが次のサイクルの材料になるのであって、揃った表に価値は無い
- **実測と申告を混ぜない。** 新規ファイル数・追加行数は `bp actual` の値、それ以外は申告。
  申告した値を「実測」と書かない
- セッションの実測は `bp session` の値だけを書く。会話の長さからの見積もりで埋めない
