---
name: close-cycle
description: "Hikyaku サイクル終了: 実装済みの成果を永続ドキュメントへ昇格させ、サイクルを closed にする。"
user-invocable: true
disable-model-invocation: true
argument-hint: "[{cycle}]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "2.0.0"
---

# Hikyaku Close Cycle

全ビルドが完了したサイクルを締め、**サイクルの成果を永続ドキュメントへ昇格させる**。

## なぜ独立したフェーズなのか

永続ドキュメントは「**実装済みの現実（as-is）**」を表す。サイクルドキュメントは
「これから作るもの（to-be）」を表す。この区別があるから、並行して走る別サイクルが
未実装の設計を「現実」として読んでしまう事故が防げる。

昇格は PR がマージされて初めて真になるので、実装が全部終わってから行う。

ただし `completed`（全ビルド完了）と `closed`（昇格完了）の間には**危険な空白**がある。
実装は main に入っているのに `overview` はまだ古い。この期間に他サイクルの architect が
走ると、古い `overview` を現実として信じる。**だから CLOSE は速やかに実行する。**

最終ビルドに混ぜないのは、builder のコンテキストが実装だけに集中できなくなるため。

## あなたは永続ドキュメントを書ける唯一のスキル

| スキル | 永続ドキュメント |
|---|---|
| planner | ✗ |
| architect | **ADR の追記のみ**（決定した時点で記録するのが ADR 本来の思想） |
| builder | ✗ |
| **close-cycle** | **✓（唯一）** |

## 作業ステップ

### Step 0: 読み込みと完了確認

- [ ] 設定と document-guide を読み込む

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs list
```

HIKYAKU_ROOT は `.hikyaku.config` から解決されるので、引数では受け取らない。
`$ARGUMENTS[0]` でサイクルが指定されていなければ、**現在のブランチ → `.hikyaku.local`
→ 唯一の進行中サイクル** の順で決まる。決められないときはユーザーに尋ねる。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle use {cycle}
```

- [ ] 対象サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

`completed` でない場合はユーザーに確認する。未完了のビルドを残したまま締めるのは、
サイクルを**中止（abandoned）**する場合に限る。

- [ ] ブランチを作成し、命名規則どおりか確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch name close {cycle}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify close {cycle}
```

`branch name` が返した名前でブランチを作成（既にあれば切り替え）してから `branch verify` を実行する。
終了コード 2 なら、表示された切り替えコマンドでブランチを移ってから続ける。
**エージェントが用意した別のブランチの上では作業しない。**

- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title close {cycle}
```

返ってきた名前をセッション名に設定する。設定する手段が無い環境ではスキップしてよい。

→ Step 1 へ。

### Step 1: 振り返り

**昇格より先に行う。** 後に回すと、この回の振り返りで出た学びを昇格させる機会が
永久に無くなる（次の close-cycle は別のサイクルを見るため）。

- [ ] `retrospective` 設定に従って次を呼び出す

```
/hikyaku:retrospective {cycle} close
```

`retrospective` が `skip` の場合はこのステップを飛ばす。

→ Step 2 へ。

### Step 2: 素材の収集

サイクルが長い（ビルドが10本ある等）とコンテキストが厳しくなるため、
**昇格候補の抽出はサブエージェントに委任する**。

- [ ] エージェントに次のファイルを渡し、昇格候補を抽出させる
  - `cycles/{cycle}/design/design-delta.md` — このサイクルが作った差分
  - `cycles/{cycle}/design/codebase-survey.md` — 調査で得た知見（存在する場合）
  - `cycles/{cycle}/build-*/handoff.md` — **全ビルドの申し送り**
  - `cycles/{cycle}/*/retrospective.md` — 振り返り（存在する場合）
  - `document-guide.md` — 昇格先の所在
- [ ] エージェントには「候補リスト」だけを返させ、本文の執筆は本セッションで行う

→ Step 3 へ。

### Step 3: 昇格候補の整理

抽出された候補を、昇格先ごとに整理する。

| 昇格先 | 何を昇格させるか |
|---|---|
| **overview** | アーキテクチャに影響した変更。責務・境界・データフローの変化 |
| **learnings** | handoff / retrospective から拾った**再現条件が明確な**落とし穴 |
| **constraints** | 実装中に判明した新たな制約（数値で書けるもの） |
| **ADR** | `status: accepted` → `implemented` に更新 |
| **document-guide** | このサイクルで新規作成したドキュメントの行を更新 |

**昇格させないもの:**

- `overview` に**テーブル一覧・エンドポイント一覧・依存パッケージのバージョン**を書かない。
  これらはコードが正で、書いた瞬間に腐り、しかも腐っていることに誰も気づけない。
  代わりに**「正がどこにあるか」のポインタ**を書く（`スキーマの正は db/migrations/`）
- `learnings` に**一般的なプログラミング知識**や**曖昧な注意**（「気をつける」だけ）を書かない
- `learnings` に **Hikyaku スキル自体への改善提案**を書かない（retrospective 側の管轄）
- `constraints` に**実現方法**を書かない（それは ADR か overview）

**`repo` 管理のドキュメントには形式を強制しない。** 既存形式に合わせて追記するだけで、
既存記述の削除・整理はしない。既存 ADR に status 欄が無くて実装状態が分からない
場合も、勝手に欄を足さず**ユーザーに提案して判断を仰ぐ**。

→ Step 4 へ。

### Step 4: ユーザー承認（G10）

- [ ] 昇格候補を**昇格先ごとに**提示し、承認を得る

```
overview に昇格:
  + 「請求」セクション: 請求は API → キュー → ワーカーの順で処理される
  + ポインタ追加: 請求スキーマの正は db/migrations/

learnings に昇格:
  + 請求バッチのテストは並列実行で落ちる（build-03 で判明、2026-09-01）

ADR:
  ~ 20260825-payment-provider.md: accepted → implemented

昇格させないもの（参考）:
  - handoff にあった「invoices テーブルを追加」→ マイグレーションが正のため書かない
```

この承認は **profile の管轄外で、どのプロファイルでも省略しない**。
不可逆だからではなく、**何を昇格させるかの取捨選択は人間の判断だから**。
自動化すると精度が落ちる。

→ 承認を得たら Step 5 へ。

### Step 5: 書き込み

- [ ] 承認された内容を永続ドキュメントへ書き込む
- [ ] `document-guide.md` を更新する（新規作成したドキュメントの管理列とパス列）
- [ ] AGENTS.md の索引を更新する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs link --dry-run
```

新しいドキュメントを追加した場合のみ差分が出る。承認を得てから実行する。

- [ ] 検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" validate {cycle}
```

→ Step 6 へ。

### Step 6: サイクルの終了

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle close {cycle} \
  --summary "{一行要約}"
```

中止する場合は `--status abandoned` を付ける。

**サイクルディレクトリは残す。** PR 履歴から辿れることに価値がある。

→ Step 7 へ。

### Step 7: PR 作成

- [ ] コミットする前に、もう一度ブランチを確認する（`hikyaku branch verify close {cycle}`）
- [ ] 外部連携が有効なら、参照行を生成する（`hikyaku external ref close {cycle}`）
- [ ] コミットして PR を作成する（タイトルは `hikyaku pr title close {cycle}` で生成）
  - `external ref` が返した行（`Closes #12` など）を本文の末尾に入れる。
    親 issue はこの PR のマージで閉じる
- [ ] 完了後、次を案内する

```
サイクル {cycle} を closed にしました。

次のサイクルを開始するには:
/hikyaku:create-cycle <slug> --profile <name>
```
