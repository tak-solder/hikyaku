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

Codex で使っている場合も、進行中のサイクルは v2 のプラグインのまま終えてください。v3 には Codex 用のプラグインがありません（[Codex のホスト対応の廃止](#codex-のホスト対応の廃止)）。

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

## Codex のホスト対応の廃止

v3 では、Codex で Hikyaku のスキルを動かすためのプラグイン（`codex-plugin` ブランチで配布していた `$hikyaku:*` のスキル）を廃止しました。Hikyaku のスキルを動かすメインのセッションは Claude Code だけです。共通の手順を変えるたびに Codex 向けの読み替えを確かめる必要があり、手順の変更を重くしていたためです。

Codex はレビューの実行先として残ります。`[review] provider = "codex"`（種類ごとなら `[review.<種類>] provider`）と書けば、コード・セキュリティ・ドキュメントのレビューを `codex exec` で実行します。

次のものは自動では移行しません。

- `[review.provider_for]` と `[review.<種類>.provider_for]` はエラーになります。`claude = "codex"` と書いていたなら `provider = "codex"` に書き換え、`codex` の行だけなら削除してください。閉じたサイクルの `.hikyaku.config` に残っているものは読み飛ばします
- `hikyaku review resolve` / `review run` の `--self` と、`hikyaku tokens session` の `--host` はエラーになります。外して実行してください
- Codex のクラウド環境（`CODEX_ENVIRONMENT_ID`）でのプロバイダの固定と、`tokens session` による Codex の rollout の計測は無くなりました。Codex で回したビルドの `retrospective.md` は、`tokens history` でこれまでどおり読めます
- Codex にインストールした Hikyaku は v2 のまま残ります。v3 には上げられないので、不要ならアンインストールしてください

## ビルドごとの外部起票の廃止

v3 では、ビルドごとの issue（GitHub の子 issue・Asana のタスク）の起票をやめ、外部システムへの投影をサイクルごとの GitHub issue の作成とクローズだけにしました（[サイクルの GitHub issue](../configuration/external.md)）。ビルドの分割や完了を外部へ写すと、写し漏れや古い表示が残り、どちらが正しいのか分からなくなるためです。ビルドの一覧と進捗の正は、これまでどおり `tasklist.md` です。

- `[external] target = "asana"` と `asana_project_gid` はエラーになります。`target` を `"github"` か `"none"` にし、`asana_project_gid` を削除してください。閉じたサイクルの `.hikyaku.config` に残っているものは読み飛ばします
- `tasklist.md` の `issue` 列は無くなりました。既存の `issue` 列のある `tasklist.md` もそのまま読めて、`tasklist` のコマンドで書き込むと列が落ちます。列にあった子 issue の参照は消えるので、残したい場合は GitHub 側で閉じておくか、手で控えてください
- `hikyaku tasklist link`、`tasklist add` の `--issue`、`cycle new` の `--external-project` は無くなりました
- ビルドの PR は子 issue を閉じず、サイクルの issue を `Refs` で参照します。既に起票済みの子 issue は Hikyaku からは閉じられないので、不要なら手で閉じてください

## 永続ドキュメントの論理名の整理

v3 では、永続ドキュメントの論理名を `overview` / `decisions` / `constraints` / `conventions` / `glossary` の5つに絞りました。`learnings` / `test-strategy` / `security-model` / `tech-stack` / `db-schema` / `interfaces` は廃止です。`document-guide.md` にこれらの行が残っていると、`hikyaku validate` と `hikyaku docs validate` がエラーにします。黙って無視すると、登録済みの文書が読む候補からも昇格先からも静かに消えるためです。

廃止の理由は、置き場の決め方を変えたことにあります。v3 は知見を「いつ読み込まれる場所に置くか」で決め、一部のファイルにしか効かない注意はパス指定の rule に、機械で防げるものはコードに置きます（[知見の置き場](../configuration/persistence.md)）。落とし穴集を1つの文書に溜めると、たまにしか使わない知見のために毎セッションで一定のコンテキストを使います。

行を消すだけにはしないでください。落とし穴集には、テストが通ってしまう類の、再発しても気づけない知見が混ざっています。一方で、既にコードで防がれているものや、他の文書と重複しているものも多く含まれます。項目ごとに振り分ける必要があります。

振り分けは `/hikyaku:init` が手伝います。初期化済みのワークスペースで実行すると、廃止した論理名が残っていることを知らせ、移行の回を始めます。

```
/hikyaku:init
```

移行の回では、`doc-triager` エージェントが文書を項目ごとに読み、コードと突き合わせて、重要度と置き場を判定します。結果は「移すもの」と「消すもの」に分けて提示され、承認したものだけが書き込まれます。機械で防げるのに未対応の項目は、rule に仮置きしたうえで、何を入れれば防げるかが PR の本文に並びます。常時読み込まれる AGENTS.md や既存の rule も、希望すれば同じ手順で見直せます。

廃止した論理名の中身の行き先は、おおむね次のとおりです。

| 廃止した論理名 | 中身の行き先 |
|---|---|
| `learnings` | 重要度で振り分ける。機械で防ぐ、パス指定の rule、`constraints`、または書かない |
| `test-strategy` | 全体に効く方針は `conventions`、テストのファイルだけに効く注意はパス指定の rule |
| `security-model` | 設計を縛る条件は `constraints`、構造は `overview` |
| `tech-stack` / `db-schema` / `interfaces` | 正はコード側。`overview` にポインタを書く。ファイルは残してもよいが、Hikyaku は読まない |

## handoff と振り返りの形式

v3 で作るサイクルでは、`handoff.md` と `retrospective.md` の形式が変わります。`handoff.md` は「後続ビルドが前提にすること」「残したこと」「永続化すること」の3節になり、`retrospective.md` は改善提案（R-N）とリポジトリ固有の学び（L-N）の代わりに、「永続化すること」と「役に立たなかった記述」を1件1行で書きます。close-cycle は `hikyaku promotions` でこれらを集めます。

v2 の形式で書かれた `handoff.md` と `retrospective.md` からは、候補を集められません。進行中のサイクルを v2 のまま終えてから v3 に上げる、という冒頭の手順に従っていれば、対応は要りません。

## close-cycle の変更

close-cycle は自身の振り返りを行わなくなりました。昇格の候補は、サブエージェントによる抽出ではなく `hikyaku promotions` が集めます。追加に加えて、記述の削除と置き換えも提案します。見積もりのガイドの補正は close の PR には含まれなくなり、乖離が大きいサイクルで close-cycle が `/hikyaku:token-guide` を呼んで、別のブランチの PR にします。詳しくは [CLOSE](../workflow/close.md) を参照してください。
