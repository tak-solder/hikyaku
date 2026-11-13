---
name: token-guide
description: "Hikyaku 予測ピークのガイドの校正: ビルドの予測ピークと実測を突き合わせ、ワークスペースの見積もりのガイド（token-guide/guide.md）をサイクルをまたいで補正する。サイクルには属さない。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[show|tune]"
---

# Hikyaku Token Guide

ワークスペースの予測ピークの見積もりのガイド（`{HIKYAKU_ROOT}/token-guide/guide.md`）を校正する。

予測ピークは、ビルドのメインセッションのコンテキストがどこまで膨らむかの予測（トークン）で、
build-manager と builder がガイドに沿って成分ごとに見積もる。ガイドが無ければプラグインの標準のガイドで
見積もり、あれば標準を置き換える。

このスキルはワークフロー（PLAN → ARCHITECT → BUILD → CLOSE）の外にある。サイクルに
属さず、どのフェーズからも呼ばれない。サイクルごとの小さな補正は close-cycle の昇格（G10）が行うので、
ここで扱うのはサイクルをまたいだ校正（モデルの世代が変わったとき、補正が溜まってガイドを書き直したいとき、
標準のガイドをプロジェクトの持ち物にしたいとき）。ガイドはワークスペース全体に効き、走行中のサイクルの
残りのビルドも補正後の版で見積もられる。各予測の表に版が残るので、比較は `--group-by guide` で版ごとに分けられる。

## ガイドの構成

| ファイル | 役割 | 書き換えるのは |
|---|---|---|
| `token-guide/guide.md` | プロジェクトのガイド。先頭に版（`version`）・元にした標準の版（`based_on`）・本文のハッシュ（`hash`） | close-cycle（昇格の承認後）・このスキル（承認後）・人。版は `tokens stamp` が上げる |
| `token-guide/progress.jsonl` | このスキルの手順の進捗。`hikyaku step report` が追記する | 手で編集しない |

予測の記録（`tokens estimate` の表）には、見積もりに使ったガイドの版とハッシュが残る。
本文を変えたら必ず `tokens stamp` で版を上げる。上げないと `validate` が止める。

## 作業ステップ

### Step 0: 前提の確認

- [ ] 設定を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config --json
```

未初期化（`document-guide.md` が無い）の場合は `/hikyaku:init` を案内して終了する。

- [ ] 今有効なガイドと、その版を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tokens guide
```

`ガイド` が「標準」なら `token-guide/guide.md` は無い。`$ARGUMENTS[0]` が `show` なら、ここで表示して終了する
（step には記録しない）。

v2 の BP 基準表（`{HIKYAKU_ROOT}/bp-guide/`）が残っていれば、v3 では読まれないことを伝える。
`bp-guide/README.md` にリポジトリ固有の数え方を書いていれば、今回の変更案の素材にする（propose で
ガイドの言葉に書き直す）。削除はユーザーに確認してから、この回の PR に含める。

→ Step 1 へ。

### Step 1 以降: step に従って進める

ここから先の手順（ブランチ → 素材の収集 → 変更案 → 承認 → 書き込み → PR）は、
`step next` が設定と進捗から1手ずつ返す。**手順を自分で組み立てない。**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next token-guide
```

最初の `step next` が `done` を返したら、それは前の回の記録で、今回は新しい回になる。
区切りを記録して、最初の1手（`start`）から始める。前の回の記録は残る。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step restart token-guide --reason "新しい回"
```

返った1手（directive）の種類ごとに動く。報告のコマンドは directive の「報告」にあるものを使う。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら `done` を報告する |
| `gate` | 「指示」のファイルを読み、ユーザーに提示して承認を求める。承認されたら `approved`、直す指示なら `rejected` を報告する。どちらも `--input` にユーザーの答えを添える。`rejected` のあとは答えを反映し、`step next` に従って提示し直す |
| `done` | 手順をすべて終えた。下の「完了の案内」へ |
| `stop` | メッセージをユーザーに伝えて終了する |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 成果物や完了の条件、報告に添える値（`--pr`）は CLI が確かめ、足りなければ報告を受け付けない。
  メッセージに従って直す。報告を通すために、条件を満たしたふりをしたり別のステップとして報告したりしない
- `skipped` は、指示ファイルがスキップを指示する場合だけ。理由を `--reason` に書く
- 承認したあとのガイドの変更は Git の履歴で追う。承認を取り直すと決めたら、
  作り直したステップ（`propose`）を `done` で報告し直す。そこから後ろはやり直しになる
- 再開したとき、前のステップで会話の中に作った成果（集めた素材・変更案の根拠など）が手元に無ければ、
  そのステップを `done` で報告し直してやり直す
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る
- 進捗は `token-guide/progress.jsonl` に記録される。コミットは `pr` の指示に従う

### 完了の案内

`done` が返ったら、次を案内する。

```
見積もりのガイドを更新しました（v{前} → v{後}）。この PR がマージされてから見積もるビルドに反映されます。
走行中のサイクルの既存の予測は変わりません。残りのビルドは新しい版で見積もられます（予測の表に版が残るので、比較は版ごとに分けられます）。
```

## 共通ルール

- **ガイドを推測で動かさない。** 根拠は `tokens history` の実測と振り返りの乖離の要因か、ユーザーの指示
- 先頭の版の宣言を手で直さない。本文を直して `tokens stamp` を実行する
- 既存の補正を黙って書き換えない。外す判断はユーザーのもの
- 走行中のサイクルには触らない。plan.md や issue.md の予測を書き換えて回るのは、このスキルの仕事ではない
