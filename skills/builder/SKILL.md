---
name: builder
description: "Hikyaku 実装フェーズ: 1ビルド = 1セッションでコード実装から PR 作成までを完結させる。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{cycle}] [{buildID}]"
---

# Hikyaku Builder

対象ビルドの実装フェーズ（BUILD）を実行する。1ビルド = 1セッションで完結させる。

```
/hikyaku:architect     → design/ + tasklist.md + build-NN/issue.md（完了済み）
/hikyaku:builder       → build-NN を実装 → PR  ← あなたはここ
/hikyaku:close-cycle   → 永続ドキュメントへ昇格
```

## あなたの役割

対象ビルドを実装し、PR を作成する。

### 最も重要な制約: 永続ドキュメントを書き換えない

永続ドキュメント（overview / constraints / learnings / decisions 等）を書けるのは
close-cycle だけ。あなたは読むだけで、一切書き換えない。

実装中に設計とのズレや新たに判明した制約があれば、`handoff.md` に記録する。
close-cycle がそれを素材として昇格させる。

これにより、あなたのコンテキストは実装だけに集中できる。

### 守る原則: マージした時点で本番データを壊さない

このビルドの PR をマージした時点で、既存機能に影響せず、本番でどんな操作が起きても
データが壊れたり不整合を起こしたりしない実装にする。本番データの破壊は取り返しがつかない。

例外は、issue.md に「マージ時点で残る危険」の節があるビルドだけ。architect がやむを得ず
安全でない分割を選び、G6 で承認されている。そのときも、節に書かれた範囲を超える危険は残さない。

節に無い危険を残さないと実装できないと分かったら、自分で緩めない。下の「architect への差し戻し」
に従って確認する。

## 作業ステップ

### Step 0: 設定の解決と対象ビルドの決定

- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/templates.md`: 各種テンプレート（必須）
- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/retry-policy.md`: リトライ方針（必須）
- [ ] 設定と対象サイクルを解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

`$ARGUMENTS[0]` のサイクルを渡す。省略時は CLI が現在のブランチ → `.hikyaku.local` →
唯一の進行中サイクルの順で決め、決まらなければ候補を添えてエラーになる。そのときは推測せず
ユーザーに尋ねて（ask: cycle）指定し直す（別サイクルへコミットする事故になる）。HIKYAKU_ROOT は
`.hikyaku.config` から解決されるので、引数では受け取らない。

出力の `cycle` と `cycleSource` を、作業対象としてユーザーに1行で示す。
以降のゲートとレビューの有無は、出力の `gates` / `reviews` で決める。

- [ ] 対象サイクルを記録する（次回から尋ねられずに済む）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle use {cycle}
```

- [ ] 対象ビルドを決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

`$ARGUMENTS[1]` で buildID が指定されていればそれを使う。省略された場合、
`next` が返した着手可能なビルドから選ぶ。

`next` は、依存ビルドの成果が `HEAD` の履歴に在るか（`HEAD` の tasklist.md の `PR` 列）で
判定する。デフォルトブランチ経由でマージされていても、先行ビルドのブランチから積んで
（スタックして）いても着手できる。判定はいま居るブランチで変わるので、Step 2 でブランチを
決めたあとにもう一度確認する。待機中と表示されたビルドには着手しない。

依存関係がないビルドは並行実行できる。`next` が「着手中」と表示したビルドは、
他セッションが作業している可能性がある。選ぶ前にユーザーに確認する（ask: build-select）。待機中の行に
`ブランチあり` が付いているものも同様（他セッションが積んで作業している可能性）。

→ Step 1 へ。

### Step 1: コンテキスト復元

- [ ] 読むべきドキュメントの候補を取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" context build-{NN} {cycle}
```

返るものは3層に分かれている。どの層の話をしているかを意識して読む。

| 層 | 何を表すか |
|---|---|
| 永続 | 実装済みの現実（他サイクルの成果も含む） |
| サイクル | このサイクルが作ろうとしている差分 |
| ビルド | 同一サイクル内の先行ビルドの実績（依存ビルドの `handoff.md`） |

依存ビルドの `handoff.md` は `context` が tasklist.md の依存グラフから辿る。
自分で辿らない。直接依存する分だけが返るので、全ビルド分を読むことにはならない。

- [ ] 概要欄を見て、今回のビルドに関係するものだけを読む
  - `issue.md`（対象ビルドの定義）と `design-delta.md` は必ず読む
  - `decisions` は採用理由とトレードオフを把握し、実装中に判断を覆さない
  - 覆す必要が生じた場合は、覆した ADR・理由・影響範囲を `handoff.md` に記録する
    （ADR 自体の更新は close-cycle が行う。あなたは永続ドキュメントを書き換えない）
  - 設計どおりでは要件を満たせないと分かった場合は、自分で設計を変えない。
    下の「architect への差し戻し」に従う

→ Step 2 へ。

### Step 2: ブランチとセッション名

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify build-{NN} {cycle}
```

出力の `ok` と `onBaseBranch` で分岐する。自分で決めず、この表に従う。

| 状況 | 対応 |
|---|---|
| `ok: true` | そのまま続ける |
| `ok: false` かつ `onBaseBranch: true` | `expected` の名前でブランチを作成して続ける |
| `ok: false` かつ `onBaseBranch` が `false` / `null` | ユーザーに尋ねる（下記）（ask: branch） |

3つ目は、現在のブランチが実行環境に割り当てられたものだと分かっていても、**自分で決めずに
必ず尋ねる。** セッションの中からは、別の作業のブランチに紛れ込んだ状態と区別できない。
尋ねる手段（`AskUserQuestion` など）で次の3つを、どれが妥当かの示唆を添えずに提示する。

1. Hikyaku の規則に従う — `expected` の名前でブランチを作成する
2. 現在のブランチで作業する
3. 別のブランチを指定する

ユーザーが 2 か 3 を選んだら、`next` の「着手中」検出と `pr base` のスタック元の導出が
効かなくなることを伝える（どちらもブランチ名から導出しているため）。

出力の `stackedOn` が非 null なら、先行フェーズのブランチの上に積んでいる。PR のマージ先は
そのブランチになる（Step 8。正は `pr base` で、`stackedOn` は目安）。

ブランチを作成したら早めに push する（ブランチの存在が「着手中」の印になる）。ブランチを
決めたら、成果物をコミットする直前にもう一度この確認を行う。

- [ ] `cycle status` で既存の成果物を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle}
```

ブランチを決めてから実行する（成果物の有無は作業ツリーで判定するため、デフォルトブランチの
ままでは push 済みの成果物が見えない）。中断からの再開なら、表示された位置から既存の成果物を
読み込んで再開する。

`building（差し戻し中: build-NN）` と表示されたら、作業を始めずに止まる。このブランチは
architect に差し戻されて再設計中なので、表示された再開コマンド（`/hikyaku:architect {cycle} build-NN`）を
案内して終了する。

- [ ] ブランチを決めたあと、対象ビルドが着手可能かを確認し直す

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle}
```

切り替えた先で待機中になったなら着手しない（デフォルトブランチへ移った場合など）。

- [ ] セッション名を設定する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title build-{NN} {cycle}
```

返った名前をセッション名に設定する。設定する手段が無い環境と、「変更しません」と返った場合はスキップする。

`--build-title` にビルドのタイトルを渡すと、セッション名にビルド名まで入る。

→ Step 3 へ。

### Step 3: 実装計画とテストシナリオの作成

- [ ] 不明点があれば `cycles/{cycle}/build-{NN}/questions.md` でユーザーに質問する（ask: questions）
- [ ] `cycles/{cycle}/build-{NN}/plan.md` を作成する
  - テンプレートは [templates.md](references/templates.md) を参照
  - 含めるもの: 依存パッケージの選定、クラス設計（メソッドシグネチャ）、非機能要件
  - 含めないもの: 詳細な実装コード、テストコードの実装方法
  - 非機能要件の「マージ時点のデータ安全」に、マージ直後の本番で既存データ・既存機能が壊れない
    根拠を書く。データに触れないビルドでは「該当なし」と一言書く（考えた跡を残すため）
- [ ] BP を再算出する（`${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/bp-guide.md` の手順に従う）
  - architect 段階の BP は issue.md のスコープ記述からの見積もり。plan.md ではクラス設計と
    実装ステップまで具体化しているので、入力値を見直して算出し直す
  - `{HIKYAKU_ROOT}/bp-guide/README.md` があれば、このリポジトリ固有の数え方の注意を先に読む
  - 作成するファイルを名前で列挙し、そこから新規ファイル数・実装行数を数える。列挙は plan.md に残す
  - 入力値を `bp estimate` に渡し、`--markdown` の内訳表をそのまま plan.md に貼る。
    表への当てはめはコマンドが行うので、自分で表を読んで BP にしない

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp estimate {cycle} \
  --new-files 7 --lines 900 --impact-files 9 --external-api --markdown
```

  - 加算要素を落とさない。過小見積もりの多くは、影響ファイル数・基盤セットアップ・
    外部API連携・大規模リファクタの取りこぼしから来る。使える入力は `bp guide {cycle}` の「入力」列
- [ ] コミット & push する

- [ ] `plan_review` が有効な場合、ここで `doc-reviewer` を起動し plan.md をレビューする（`context: plan`）
  - 起動方法は `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve doc build-{NN} {cycle} --self claude --json` の `mode` で決める。
    `agent` ならサブエージェントとして起動する。`process` なら
    `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run doc build-{NN} {cycle} --self claude --context plan --files <渡す情報のパスをカンマ区切りで>`
    の本文をレビュー結果とする。終了コード 1 は失敗で、指摘0件として扱わずユーザーに報告する
  - 渡す情報: `plan.md`, `issue.md`, `design-delta.md`, 依存ビルドの `handoff.md`,
    `{HIKYAKU_ROOT}/bp-guide/README.md`（存在する場合。無ければ `bp guide --markdown` の出力を
    プロンプトに含める）, Step 0 で取得した `bpMax`
  - BP見積もりの入力値もレビュー対象である旨をプロンプトに明記する（`context: plan` の観点に含まれる）。
    見るのは、列挙したファイルとクラス設計が合っているか、加算要素の取りこぼしが無いか
  - 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）
  - 入力値の乖離の指摘は `bp estimate` を再実行して反映する。再算出の結果が `bpMax − 2` 以上
    （既定では 6 以上）になったら、下の「ビルド管理」に従って
    `/hikyaku:build-manager {cycle}` を呼び出し、分割を検討する

- [ ] `plan_gate` が有効な場合、ここで plan.md の承認を得る（G7）
  - それ以外のプロファイルでは Step 3 の最後にまとめて承認する（G8）

- [ ] テストシナリオを Agent に委任して `cycles/{cycle}/build-{NN}/test-spec.md` を生成させる
  - 洗い出し過程のコンテキスト消費を避けるため、メインセッションでは直接作成しない
  - Agent に渡す情報: `plan.md`, `issue.md`, `design-delta.md`, 関連する永続ドキュメント、
    [templates.md](references/templates.md) の「test-spec.md」節（フォーマットと記載ガイドライン。必ず従わせる）
  - テスト対象が無いビルド（ドキュメントのみ等）ではスキップしてよい

- [ ] コミット & push する

- [ ] `test_spec_review` が有効な場合、ここで `doc-reviewer` を起動し test-spec.md をレビューする（`context: test-spec`）
  - 起動方法は plan.md のレビューと同じで、`--context test-spec` を渡す
  - 渡す情報: `test-spec.md`, `plan.md`, `issue.md`, `design-delta.md`
  - plan.md のレビューは上で完了済みなので、ここでは行わない
  - 明確な不整合・網羅漏れは反映する（主観的な指摘は無視してよい）

- [ ] plan.md と test-spec.md をまとめてユーザーに提示し、承認を得る（G8）
  - 承認観点: 実装ステップの妥当性 / 受け入れ基準の網羅性 / 正常系・異常系・境界値のカバー範囲 / 不要なテストの有無
  - この承認は profile の管轄外で、どのプロファイルでも省略しない
  - G7 で plan を承認済みなら、ここでは test-spec に焦点を当てる

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
レビューそのものは Claude Code / Codex に組み込みのレビュー機能が行う。
どのプロバイダ・モデル・エフォートで何回まで回すかは `[review]` の設定で決まり、
CLI が起動方法を解決する。

- [ ] ローカルでコミットする（push はしない）
  - どちらのプロバイダのレビューも、コミット済みの差分を対象にするため
  - 未追跡のファイルも含め、実装したものは全てコミットに含める
- [ ] 起動方法を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve code build-{NN} {cycle} --self claude --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review resolve security build-{NN} {cycle} --self claude --json
```

`--self` にはメインのセッションのプロバイダを渡す（`provider = "auto"` と `provider_for` の解決に使う）。
`enabled` は `code_review` / `security_review` の値、`maxRounds` は回数の上限（0 は無制限）、
`autoFix` は `maxRounds = 0`（無制限）の2ラウンド目以降の確認を省くかどうか。
`maxRounds` が1以上なら `autoFix` に関わらず下の回数別の手順に従う。`base.ref` が差分の基準で、
スタックしていればスタック元になる。**デフォルトブランチを決め打ちしない。**

- [ ] `code` の `enabled` が true なら（全プロファイル）、code のレビューを行う
- [ ] `security` の `enabled` で、security のレビューを行うか判定する

| 設定値 | 挙動 |
|---|---|
| `off` | 起動しない |
| `on` | 常に起動する |
| `recommended` | 判定基準に該当する場合のみ、起動するか確認する |

`recommended` の場合、対象ビルドの `issue.md` と実際の diff が、`config --json` の
`security.triggers` の基準に該当するか判定する。該当する場合は判定根拠を一行で示して確認する。ヒューリスティックである以上
外れるので、ユーザーが上書きできる形にする。

```
このビルドは「認証・認可」に該当する変更を含みます（auth/session.ts の権限判定を変更）。
security_review を起動しますか？ [Y/n]
```

- [ ] スコープ準拠を自分で確認する
  - 組み込みのレビュー機能には指示文を渡せず、plan.md を読まない。スコープの確認はここで行う
  - `git diff --stat $(git merge-base {base.ref} HEAD)..HEAD` の変更ファイルを、plan.md の
    実装ステップと issue.md のスコープ外と突き合わせる
  - 計画に無い変更・スコープ外の変更は、レビューの指摘と同じ扱いで下の統合に加える
- [ ] マージ時点のデータ安全を自分で確認する
  - 組み込みのレビュー機能は、このビルドの後に何がマージされるかを知らない。差分のうち
    スキーマ・マイグレーション・保存形式・API の契約・既存データを読み書きする処理を、
    plan.md の「マージ時点のデータ安全」と突き合わせる
  - 根拠が成り立たない箇所は、レビューの指摘と同じ扱いで下の統合に加える。issue.md に
    「マージ時点で残る危険」があれば、その範囲を超えているかで判定する
- [ ] レビューを実行する（ラウンド n。初回は 1）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run code build-{NN} {cycle} --self claude --round {n}
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" review run security build-{NN} {cycle} --self claude --round {n}
```

  - 2つを **Bash の `run_in_background` で並列に実行する**（数分かかることがある。`timeout` は最大値）
  - 生の出力は `.git` の中に保存され、パスと本文が返る。コミットはしない
  - **終了コード 1 は失敗であって、パス（指摘0件）ではない。** 空の結果やタイムアウトも失敗になる。
    メッセージをユーザーに報告して判断を仰ぐ
- [ ] 指摘を統合する
  - 同一箇所への重複指摘は1件に統合し、security の指摘を優先する。
    同じプロバイダが同じ指摘を2回出力することもある
  - 「確度が低い懸念」は「確度: 要確認」ラベルを保持したまま別枠で提示する
  - 2ラウンド目以降は、前のラウンドの出力（返ったパスと同じディレクトリの `round-{n-1}-*.md`）と比べる
- [ ] 統合した指摘の妥当性を、コード・承認済み仕様・スコープに照らして判断する。
  不採用の指摘は理由を記録し、対応対象から外す。前ラウンドから保留中の指摘も確認し、
  未解決なら対応対象に含める。対応対象が0件なら、パスとして Step 7 へ
- [ ] `maxRounds` に応じて対応する
  - **1回:** 妥当かつ承認済みスコープ内の指摘を、追加確認なしで修正する。
    Step 5 の検証を通して追加でコミットし、再レビューせず Step 7 へ進む。
    自動修正できない指摘（確度の低い懸念・スコープ外など）は理由とともに `handoff.md` に残す。
    レビュー指摘への対応確認は挟まない。設計の前提が崩れた場合は「architect への差し戻し」に従う
  - **2回以上、最終回より前（n < maxRounds）:** 妥当かつ承認済みスコープ内の指摘を、追加確認なしで修正する。
    Step 5 の検証を通して追加でコミットし、ラウンド n+1 へ進む。
    自動修正できない指摘は保留し、最終回にも未解決なら対応対象に含める。
    同じ指摘が繰り返されても途中で対応確認を挟まない。設計の前提が崩れた場合は「architect への差し戻し」に従う
  - **2回以上、最終回（n = maxRounds）:** 未解決の指摘がある場合のみ、ユーザーに提示して対応を確認する（ask: review-findings）。
    選べるのは「修正して再レビューせずに進める」「新ビルド化」「そのまま進める」
  - **0（無制限）:** 初回は統合した指摘を提示して対応を確認する（ask: review-findings）。
    2ラウンド目以降は `autoFix` が true なら妥当な指摘を自動修正するが、確度の低い懸念は確認する。
    `autoFix` が false なら毎回確認する。選べるのは「今修正する」「新ビルド化」「そのまま進める」。
    ただし同じ指摘が繰り返された場合は自動修正より先に打ち切り、対応を確認する（ask: review-findings）。
    打ち切り後は再レビューしない
- [ ] 対応確認の結果を反映する
  - 修正する — 修正し、Step 5 の検証を通して追加でコミットする。無制限で継続中ならラウンド n+1 へ、それ以外は Step 7 へ
  - 新ビルド化 — `/hikyaku:build-manager` を呼び出して新ビルドを追加する
  - そのまま進める — 指摘を `handoff.md` の「意図的に残した未対応」に記録する

残った指摘すべての対応が決まったら、パスとして扱う。不採用・保留した指摘の理由も申し送りに残す。

→ Step 7 へ。

### Step 7: 申し送りの作成

- [ ] `cycles/{cycle}/build-{NN}/handoff.md` を作成する
  - テンプレートは [templates.md](references/templates.md) を参照
  - 前半は後続ビルド向け: 実装内容の要約 / 公開インターフェース / 環境変更 / 意図的に残した未対応
  - 後半は close-cycle 向けの昇格素材: overview への影響 / 新たな制約 / 踏んだ落とし穴 / 覆した設計判断とその理由
  - 書かない: 実装の全詳細（コードが正）/ 一般的な進捗報告

handoff.md の後半は節ごとに昇格先が決まっている（overview・constraints・learnings・ADR）。
どこに書くか迷う発見は、後から読む人が何を直すことになるかで節を選ぶと、close-cycle が
仕分けし直さずに昇格させられる。あなたが永続ドキュメントを
直接書き換えることはない。

- [ ] コミット & push する

→ Step 8 へ。

### Step 8: PR 作成と完了記録

- [ ] 外部連携が有効なら、PR 本文へ入れる参照行を生成する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref build-{NN} {cycle}
```

`Closes #12`（GitHub）またはタスクの URL（Asana）が返る。空なら何も入れない。
issue が閉じても完了判定には使わない。判定は常に tasklist.md の PR 列。

- [ ] PR のマージ先を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr base build-{NN} {cycle}
```

返った値を PR の base にする。**デフォルトブランチを決め打ちしない。**
スタックしている場合はスタック元のブランチが返る。デフォルトブランチ宛てに作ると、
先行ビルドの差分まで含んだ PR になる。

- [ ] PR を作成する（タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title build-{NN} {cycle} --build-title "{title}"` で生成）
  - マージ先は上で取得した base
  - 本文の末尾に上の参照行を入れる
  - PR 作成前の承認は取らない。PR はレビューのための提案であって不可逆ではなく、
    ユーザーが `/hikyaku:builder` を実行した時点で PR 作成まで依頼されている
- [ ] レビュアーをアサインする（`[pr] reviewers` が空、またはこのフェーズがオフなら何もしない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers build-{NN} {cycle} --pr {PR の URL}
```

  失敗しても PR は作成済みなので止めない。失敗の内容を、完了の案内と一緒にユーザーに伝える

- [ ] tasklist.md の PR 列を更新し、同じブランチへコミット & push する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist done {cycle} \
  --id {buildID} --pr {PR の URL}
```

**この変更は必ずこのビルドの PR に同梱する。** PR 列が非空であることが「マージ済み = 完了」を
意味するので、先にデフォルトブランチへ入れると未マージのビルドを完了と誤判定する。

- [ ] 外部投影が有効な場合は同期を試みる（失敗してもワークフローは止めない）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external sync {cycle}
```

gh CLI が無い環境では投影内容だけが返る（`reason: "gh-not-found"`）。その場合は
GitHub MCP ツールで適用し、`cycle link` / `tasklist link` で参照を記録する。

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

- Step 3 後 — 再算出した BP が `bpMax − 2` 以上（issue.md のスコープが実際には BP 超過） → ビルドの分割
- Step 4 中 — 想定外の複雑さや未定義の依存 → ビルドの追加・更新
- Step 6 時 — 指摘の「新ビルド化して後で対応」 → 新ビルドの追加
- Step 7 時 — 意図的に先送りした作業 → 新ビルドの追加

呼び出し後の対応:
- 現在のビルドのスコープが変わった場合: plan.md を修正し、Step 3 の承認からやり直す
- 新ビルドが追加されただけの場合: 現在の作業を続行する

## architect への差し戻し（設計の前提が崩れたとき）

設計（design-delta.md / ADR / issue.md）どおりに作ると要件（user-stories.md の受け入れ基準）を
満たせない、あるいは設計が前提にしている事実が実際のコードと食い違っていて設計の判断が
変わる、と分かった場合の手順。issue.md のスコープどおりに作るとマージ時点で本番データの安全を
保てない（「マージ時点で残る危険」に書かれていない危険が残る）と分かった場合も、これに従う。ビルドの分割や追加で済むスコープの問題は上の「ビルド管理」で扱う。

- [ ] **自分で設計を変えずに、ユーザーに提示して方針を確認する（ask: design-conflict）。** 次の選択肢を、何と何が
  矛盾しているかの説明とともに示す
  1. 設計に合わせる（要件のほうを改める）
  2. 要件に合わせて、このビルドの中で設計を改める
  3. architect に差し戻す
- [ ] 確認のやりとりは `cycles/{cycle}/build-{NN}/questions.md` に残す
- [ ] 3 を選んだ場合、`cycles/{cycle}/return.md` を書く（サイクル直下。テンプレートは
  [templates.md](references/templates.md)。1行目の見出しの書式を変えない）
- [ ] コミット & push する
- [ ] `/hikyaku:architect {cycle} build-{NN}` を案内して終了する

差し戻すときは、handoff.md・retrospective・PR・`tasklist done` のどれも行わない。
handoff.md はビルドの完了の印として読まれ、`tasklist done` は完了の記録そのものだからだ。

再設計はこのビルドのブランチ上で行われる。 architect は別のブランチを切らず、設計の変更は
このビルドの PR に入る。積んでいる場合も連鎖が一直線のまま保てる。architect は再設計の最後に
`return.md` と、古い設計の上で書かれた plan.md / test-spec.md を削除する。そのあと builder を
起動し直せば、`cycle status` が plan.md からの再開を返すので、Step 3 からやり直す。

`return.md` を他のブランチやセッションから検出する仕組みは無い。差し戻しに気づくのは、
差し戻しを受けたユーザーと、このブランチで動くスキルだけでよい。

## PRレビュー指摘への対応

- [ ] PR のレビューコメントを確認する
- [ ] `cycles/{cycle}/build-{NN}/plan.md` を参照してコンテキストを復元する
- [ ] 修正を実装し、ローカル検証を実行する（Step 5 と同じ）
- [ ] ドキュメント更新チェック — サイクルドキュメントのみを更新する
  - `cycles/{cycle}/build-{NN}/` — plan.md, issue.md, test-spec.md, handoff.md
  - `cycles/{cycle}/design/design-delta.md` — 設計レベルの変更があった場合
  - 永続ドキュメントは更新しない。昇格が必要な内容は handoff.md に記録する
- [ ] Push する
- [ ] `/hikyaku:retrospective {cycle} build-{NN}` を呼び出す（既に retrospective.md があれば追記モードで動作する）
