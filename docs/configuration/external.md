# 外部システムへの投影

`[external] target` を設定すると、サイクルとビルドを外部システムへ片方向で投影します。

```toml
[external]
target = "github"          # none | github | asana
github_repo = "owner/repo"
# asana_project_gid = "..."
```

**マスターは常にファイル側です。** 外部システムは可視化のためのビューにすぎず、読み取りにも完了判定にも使いません。投影は冪等なので、何度実行しても収束します。

## 投影の単位

| 単位 | 内容 |
|---|---|
| 親 | サイクルに1つ。tasklist へのリンクとビルド一覧（完了状態つき） |
| 子 | 各ビルドの `issue.md` |

親が無ければ先に作るので、どのフェーズから同期を始めても収束します。通常は PLAN の PR を作る直前に最初の同期が走ります。その時点なら user-stories があって親の要約として成立し、以降のすべての PR が親を参照できるためです。

参照は作成後に自動で記録されます（親は `cycles.md` の外部列、子は `tasklist.md` の issue 列）。手で書き写す運用は必ず抜けるためです。

## PR からのリンク

`hikyaku external ref` が PR 本文に入れる1行を返します。

| フェーズ | GitHub | Asana |
|---|---|---|
| build-NN | `Closes #12`（子 issue） | タスクの URL |
| close | `Closes #10`（親 issue） | タスクの URL |
| その他 | `Refs #10`（閉じない） | タスクの URL |

GitHub のクローズキーワードは `#12` か URL しか解釈しないため、Markdown リンクではなく素の番号で出します（リンクだけ張られて issue が閉じない事故を防ぐため）。

**issue が閉じても完了判定には使いません。** 判定は常に `tasklist.md` の `PR` 列です。

## gh CLI が無い環境

スクリプトから外部 API を呼ぶのは GitHub の `gh` CLI 経由だけです。`gh` が無い場合も投影内容は返ります（`applied: false` / `reason: "gh-not-found"`）。その場合はスキル側が GitHub MCP ツールで適用し、参照を記録します。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle link 002-billing --external {親issueのURL}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist link 002-billing --id 3 --issue {子issueのURL}
```

Asana も同じ形です。スクリプトは投影内容を出力するだけで、反映は Asana MCP ツールを持つスキル側が行います。

## 失敗しても止まらない

投影に失敗しても、警告を出して終了コード 0 で終わります。外部システムに到達できないことが、実装や設計を止める理由にはならないためです。ファイル側は既に正しいので、後から同期し直せば収束します。

## 手動で同期する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync 002-billing --dry-run
```

通常はスキルが呼ぶので、手で実行するのは投影が抜けたときの復旧くらいです。
