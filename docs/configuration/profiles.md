# プロファイル

プロファイルはサイクルの属性です。`create-cycle` で必ず明示的に選択し、`cycles.md` に記録されます。作成後は変わりません（変える場合は `cycles.md` を直接編集します）。

|  | 人間の承認回数 | AIレビュー |
|---|---|---|
| express | 少 | 有 |
| economy | 多 | コードのみ |
| standard | 多 | 有 |
| thorough | 最多 | 全部 |

## 何を節約するか

express は人間の時間を節約します。承認は減らしますが、AI には見させます。economy は AI 実行コストを節約します。中間成果物のレビューを起動しませんが、人間は見ます。

つまり express と economy は「何を省くか」が違うだけの兄弟です。品質の担保を AI に寄せるのが express、人間に寄せるのが economy で、どちらも担保そのものは手放しません。「承認少 + レビュー無」の組み合わせは意図的に用意していません。

thorough は判定基準が厳しくなるわけではありません。standard で不合格になるものが thorough で通る、という関係ではなく、変わるのはチェックポイントの細かさです。standard は完成した成果物の単位で（user-stories / 設計ドキュメント / plan + test-spec）、必要なときに確認します。thorough はその手前の作りかけの段階でも止まり（codebase-survey だけ、plan だけ、各ステップごと）、やるかどうかの判断を挟まず常に実行します。手戻りの巻き戻し幅が、フェーズ単位からステップ単位になると考えてください。

## 承認ゲート

| # | フェーズ | ゲート | express | economy | standard | thorough |
|---|---|---|---|---|---|---|
| G1 | planner | user-stories 承認 | ✓ | ✓ | ✓ | ✓ |
| G2 | architect | codebase-survey 確認 | ✗ | ✗ | ✗ | ✓ |
| G3 | architect | 設計案の選択 | ✗ | ✓ | ✓ | ✓ |
| G4 | architect | 設計ドキュメント承認 | ✗ | ✓ | ✓ | ✓ |
| G6 | build-manager | tasklist / issue 変更承認 | ✓ | ✓ | ✓ | ✓ |
| G7 | builder | plan 単独の承認 | ✗ | ✗ | ✗ | ✓ |
| G8 | builder | plan + test-spec 承認 | ✓ | ✓ | ✓ | ✓ |
| G10 | close-cycle | 永続ドキュメント昇格の承認 | ✓ | ✓ | ✓ | ✓ |

G1 / G6 / G8 / G10 はプロファイルの管轄外で、常に有効です。プロファイルで省略できるのは確認であって、同意ではありません。この区別の理由は [概念と設計思想](../concepts.md#承認ゲートは確認と同意を分ける) にあります。

express は「要件（G1）と実装直前（G8）だけ人間が見て、その間は AI に任せる」という形です。G3 を外しても採用理由と退けた案は ADR に残り、PR 本文にも出るので、判断を後から追えなくなることはありません。

## レビュー

| レビュー | express | economy | standard | thorough |
|---|---|---|---|---|
| user_stories_review | ✓ | ✗ | ✓ | ✓ |
| architecture_review | ✓ | ✗ | ✓ | ✓ |
| plan_review | ✓ | ✗ | ✓ | ✓ |
| code_review | ✓ | ✓ | ✓ | ✓ |
| security_review | 推奨時のみ確認 | 推奨時のみ確認 | 推奨時のみ確認 | on |
| retrospective | auto | skip | auto | auto |
| validate | 手動のみ | 手動のみ | 各フェーズ末 | 各ステップ |

`code_review` はどのプロファイルでも行います。中間成果物（user-stories / 設計 / plan）のレビューは人間の承認で代替できますが、コードは差分が大きく、人間の承認ゲートが拾える粒度を超えるためです。economy で省くのはこの中間成果物のレビューです。

`security_review` もどのプロファイルでも `off` にはしません。「承認を減らしたから」「実行コストを削ったから」で落としてよい観点ではないためです。既定は `recommended`（判定基準に該当したときだけ起動を確認）で、thorough だけが該当判定を挟まず `on` です。明示的に切りたい場合は `security_review = "off"` で上書きできます。

`retrospective` を economy だけ `skip` にしているのは、振り返りがサブエージェントの実行コストそのものだからです。承認を省く express では逆に、改善の材料をセッション内から自動で拾い上げる必要があります。

各レビューを担うエージェントは [内部スキルとエージェント](../reference/agents-and-skills.md) にまとめてあります。

## 選び方

standard から始めて、回してみた感触で変えるのが確実です。express と economy は要件が固まっていて手戻りが小さいサイクルに向きます。thorough は影響範囲が広い変更や、途中で気づかないまま進むと巻き戻しが大きい変更に向きます。

## 個別に上書きする

プロファイルの既定値はキー単位で上書きできます。書く場所は `.hikyaku.config`（リポジトリ全体、またはサイクルディレクトリ）です。キーの一覧は [.hikyaku.config](config-file.md#承認ゲートとレビューの個別指定) にあります。

```toml
# standard のままだが、このリポジトリでは設計ドキュメントの承認を省く
architecture_gate = false
```

サイクル単位で変えたい場合は `{HIKYAKU_ROOT}/cycles/{NNN}-{slug}/.hikyaku.config` に書きます。ただし `profile` 自体はここに書けません（`cycles.md` が唯一の正のため）。

展開結果は `hikyaku config` で確認できます。
