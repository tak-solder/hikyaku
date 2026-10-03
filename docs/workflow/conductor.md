# conductor — ARCHITECT 以降を任せる

`/hikyaku:conductor` は、PLAN を終えたサイクルを ARCHITECT から最後のビルドまで進めます。あなたが開いているセッションが監督になり、各フェーズは監督が起動する非対話の子セッション（`claude -p`）が、いつもの architect / builder / close-cycle のスキルのまま実行します。

子が承認や確認を求める箇所で止まると、監督が成果物を読んで答えます。人間が答えるのは、要件のすり合わせ（PLAN）と、監督が自分で答えてはいけない問いだけです。

```
/hikyaku:planner      → 人間と要件をすり合わせる（いつもどおり）
/hikyaku:conductor    → architect → build-01 → build-02 … を子が実行し、監督が問いに答える
（人間が PR の連鎖をマージ）
/hikyaku:conductor    → close-cycle を子が実行する
```

## 使う前に

監督は自分のセッションの Bash で `claude -p` を起動します。この起動が許可ルールで止められないよう、監督を動かすリポジトリの `.claude/settings.json`（または `settings.local.json`）で許可してください。

```json
{
  "permissions": {
    "allow": ["Bash(claude -p:*)"]
  }
}
```

子に許可するツールは `hikyaku conductor launch` が決めます。既定はファイルの読み書きと検索、サブエージェント、`git` / `node` / `ls` / `cat`、PR の作成と参照（`gh pr create` / `gh pr view`）だけです。テストの実行コマンドがこれに含まれない場合（`npm test` など）は、`.hikyaku.config` の `[conductor] allowed_tools` に足してコミットしておきます。許可が無いと、builder はローカル検証の段階で止まります。監督も起動前にこれを確かめ、足りなければ案内して止まります。

```toml
[conductor]
allowed_tools = ["Bash(npm test:*)"]
```

子に `bypassPermissions` は渡しません。監督の目が届かないところで何でもできる状態を作らないためです。設定キーの一覧は [.hikyaku.config](../configuration/config-file.md#conductor) にあります。

## 始める

PLAN を終えたら、サイクルを指定して起動します。

```
/hikyaku:conductor 002-billing
```

サイクルがまだ `planning`（user-stories.md が無い）なら、監督は `/hikyaku:planner` を案内して止まります。要件のすり合わせは人間と対話で行うもので、conductor の対象ではありません。

起動すると、監督は1回だけ確認を求めます。user-stories.md を承認済みの要件として扱うこと、監督が判断する同意ゲートと人間に上げる問いの一覧、PR はマージしないこと、の3点です。一覧は `hikyaku conductor asks` が、サイクルのプロファイルと設定から計算します。

## 監督が答える問い、人間に上げる問い

子が止まる箇所には、スキルの中で ID が付いています（`G8` や `review-findings` など）。監督は子の出力から ID を取り出し、既定の振り分けに従って答えるか人間に上げるかを決めます。

| 種別 | 例 | 既定 |
|---|---|---|
| 確認ゲート・経路の判断 | G3 / G4、`branch`、`overlap` | 監督 |
| 同意ゲート | G6 / G8 / G10 | 監督（起動時の確認で委任される） |
| 仕様の確認 | `questions`、`design-conflict`、`review-findings` | 監督 |
| 障害 | `retry-limit` | 人間 |
| サイクルの中止・分類できない問い | `abandon`、`other` | 常に人間 |

既定で監督が答える種別でも、issue と承認済みの成果物から導けない回答や、スコープを広げる回答が必要なら、監督は人間に上げます。たとえば builder が「設計どおりでは要件を満たせない」と止まったとき、監督は architect への差し戻しを選べますが、要件のほうを改める判断はしません。

振り分けは問いの ID ごとに変えられます。G8 だけは自分で見たい、という場合は `escalate` に並べます。

```toml
[conductor]
escalate = ["G8"]          # 監督が答える問いを人間に上げる
delegate = ["retry-limit"] # 人間に上げる問いを監督に任せる
```

`abandon` と `other` は設定でも監督に任せられません。表に無い ID はエラーになります。全体の振り分けは `hikyaku conductor asks <cycle>` で確認できます。

プロファイルは今までどおり効きます。プロファイルが決めているのは子がどこで止まるかなので、conductor のもとでは「監督がどれだけ確かめるか」に読み替わります。express なら G3 / G4 で止まらず、監督が設計を見るのは G6 からになります。止まる回数が増えるほど、子の再開の回数と費用も増えます。

## 監督が確かめること

監督は子の報告をそのまま信じません。plan.md と test-spec.md を承認する前（G8）には、issue.md の受け入れ基準をすべて網羅しているかを読みます。ビルドが終わったら、テストを自分で再実行し、差分が plan.md の範囲に収まっているかを確かめます。昇格を承認する前（G10）には、監督がその場で決めた運用や、すでに事実でない前提が昇格候補に混ざっていないかを確かめます。

監督が下した判断は、子が根拠とともに記録します。architect では `design/design-questions.md`、builder では `build-NN/questions.md`、tasklist の変更（G6）と昇格（G10）ではコミットメッセージです。PR をレビューするときに、どの承認を人間ではなく監督が下したかを追えます。

## PR は積み上げ、マージは人間が行う

監督は PR をマージしません。各フェーズのブランチを直前のフェーズのブランチから切り、plan → architect → build-01 → build-02 … と積んでいきます。各 PR のマージ先は直前のブランチになります（`hikyaku pr base` が導出するので、特別な指定は要りません）。

最後のビルドが終わると、監督はマージすべき PR を順に並べて止まります。PR ごとに、監督が判断した同意ゲートも示します。順にマージしたあと、もう一度 `/hikyaku:conductor <cycle>` を実行すると、サイクルの状態が `completed` になっているので CLOSE から再開します。CLOSE だけを積まないのは、未マージの実装を「実装済みの現実」として永続ドキュメントに書かないためです。

積み上げている間は、PLAN と ARCHITECT の成果物がデフォルトブランチに入りません。並行して走っている他のサイクルからは、このサイクルの設計が見えないということです。conductor は1サイクルずつ回す前提で、`hikyaku next` が複数のビルドを返しても1件ずつ実行します。

builder が architect へ差し戻した場合も、監督は状態導出に従って、差し戻されたビルドのブランチのまま architect を起動します。再設計はそのビルドの PR に入るので、PR の連鎖は一直線のまま保たれます。

## 中断と再開

監督は状態を保存しません。次に何をするかは毎回 `hikyaku cycle status` と `hikyaku next` から導くので、監督のセッションが落ちても、同じコマンドで起動し直せば続きから進みます。止まっていた子の会話は引き継がれませんが、子はスキルの中断検出で成果物から再開点を見つけます。

子が予算超過や利用上限で途中終了した場合、監督は人間に再開してよいかを尋ね、同じ子のセッションを再開します。呼び出し1回ごとの費用に上限を設けたいときは `budget_per_run` を使います（既定は 0 で上限なし）。
