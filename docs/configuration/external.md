# サイクルの GitHub issue

`[external] target = "github"` を設定すると、Hikyaku はサイクルごとに GitHub の issue を1つ起票し、そのサイクルのすべての PR からこの issue を参照します。issue は CLOSE の PR のマージで閉じます。

```toml
[external]
target = "github"          # none | github
github_repo = "owner/repo"
```

**マスターは常にファイル側です。** issue は可視化のためのビューにすぎず、読み取りにも完了判定にも使いません。ビルドの一覧と進捗は `tasklist.md` が正で、issue には載せません。ビルドごとに issue を作ることもしません。ビルドの分割や完了をそのたびに外部へ写すと、写し漏れや古い表示が残り、どちらが正しいのか分からなくなるためです。

起票先は[サイクルごとに変えられます](config-file.md#サイクルごとに変える)。ふだんは起票せず特定のサイクルだけ GitHub に出す、サイクルによって起票先のリポジトリを分ける、といった使い分けができます。

## いつ起票されるか

PLAN の PR を作る直前に、planner が1回だけ起票します。その時点なら user-stories があって issue の要約として成立し、以降のすべての PR がこの issue を参照できます。本文はサイクルの要約・profile・チケット・サイクルのディレクトリへのリンクです。

作成した issue の参照は `cycles.md` の外部列に自動で記録されます。この変更は PLAN の PR でデフォルトブランチに入るので、並行して動くほかのセッションからも見えます。手で書き写す運用は必ず抜けるため、記録はスクリプトが行います。

## PR からのリンク

`hikyaku external ref` が PR 本文に入れる1行を返します。

| フェーズ | 返す行 |
|---|---|
| close | `Closes #10` |
| その他（plan / architect / build-NN / conductor） | `Refs #10`（閉じない） |

GitHub のクローズキーワードは `#12` か URL しか解釈しないため、Markdown リンクではなく素の番号で出します（リンクだけ張られて issue が閉じない事故を防ぐため）。

**issue が閉じても完了判定には使いません。** ビルドの完了は常に `tasklist.md` の `PR` 列、サイクルの完了は `cycles.md` の `status` で判定します。

## gh CLI が無い環境

スクリプトから GitHub を呼ぶのは `gh` CLI 経由だけです。`gh` が無い場合も起票する内容は返ります（`applied: false` / `reason: "gh-not-found"`）。その場合はスキル側が GitHub MCP ツールで起票し、参照を記録します。

```bash
hikyaku cycle link 002-billing --external {issueのURL}
```

## 失敗しても止まらない

起票に失敗しても、警告を出して終了コード 0 で終わります。GitHub に到達できないことが、実装や設計を止める理由にはならないためです。ファイル側は既に正しいので、後から起票し直せば収束します。

## 手動で起票し直す

```bash
hikyaku external sync 002-billing --dry-run
```

既に参照が記録されていれば、その issue のタイトルと本文を更新します。通常はスキルが呼ぶので、手で実行するのは起票が抜けたときの復旧くらいです。
