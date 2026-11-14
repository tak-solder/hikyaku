# 内部スキルとエージェント

ユーザーが直接呼び出すものではなく、各フェーズのスキルが自動的に呼び出します。プロファイルで「レビューを省く」「実行コストを節約する」と言うとき、実際に増減するのがここです。

## 内部スキル

内部スキルは呼び出し元と同じセッションで動きます（コンテキストを共有します）。

### build-manager

予測ピークの成分の見積もりと分割単位の判断、`issue.md` の作成、レビュー、承認を行います。成分の合計と判定（`hikyaku tokens estimate`）、`tasklist.md` の行の更新・依存グラフの再生成・循環依存の検証はスクリプトの担当です。

architect のビルド分割ステップと、builder の実装中にスコープが変わったときに呼ばれます。書き込み前に `tasklist_review` が有効なら `doc-reviewer`（`context: tasklist`）を起動し、予測ピークの成分の乖離やスコープの重複を確認します。承認（G6）はどのプロファイルでも省略されません。

### retrospective

セッションの経験から、次の2つを取り出して記録します。

| 節 | 何か | close-cycle の扱い |
|---|---|---|
| 永続化すること | 以後に効く知見。ユーザーから受けたスキル外の指示が最重要の入力 | 重複を束ね、置き場ごとに反映する |
| 役に立たなかった記述 | 読み込まれた記述のうち、古い・自明・無関係だったもの | 削除・置き換え・glob の見直しを提案する |

どちらも1件1行で、`handoff.md` の「永続化すること」と同じ形で書きます。形が決まっているので、`hikyaku promotions` がサイクル全体の分を集められます。重要度が低の知見は書きません。重要度と置き場の考え方は [知見の置き場](../configuration/persistence.md) にあります。

Hikyaku の手順そのものに穴があると思える場合も、このリポジトリで埋めるなら `{HIKYAKU_ROOT}/instructions.md` 宛てに書きます。Hikyaku 自体の不具合と思われるものは報告として記録され、close の PR の本文に並びます。

実装フェーズ（`build-{NN}`）では、これに加えて予測ピークと実測を記録します。architect 段階・builder 段階の予測と、`hikyaku tokens session` で実測したセッションのコンテキスト（ピーク・開始時の固定分・呼び出し回数・コンパクション回数・モデル・ホスト・Hikyaku の版）、`hikyaku tokens history build-NN` が PR の base から数えた差分（新規ファイル数・追加行数とその実装とテストの内訳）を並べ、1セッションで完結したかと、乖離の要因を成分ごとに残します。永続化の候補ではなく、事実の記録です。この節の形は固定で、`hikyaku tokens history` が読みます。close-cycle はこの記録から見積もりのガイドの見直しが必要かを判定し、`/hikyaku:token-guide` がガイドを補正する素材にします。

実装フェーズでは、G8 の提示・実装開始前・レビュー前の区切りで測ったコンテキスト（`progress.jsonl` の記録）も確かめます。目安を超えたまま継続した区切りがあれば、どこで膨らんだかを乖離の要因に書きます。値そのものは `retrospective.md` に書き写さず、`hikyaku tokens history` が `progress.jsonl` から読みます。

各フェーズの末尾で呼ばれます。`economy` では `skip`、それ以外は `auto` です。呼び出し元の手順が `call` で振り返りを返し、retrospective は `hikyaku step next <phase> <cycle> --skill retrospective` で自分の手順を進めます。記録は呼び出し元と同じ `progress.jsonl` に入ります。`prompt` で実施しないと答えた場合は、残りの手順は対象外になってすぐに呼び出し元へ戻ります。PR レビュー対応で振り返るときは、builder が `hikyaku step restart` で区切ってから呼ぶので、既存の `retrospective.md` へ追記する形で手順が最初から回ります。

## エージェント

エージェントは別コンテキストで動き、結果だけを本セッションに返します。探索や洗い出しの過程で本セッションのコンテキストを消費しないための委任です。

| エージェント | 呼ぶ側 | 役割 |
|---|---|---|
| `cycle-scanner` | architect | 走行中の他サイクルの設計差分を読み、重複を報告する（軽量モデル） |
| `code-explorer` | architect | 既存コード調査。`overview` が渡されると差分調査に切り替わる |
| `code-architect` | architect | 指定観点（Minimal / Clean / Pragmatic など）の単一設計案を返す |
| `doc-reviewer` | planner / architect / build-manager / builder | 中間成果物の整合性・網羅性・曖昧さを証拠ベースで報告する |
| `doc-triager` | init（移行の回） | 既存の文書を項目ごとに読み、コードと突き合わせて、重要度と置き場を判定する |

`doc-reviewer` は plan のレビューで、`overview` / `decisions` / `constraints` の全文と plan を突き合わせます。builder は `issue.md` が指す節しか読まないので、architect の選び漏れや、選んだあとに他サイクルが足した記述を拾えるのはここだけです。

`code-explorer` が返す Key Files は本セッション自身が読みます。要約だけで設計を進めると、規約やインターフェースの解像度が落ちるためです。

`doc-reviewer` は渡された context（`user-stories` / `architecture` / `tasklist` / `plan` / `test-spec`）に応じて観点を切り替えます。architecture と plan ではセキュリティ設計の考慮漏れも見ます。tasklist は予測ピークの見積もりの妥当性と分割の網羅性が対象で、tasklist.md・issue.md がまだファイルに書き込まれていない段階でレビューするため、build-manager が内容をプロンプトへ直接渡します。plan と test-spec はそれぞれの成果物の完成直後にレビューされ、`plan` は plan.md 作成直後、`test-spec` は test-spec.md 作成後という位置は、どのプロファイルでも変わりません。plan は受け入れ基準の網羅とスコープ逸脱に加えて、plan.md に書かれた予測ピークの成分の妥当性も見ます（tasklist は issue.md のスコープ記述から、plan は実装計画から、それぞれ内訳表の成分と根拠が記述と合っているかを見ます。合計と判定はコマンドが行うので対象外です）。test-spec は plan.md・issue.md に対するテストシナリオの網羅性が対象です。

`doc-reviewer` は `[review.doc]` で別のプロバイダを選んだときだけ、定義の本文を指示文にして `claude -p` か `codex exec` で起動されます（[.hikyaku.config](../configuration/config-file.md#review)）。

## コードとセキュリティのレビュー

builder のコードレビューとセキュリティレビューは、Hikyaku のエージェントではなく、Claude Code と Codex に組み込みのレビュー機能が行います。起動は `hikyaku review run` が受け持ち、2つのレビューは並列に動いて、指摘は builder が統合します。同じ箇所への重複は1件に束ねられ、セキュリティの指摘が優先されます。

| レビュー | Claude | Codex |
|---|---|---|
| コード | `/code-review` | `codex exec review --base` |
| セキュリティ | `/security-review`。スタックしたビルドなどでは観点の指示文 | 観点の指示文を渡した `codex exec review` |

セキュリティの観点の指示文は `skills/builder/references/security-review.md` にあります。plan.md のスコープから外れていないかは、組み込みのレビュー機能に指示文を渡せないため、builder 自身が確かめます。

## プロファイルとの対応

| エージェント・レビュー | express | economy | standard | thorough |
|---|---|---|---|---|
| `cycle-scanner` | 他サイクルがあれば起動 | 同左 | 同左 | 同左 |
| `code-explorer` | 既存コードがあれば起動 | 同左 | 同左 | 同左 |
| `code-architect` | 分岐がある判断で起動 | 同左 | 同左 | 同左 |
| `doc-reviewer` | ✓ | ✗ | ✓ | ✓ |
| `doc-triager` | 移行の回で起動 | 同左 | 同左 | 同左 |
| コードレビュー | ✓ | ✓ | ✓ | ✓ |
| セキュリティレビュー | 推奨時のみ確認 | 推奨時のみ確認 | 推奨時のみ確認 | 常に起動 |
| `retrospective`（内部スキル） | auto | skip | auto | auto |

economy が省くのは `doc-reviewer` と `retrospective` です。調査系（`cycle-scanner` / `code-explorer` / `code-architect`）は成果物の生成に必要なので、どのプロファイルでも起動します。express が承認を省いても品質が落ちないのは、`doc-reviewer` が全フェーズで動いているからです。

## 定義の場所

エージェントの定義は `agents/{name}.md`、内部スキルは `skills/{name}/SKILL.md` にあります。出力フォーマットや判定基準を確認したい場合はそちらを参照してください。

Codex では `codex/skills/{name}/SKILL.md` が入口になり、同じ手順と判定基準を読みます。起動方法は [Codex で使い始める](../getting-started-codex.md) を参照してください。
