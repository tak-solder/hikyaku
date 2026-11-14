# サイクルの GitHub issue

`[external] target = "github"` を設定すると、Hikyaku はサイクルごとに GitHub の issue を1つ起票し、そのサイクルのすべての PR からこの issue を参照します。CLOSE の PR には `Closes` が入るので、その PR がデフォルトブランチにマージされると issue が閉じます。`base_branch` をデフォルトブランチ以外にしているサイクルでは GitHub が閉じないので、手で閉じてください。

```toml
[external]
target = "github"          # none | github
github_repo = "owner/repo"
```

**マスターは常にファイル側です。** issue は可視化のためのビューにすぎず、読み取りにも完了判定にも使いません。ビルドの一覧と進捗は `tasklist.md` が正で、issue には載せません。ビルドごとに issue を作ることもしません。ビルドの分割や完了をそのたびに外部へ写すと、写し漏れや古い表示が残り、どちらが正しいのか分からなくなるためです。

起票先は[サイクルごとに変えられます](config-file.md#サイクルごとに変える)。ふだんは起票せず特定のサイクルだけ GitHub に出す、サイクルによって起票先のリポジトリを分ける、といった使い分けができます。

## いつ起票されるか

PLAN の PR を作る直前に、planner が1回だけ起票します。その時点なら user-stories があって issue の要約として成立し、以降のすべての PR がこの issue を参照できます。本文はサイクルの要約・profile・チケット・サイクルのディレクトリへのリンクです。起票したあとは、ビルドが進んでも本文を更新しません。

サイクルのディレクトリへのリンクは、`origin` のリポジトリから作ります。`github_repo` は issue の起票先なので、サイクルのファイルがあるリポジトリとは限らないためです。`origin` が GitHub でなければ、リポジトリ相対のパスを書きます。リンク先のファイルは PLAN の PR がマージされるまで開けません。

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

既に参照が記録されていれば、その issue のタイトルと本文を更新します。GitHub 側で本文を編集していた場合、その編集は上書きされます。通常はスキルが呼ぶので、手で実行するのは起票が抜けたときの復旧くらいです。

進行中のサイクルの `.hikyaku.config` に廃止したキー（`target = "asana"` など）が残っていると、`external sync` と `external ref` はエラーで止まります。ルートの設定に戻って起票し直すことはしません。
