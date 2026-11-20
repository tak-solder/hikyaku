---
name: planner
description: "Hikyaku 企画フェーズ: チケットと既存の企画ドキュメントを読み込み、そのサイクルのユーザーストーリーとして構造化する。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{cycle}]"
---

# Hikyaku Planner

対象サイクルの企画フェーズ（PLAN）を実行する。各フェーズは別セッションが担当し、
引き継ぎはファイルで行う。

```
/hikyaku:init          → ワークスペースを初期化（初回のみ）
/hikyaku:create-cycle  → サイクルを作成し profile を選ぶ
/hikyaku:planner       → planning/ を生成  ← あなたはここ
/hikyaku:architect     → design/ + tasklist.md + build-NN/issue.md を生成
/hikyaku:builder       → build-NN を実装 → PR（依存が無ければ並行実行可）
/hikyaku:close-cycle   → 永続ドキュメントへ昇格し、サイクルを closed に
```

### ディレクトリ構造

```
リポジトリルート/
├── .hikyaku.config            # 設定のベース（必須）。hikyaku_root もここ
└── {HIKYAKU_ROOT}/
    ├── document-guide.md      # 永続ドキュメントの所在（必須）
    ├── cycles.md              # サイクル索引（必須）
    ├── instructions.md        # ワークフロー独自の指示（任意）
    ├── .hikyaku.local         # 最後に作業したサイクル（git 管理対象外）
    └── cycles/
        └── {NNN}-{slug}/
            ├── .hikyaku.config  # サイクル固有の上書き（任意）
            ├── planning/        # ← あなたが作る
            │   ├── questions.md
            │   └── user-stories.md
            ├── design/          # ARCHITECT が作る
            ├── tasklist.md      # ARCHITECT が作る
            └── build-01/        # BUILD が作る
```

永続ドキュメント（overview / decisions / constraints / conventions 等）は
HIKYAKU_ROOT の外にある。 所在は `document-guide.md` が宣言する。

### あなたの役割

ユーザーは既にチケットや企画メモを持っている。あなたの仕事は、それを読み込んで
次の設計フェーズ（ARCHITECT）が作業を開始できる形に構造化すること。成果物は
`cycles/{cycle}/planning/` の `user-stories.md` と `questions.md`。

やらないこと:
- 技術的な実現方法の決定（設計フェーズの仕事）
- 永続ドキュメントへの書き込み（close-cycle だけが行う）
- このサイクル外のストーリーを書くこと（バックログ管理はスコープ外）

## 作業ステップ

### Step 0: 準備

- [ ] 準備をまとめて行う（作業サイクルの記録・ブランチ・状態の確認・セッション名）。`$ARGUMENTS[0]` のサイクルを渡す（省略してよい）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" start plan {cycle}
```

次のエラーが出た場合は代行してから、`start` をやり直す。

- 未初期化（`.hikyaku.config` が無い / `document-guide.md` が無い）
  → `/hikyaku:init` を実行して初期化を代行する
- サイクルが未作成（「サイクルがまだありません」）
  → `/hikyaku:create-cycle` を実行して代行する
  - 代行した場合、create-cycle は PR を作らない。成果物が cycles.md の1行だけなので、
    このスキルの PR に畳む
- サイクルを決められずに候補が出たら、推測せずユーザーに尋ねて指定し直す（別サイクルへコミットする事故になる）

出力の「次」に従う。

- ブランチを尋ねるよう出たら、現在のブランチが実行環境に割り当てられたものだと分かっていても、
  **自分で決めずに必ず尋ねる。** セッションの中からは、別の作業のブランチに紛れ込んだ状態と区別できない。
  どれが妥当かの示唆を添えずに3つを示す: 1. 規則どおり期待する名前のブランチを作る（`git switch -c {期待する名前}`）
  / 2. 現在のブランチで作業する（`--keep-branch` を付ける）/ 3. 別のブランチを指定する（切り替える）。
  答えに従って `start` をやり直す
- 止まると出たら、内容を伝えて終了する
- サイクルを1行で示し、セッション名を設定する（設定する手段が無い環境ではスキップ）。中断からの再開で
  既存の成果物があれば読み込んでおく（どのステップから続けるかは `step next` が決める）

成果物をコミットする直前に `branch verify plan {cycle}` でブランチを確かめる。

- [ ] 読むべきドキュメントの候補を取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" context plan {cycle}
```

企画では永続ドキュメントをほとんど読まない。実装済みの現実を前提に置く場面では
ないため、返るのは `constraints`（確定済みの非機能要件を再度質問しないため）と
`glossary`（語を既存の定義に揃えるため）だけ。

インストラクションは次の優先順で適用する。上位が下位と矛盾する場合は上位を優先する。

1. リポジトリ全体のインストラクション（AGENTS.md, CLAUDE.md 等）
2. ワークフロー独自のインストラクション（`{HIKYAKU_ROOT}/instructions.md`）
3. このスキルの説明（SKILL.md と、step が返す指示ファイル）

→ Step 1 へ。

### Step 1 以降: step に従って進める

ここから先の手順（インプットの読み込み → スコープのすり合わせ → user-stories → レビュー → G1 →
振り返り → PR）は、`step next` が設定と進捗から1手ずつ返す。**手順を自分で組み立てない。**
レビューが有効か、G1 があるかは step が profile と個別キーから決める。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next plan {cycle}
```

返った1手（directive）の種類ごとに動く。報告のコマンドは directive の「報告」にあるものを使う。

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら `done` を報告する |
| `gate` | 「指示」のファイルを読み、ユーザーに提示して承認を求める。承認されたら `approved`、フィードバックなら `rejected` を報告する。どちらも `--input` にユーザーの答えを添える。`rejected` のあとは答えを反映し、`step next` に従って提示し直す |
| `call` | 「指示」のファイルを読み、「呼ぶスキル」を呼び出す。「呼ばれたスキルの手順」があれば、呼ばれたスキルはそのコマンドから始める。呼ばれたスキルが手順を終えて戻ったら、指示ファイルの「戻ったら」に従って `done` を報告する。呼ばれたスキルが `stop` で止まったら報告せず、そのメッセージを伝えて止まる |
| `done` | 手順をすべて終えた。下の「完了の案内」へ |
| `stop` | メッセージをユーザーに伝えて終了する |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 成果物や完了の条件、報告に添える値（`--pr`）は CLI が確かめ、足りなければ報告を受け付けない。
  メッセージに従って直す。報告を通すために成果物を空で作ったり、別のステップとして報告したりしない
- 承認したあとの user-stories.md の変更は Git の履歴で追う。承認を取り直すと決めたら、`user-stories` を
  `done` で報告し直す。そこから後ろはやり直しになる
- 再開したとき、前のステップで会話の中に作った成果（すり合わせたスコープなど）が手元に無ければ、
  そのステップを `done` で報告し直してやり直す
- 報告したら、成果物と `cycles/{cycle}/planning/progress.jsonl` をコミット & push する。コミットされていなければ、
  中断時に他セッションから進捗が見えず、再開点を検出できない。pr の指示にコミットの時機の定めがあれば、そちらに従う
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る

### 完了の案内

`done` が返ったら、以下を案内する。

```
企画フェーズが完了しました。

設計フェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku:architect {cycle}
```
