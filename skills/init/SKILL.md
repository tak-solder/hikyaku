---
name: init
description: "Hikyaku 初期化: ワークスペースを作成し、リポジトリ既存の設計ドキュメントを document-guide.md に登録する。v1 からの移行もここで行う。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{HIKYAKU_ROOT}]"
---

# Hikyaku Init

Hikyaku ワークスペースを初期化する。このスキルは1つのリポジトリにつき原則1回だけ実行する。

## あなたの役割

`document-guide.md` を作ることがゴール。これは「どの永続ドキュメントが、どこに、
誰の管理で存在するか」を宣言する唯一の場所で、存在しなければ Hikyaku は動作しない。

機械的な雛形生成はスクリプトが行う。あなたの仕事はリポジトリを調べて、既存の
設計ドキュメントを見つけ、ユーザーと相談して guide に当てはめること。

## 作業ステップ

Step 0〜3 はワークスペースができる前の準備で、ここに書いてある。雛形を生成したあとの手順は
`step next` が1手ずつ返す（Step 4 以降）。

### Step 0: 既存ワークスペースの確認

- [ ] `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" doctor` を実行する

Node が v22.18.0 未満の場合はここで終了し、更新を案内する（型剥がしがフラグ無しで
有効になる最小バージョン）。

- [ ] 既に `document-guide.md` が存在する場合は、`step next` で初期化済みかを確かめる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next init
```

`stop` が返ったら初期化済み（手順を終えている、または v2 までに初期化された）なので、
メッセージを伝えて終了する。それ以外は中断からの再開（雛形を生成した直後の中断を含む）なので、
返った1手から Step 4 の転送ループで続ける。

→ Step 1 へ。

### Step 1: HIKYAKU_ROOT の決定

- [ ] `$ARGUMENTS[0]` が指定されていればそれを使う
- [ ] 未指定ならユーザーに尋ねる（デフォルト: `docs/hikyaku`）

HIKYAKU_ROOT にはサイクルの成果物だけを置く。永続ドキュメントはリポジトリ側の
規約に従った場所（`docs/` など）に置き、guide から参照する。

→ Step 2 へ。

### Step 2: v1 構造の検出（該当時のみ）

指定されたパスの直下に `planning/` や `build-01/` があれば、Hikyaku v1 のワークスペースである。
`${CLAUDE_PLUGIN_ROOT}/skills/init/references/v1.md`（[v1.md](references/v1.md)）に従って、
ユーザーと扱いを決める。無ければ飛ばす。

→ Step 3 へ。

### Step 3: 雛形の生成

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" init --root {HIKYAKU_ROOT}
```

既存ファイルは決して上書きされない。

生成するのは次の5つ。

| ファイル | 役割 |
|---|---|
| リポジトリルート/`.hikyaku.config` | 設定のベース（必須）。`hikyaku_root` の唯一の宣言先 |
| `{HIKYAKU_ROOT}/cycles.md` | サイクル索引 |
| `{HIKYAKU_ROOT}/document-guide.md` | ドキュメントガイドの雛形 |
| `{HIKYAKU_ROOT}/bp-guide/` | BP の基準表（`rules.toml` 正本 / `README.md` 説明 / `cases.toml` 期待値テスト）。Hikyaku の既定値から生成 |
| `{HIKYAKU_ROOT}/.gitignore` | `.hikyaku.local` の1行だけ（既にあれば1行だけ追記する） |

`bp-guide/` はワークスペースの持ち物で、以後プラグインを更新しても変わらない。
無くても既定値で動くので、v2.0 で初期化済みのワークスペースに足すときも同じコマンドを
再実行すればよい（無いファイルだけ生成する）。調整は `/hikyaku:bp-guide` で行う。

出た警告は、Step 4 の最初の手順（cleanup）で扱う。

→ Step 4 へ。

### Step 4 以降: step に従って進める

ここから先の手順（警告の後始末 → 既存ドキュメントの登録 → AGENTS.md への索引の承認と書き込み →
PR）は、`step next` が進捗から1手ずつ返す。**手順を自分で組み立てない。**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next init
```

返った1手（directive）の種類ごとに動く。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら「報告」のコマンドを実行する |
| `gate` | 「指示」のファイルを読み、ユーザーに提示して承認を求める。答えを `approved` / `rejected` で報告する |
| `stop` | メッセージをユーザーに伝えて終了する。`pr` の報告のあとに返るものは、完了の案内のあとでよい |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 報告を受け付けないとき（現在地と違うステップ）はエラーになる。メッセージに従って直す
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る
- 進捗は `{HIKYAKU_ROOT}/progress.jsonl` に記録される。PR に含める

### 完了の案内

完了の案内は最後のステップ（`pr`）の指示にある。`pr` を報告したあとは、初期化済みを示す `stop` が返る。
