---
name: bp-guide
description: "Hikyaku BP 基準表の運用: ビルドの見積もりと実績を突き合わせ、ワークスペースの BP 基準表（bp-guide/rules.toml）を調整し、期待値テストを整備する。サイクルには属さない。"
user-invocable: true
disable-model-invocation: true
argument-hint: "[show|tune]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "2.1.0"
---

# Hikyaku BP Guide

ワークスペースの BP 基準表（`{HIKYAKU_ROOT}/bp-guide/`）を運用する。

**このスキルはワークフロー（PLAN → ARCHITECT → BUILD → CLOSE）の外にある。** サイクルに
属さず、どのフェーズからも呼ばれない。基準表はワークスペース全体に効くので、走行中の
サイクルの途中で動かすと、そのサイクルの中で見積もりの比較が成立しなくなる。
だから専用の入口を持つ。

## 基準表の構成

| ファイル | 役割 | 書き換えるのは |
|---|---|---|
| `bp-guide/rules.toml` | 正本。スクリプトはこれだけを読む | このスキル（承認後）か人 |
| `bp-guide/README.md` | 人間向けの説明。表の部分はマーカーブロックで `rules.toml` から生成 | 表は `bp render`、文章は人 |
| `bp-guide/cases.toml` | 期待値テスト。入力 → 期待 BP | このスキル（承認後）か人 |

ディレクトリが無ければ Hikyaku の既定値で動いている。調整するには先に生成する（Step 1）。

## 入力値の問題か、基準表の問題か

**見積もりの乖離には2種類あり、直す場所が違う。**

| 乖離の種類 | 見え方 | 直す場所 |
|---|---|---|
| 入力値の読み違え | 見積もった新規ファイル数・行数と実測値が離れている。加算要素を落としていた | 数え方。`bp-guide/README.md` の「入力値の数え方」か `instructions.md` |
| 基準表がリポジトリに合わない | 入力値は合っていたのに1セッションに収まらなかった（または大幅に余った）ビルドが続く | `rules.toml` のしきい値・加算値 |

`rules.toml` を動かすのは後者だけ。入力値の読み違えをしきい値で吸収すると、次に数え方が
正しくなったときに逆方向へ外れる。

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

先頭が「既定値」なら `bp-guide/` は無い。`$ARGUMENTS[0]` が `show` なら、ここで表示して終了する。

→ Step 1 へ。

### Step 1: ブランチと基準表の生成

- [ ] ブランチを作成し、命名規則どおりか確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify bp-guide
```

`bp-guide` はサイクルに属さないフェーズで、ブランチは `init` と同じ形（`{prefix}{separator}bp-guide`）。
`ok: true` ならそのまま、`onBaseBranch: true` なら `expected` の名前で作成する。
`onBaseBranch` が `false` / `null`（既に別の作業ブランチに居る）なら、**必ずユーザーに尋ねる**。
Hikyaku の規則に従う / 現在のブランチで作業する / 別のブランチを指定する、の3つを提示し、
**どれが妥当かは示唆しない。**

- [ ] `bp-guide/` が無ければ生成する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" init --root {HIKYAKU_ROOT} --dry-run
```

`bp-guide/` の3ファイルだけが「生成」になることを確認してから `--dry-run` を外す。
既存ファイルには触れない。生成直後の内容は既定値そのものなので、ここで止めるなら
コミットして Step 5 へ進む（既定値をワークスペースの持ち物として固定するだけでも意味がある。
以後プラグインの既定値が変わっても、このリポジトリの基準は動かない）。

→ Step 2 へ。

### Step 2: 素材の収集

- [ ] 見積もりと実績を集める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp history
```

各ビルドについて architect / builder 段階の見積もり、実績、乖離、新規ファイル数・実装行数の
「見積 → 実測」、セッションが完結したかが並ぶ。**読めない項目は「—」で出る。推測で埋めない。**

- [ ] 乖離のあるビルドの `retrospective.md` を読み、「乖離の要因」を確認する
  - 入力値の読み違えか、基準表の問題かは、そこに分けて書かれている（書かれていなければ
    「見積 → 実測」の列とセッション列から判断する）
- [ ] `bp-guide/README.md` の文章（このリポジトリ固有の数え方の注意）を読む

素材が無い（ビルドの振り返りがまだ無い）場合は、ユーザーが変更内容を指定している場合だけ
Step 3 へ進む。実績無しにしきい値を動かすのは推測なので、こちらから提案はしない。

→ Step 3 へ。

### Step 3: 変更案の作成

- [ ] 素材から変更案を作り、**根拠を添えて**ユーザーと決める

変更の種類ごとに書く場所が違う。

| 変更 | 書く場所 | 例 |
|---|---|---|
| しきい値の変更 | `rules.toml` の `metrics.*.upper` / `levels` | 実装行数の BP3 上限を 1000 → 700 に下げる |
| 加算要素の追加 | `rules.toml` の `[additions.*]` | `[additions.payment_api] label = "決済APIを叩く" bp = 2` |
| 指標の追加 | `rules.toml` の `[metrics.*]` | `[metrics.migrations]` |
| 数え方の注意 | `README.md` の文章部分 | 「マイグレーション1本は新規ファイル2つと数える」 |

加算要素の書き方は3種類（`hikyaku help bp guide` と `rules.toml` のコメントを参照）。

```toml
[additions.payment_api]        # flag: 該当すれば +2
label = "決済APIを叩く"
bp = 2

[additions.entity_design]      # per: 指標の値を共有し、1つにつき +1（上限 +4）
label = "Entity 設計"
input = "db_entities"
per = 1
cap = 4

[additions.impact_files]       # tiered: 段階で加算
label = "影響ファイル数"
upper = [3, 6, 10]
bp = [0, 1, 3, 4]
```

- [ ] 変更ごとに、**それを確かめる期待値ケース**を `cases.toml` に足す
  - 動かしたしきい値の境界の両側、追加した加算要素が効く入力と効かない入力
  - 既存のケースが変更で壊れるなら、期待値を直すのではなく、**なぜ変わってよいか**を
    ユーザーに確認する（既存ケースは過去の判断の記録）

→ Step 4 へ。

### Step 4: 反映と検証（承認必須）

**承認前に書き込まない。**

- [ ] 変更後の `rules.toml` / `cases.toml` の差分と、次の2つの結果を提示して承認を得る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp render --dry-run
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp test
```

`bp test` は書き込み済みの `rules.toml` / `cases.toml` を読むので、提示の段階では
変更案をファイルに書いた上で実行し、承認されなければ `git checkout` で戻す。

- [ ] 承認を得たら README の表を再生成し、検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp render
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" validate
```

`validate` は README の表が古いこと、期待値の不一致、`rules.toml` の構文エラーを検出する。
通らなければ Step 3 に戻る。

この承認は profile の管轄外で、常に行う。基準表はワークスペース全体の見積もりに効き、
**何を基準にするかは人間の判断**だから。

→ Step 5 へ。

### Step 5: コミットと PR

- [ ] コミットする前に、もう一度ブランチを確認する（`hikyaku branch verify bp-guide`）
- [ ] コミットして PR を作成する（タイトルは `hikyaku pr title bp-guide` で生成）
  - PR 本文に、変更の根拠（どのビルドの乖離から判断したか）を書く
- [ ] 完了後、次を案内する

```
BP 基準表を更新しました。この PR がマージされてから作成するビルドの見積もりに反映されます。
走行中のサイクルの既存の見積もりは変わりません（比較のため、振り返りは当時の基準で読んでください）。
```

## 共通ルール

- **`rules.toml` の値を推測で動かさない。** 根拠は `bp history` の実績か、ユーザーの指示
- **`README.md` の表を手で直さない。** `rules.toml` を直して `bp render` する。手で直すと `validate` が止める
- **既存の期待値ケースを黙って書き換えない。** 期待値が変わるのは基準の変更で、その判断はユーザーのもの
- 走行中のサイクルには触らない。plan.md や issue.md の BP を書き換えて回るのは、このスキルの仕事ではない
