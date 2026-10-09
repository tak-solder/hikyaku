---
name: conductor
description: "Hikyaku 監督: PLAN 済みのサイクルを、ARCHITECT → BUILD を非対話の子セッション（claude -p）に実行させて進める。子の問いには監督が答え、取り返しのつかない判断だけを人間に上げる"
user-invocable: true
disable-model-invocation: true
argument-hint: "[{cycle}]"
metadata:
  repository: https://github.com/tak-solder/hikyaku
  version: "2.3.0"
---

# Hikyaku Conductor

PLAN を終えたサイクルを、ARCHITECT から最後のビルドまで進める。あなたは**監督**で、
各フェーズは非対話の**子セッション**（`claude -p`）が既存のスキルのまま実行する。

```
/hikyaku:planner       → 人間と要件をすり合わせる（conductor の対象外）
/hikyaku:conductor     → architect → build-01 → build-02 … を子に実行させる  ← あなたはここ
                          各 PR は conductor ブランチへ向け、監督が取り込む
（人間が conductor ブランチ → デフォルトブランチの PR をマージ）
/hikyaku:conductor     → close-cycle を子に実行させる
```

**あなたの仕事は、子の成果物を読んで判断すること。** 実装はしない。成果物を書き換えない。
コミットもしない。行う git 操作は、ブランチの作成・切り替えと、子の PR の conductor ブランチへの
取り込みだけ。

## 原則

- **状態は保存しない。** 次に何をするかは毎回 `cycle status` / `next` から導く。子の session-id も
  記録しない。監督のセッションが落ちたら、子を新しく起動し直せばスキルの中断検出で続きから進む
- **子の報告をそのまま信じない。** 「検証の義務」を必ず行う
- **デフォルトブランチにはマージしない。** サイクルの統合ブランチ（conductor ブランチ）を1本切り、
  各フェーズのブランチはそこから切って PR もそこへ向ける。子の PR を conductor ブランチに取り込むのは
  監督、conductor ブランチをデフォルトブランチへマージするのは人間
- **委任の範囲を固定する。** Step 0 で人間と合意したときの `digest` を、以後のすべての
  `conductor launch` / `parse` に `--expect-digest` で渡す。子が `.hikyaku.config` を書き換えて
  権限や振り分けが変わっていれば、CLI がエラーで止まる。そのときは人間に上げる
- **子の自由文から問いを推測しない。** 判断の起点は常に `conductor parse` の結果
- **逐次実行。** `next` が複数のビルドを返しても1件ずつ進める

## 作業ステップ

### Step 0: 前提の確認と委任の合意

- [ ] 設定と対象サイクルを解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

- 未初期化（`.hikyaku.config` が無い等）なら、`/hikyaku:init` を先に実行するよう伝えて**終了**する
- サイクルを決められなければ、進行中サイクルの一覧を示して人間に尋ねる

- [ ] サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle} --json
```

| `phase` | 対応 |
|---|---|
| `planning` | `/hikyaku:planner {cycle}` を先に実行するよう伝えて**終了**する。要件のすり合わせは人間が対話で行う |
| `closed` / `abandoned` | 何もせず**終了**する |
| それ以外 | 続ける |

- [ ] 委任される範囲と、子に許可するツールを取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor asks {cycle} --json
```

出力の `digest` を控える（以後のすべての `launch` / `parse` に渡す）。

- [ ] 子がテストを実行できるかを確認する
  - テストのコマンドを AGENTS.md / README / package.json などから引く
  - `asks` の `allowedTools` で許可されているかを照合する
    （既定は `git` のサブコマンドと Hikyaku CLI の実行などだけで、`npm test` / `node --test` や
    環境変数を前置きしたコマンドは含まない）
  - 許可されていなければ、`.hikyaku.config` の `[conductor] allowed_tools` に足してコミットするよう人間に
    案内して**終了**する。許可が無いと builder はローカル検証で blocked になる

- [ ] **人間に1回だけ確認する**（`AskUserQuestion`）。次を示し、進めてよいかを尋ねる

```
サイクル {cycle}（profile: {profile}）を {ARCHITECT / BUILD / CLOSE} から進めます。
planning/user-stories.md を承認済みの要件として扱います。
監督が判断する同意ゲート: {asks の出力}
人間に上げる問い: {asks の出力}、およびスコープを広げる回答が要る問い
子のモデル: {asks の出力の models。null は「既定」と書く}
フェーズの PR のレビュアーと、待つ上限: {asks の出力の review}
最後の PR のレビュアー: {asks の出力の review.finalReviewers}
各フェーズの PR は conductor ブランチ（{conductor}）に向け、監督が取り込みます。
デフォルトブランチにはマージしません。最後のビルドが終わったら、{conductor} → デフォルトブランチの
PR を作って止まります。
```

同意ゲートは、ここでの合意によって監督に**委任**される（省かれるのではない）。断られたら**終了**する。
想定と違う振り分けを望まれたら、`.hikyaku.config` の `[conductor] escalate` / `delegate` を案内する。

→ Step 1 へ。

### Step 1: 次の作業を決める

- [ ] `cycle status {cycle} --json` を実行し、次の表で決める

| 状態 | 次の作業 |
|---|---|
| `architecting` | Step 2 → Step 3（`architect`） |
| `building` かつ `returned` あり | 差し戻されたビルドのブランチのまま Step 3（`architect {cycle} build-NN`） |
| `building` | 下記で着手するビルドを決めて Step 2 → Step 3（`builder {cycle} {NN}`） |
| `completed` | Step 2 → Step 3（`close-cycle`） |
| `closed` | Step 5 へ |

状態は **conductor ブランチの上で**見る（途中のビルドを再開するときは、そのビルドのブランチの上）。
デフォルトブランチの上では、取り込み済みの成果物が見えない。

`building` のときは、次の順に決める。

- `cycle status` の `resumeAt` が `build-NN/…` を指していれば、途中で止まったそのビルドを再開する
- そうでなければ `next` を実行し、`available` のうち**番号が最も小さい1件**を選ぶ

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle} --json
```

- `available` が空で、`tasklist read {cycle}` で全ビルドが完了なら Step 4 へ
- それ以外（依存が満たされず進めない）は、`next` の出力を示して人間に上げる

### Step 2: ブランチを用意する

子に `branch` の問いを出させないため、**子を起動する前に**期待されるブランチへ切り替えておく。

- [ ] conductor ブランチを用意する（close-cycle では不要）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify conductor {cycle} --json
```

`expected` が conductor ブランチの名前。既にあれば（ローカルか origin に）それに切り替えて最新にする。
無ければ、デフォルトブランチを最新にしてから `git switch -c {expected}` で作り、push する。
plan の PR がまだマージされていなければ、デフォルトブランチではなく plan のブランチから作る
（plan の成果物が無いと architect が始められない。plan の変更も最後の PR に含まれる）。

- [ ] フェーズのブランチを用意する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify {phase} {cycle} --json
```

`{phase}` は `architect` / `build-NN` / `close`。

| 状況 | 対応 |
|---|---|
| `ok: true` | そのまま |
| `expected` のブランチが既にある | `git switch {expected}`（中断からの再開） |
| 無い（architect / build） | conductor ブランチに切り替えてから `git switch -c {expected}` |
| 無い（close） | デフォルトブランチを最新にしてから `git switch -c {expected}` |

切り替えたあと、もう一度 `branch verify` を実行して `ok: true` を確認する。architect / build では
出力の `prBase` が conductor ブランチになっていることも確認する（子が作る PR の向き先になる）。

**差し戻しの再設計（`returned` あり）ではブランチを切らない。** 差し戻されたビルドのブランチに居ることを
`branch verify build-NN {cycle}` で確認する。

### Step 3: 子を起動して結果を処理する

- [ ] 起動コマンドを組み立てる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor launch {architect|builder|close-cycle} {cycle} [{build}] \
  --expect-digest {digest} --json
```

- [ ] 返ってきた `command` を **Bash の `run_in_background` で実行**する（`timeout` は最大値にする）
  - 子は10分を超えうる。フォアグラウンドで待たない。完了の通知を待ち、ポーリングしない
  - 起動が許可ルールで拒否されたら、`Bash(claude -p:*)` を許可するよう人間に案内して止まる
- [ ] 完了したら結果を解析する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor parse {resultFile} {cycle} --expect-digest {digest} --json
```

`outcome` で分岐する。

#### gate

`ask.handler` で分岐する。

- **`supervisor`**: 「問いへの答え方」に従って判断する。ただし、そこに書いた「人間に上げる」条件に
  当たれば `human` と同じに扱う
- **`human`**: 子の問い（`body`）を要約せずに `AskUserQuestion` で人間に示し、回答を得る

回答をスクラッチパッドのファイルに書き、同じ session-id で再開する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor launch {phase} {cycle} [{build}] \
  --resume {sessionId} --message {回答ファイル} --expect-digest {digest} --json
```

回答ファイルの書式（監督が判断した場合）:

```
回答（委任された判断）: {回答。選択肢があればどれを選んだか}
根拠: {どの成果物の、どの記述に基づくか}
```

人間が答えた場合は `回答（人間の判断）:` とし、根拠は書かない。子は「委任された判断」を
非対話規約に従って記録する。

→ 再開した子の結果を、また Step 3 の解析から処理する。

#### done

- [ ] 「検証の義務」のうち、そのフェーズの done に当たるものを行う
- [ ] 問題があれば人間に上げる（自分で直さない）
- [ ] 子が PR を作っていれば（architect / builder）、取り込む前にその PR を検証する。レビューや CI を待つので、
  **Bash の `run_in_background` で実行する**（`timeout` は最大値にする）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor check-pr {PR の番号か URL} {cycle} --wait --json
```

  - 確かめるのは、**マージ先が conductor ブランチであること**、PR が開いていること、**Draft でない
    （Ready for Review の）こと**、**レビューの依頼が残っていないこと**、**未解決のレビュースレッドが
    無いこと**、**CI が失敗も待機もしていないこと**。`[conductor] require_approval = true` なら、1人以上の
    承認があり変更の要求が残っていないことも求める（既定では承認は不問）。満たしていなければ
    終了コード 2 になり、理由が `problems` に入る
  - 取り込みはローカルの `git merge` と push で行うので、GitHub のブランチ保護や必須チェックは働かない。
    この検証がその代わりになる
  - 子が作った PR には、`[conductor] phase_reviewers` のレビュアーが、子の `pr request-reviewers` で
    アサインされている（設定が空なら何も依頼されない）
  - `--wait` は、待てば解消しうる問題（CI の実行中、レビューの依頼が残っている）だけで止まっているあいだ、
    確かめ直す。上限は `[conductor] review_timeout`（既定 15 分。0 なら待たない）。上限を超えると
    `timedOut: true` で終了コード 2 になる。Draft・未解決の指摘・CI の失敗・マージ先の食い違いは、待っても
    解消しないので、見つけた時点で返る
  - **未解決のレビュースレッド**（`threads.unresolved`）があれば、取り込まない。指摘の場所・投稿者・URL を
    人間に示して上げる。**監督は指摘に自分で対応せず、子を再開して直させることもしない**。人間が対応するか、
    同意して resolve したら、`check-pr` をやり直す
  - Draft・承認の不足・CI の失敗・マージ先の食い違い・待機の上限超過も、取り込まずに `problems` を示して
    人間に上げる（`gh pr ready` で Draft を外したり、依頼を取り下げたりしない）。人間が対応したら
    `check-pr` をやり直す
  - **終了コード 1**（`gh` の応答に必須のフィールドが無い、型が違う、取得できないなど、状態を判定できなかった）
    も、取り込まない。判定できなかった PR を、CI なし・依頼なし・Ready として合格させない。エラーの内容を
    人間に示して上げる
  - `none`（CI が1つも無い）は失敗にならない。PR を作った直後にチェックがまだ登録されていない場合は、
    `--wait` が最初の少しのあいだ待ってから判定するので、再実行は要らない。`none` で通ったら、最後の PR の
    本文に「フェーズの PR に CI が走っていなかった」と書く
  - 結果の `headSha` は、検証した PR の head のコミット。取り込みにはブランチ名ではなくこれを使う

- [ ] 検証を通った PR を conductor ブランチに取り込む

```bash
git fetch origin {フェーズのブランチ}
git rev-parse {フェーズのブランチ} origin/{フェーズのブランチ}
```

  - 2行とも `headSha` と一致することを確かめる。一致しなければ取り込まず、人間に上げる。
    ローカルに push されていないコミットがある、または検証のあとに push されたコミットがあるので、
    検証していないコミットを取り込むことになる。`check-pr` をやり直すかは人間が決める

```bash
git switch {conductor}
git pull --ff-only
git merge --no-ff {headSha} -m "{フェーズ} を conductor に取り込む（{PR の URL}）"
git push origin {conductor}
git branch -d {フェーズのブランチ}
git push origin --delete {フェーズのブランチ}
```

  - ブランチ名ではなく、`check-pr` が検証したコミット（`headSha`）を `--no-ff` で取り込む
  - 取り込んだブランチは消す。残すと、次のフェーズの PR の向き先（`pr base`）を導くときの候補に混ざる
  - push すると、GitHub はその PR をマージ済みとして扱う
  - 取り込んだ PR の `check-pr` の結果（CI の件数と状態）は、Step 4 の最後の PR の本文に1行で残す
  - 差し戻しの再設計（`architect {cycle} build-NN`）は PR を作らない。取り込まずに Step 1 へ
    （同じビルドのブランチで builder を起動し直す）
  - close-cycle の PR はデフォルトブランチへ向く。取り込まない
- → Step 1 へ

#### blocked

- [ ] `cycle status {cycle} --json` を実行する
- `returned` があれば（builder からの差し戻し）→ Step 1 へ（architect が差し戻しを扱う）
- それ以外は、`body` を示して人間に上げる。指示があればそれに従い、無ければ**終了**する

#### violation

規約どおりのブロックが無い。**子の自由文から問いや結果を推測しない。**

- 1回目: 同じ session-id で再開し、「非対話規約に従い、最後に gate / done / blocked のどれか1つを
  出力してください」とだけ伝える
- 2回目も violation なら、`body`（出力の末尾）と `reason` を示して人間に上げる

#### error

予算超過や利用上限への到達などで子が異常終了した。`reason` と `costUsd` を示して人間に上げ、再開するかを尋ねる。
再開するなら、**同じ session-id で** `--resume` し、「中断したところから続けてください」とだけ伝える。
子は止まる直前の文脈を持っているので、新しい session で起動し直すより確実に続きから進む。
`--resume` 自体が失敗したときだけ、新しい session で起動し直す（スキルの中断検出で続きから進む）。

### Step 4: デフォルトブランチへの PR を作って止まる

最後のビルドを conductor ブランチに取り込んだら、CLOSE には進まない。close-cycle は全ビルドが
デフォルトブランチにマージされていることを前提にしている（未マージの実装を永続ドキュメントに
書くと、永続ドキュメントとサイクルドキュメントを分けた意味が無くなる）。

- [ ] **作る前に、同じ向き（conductor ブランチ → デフォルトブランチ）で開いている PR が既に無いかを確かめる**。
  監督が Step 4 の直後に落ちて再実行されると、状態導出は `building` のまま（デフォルトブランチにはまだ
  ビルドの PR 列が入っていない）で、同じ Step 4 に戻ってくるため。PR が重複して作られたり、作成に
  失敗したりするのを防ぐ

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify conductor {cycle} --json   # baseBranch がデフォルトブランチ
gh pr list --head {conductor ブランチ} --base {baseBranch} --state open --json number,url
```

  - **見つかったら、PR を作らない。** その URL を人間に示し、下の「レビュアーをアサインする」手順だけ
    実行して（依頼済みの相手には重ねて依頼しないので、何度実行しても同じ）、案内して**終了**する
  - 見つからなければ、次の手順で作る（閉じられた PR や、マージ済みの PR は対象にしない）
- [ ] conductor ブランチ → デフォルトブランチの PR を作る
  - タイトルは `hikyaku pr title conductor {cycle}` で生成する
  - 本文に、取り込んだフェーズの PR を順に並べ、それぞれで**監督が判断した同意ゲート**を1行ずつ示す
    （人間がレビューで確認するため）
  - 外部連携が有効なら、各ビルドの `hikyaku external ref build-NN {cycle}` の行を本文の末尾に入れる。
    conductor ブランチへのマージではクローズキーワードが効かないため、ここでまとめて閉じる
- [ ] この PR にレビュアーをアサインする（`[pr] reviewers` が空、または `[pr] reviewers_skip` に
  `conductor` があれば何もしない）。人間がレビューする PR なので、待たない

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers conductor {cycle} --pr {PR の URL}
```
- [ ] PR の URL を示し、「マージしたら `/hikyaku:conductor {cycle}` を実行すると CLOSE から再開する」と
  案内して**終了**する

### Step 5: 完了

close-cycle の子が done になったら、`cycle status` が `closed` であることを確認し、
CLOSE の PR を示して終了する。

## 問いへの答え方

監督が答えてよいのは、**issue と承認済みの成果物から導ける回答**と、**挙動を狭める回答**だけ。
スコープを広げる回答、issue や user-stories と矛盾する回答が必要なら、どの種別でも人間に上げる。

| id | 答え方 |
|---|---|
| `cycle` | 対象サイクル名を答える |
| `branch` | Step 2 で用意したブランチなら「Hikyaku の規則に従う」。食い違いの理由が分からなければ人間に上げる |
| `build-select` | Step 1 で選んだビルドを答える |
| `overlap` | このサイクルの design-delta で分担を決められるなら答える。**他のサイクルの設計を変える必要があれば人間に上げる** |
| `G3` | 推奨案が user-stories と `constraints` に反していなければ推奨案を選ぶ |
| `G2` / `G4` / `G7` | 成果物を読み、承認観点（スキルが示すもの）に沿って承認するか差し戻す |
| `retrospective` | 実施する |
| `docs-link` | `--dry-run` の差分がマーカーで囲まれた索引ブロックの中だけなら承認する |
| `G6` | 分割・依存が design-delta と矛盾せず、各ビルドの BP が上限内なら承認する |
| `G8` | 「検証の義務」の G8 を行い、満たしていれば承認する |
| `G10` | 「検証の義務」の G10 を行い、除外すべき候補を外して承認する |
| `questions` | 成果物から導けるものだけ答える。導けないものは人間に上げる |
| `adr-status` | 既存の形式に欄を足さない（挙動を狭める側） |
| `design-conflict` | 「architect に差し戻す」を選ぶ。**「設計に合わせる（要件を改める）」が必要なら人間に上げる**。ビルドの中で設計を改めるのは、変更が plan.md の範囲に収まり ADR を覆さない場合だけ |
| `review-findings` | 明確なバグ・規約違反は「今修正する」。スコープ外は「新ビルド化」。「そのまま進める」は確度の低い懸念だけ |

## 検証の義務

| 時点 | 行うこと |
|---|---|
| G8 の前 | plan.md と test-spec.md が、issue.md の受け入れ基準をすべて網羅しているかを読む |
| builder の done の後 | テストを自分で再実行する。差分（`git diff {conductor}...HEAD --stat` と主要ファイル）が plan.md の範囲に収まっているかを読む |
| G10 の前 | 昇格候補に「監督がその場で決めた運用」や「すでに事実でない前提」が混ざっていないかを読み、混ざっていれば除外する |

テストのコマンドは handoff.md / plan.md から引く。再実行に許可が要れば人間に案内する。

## 人間に上げるとき

`AskUserQuestion` で、次を含めて尋ねる。

- どのフェーズの、どの問いか（`id` と種別）
- 子の問いの本文（要約しない）
- 監督が自分で答えなかった理由
- 選択肢（子が示したもの）

人間の回答は「回答（人間の判断）」として子に渡す。人間が「監督に任せる」と答えたら、
その問いに限って監督が判断し、「委任された判断」として渡す。
