---
name: bp-guide
description: "Hikyaku BP 基準表の運用: ビルドの見積もりと実績を突き合わせ、ワークスペースの BP 基準表（bp-guide/rules.toml）を調整し、期待値テストを整備する。サイクルには属さない。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[show|tune]"
---

# Hikyaku BP Guide

ワークスペースの BP 基準表（`{HIKYAKU_ROOT}/bp-guide/`）を運用する。

この基準表（`rules.toml` の段階表と `cases.toml` の期待値）による BP の算出は、v3 の見積もり方を
[#68](https://github.com/tak-solder/hikyaku/issues/68) で決めるまでの暫定の方式。方式が変われば、
この手順も build-manager の見積もりや分割のしきい値と合わせて変わる。

このスキルはワークフロー（PLAN → ARCHITECT → BUILD → CLOSE）の外にある。サイクルに
属さず、どのフェーズからも呼ばれない。基準表はワークスペース全体に効くので、走行中の
サイクルの途中で動かすと、そのサイクルの中で見積もりの比較が成立しなくなる。
だから専用の入口を持つ。

## 基準表の構成

| ファイル | 役割 | 書き換えるのは |
|---|---|---|
| `bp-guide/rules.toml` | 正本。スクリプトはこれだけを読む | このスキル（承認後）か人 |
| `bp-guide/README.md` | 人間向けの説明。表の部分はマーカーブロックで `rules.toml` から生成 | 表は `bp render`、文章は人 |
| `bp-guide/cases.toml` | 期待値テスト。入力 → 期待 BP | このスキル（承認後）か人 |
| `bp-guide/progress.jsonl` | 運用の手順の進捗。`hikyaku step report` が追記する | 手で編集しない |

ディレクトリが無ければ Hikyaku の既定値で動いている。調整するには先に生成する（step の `generate`）。

## 作業ステップ

### Step 0: 前提の確認

- [ ] 設定を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config --json
```

未初期化（`document-guide.md` が無い）の場合は `/hikyaku:init` を案内して終了する。

- [ ] 現在の基準表と、その出どころを確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp guide
```

先頭が「既定値」なら `bp-guide/` は無い。`$ARGUMENTS[0]` が `show` なら、ここで表示して終了する
（step には記録しない）。

→ Step 1 へ。

### Step 1 以降: step に従って進める

ここから先の手順（ブランチ → 基準表の生成 → 素材の収集 → 変更案 → 承認 → 再生成と検証 → PR）は、
`step next` が設定と進捗から1手ずつ返す。**手順を自分で組み立てない。**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next bp-guide
```

最初の `step next` が `done` を返したら、それは前の回の記録で、今回は新しい回になる。
区切りを記録して、最初の1手（`start`）から始める。前の回の記録は残る。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step restart bp-guide --reason "新しい回"
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
- 承認したあとの `rules.toml` / `cases.toml` の変更は Git の履歴で追う。承認を取り直すと決めたら、
  作り直したステップ（`propose`）を `done` で報告し直す。そこから後ろはやり直しになる
- 再開したとき、前のステップで会話の中に作った成果（集めた素材・変更案の根拠など）が手元に無ければ、
  そのステップを `done` で報告し直してやり直す
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る
- 進捗は `bp-guide/progress.jsonl` に記録される。コミットは `pr` の指示に従う

### 完了の案内

`done` が返ったら、次を案内する。

```
BP 基準表を更新しました。この PR がマージされてから作成するビルドの見積もりに反映されます。
走行中のサイクルの既存の見積もりは変わりません（比較のため、振り返りは当時の基準で読んでください）。
```

## 共通ルール

- **`rules.toml` の値を推測で動かさない。** 根拠は `bp history` の実績か、ユーザーの指示
- `README.md` の表を手で直さない。`rules.toml` を直して `bp render` する。手で直すと `validate` が止める
- 既存の期待値ケースを黙って書き換えない。期待値が変わるのは基準の変更で、その判断はユーザーのもの
- 走行中のサイクルには触らない。plan.md や issue.md の BP を書き換えて回るのは、このスキルの仕事ではない
