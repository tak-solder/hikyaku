---
name: architect
description: "Hikyaku 設計フェーズ: 企画成果物と既存コードを入力に、このサイクルの設計差分（design-delta）とビルド分割を出力する"
user-invocable: true
disable-model-invocation: true
argument-hint: "[{cycle}]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "2.0.0"
---

# Hikyaku Architect

対象サイクルの設計フェーズ（ARCHITECT）を実行する。

```
/hikyaku:planner       → planning/ を生成（完了済み）
/hikyaku:architect     → design/ + tasklist.md + build-NN/issue.md  ← あなたはここ
/hikyaku:builder       → build-NN を実装 → PR
/hikyaku:close-cycle   → 永続ドキュメントへ昇格
```

## あなたの役割

企画フェーズの成果物を入力とし、「**どう作るか**」を決める。

### 最も重要な制約: 永続ドキュメントを書き換えない

永続ドキュメント（overview / constraints / learnings / conventions 等）は
「**実装済みの現実（as-is）**」を表す。あなたが作るのは「**これから作るもの（to-be）**」で、
それは `design-delta.md` に書く。

この区別があるから、並行して走る別サイクルが**未実装の設計を現実として読む事故**が防げる。
昇格は実装が全部終わってから close-cycle が行う。

**ADR（decisions）だけが例外。** 決定した時点で記録するのが ADR 本来の思想なので、
あなたが `status: accepted`（決定済み・未実装）で追記する。`implemented` への更新は
close-cycle が行う。並行サイクルはこの status を見て「決まっているが、まだ動いていない」と
判別できる。

**やらないこと:**
- 企画内容の変更（スコープ・優先度の変更は企画フェーズに差し戻す）
- 実装コード・テストコードの記述
- ADR 以外の永続ドキュメントへの書き込み

## 作業ステップ

### Step 0: 設定の解決と入力の読み込み

- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/architect/references/templates.md`: 各種テンプレート（必須）
- [ ] 設定と対象サイクルを解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

HIKYAKU_ROOT は `.hikyaku.config` から解決されるので、引数では受け取らない。

`$ARGUMENTS[0]` でサイクルが指定されていればそれを渡す。省略された場合は
**現在のブランチ → `.hikyaku.local` → 唯一の進行中サイクル** の順で決まる。
決められないときは進行中サイクルの一覧を添えてエラーになるので、**ユーザーに尋ねてから**
指定し直す。推測して進めない（別サイクルへコミットする事故になる）。

出力の `cycle` と `cycleSource` を、作業対象としてユーザーに1行で示す。

- [ ] 対象サイクルを記録する（次回から尋ねられずに済む）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle use {cycle}
```

- [ ] 企画成果物を読み込む（必須）
  - `cycles/{cycle}/planning/user-stories.md`
  - `cycles/{cycle}/planning/questions.md`（存在する場合）

いずれも無ければ `/hikyaku:planner` を先に実行するよう案内して終了する。

- [ ] **永続ドキュメントを読み込む**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs list
```

概要欄を見て、**今回のスコープに関係するものだけ**を読む。全部読む必要はない。
概要欄があるのはそのためで、パスだけでは全部読むしかなくなる。

- `overview` — 実装済みの現実。Step 2 の差分調査の基準になる
- `constraints` — 既に確定している非機能要件。再度質問しないため
- `decisions` — 過去の設計判断。**採用理由とトレードオフを把握し、実装中に覆さない**
- `learnings` — 既知の落とし穴
- `conventions` — 規約（AGENTS.md にマップされていることが多い）

`repo` 管理のドキュメントは**既存形式が正**。参考として読むが、形式には手を出さない。
`tech-stack` / `db-schema` / `interfaces` は俯瞰の手がかりとして読むが、
**コードと矛盾したら常にコードを正とする**（勝手に直さず、handoff に記録する）。

- [ ] `{HIKYAKU_ROOT}/instruction.md` を読む（存在する場合のみ）

- [ ] ブランチを作成し、命名規則どおりか確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify architect {cycle}
```

出力の `ok` と `onBaseBranch` で分岐する。**自分で決めず、この表に従う。**

| 状況 | 対応 |
|---|---|
| `ok: true` | そのまま続ける |
| `ok: false` かつ `onBaseBranch: true` | `expected` の名前でブランチを作成して続ける |
| `ok: false` かつ `onBaseBranch` が `false` / `null` | **ユーザーに尋ねる**（下記） |

3つ目は**ユーザーの判断であって、あなたの判断ではない。** 現在のブランチが実行環境に
割り当てられたものだと分かっていても、**自分で決めずに必ず尋ねる。**

実行環境が割り当てたブランチと、別の作業のブランチに紛れ込んだ状態は、セッションの中からは
区別できない。「今回は前者だから問題ない」という推測を一度でも通すと、**後者もまったく
同じ理屈で通る。** それを防ぐための確認なので、確認を省いた時点で意味が無くなる。

尋ねる手段（`AskUserQuestion` など）があればそれを使い、次の3つを提示する。
**どれが妥当かの示唆を添えない。選ぶのはユーザー。**

1. Hikyaku の規則に従う — `expected` の名前でブランチを作成する
2. 現在のブランチで作業する
3. 別のブランチを指定する

**ユーザーが 2 または 3 を選んだあとで**、`next` の「着手中」検出が効かなくなることを
伝える（ブランチ名から導出しているため）。**完了判定と中断検出には影響しない。**

ブランチを決めたら、成果物をコミットする直前にもう一度この確認を行う。

- [ ] サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

中断からの再開の場合、`cycle status` がどこまで進んだかを教えてくれる。

**ブランチを決めたあとに実行する。** 成果物の有無は作業ツリーを見て判定するため、
デフォルトブランチに居るまま実行すると、別セッションが push 済みの成果物が見えない。
中断からの再開なのに最初からやり直すことになる。

- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title architect {cycle}
```

返ってきた名前をセッション名に設定する。設定する手段が無い環境ではスキップしてよい。
`[session] title` が空文字なら「変更しません」と返るので、その場合もスキップする。

→ Step 1 へ。

### Step 1: 並行サイクルの確認

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle list --active
```

**他に走行中のサイクルが無ければこのステップをスキップして Step 2 へ。**

- [ ] `cycle-scanner` エージェントを起動する
  - 渡す情報: 今回の `user-stories.md` のパス / 走行中サイクルのディレクトリ一覧 / `document-guide.md` のパス
  - 出力フォーマットは `${CLAUDE_PLUGIN_ROOT}/agents/cycle-scanner.md` を参照
- [ ] 重複が報告されたら、ユーザーに提示して方針を確認する
  - 設計を分ける / どちらかに寄せる / そのまま進める

全走行サイクルの本文を本セッションで読むと、大規模リポジトリでコンテキストが破綻する。
だから軽量エージェントに委任し、返ってきた重複箇所だけを本セッションで扱う。

→ Step 2 へ。

### Step 2: 既存コードベースの差分調査

**既存コードがない（新規開発）場合はスキップして Step 3 へ。**

調査のコンテキスト消費を避けるため、探索は `code-explorer` に委任する。ただし、
設計判断に必要な **Key Files** は本セッション自身が読む。

- [ ] **調査範囲の判定**
  - 単一機能・小規模スコープ → **単一エージェント**（モード: 単一起動）
  - 複数の独立した機能領域を含む、または大規模 → **観点別に2〜3並列**（モード: 並列起動）

- [ ] **`code-explorer` を起動する**
  - 委任プロンプトに以下の絶対パスを必ず明示する:
    - ワークスペース: `{HIKYAKU_ROOT}`
    - 要件: `cycles/{cycle}/planning/user-stories.md`
    - 調査対象リポジトリのルート
    - **`overview` のパス（登録されている場合）** ← これが差分調査の鍵
  - `overview` を渡すと、エージェントは**全体調査ではなく差分調査**を行う
    - 調べる: 今回のスコープに関係する箇所 / overview に無い詳細 / overview とコードのズレ
    - 調べない: overview に既にある内容の再確認
  - 並列起動の場合は「担当観点」を明記し、いずれか1つに「概観担当」を追加指示する
  - 各エージェントに **Key Files**（5〜10ファイルのパスと役割）を必ず返させる

- [ ] **Key Files をメインセッションで直接読む**
  - 重複を排除し、Read tool で実ファイルを読む
  - **このステップを省略しない。** 要約だけで設計を進めると規約・インターフェースの解像度が落ちる

- [ ] **`cycles/{cycle}/design/codebase-survey.md` を作成する**
  - フォーマットは [templates.md](references/templates.md) を参照
  - **overview に既にある内容は書かない。** これが差分調査の肝で、書いてしまうと
    2周目以降も初回と同じコストがかかり、overview を持つ意味が失われる
  - 恒久的な価値のある発見（規約・拡張ポイント）は、close-cycle が overview へ昇格させる。
    ここでは「今回のサイクルで必要な範囲」に留める
- [ ] **コミット & push する**

- [ ] **`codebase_survey_gate` が有効な場合**（thorough のみ）、ユーザーに提示して確認を得る

→ Step 3 へ。

### Step 3: 設計に関する質問（反復ループ）

**codebase-survey.md・planning/・永続ドキュメントに明記されている内容は質問しない。**
特に `constraints` に書かれている非機能要件を聞き直さないこと。

- [ ] 技術設計に落とし込む過程で生じる不明点を質問する
  - 1ラウンドの質問数に上限はない。聞くべきことは1回でまとめて聞く
  - 確認観点: **技術選定**, **データ設計**, **インターフェース設計**, **非機能要件**, **既存コードとの整合**
  - 質問が発生した場合のみ `cycles/{cycle}/design/design-questions.md` に記録する
  - **未回答の質問を放置しない**
- [ ] 設計判断に必要な情報が揃うまで繰り返す

→ Step 4 へ。

### Step 4: 設計判断と design-delta の作成

#### Step 4a: 主要な設計判断の特定と分岐評価

- [ ] 設計に反映する主要な技術判断を列挙する（認証方式、状態管理戦略、データ同期方式など）
- [ ] 各判断について、**妥当な代替案が複数あり trade-off が非自明**かを評価する
  - 既存規約から自明 / 単一の合理的選択肢しかない → **分岐なし**
  - 複数案で trade-off が異なり、ユーザーの判断が必要 → **分岐あり**

#### Step 4b: 分岐がある判断の選択（G3・常時必須）

分岐がなければスキップして Step 4c へ。**この場合 ADR は作成しない**（記録対象は分岐ありの判断のみ）。

- [ ] 各判断について **`code-architect` を2〜3並列**で起動し、異なる観点の案を生成させる
  - 委任プロンプトに以下の絶対パスを明示する:
    - 要件: `cycles/{cycle}/planning/user-stories.md`
    - 設計質問の回答: `cycles/{cycle}/design/design-questions.md`（存在する場合）
    - 既存コード調査: `cycles/{cycle}/design/codebase-survey.md`（存在する場合）
    - 永続ドキュメント: `overview` / `constraints` / `decisions` のパス
  - 観点の例: **Minimal**（既存資産の最大活用・低リスク）/ **Clean**（関心分離・長期保守性）/ **Pragmatic**（中間）
  - 各案に「影響ファイル」「主要コンポーネントの責務」「Trade-off」を返させる
- [ ] **trade-off表**にまとめ、**推奨案と理由**を明記して提示する
- [ ] 「お任せ」と回答された場合も、推奨案を改めて提示して**明示的な確認**を得る（空回答として進めない）

**この承認（G3）は profile の管轄外で、どのプロファイルでも省略しない。**
不可逆だからではなく、**トレードオフの選択は人間にしか下せない判断**だから。

- [ ] 確定した採用案を **ADR として追記する**
  - 昇格先は `document-guide.md` の `decisions` が指すパス
  - **`hikyaku` 管理の場合**: 日付ベースのファイル名（`20260901-auth-strategy.md`）、`status: accepted`
  - **`repo` 管理の場合**: **既存形式に合わせる。** 連番なら連番、独自テンプレートならそれに従う。
    既存に status 欄が無い場合、勝手に欄を足さず**ユーザーに提案して判断を仰ぐ**
  - 記録項目: 決定 / 文脈 / 検討した案 / 採用理由 / **トレードオフ** / 影響範囲
  - **トレードオフ欄に「特になし」と書かない。** 書きたくなるなら Step 4a の分岐判定が誤っている
  - **既存エントリは書き換えない**（覆すときは新エントリ + 旧を superseded）
- [ ] コミット & push する

#### Step 4c: design-delta.md の作成

- [ ] `cycles/{cycle}/design/design-delta.md` を作成する
  - フォーマットは [templates.md](references/templates.md) を参照
  - **書く**: このサイクルで作るもの（to-be）/ **永続ドキュメントのどこを更新する予定か** / 既存構造への影響
  - **書かない**: 実装コード / ビルド分割（tasklist が正）/ 恒久的な設計判断（ADR が正）/
    **既に永続側にある内容の再掲**
  - 「永続ドキュメントのどこを更新する予定か」は close-cycle と cycle-scanner の入力になる
- [ ] コミット & push する

→ Step 5 へ。

### Step 5: 承認とビルド分割

#### Step 5a: 設計の承認（G4）

- [ ] **`architecture_review` が有効な場合**（express / standard / thorough）、`doc-reviewer` を起動する（`context: architecture`）
  - 渡す情報: `design-delta.md`, `codebase-survey.md`, 今回追記した ADR, `user-stories.md`
  - 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）
- [ ] **`architecture_gate` が有効な場合**（economy / standard / thorough）、ユーザーに提示して承認を得る

**承認観点はこれに限定する:**

```
- Step 4b で採用した案が design-delta に正しく反映されているか
- 分岐なしとして ADR に記録しなかった判断に、見落としがないか
- doc-reviewer の指摘への対処は妥当か
```

技術選定の是非は **G3 で決着済み**なので、ここで問い直さない。同じことを二度聞くのが
承認ラウンドの冗長さの正体になる。

→ 承認を得たら Step 5b へ。フィードバックがあれば Step 3 に戻る。

#### Step 5b: ビルド分割（G6）

**v1 にあった「ビルド分割ドラフトの承認」は廃止した。** あれは `issue_backend` が
github/asana のとき外部システムで issue の作成・削除が乱造されるのを防ぐためのもので、
ファイル正に変えた時点で理由が消えた。build-manager が `--dry-run` で差分を提示し、
承認後に初めて書き込むので、拒否されても外部に何も残らない。

- [ ] 設計に基づいてビルドの論理的な単位（タイトル・スコープ・依存関係）を整理する
- [ ] `/hikyaku:build-manager {cycle}` を呼び出す
  - 伝える情報: 各ビルドのタイトル・スコープ・依存関係・参照すべき設計ドキュメント
  - build-manager が BP見積もり、tasklist の更新、issue.md の作成、承認までを行う
- [ ] 検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" validate {cycle}
```

→ 承認を得たら Step 6 へ。フィードバックの内容に応じて対応する:
- 設計へのフィードバック → Step 3 に戻る
- ビルド分割へのフィードバック → build-manager を再度呼び出す

### Step 6: 振り返りと PR

- [ ] `retrospective` 設定に従って `/hikyaku:retrospective {cycle} design` を呼び出す
- [ ] コミット前にブランチを確認する（`hikyaku branch verify architect {cycle}`）
- [ ] 外部連携が有効なら、参照行を生成する（`hikyaku external ref architect {cycle}`）
- [ ] PR を作成する（タイトルは `hikyaku pr title architect {cycle}` で生成）
  - `external ref` が返した行（`Refs #12` など）を本文の末尾に入れる。空なら入れない

**この PR も速やかにマージすることを想定している。** tasklist.md がデフォルトブランチに
入らないと、builder が依存ビルドの完了を判定できない。

- [ ] 完了後、次に着手できるビルドを案内する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

```
設計フェーズが完了しました。

BUILDフェーズを開始するには、新しいセッションで以下を実行してください:
/hikyaku:builder {cycle} {buildID}

依存関係のないビルドは並行して進められます。
```
