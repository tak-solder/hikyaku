# 内部スキルとエージェント

ユーザーが直接呼び出すものではなく、各フェーズのスキルが自動的に呼び出します。プロファイルで「レビューを省く」「実行コストを節約する」と言うとき、実際に増減するのがここです。

## 内部スキル

内部スキルは呼び出し元と同じセッションで動きます（コンテキストを共有します）。

### build-manager

BP の見積もりと分割単位の判断、`issue.md` の作成、承認を行います。`tasklist.md` の行の更新・依存グラフの再生成・循環依存の検証はスクリプトの担当です。

architect のビルド分割ステップと、builder の実装中にスコープが変わったときに呼ばれます。承認（G6）はどのプロファイルでも省略されません。

### retrospective

セッション中にスキル外で受けた指示を分析し、2種類に分けて記録します。

| 種類 | 何か | 行き先 |
|---|---|---|
| 改善提案（R-N） | 以後の取り決め。「次からこう書く / こう進める」 | close-cycle が `conventions` などの永続ドキュメントか `instructions.md` へ反映する |
| リポジトリ固有の学び（L-N） | 踏んだ地雷。再現条件が明確な落とし穴 | close-cycle が `learnings` へ昇格させる |

軸は「提案か、事実か」です。再現条件が具体的に書けないものは L-N にしません（「なんとなく遅い」ではなく「N=1000 でタイムアウトする」）。`overview` や `constraints` に載る事実は `handoff.md` が担い、昇格の経路を二重に持ちません。

改善提案の分類先は `doc:{論理名}` / `workflow` / `記録のみ` の3つです。`doc:` の論理名は `document-guide.md` が正で、そこに無い論理名は使いません。Hikyaku の手順そのものに穴があると思える場合も、このリポジトリで埋めるなら `workflow`（= `instructions.md`）に落とします。

各フェーズの末尾で呼ばれます。`economy` では `skip`、それ以外は `auto` です。

## エージェント

エージェントは別コンテキストで動き、結果だけを本セッションに返します。探索や洗い出しの過程で本セッションのコンテキストを消費しないための委任です。

| エージェント | 呼ぶ側 | 役割 |
|---|---|---|
| `cycle-scanner` | architect | 走行中の他サイクルの設計差分を読み、重複を報告する（軽量モデル） |
| `code-explorer` | architect | 既存コード調査。`overview` が渡されると差分調査に切り替わる |
| `code-architect` | architect | 指定観点（Minimal / Clean / Pragmatic など）の単一設計案を返す |
| `doc-reviewer` | planner / architect / builder | 中間成果物の整合性・網羅性・曖昧さを証拠ベースで報告する |
| `code-reviewer` | builder | スコープ・規約・バグ・冗長性を証拠ベースで報告する |
| `security-reviewer` | builder | OWASP 系のセキュリティ指摘 |

`code-explorer` が返す Key Files は本セッション自身が読みます。要約だけで設計を進めると、規約やインターフェースの解像度が落ちるためです。

`doc-reviewer` は渡された context（`user-stories` / `architecture` / `plan`）に応じて観点を切り替えます。architecture と plan ではセキュリティ設計の考慮漏れも見ます。

`code-reviewer` と `security-reviewer` は並列で起動し、指摘は統合されます。同じ箇所への重複は1件に束ねられ、セキュリティの指摘が優先されます。担当が分かれているので、`code-reviewer` はセキュリティ観点を扱いません。

## プロファイルとの対応

| エージェント | express | economy | standard | thorough |
|---|---|---|---|---|
| `cycle-scanner` | 他サイクルがあれば起動 | 同左 | 同左 | 同左 |
| `code-explorer` | 既存コードがあれば起動 | 同左 | 同左 | 同左 |
| `code-architect` | 分岐がある判断で起動 | 同左 | 同左 | 同左 |
| `doc-reviewer` | ✓ | ✗ | ✓ | ✓ |
| `code-reviewer` | ✓ | ✓ | ✓ | ✓ |
| `security-reviewer` | 推奨時のみ確認 | 推奨時のみ確認 | 推奨時のみ確認 | 常に起動 |
| `retrospective`（内部スキル） | auto | skip | auto | auto |

economy が省くのは `doc-reviewer` と `retrospective` です。調査系（`cycle-scanner` / `code-explorer` / `code-architect`）は成果物の生成に必要なので、どのプロファイルでも起動します。express が承認を省いても品質が落ちないのは、`doc-reviewer` が全フェーズで動いているからです。

## 定義の場所

エージェントの定義は `agents/{name}.md`、内部スキルは `skills/{name}/SKILL.md` にあります。出力フォーマットや判定基準を確認したい場合はそちらを参照してください。
