---
name: builder
description: "Hikyaku 実装フェーズ: 1ビルド = 1セッションでコード実装から PR 作成までを完結させる"
user-invocable: true
disable-model-invocation: true
argument-hint: "[{cycle}] [{buildID}]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "2.0.0"
---

# Hikyaku Builder

対象ビルドの実装フェーズ（BUILD）を実行する。**1ビルド = 1セッション**で完結させる。

```
/hikyaku:architect     → design/ + tasklist.md + build-NN/issue.md（完了済み）
/hikyaku:builder       → build-NN を実装 → PR  ← あなたはここ
/hikyaku:close-cycle   → 永続ドキュメントへ昇格
```

## あなたの役割

対象ビルドを実装し、PR を作成する。

### 最も重要な制約: 永続ドキュメントを書き換えない

永続ドキュメント（overview / constraints / learnings / decisions 等）を書けるのは
**close-cycle だけ**。あなたは読むだけで、一切書き換えない。

実装中に設計とのズレや新たに判明した制約があれば、**`handoff.md` に記録する**。
close-cycle がそれを素材として昇格させる。

これにより、あなたのコンテキストは実装だけに集中できる。

## 作業ステップ

### Step 0: 設定の解決と対象ビルドの決定

- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/templates.md`: 各種テンプレート（必須）
- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/retry-policy.md`: リトライ方針（必須）
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

- [ ] 対象ビルドを決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

`$ARGUMENTS[1]` で buildID が指定されていればそれを使う。省略された場合、
`next` が返した**着手可能なビルド**から選ぶ。

**依存関係のあるビルドは、先行ビルドがデフォルトブランチにマージ済みであることが必須。**
`next` はこれを tasklist.md の `PR` 列で判定している。待機中と表示されたビルドには着手しない。

**依存関係がないビルドは並行実行できる。** `next` が「着手中」と表示したビルドは、
他セッションが作業している可能性がある。選ぶ前にユーザーに確認する。

- [ ] `{HIKYAKU_ROOT}/instructions.md` を読む（存在する場合のみ）

→ Step 1 へ。

### Step 1: コンテキスト復元

以下の順で読み込む。**3層に分かれていることを意識する。**

| 層 | 何を表すか | 読むもの |
|---|---|---|
| **永続** | 実装済みの現実（他サイクルの成果も含む） | overview / constraints / decisions / learnings / conventions |
| **サイクル** | このサイクルが作ろうとしている差分 | design-delta.md / codebase-survey.md |
| **ビルド** | 同一サイクル内の先行ビルドの実績 | 依存ビルドの handoff.md |

- [ ] `cycles/{cycle}/build-{NN}/issue.md` を読む（対象ビルドの定義）
- [ ] `docs list` で永続ドキュメントの所在を確認し、**今回のビルドに関係するものだけ**を読む
  - `decisions` は採用理由とトレードオフを把握し、**実装中に判断を覆さない**
  - 覆す必要が生じた場合は、覆した ADR・理由・影響範囲を **`handoff.md` に記録する**
    （ADR 自体の更新は close-cycle が行う。あなたは永続ドキュメントを書き換えない）
- [ ] `cycles/{cycle}/design/design-delta.md` を読む
- [ ] **依存ビルドの `handoff.md` を読む**（直接依存するビルドの分のみ。全ビルド分は読まない）

→ Step 2 へ。

### Step 2: ブランチとセッション名

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify build-{NN} {cycle}
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

**Hikyaku の規則に従う場合、このブランチの存在が「着手中」の印**になるので、作成したら
早めに push しておくと他セッションとの衝突を避けられる。ブランチを決めたら、成果物を
コミットする直前にもう一度この確認を行う。

- [ ] `cycle status` で既存の成果物を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

中断からの再開なら、どこまで進んだかが表示される。既存の成果物を読み込んで途中から再開する。

**ブランチを決めたあとに実行する。** 成果物の有無は作業ツリーを見て判定するため、
デフォルトブランチに居るまま実行すると、前回のセッションが push 済みの成果物が見えない。
中断からの再開なのに最初からやり直すことになる。

- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title build-{NN} {cycle}
```

返ってきた名前をセッション名に設定する。設定する手段が無い環境ではスキップしてよい。
`[session] title` が空文字なら「変更しません」と返るので、その場合もスキップする。

`--build-title` にビルドのタイトルを渡すと、セッション名にビルド名まで入る。

→ Step 3 へ。

### Step 3: 実装計画とテストシナリオの作成

- [ ] 不明点があれば `cycles/{cycle}/build-{NN}/questions.md` でユーザーに質問する
- [ ] `cycles/{cycle}/build-{NN}/plan.md` を作成する
  - テンプレートは [templates.md](references/templates.md) を参照
  - **含めるもの:** 依存パッケージの選定、クラス設計（メソッドシグネチャ）、非機能要件
  - **含めないもの:** 詳細な実装コード、テストコードの実装方法
- [ ] コミット & push する

- [ ] **`plan_gate` が有効な場合**（thorough のみ）、ここで plan.md の承認を得る（G7）
  - それ以外のプロファイルでは Step 3 の最後にまとめて承認する（G8）

- [ ] テストシナリオを **Agent に委任して** `cycles/{cycle}/build-{NN}/test-spec.md` を生成させる
  - 洗い出し過程のコンテキスト消費を避けるため、メインセッションでは直接作成しない
  - Agent に渡す情報: `plan.md`, `issue.md`, `design-delta.md`, 関連する永続ドキュメント
  - テスト対象が無いビルド（ドキュメントのみ等）ではスキップしてよい

Agent に渡すフォーマット指定:

````
## フォーマット（必ず従うこと）

```markdown
# Build {NN}: {ビルド名} テストシナリオ

## {テスト対象クラス/モジュール名}

### {メソッド名}: {シナリオ名}
- Given: （前提条件）
- When: （操作）
- Then: （期待結果）
```

**記載ガイドライン:**
- 正常系・異常系・境界値を網羅する
- Given/When/Then は具体的な値を含める（例: `Given: メールアドレス "user@example.com" のユーザーが登録済み`）
- 1シナリオ = 1つの検証観点に絞る。表形式は使わないこと
````

- [ ] コミット & push する

- [ ] **`plan_review` が有効な場合**（express / standard / thorough）、`doc-reviewer` を起動する（`context: plan`）
  - 渡す情報: `plan.md`, `issue.md`, `design-delta.md`, 依存ビルドの `handoff.md`
  - 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）

- [ ] **plan.md と test-spec.md をまとめてユーザーに提示し、承認を得る（G8）**
  - 承認観点: 実装ステップの妥当性 / 受け入れ基準の網羅性 / 正常系・異常系・境界値のカバー範囲 / 不要なテストの有無
  - この承認は profile の管轄外で、どのプロファイルでも省略しない
  - thorough では G7 で plan を既に承認しているので、ここでは test-spec に焦点を当てる

→ 承認を得たら Step 4 へ。フィードバックがあれば反映して承認からやり直す。

### Step 4: コード生成

- [ ] plan.md の実装ステップに沿って実装する（チェックボックスを完了ごとに更新する）
- [ ] test-spec.md のシナリオに基づいてテストコードを生成する

→ Step 5 へ。

### Step 5: ローカル検証

**全ての項目がパスするまで Push しない。**

- [ ] リポジトリの規約に従い品質管理を実行する（lint, test, build 等）
- [ ] エラーがあれば修正して再実行する
  - [retry-policy.md](references/retry-policy.md) の試行回数上限に従う
  - 上限に達したらユーザーに報告して判断を仰ぐ

→ Step 6 へ。

### Step 6: コードレビュー

機械的検証だけでは検出できない品質・規約・セキュリティ観点をレビューする。

- [ ] **`code_review` が有効な場合**（全プロファイル）、`code-reviewer` を起動する
- [ ] **`security_review` の判定**

| 設定値 | 挙動 |
|---|---|
| `off`（既定では該当なし。個別キーで明示したときだけ） | 起動しない |
| `on`（thorough） | 常に起動する |
| `recommended`（express / economy / standard） | **判定基準に該当する場合のみ、起動するか確認する** |

`recommended` の場合、対象ビルドの `issue.md` と実際の diff を見て、
`[review.security].triggers` に該当するか判定する。`config --json` の
`security.triggers` に基準が入っている（未設定なら既定の3カテゴリ）。

```
- 個人情報・秘密情報を扱う（氏名/住所/連絡先/生年月日、パスワード、トークン、APIキー）
- 認証・認可（ログイン、セッション、権限判定、アクセス制御）
- 決済（支払い、カード情報、請求、返金）
```

該当する場合は**判定根拠を一行で示して確認する**。ヒューリスティックである以上
外れるので、ユーザーが上書きできる形にする。

```
このビルドは「認証・認可」に該当する変更を含みます（auth/session.ts の権限判定を変更）。
security_review を起動しますか？ [Y/n]
```

- [ ] エージェントは以下すべてで当該ブランチの変更を確認する（漏らさないため）
  - `git status` — 変更ファイル一覧（未追跡含む）
  - `git diff` — unstaged 差分
  - `git diff --cached` — staged 差分
  - `git diff $(git merge-base {BASE_BRANCH} HEAD)..HEAD` — base からのコミット済み差分
  - 新規追加ファイル（未追跡）は Read tool で内容を読む
- [ ] 担当範囲
  - `code-reviewer`: スコープ準拠 / 規約準拠 / バグ・ロジック誤り / 冗長性
  - `security-reviewer`: OWASP 系のセキュリティパターン違反
- [ ] 指摘を統合する
  - 同一箇所への重複指摘は1件に統合し、`security-reviewer` の指摘を優先する
  - 「確度が低い懸念」は「確度: 要確認」ラベルを保持したまま別枠で提示する
- [ ] 統合した指摘をユーザーに提示し、対応を決める
  - **今修正する** — 修正して Step 5 に戻る
  - **新ビルド化して後で対応** — `/hikyaku:build-manager` を呼び出して新ビルドを追加する
  - **そのまま進める** — 指摘を `handoff.md` の「既知の制約・注意点」に記録する

→ Step 7 へ。

### Step 7: 申し送りの作成

- [ ] `cycles/{cycle}/build-{NN}/handoff.md` を作成する
  - テンプレートは [templates.md](references/templates.md) を参照
  - **書く**: 実装内容の要約 / 後続ビルドが知るべき変更 / 意図的に残した未対応 /
    **覆した設計判断とその理由** / 実装中に判明した新たな制約
  - **書かない**: 実装の全詳細（コードが正）/ 一般的な進捗報告

**handoff.md は close-cycle の昇格素材になる。** 恒久的な価値のある発見（落とし穴、
アーキテクチャへの影響、新たな制約）はここに書いておけば、close-cycle が
learnings / overview / constraints へ昇格させる。**あなたが永続ドキュメントを
直接書き換えることはない。**

- [ ] コミット & push する

→ Step 8 へ。

### Step 8: PR 作成と完了記録

- [ ] 外部連携が有効なら、PR 本文へ入れる参照行を生成する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref build-{NN} {cycle}
```

`Closes #12`（GitHub）またはタスクの URL（Asana）が返る。空なら何も入れない。
**issue が閉じても完了判定には使わない。** 判定は常に tasklist.md の PR 列。

- [ ] PR を作成する（タイトルは `hikyaku pr title build-{NN} {cycle} --build-title "{title}"` で生成）
  - 本文の末尾に上の参照行を入れる
  - PR 作成前の承認は取らない。PR はレビューのための提案であって不可逆ではなく、
    ユーザーが `/hikyaku:builder` を実行した時点で PR 作成まで依頼されている

- [ ] tasklist.md の PR 列を更新し、**同じブランチへコミット & push する**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist done {cycle} \
  --id {buildID} --pr {PR の URL}
```

**PR を作ってからでないと URL が無い。** だから PR 作成が先で、PR 列の更新は後になる。
push した分は同じ PR に載るので、順序が変わっても「PR に同梱する」ことは変わらない。

**この変更は必ずこのビルドの PR に同梱する。** 先にデフォルトブランチへ入れると、
未マージのビルドを完了と誤判定する。PR 列が非空であること自体が「マージ済み = 完了」を
意味するのは、この同梱が守られているからこそ成立する。

- [ ] 外部投影が有効な場合は同期を試みる（失敗してもワークフローは止めない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
```

gh CLI が無い環境では投影内容だけが返る（`reason: "gh-not-found"`）。その場合は
GitHub MCP ツールで適用し、`cycle link` / `tasklist link` で参照を記録する。

**注意:** このビルドに依存する後続ビルドは、**この PR がマージされてから**開始すること。
依存ビルドの完了判定はデフォルトブランチ上の `tasklist.md` の `PR` 列で行うため、
マージ前に開始すると依存が未完了と判定される。依存関係のないビルドは並行して進められる。

→ Step 9 へ。

### Step 9: 振り返り

- [ ] `retrospective` 設定に従って `/hikyaku:retrospective {cycle} build-{NN}` を呼び出す
- [ ] 完了後、次の状況を案内する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

全ビルドが完了していれば、close-cycle を案内する。

```
Build {NN} が完了しました。

（未完了のビルドがある場合）
次のビルドを開始するには、新しいセッションで:
/hikyaku:builder {cycle} {次のbuildID}

（全ビルドが完了した場合）
サイクルを締めるには、新しいセッションで:
/hikyaku:close-cycle {cycle}

実装は完了していますが、永続ドキュメントへの昇格がまだです。
この状態が続くと、他サイクルが古い overview を「実装済みの現実」として
読んでしまいます。速やかに実行してください。
```

---

## ビルド管理（実装中のスコープ変更）

実装中に以下が判明した場合、`/hikyaku:build-manager {cycle}` を呼び出す。

- **Step 3 後** — issue.md のスコープが実際には BP 超過 → ビルドの分割
- **Step 4 中** — 想定外の複雑さや未定義の依存 → ビルドの追加・更新
- **Step 6 時** — 指摘の「新ビルド化して後で対応」 → 新ビルドの追加
- **Step 7 時** — 意図的に先送りした作業 → 新ビルドの追加

呼び出し後の対応:
- 現在のビルドのスコープが変わった場合: plan.md を修正し、Step 3 の承認からやり直す
- 新ビルドが追加されただけの場合: 現在の作業を続行する

## PRレビュー指摘への対応

- [ ] PR のレビューコメントを確認する
- [ ] `cycles/{cycle}/build-{NN}/plan.md` を参照してコンテキストを復元する
- [ ] 修正を実装し、ローカル検証を実行する（Step 5 と同じ）
- [ ] ドキュメント更新チェック — **サイクルドキュメントのみ**を更新する
  - `cycles/{cycle}/build-{NN}/` — plan.md, issue.md, test-spec.md, handoff.md
  - `cycles/{cycle}/design/design-delta.md` — 設計レベルの変更があった場合
  - **永続ドキュメントは更新しない。** 昇格が必要な内容は handoff.md に記録する
- [ ] Push する
- [ ] `/hikyaku:retrospective {cycle} build-{NN}` を呼び出す（既に retrospective.md があれば追記モードで動作する）
