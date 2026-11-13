# v2 → v3 移行ガイド

v3 では、各フェーズの中の手順を `hikyaku step next` が1手ずつ決めるようになり、進捗は作業単位のディレクトリの `progress.jsonl` に記録されます。v2 で作成したサイクルにはこの記録が無いため、v3 のスキルは v2 で始めたサイクルを扱いません。`step next` は、作成時の版のメジャーが 2 以下のサイクルに対して、作業を始めずに止まります。

**進行中のサイクルは、v2 のまま終えてから v3 に上げてください。** 閉じたサイクルや、これから作るサイクルには影響しません。

## v2 のまま進行中のサイクルを終える

すでに v3 に上げてしまった場合は、マーケットプレイスを v2 の最後のリリースのタグに固定して入れ直します。

```bash
claude plugin marketplace remove hikyaku
```

```bash
claude plugin marketplace add tak-solder/hikyaku#v2.9.2
```

```bash
claude plugin install hikyaku@hikyaku
```

マーケットプレイスを削除すると、そこから入れたプラグインもアンインストールされます。入れ直したら `claude plugin list` で版が 2.9.2 になっていることを確かめてください。進行中のサイクルをすべて閉じたら、同じ手順でタグを付けずに追加し直すと v3 に戻ります。

Codex で使っている場合も、進行中のサイクルは v2 のプラグインのまま終えてください。

## 対応が必要なもの

v3 で作成したサイクルでは、ビルドのディレクトリと `design/` に `progress.jsonl` が増えます。成果物と同じくコミット対象で、`.gitignore` で除外しないでください。別のセッションから再開したときに、続きの手順をこの記録から導くためです。

プラグインに Claude Code の Stop フックが加わりました。スキルの手順の途中でセッションが止まろうとすると、1回だけ続きを促します。Hikyaku を使っていないリポジトリや、手順を進めていないセッションでは何もしないので、対応は要りません。

設定に `[context]` が増えました（[設定](../configuration/config-file.md#context)）。既定値のままで動くので、書き足す必要はありません。

## BP の廃止と予測ピーク

v3 では BP（ビルドポイント）を廃止し、ビルドの大きさを予測ピークで判定します。予測ピークは、ビルドを1つのセッションで進めたとき、メインセッションのコンテキストがどこまで膨らむかの予測（トークン）です（[BUILD](../workflow/build.md#予測ピーク)）。BP の基準表は表そのものが外れていても見積もりと実績が同じように外れ、外れに気づけませんでした。予測ピークはホストの記録から測った実測と直接比べられるので、見積もり方を実績で補正できます。経緯は [#68](https://github.com/tak-solder/hikyaku/issues/68) にあります。

BP と予測ピークは別の量で換算できないため、次のものは自動では移行しません。

- リポジトリルートの `.hikyaku.config` の `bp_max` はエラーになります。削除してください。分割を検討する境目は `[context] split_above`（既定 450k）、統合を検討する境目は `merge_below`（既定 300k）です。閉じたサイクルの `.hikyaku.config` に残っている `bp_max` と `[bp_actual]` は履歴として読み飛ばすので、消さなくて構いません。進行中のサイクルに残っていると、そのサイクルの v3 の作業（`step`・`tokens estimate`・`tasklist` の書き込み）が止まり、`hikyaku validate` も知らせます
- `{HIKYAKU_ROOT}/bp-guide/`（`rules.toml`・`README.md`・`cases.toml`）は読まれません。`README.md` にリポジトリ固有の数え方の注意を書いていた場合は、`/hikyaku:token-guide` で見積もりのガイド（`{HIKYAKU_ROOT}/token-guide/guide.md`）の言葉に書き直してから、`bp-guide/` を削除してください。残っているあいだは `hikyaku doctor` が注意を出します
- `hikyaku bp` のコマンドは `hikyaku tokens` に置き換わりました。`bp guide` は `tokens guide`、`bp estimate` は `tokens estimate`（成分の合計）、`bp history` は `tokens history`、`bp actual` は `tokens history build-NN` です。`bp render`・`bp test` は無くなり、ガイドの版の更新は `tokens stamp` が行います。セッションの実測には `tokens session` が加わりました
- `step report` と `tasklist add / update` の `--bp` は `--peak <トークン数>` になりました
- `/hikyaku:bp-guide` は `/hikyaku:token-guide` になり、ブランチのフェーズ名も `bp-guide` から `token-guide` に変わりました。`[pr] reviewers_skip` に `bp-guide` を書いていたら `token-guide` に直してください

v2 で作成したサイクルの `tasklist.md`（`BP` 列）と `retrospective.md`（「BP見積もりの振り返り」）は、v3 では読み取りだけを行います。`tasklist.md` の更新はエラーで止まり、`tokens history` には並びません。
