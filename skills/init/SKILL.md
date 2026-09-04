---
name: init
description: "Hikyaku 初期化: ワークスペースを作成し、リポジトリ既存の設計ドキュメントを document-guide.md に登録する。v1 からの移行もここで行う。"
user-invocable: true
disable-model-invocation: false
argument-hint: "[{HIKYAKU_ROOT}]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "2.0.0"
---

# Hikyaku Init

Hikyaku ワークスペースを初期化する。**このスキルは1つのリポジトリにつき原則1回だけ実行する。**

## あなたの役割

`document-guide.md` を作ることがゴール。これは「どの永続ドキュメントが、どこに、
誰の管理で存在するか」を宣言する唯一の場所で、**存在しなければ Hikyaku は動作しない**。

機械的な雛形生成はスクリプトが行う。あなたの仕事は**リポジトリを調べて、既存の
設計ドキュメントを見つけ、ユーザーと相談して guide に当てはめること**。

## 判断基準

永続ドキュメントに何を持つかは、次の基準で決まっている。

> **復元コスト ÷ 陳腐化速度**

- `db-schema` の全テーブル定義 — 復元コスト低（マイグレーションを読めばよい）／陳腐化速い → **Hikyaku は作らない**
- `overview` の責務・境界・データフロー — 復元コスト極高（全ファイルを読んで構造を推論）／陳腐化遅い → **作る価値がある**

**コピーではなくポインタを持つ。** 「スキーマの正は `db/migrations/`」は腐らないが、
「主要テーブル: users, orders」は腐り、しかも腐っていることに誰も気づけない。

## 作業ステップ

### Step 0: 既存ワークスペースの確認

- [ ] `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" doctor` を実行する

Node が v22.18.0 未満の場合はここで終了し、更新を案内する（型剥がしがフラグ無しで
有効になる最小バージョン）。

- [ ] 既に `document-guide.md` が存在する場合は、初期化済みとして終了する

→ Step 1 へ。

### Step 1: HIKYAKU_ROOT の決定

- [ ] `$ARGUMENTS[0]` が指定されていればそれを使う
- [ ] 未指定ならユーザーに尋ねる（推奨: `docs/hikyaku`）

**HIKYAKU_ROOT にはサイクルの成果物だけを置く。** 永続ドキュメントはリポジトリ側の
規約に従った場所（`docs/` など）に置き、guide から参照する。

→ Step 2 へ。

### Step 2: v1 構造の検出（該当時のみ）

指定されたパスの直下に `planning/` や `build-01/` があれば、Hikyaku v1 のワークスペースである。

**移行は機械的に決め打ちせず、ユーザーと対話して決める。** v1 ユーザーの状態は多様で、
一律のルールでは捌けない。

| 状況 | 妥当な扱い |
|---|---|
| サイクル完走済み | `cycles/001-legacy/` へアーカイブ（第一候補） |
| ビルド途中 | **v1.0.0 のまま完走してから移行**する（プラグインのバージョンを固定） |
| planning だけやって放置 | 捨ててよいことが多い |
| 複数の DOC_ROOT を運用していた | 別サイクルか別ワークスペースか要判断 |

アーカイブする場合:

- [ ] `git mv` で `planning/` `tasklist.md` `build-NN/` を `cycles/001-{slug}/` へ移す
- [ ] `architecture/` は**移動しない**。Step 4 で `repo` 管理として guide に登録する
- [ ] cycles.md に `hikyaku: 1.0.0` / `status: closed` で1行足す

これにより、`planning/` があって `design-delta.md` が無い理由が、行を見ただけで分かるようになる。

→ Step 3 へ。

### Step 3: 雛形の生成

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" init --root {HIKYAKU_ROOT}
```

既存ファイルは決して上書きされない。

**v1 と異なり `.gitignore` は生成しない。** ファイル正へ一本化した結果、除外すべき
ローカルキャッシュが無くなった。close-cycle は別セッションで `retrospective.md` を
昇格素材として読むため、除外すると読めなくなる。

→ Step 4 へ。

### Step 4: 既存ドキュメントの検出と登録

**ここがこのスキルの本体。**

- [ ] リポジトリを走査して既存の設計ドキュメントを探す
  - `docs/` `doc/` `adr/` `architecture/` `AGENTS.md` `CLAUDE.md` `CONTRIBUTING.md`
  - v1 から移行する場合は `{HIKYAKU_ROOT}/architecture/` も対象
  - AGENTS.md / CLAUDE.md にドキュメント規約が書かれていれば最優先で従う
- [ ] 見つけたものを論理名に割り当て、**ユーザーに提示して確認を得る**

```
既存の設計ドキュメントを検出しました。document-guide に登録しますか？

  decisions   → docs/adr/                 (repo 管理・既存ADR形式)
  conventions → AGENTS.md                 (repo 管理)
  db-schema   → docs/db.md                (repo 管理・参考資料)
  overview    → 該当なし。未作成として登録し、初回の close-cycle で作成します
```

- [ ] `{HIKYAKU_ROOT}/document-guide.md` の管理列とパス列を埋める

**管理列の意味を守ること:**

| 管理 | Hikyaku の振る舞い |
|---|---|
| `hikyaku` | テンプレートに従う。書く/書かない・振る舞い・形式のすべてを適用する |
| `repo` | **既存形式が正。追記のみで、形式には手を出さない**。既存記述の削除・整理もしない |
| `未作成` | 次に必要になったとき Hikyaku が作成する |
| `対象外` | 意図的に持たない。**理由を概要欄に書く** |

既存 ADR が `AD-N` 形式でも、`repo` 管理として登録すればそのまま使い続けられる。
形式変換は不要。

- [ ] 検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs validate --root {HIKYAKU_ROOT}
```

→ 問題がなければ Step 5 へ。

### Step 5: AGENTS.md への索引（承認必須）

- [ ] 差分を提示する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs link --root {HIKYAKU_ROOT} --dry-run
```

- [ ] **ユーザーの承認を得てから**実行する

AGENTS.md はリポジトリ全体の AI 設定であり、チーム全体に影響する。マーカーで
囲むので人間が書いた部分は保持されるが、書き換える以上は承認を取る。

**この索引が無いと、Hikyaku 以外のセッション（通常の Claude Code、Copilot、Cursor）は
永続ドキュメントの存在に気づけない。**

→ Step 6 へ。

### Step 6: コミットと PR

- [ ] ブランチを作成する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch name init --root {HIKYAKU_ROOT}
```

- [ ] コミットして PR を作成する（タイトルは `hikyaku pr title init` で生成）
  - コミットメッセージの形式はリポジトリの規約に従う。Hikyaku は関与しない
- [ ] 完了後、次を案内する

```
初期化が完了しました。

サイクルを開始するには:
/hikyaku:create-cycle {HIKYAKU_ROOT} <slug> --profile <name>

または planner が代行します:
/hikyaku:planner {HIKYAKU_ROOT}
```
