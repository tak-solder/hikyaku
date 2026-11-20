---
name: conductor
description: "Hikyaku 監督: PLAN 済みのサイクルを、ARCHITECT → BUILD を非対話の子セッション（claude -p）に実行させて進める。子の問いには監督が答え、取り返しのつかない判断だけをユーザーに上げる。モデルによる Hikyaku ワークフロー以外からの呼び出しは禁止です。"
user-invocable: true
argument-hint: "[{cycle}]"
---

# Hikyaku Conductor

PLAN を終えたサイクルを、ARCHITECT から最後のビルドまで進める。あなたは**監督**で、
各フェーズは非対話の**子セッション**（`claude -p`）が既存のスキルのまま実行する。

```
/hikyaku:planner       → ユーザーと要件をすり合わせる（conductor の対象外）
/hikyaku:conductor     → architect → build-01 → build-02 … を子に実行させる  ← あなたはここ
                          各 PR は conductor ブランチへ向け、監督が取り込む
（ユーザーが conductor ブランチ → デフォルトブランチの PR をマージ）
/hikyaku:conductor     → close-cycle を子に実行させる
```

**あなたの仕事は、子の成果物を読んで判断すること。** 実装はしない。成果物を書き換えない。
コミットもしない。行う git 操作は、ブランチの作成・切り替えと、子の PR の conductor ブランチへの
取り込みだけ。

## 原則

- **状態は保存しない。** 次に何をするかは毎回 `cycle status` / `next` から導く。子の session-id も
  記録しない。監督のセッションが落ちたら、子を新しく起動し直せば、子が `step next` で progress.jsonl から続きを導く
- **子の報告をそのまま信じない。** 「検証の義務」を必ず行う
- **デフォルトブランチにはマージしない。** サイクルの統合ブランチ（conductor ブランチ）を1本切り、
  各フェーズのブランチはそこから切って PR もそこへ向ける。子の PR を conductor ブランチに取り込むのは
  監督、conductor ブランチをデフォルトブランチへマージするのはユーザー
- **委任の範囲を固定する。** Step 0 でユーザーと合意したときの `digest` を、以後のすべての
  `conductor launch` / `parse` に `--expect-digest` で渡す。子が `.hikyaku.config` を書き換えて
  権限や振り分けが変わっていれば、CLI がエラーで止まる。そのときはユーザーに上げる
- **子の自由文から問いを推測しない。** 判断の起点は常に `conductor parse` の結果
- **子の手順の位置は `conductor parse` の `step` で読む。** 子が最後に進めた作業単位の次の1手
  （`step next` と同じ判定）が入る。progress.jsonl を自分で読んで位置を判断しない
- **逐次実行。** `next` が複数のビルドを返しても1件ずつ進める
- **走りきる。** ユーザーに上げる問いは、その場で尋ねずに子に記録させ（`--escalate`）、それに依存しない
  ビルドを先に進める。待っている問いは、着手できるビルドが無くなったときにまとめて尋ねる。待ちは
  `conductor waiting` が記録から導く（保存しない）。障害（error）・2回目の violation・stepProblems・
  `check-pr` の不合格は、従来どおりその場でユーザーに上げる
- **監督は安全側にだけ倒す。** 監督の答えは `conductor launch --from supervisor` で渡し、CLI が
  安全側の値（`ask.safe`）・リスクの申告・上限を検査する。拒まれたら答えずにユーザーに上げる

## 作業ステップ

### Step 0: 前提の確認と委任の合意

- [ ] 設定と対象サイクルを解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --require-cycle --json
```

- 未初期化（`.hikyaku.config` が無い等）なら、`/hikyaku:init` を先に実行するよう伝えて**終了**する
- サイクルを決められなければ、進行中サイクルの一覧を示してユーザーに尋ねる

- [ ] サイクルの状態を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" cycle status {cycle} --json
```

| `phase` | 対応 |
|---|---|
| `planning` | `/hikyaku:planner {cycle}` を先に実行するよう伝えて**終了**する。要件のすり合わせはユーザーが対話で行う |
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
    （既定はファイル操作と Hikyaku CLI の実行などだけで、`git`・`gh`・`npm test` / `node --test` は含まない）
  - 許可されていなければ、下の確認に「テストのコマンドは auto モードの安全判定にかかり、止められると builder は
    ローカル検証で blocked になる。判定を通さずに許可するなら `[conductor] allowed_tools` に足してコミットする」と添える

- [ ] **ユーザーに1回だけ確認する**（`AskUserQuestion`）。次を示し、進めてよいかを尋ねる

```
サイクル {cycle}（profile: {profile}）を {ARCHITECT / BUILD / CLOSE} から進めます。
planning/user-stories.md を承認済みの要件として扱います。
監督が判断する問い: {asks の出力}
ユーザーに上げる問い: {asks の出力（同意ゲートを含む）}、回によって同意になるゲート（consentWhen）、およびスコープを広げる回答が要る問い
子のモデル: {asks の出力の models。null は「既定」と書く}
フェーズの PR のレビュアーと、待つ上限: {asks の出力の review}
最後の PR のレビュアー: {asks の出力の review.finalReviewers}
問いの扱い: {asks の出力の queueing}
事後同意: {asks の出力の deferredConsent。有効 / 無効（reason） / 選んでいない}
  （有効なら: 上限を超える受け入れは各フェーズで止めず、最後のビルドの同意ゲートで一覧にしてユーザーに尋ねます）
各フェーズの PR は conductor ブランチ（{conductor}）に向け、監督が取り込みます。
デフォルトブランチにはマージしません。最後のビルドが終わったら、{conductor} → デフォルトブランチの
PR を作って止まります。
```

同意ゲートは監督に委任しない。子がそこで止まったら、ユーザーに上げる。断られたら**終了**する。
想定と違う振り分けを望まれたら、`.hikyaku.config` の `[conductor] escalate` / `delegate` を案内する。

→ Step 1 へ。

### Step 1: 次の作業を決める

- [ ] `cycle status {cycle} --json` を実行し、次の表で決める

| 状態 | 次の作業 |
|---|---|
| `architecting` | Step 2 → Step 3（`architect`） |
| `building` かつ `returned` あり | 差し戻されたビルドのブランチのまま Step 3（`architect {cycle} build-NN`） |
| `building` | 下記で着手するビルドを決めて Step 2 → Step 3（`builder {cycle} {NN}`） |
| `completed` | `conductor waiting` に `close` の問いがあれば「待っている問いを尋ねる」へ。無ければ Step 2 → Step 3（`close-cycle`） |
| `closed` | Step 5 へ |

状態は **conductor ブランチの上で**見る（途中のビルドを再開するときは、そのビルドのブランチの上）。
デフォルトブランチの上では、取り込み済みの成果物が見えない。

`building` のときは、次の順に決める。待っているビルドは `next --json` の `waiting.builds` にある
（`architecting` のときも、`waiting.items` に architect の問いがあれば、下の「待っている問いを尋ねる」へ）。

- `cycle status` の `resumeAt` が `build-NN/…` を指し、そのビルドが `waiting.builds` に**無ければ**、途中で
  止まったそのビルドを再開する（待っているビルドは再開に選ばない）
- そうでなければ `next` を実行し、`available` のうち `waiting.builds` に無い、**番号が最も小さい1件**を選ぶ

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" next {cycle} --json
```

- 選べるビルドが無く、`waiting.items` が空でなければ、下の「待っている問いを尋ねる」へ
- 選べるビルドが無く、`tasklist read {cycle}` で全ビルドが完了なら Step 4 へ
- それ以外（依存が満たされず進めない）は、`next` の出力を示してユーザーに上げる

#### 待っている問いを尋ねる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor waiting {cycle} --json
```

- [ ] `items` の問いを、`AskUserQuestion` でまとめて尋ねる。各問いの本文・選択肢・推奨は、問いを出した
  子の記録先（builder なら `build-NN/questions.md`、architect なら `design/design-questions.md`。`source` の
  ブランチの上にある）から読み、要約せずに示す
  - `ask` が `deferred-consent` の待ち（最後のビルドの同意ゲート）は、そのビルドのブランチで次の出力を要約せずに示し、
    **項目ごとに**ユーザーの決定（同意 / 退ける など）を受け取る。高として扱う異議には、ユーザーが受け入れると書いた言葉も受け取る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger consent-list build-NN {cycle} --all --full
```

  （`--all` は、最後のビルドの子の同意ゲートと同じくサイクル全体の項目を並べるため）
- [ ] 答えごとに、待っている作業単位のブランチ（`source` の `origin/` を除いたもの。`build-NN`、ARCHITECT なら `architect`、
  差し戻しの再設計ならそのビルドのブランチ、CLOSE なら `close`）へ conductor ブランチを
  取り込む（`git switch {ブランチ}`・`git merge {conductor}`・push）。取り込みで衝突したら、ユーザーに上げる
- [ ] 答えをスクラッチパッドのファイルに `回答（ユーザーの判断）: …` の形で書き、`--from user --closes {待ちの ID}` で
  子を再開する。session-id が会話に無ければ（監督が落ちた後など）、`--resume` を外して新しく起動する
  （`--from` を添えれば初回の起動でも `--message` を渡せる）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor launch {phase} {cycle} [{build}] \
  [--resume {sessionId}] --message {回答ファイル} --from user --closes {ID,...} --expect-digest {digest} --json
```

  - 1件ずつ再開し、結果を Step 3 の解析から処理する（逐次実行は保つ）。`--closes` に渡せるのは、作業ツリーの
    記録にある未決の待ちの事項と、再開する子の同意ゲートの項目だけ（取り込み前のブランチで再開すると拒まれる）
  - `deferred-consent` の待ちは、`--closes` に待ちの ID と同意の項目の ID をすべて渡す。回答ファイルには項目ごとの
    ユーザーの決定を、ID を添えて書く（子が項目ごとに `ledger decide --by user` で記録する）
  - 答えを渡し終えたら Step 1 へ

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
  - 起動が許可ルールで拒否されたら、`Bash(claude -p:*)` を許可するようユーザーに案内して止まる
- [ ] 完了したら結果を解析する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor parse {resultFile} {cycle} --expect-digest {digest} \
  [--expect-answer {answerToken}] --json
```

監督の答え（`--from supervisor`）で再開した子の結果は、そのときの launch の `answerToken` を `--expect-answer` に
渡して読む。子が監督の答えを記録せずに進めていれば、`stepProblems` に入る。

`outcome` で分岐する。その前に `stepProblems` を見る。

- **`stepProblems` が空でなければ、`outcome` で分岐しない。** 子のブロックと手順の位置が食い違っている
  （done なのに手順が終わっていない、G8 で止まったのに手順がそのゲートに居ない、など）。violation と
  同じく、1回目は同じ session-id で `--notice` で再開し、「`step next` で現在地を確かめ、返った1手から続けてください。
  {stepProblems の内容}」とだけ伝える。ただし `--expect-answer` の食い違い（監督の答えの記録が無い）の1回目は、
  同じ答え（`--from supervisor --ask --choice` と申告）で再開し直し、次の parse には新しい `answerToken` を渡す。
  2回目も食い違えば、`stepProblems` と `body` を示してユーザーに上げる

#### gate

`ask.handler` で分岐する。

- **`supervisor`**: 「問いへの答え方」に従って判断する。ただし、そこに書いたユーザーに上げる条件に
  当たれば `user` と同じに扱う。ゲート（`step.kind` が `gate`）なら、承認の観点と読む成果物は `step.read` の
  指示ファイルにある（成果物のパスは `step.directory` から辿る）。答えの値は `ask.safe.safe` から選ぶ（迷ったら
  `ask.safe.default`）。`ask.declaresRisk` の問いで受け入れうる答え（questions、review-findings の `proceed`）には、
  受け入れるリスクの申告（`--harm 高|中 --premises <ref,...>`、無ければ `--no-risk`）を添える
- **`user`**: `AskUserQuestion` を出さず、子に問いを記録させる。同意ゲート（`ask.category` が `consent`）も
  こちらに固定され、監督は答えない

```bash
# supervisor: 監督の答え（拒まれたら答えずに、下の user の手順でユーザーに上げる）
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor launch {phase} {cycle} [{build}] \
  --resume {sessionId} --message {回答ファイル} --from supervisor --ask {id} [--choice {値}] \
  [--harm 高|中 --premises {ref,...} | --no-risk] --expect-digest {digest} --json

# user: 子に問いを記録させ、答えを待つ blocked で終えさせる
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor launch {phase} {cycle} [{build}] \
  --resume {sessionId} --escalate --ask {id} --expect-digest {digest} --json
```

launch が `--from supervisor` を拒んだら（ユーザーが答える問い、安全側でない値、申告の無い受け入れ、上限を
超える申告）、答えを変えて通そうとせず、`--escalate` でユーザーに上げる。

上限を超える申告でも、事後同意が有効で、子に同意ゲートの置き場があり（PR を作る前の architect・最後以外のビルドの
子と、同意ゲートの手前の最後のビルドの子。差し戻しの回は除く）、前提が宣言の参照だけなら、launch は受け付ける。子は答えを記録するときに、その
受け入れを risk の事項として積み（スクリプトが書く）、最後のビルドの同意ゲートでユーザーが決める。監督が答えを
軽くして通すための経路ではないので、上限を超えるかどうかで答えを変えない。

回答ファイルの書式（監督が判断した場合）:

```
回答（委任された判断）: {回答。選択肢があればどれを選んだか}
根拠: {どの成果物の、どの記述に基づくか}
```

子は「委任された判断」を非対話規約に従って記録する。ユーザーの答えは「待っている問いを尋ねる」で渡す。

→ 再開した子の結果を、また Step 3 の解析から処理する。

#### done

`stepProblems` が空なら、子の手順は `step` の作業単位で終わっている（`step.kind` が `done`）。

- [ ] 「検証の義務」のうち、そのフェーズの done に当たるものを行う
- [ ] 問題があればユーザーに上げる（自分で直さない）
- [ ] 子の architect / builder の PR を取り込む前に、監督として公開する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr ready {architect|build-NN} {cycle} --pr {PR} --for-merge
```

  失敗したら取り込まず、エラーをユーザーに示して止まる。公開後の `check-pr` で Draft に戻っていたら、
  再び Ready にせず、その検証結果をユーザーに上げる。
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
    ユーザーに示して上げる。**監督は指摘に自分で対応せず、子を再開して直させることもしない**。ユーザーが対応するか、
    同意して resolve したら、`check-pr` をやり直す
  - Draft・承認の不足・CI の失敗・マージ先の食い違い・待機の上限超過も、取り込まずに `problems` を示して
    ユーザーに上げる（`gh pr ready` で Draft を外したり、依頼を取り下げたりしない）。ユーザーが対応したら
    `check-pr` をやり直す
  - **終了コード 1**（`gh` の応答に必須のフィールドが無い、型が違う、取得できないなど、状態を判定できなかった）
    も、取り込まない。判定できなかった PR を、CI なし・依頼なし・Ready として合格させない。エラーの内容を
    ユーザーに示して上げる
  - `none`（CI が1つも無い）は失敗にならない。PR を作った直後にチェックがまだ登録されていない場合は、
    `--wait` が最初の少しのあいだ待ってから判定するので、再実行は要らない。`none` で通ったら、最後の PR の
    本文に「フェーズの PR に CI が走っていなかった」と書く
  - 結果の `headSha` は、検証した PR の head のコミット。取り込みにはブランチ名ではなくこれを使う

- [ ] 検証を通った PR を conductor ブランチに取り込む

```bash
git fetch origin {フェーズのブランチ}
git rev-parse {フェーズのブランチ} origin/{フェーズのブランチ}
```

  - 2行とも `headSha` と一致することを確かめる。一致しなければ取り込まず、ユーザーに上げる。
    ローカルに push されていないコミットがある、または検証のあとに push されたコミットがあるので、
    検証していないコミットを取り込むことになる。`check-pr` をやり直すかはユーザーが決める

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
  - 取り込んだ PR の `check-pr` の結果（CI の状態）は、Step 4 の最後の PR の本文に、PR へのリンクと1行で残す
    （チェックの件数は PR から読めるので写さない）
  - 差し戻しの再設計（`architect {cycle} build-NN`）は PR を作らない。取り込まずに Step 1 へ
    （同じビルドのブランチで builder を起動し直す）
  - close-cycle の PR はデフォルトブランチへ向く。取り込まない
- → Step 1 へ

#### blocked

- [ ] `cycle status {cycle} --json` を実行する。`step` があれば、子がどこで止まったか（`step.kind` が `stop` なら
  `step.message`）もユーザーに上げるときに添える
- `waiting` があれば（答えを待つ blocked。`--escalate` で記録させた問い）、ユーザーに上げずに conductor ブランチへ
  切り替えて Step 1 へ（問いは「待っている問いを尋ねる」でまとめて尋ねる）
- `returned` があれば（builder からの差し戻し）→ Step 1 へ（architect が差し戻しを扱う）
- `handover` があれば（子が区切りの推奨に従ってセッションを切り替えた）、ユーザーに上げずに、同じビルドを
  **新しい session で**起動し直す（Step 3。`--resume` は付けない）。新しい子は `step next` で implement から続ける
- 本文が PR の作成の代行を頼んでいれば（子が `gh` で PR を作れなかった）、子が書いた `.tmp/hikyaku-pr-{phase}.md` を
  本文にして、子が push したブランチから PR を Draft で作る。作れたら同じ session-id で `--notice` で再開し、
  「PR を作りました: {URL}。この URL で pr の done を報告して続けてください」と伝える。作れなければユーザーに上げる
- それ以外は、`body` を示してユーザーに上げる。指示があればそれに従い、無ければ**終了**する

#### violation

規約どおりのブロックが無い。**子の自由文から問いや結果を推測しない。**

- 1回目: 同じ session-id で `--notice` で再開し、「非対話規約に従い、最後に gate / done / blocked のどれか1つを
  出力してください」と伝え、`reason` を添える（blocked の行き詰まりの報告が欠けていたときは、欠けた節が
  `reason` にある）
- 2回目も violation なら、`body`（出力の末尾）と `reason` を示してユーザーに上げる

#### error

予算超過や利用上限への到達などで子が異常終了した。`reason` と `costUsd` を示してユーザーに上げ、再開するかを尋ねる。
再開するなら、**同じ session-id で** `--resume` と `--notice` を付け、「中断したところから続けてください」とだけ伝える。
子は止まる直前の文脈を持っているので、新しい session で起動し直すより確実に続きから進む。
`--resume` 自体が失敗したときだけ、新しい session で起動し直す（子は `step next` で progress.jsonl から続きを導く）。

### Step 4: デフォルトブランチへの PR を作って止まる

最後のビルドを conductor ブランチに取り込んだら、CLOSE には進まない。close-cycle は全ビルドが
デフォルトブランチにマージされていることを前提にしている（未マージの実装を永続ドキュメントに
書くと、永続ドキュメントとサイクルドキュメントを分けた意味が無くなる）。

以下の PR 作成・更新では、ビルドが残した「確度: 要確認」の懸念があれば、handoff の該当節への
コミット固定リンクと要点を本文に反映し、完了の案内にも含める。懸念の全文は転記しない。

- [ ] **作る前に、同じ向き（conductor ブランチ → デフォルトブランチ）で開いている PR が既に無いかを確かめる**。
  監督が Step 4 の直後に落ちて再実行されると、状態導出は `building` のまま（デフォルトブランチにはまだ
  ビルドの完了の記録が入っていない）で、同じ Step 4 に戻ってくるため。PR が重複して作られたり、作成に
  失敗したりするのを防ぐ

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify conductor {cycle} --json   # baseBranch がデフォルトブランチ
gh pr list --head {conductor ブランチ} --base {baseBranch} --state open --json number,url
```

  - **見つかったら、PR を作らない。** 「最後の PR が既にあるとき」へ進む
  - 見つからなければ、次の手順で作る（閉じられた PR や、マージ済みの PR は対象にしない）
- [ ] conductor ブランチ → デフォルトブランチの PR を作る
  - タイトルは `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr title conductor {cycle}` で生成する
  - `gh pr create --draft` で作る。Draft に対応していない場合だけ通常の PR で作り、その旨を案内する
  - 本文に、取り込んだフェーズの PR を順に並べ、それぞれで子が解釈で決めた振る舞いを1行ずつ示す
    （ユーザーがレビューで確認するため）
  - `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger answers {cycle} --format pr` の出力（「監督が答えた問い」の節）を、
    本文にそのまま貼る。`--no-risk` で答えた問いの「リスクなしと申告」も、スクリプトが決定の記録から示す。監督は書き写さない
  - `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger pr-section <最後のビルド> {cycle} --all` の出力（全フェーズで
    受け入れたリスクと、同意・退けの決定と答えの出どころ）が空でなければ、本文にそのまま貼る。監督は書き写さない。
    ただし PR を作る前に `--json` の `undecided` を見て、空でなければ PR を作らずに、その ID を示してユーザーに上げる
    （最後のビルドの同意ゲートを通らなかった項目の安全網）
  - `node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" ledger premises --changed-from {baseBranch} --format pr` の出力が空でなければ、
    本文にそのまま貼る（conductor ブランチとベースブランチの差分で、サイクルで変えた宣言と、それを拠り所にした全フェーズの
    受け入れが出る。ユーザーが見直すのはこの PR。フェーズの PR は監督が取り込む）
  - 外部連携が有効なら、`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" external ref conductor {cycle}` の行
    （サイクルの issue への `Refs #12`）を本文の末尾に入れる。issue は CLOSE の PR で閉じる
- [ ] 設定に従って公開する（失敗したら、再実行のコマンドと Draft のままであることを案内する。出力の
  `applied` が `false` なら、gh でできなかったことと `manual` をユーザーに伝える）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr ready conductor {cycle} --pr {PR}
```
- [ ] この PR にレビュアーをアサインする（`[pr] reviewers` が空、または `[pr] reviewers_skip` に
  `conductor` があれば何もしない）。ユーザーがレビューする PR なので、待たない。出力の `applied` が `false` なら、
  `manual`（ユーザーが代わりに依頼するレビュアー）を伝える

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr request-reviewers conductor {cycle} --pr {PR の URL}
```
- [ ] PR の URL を示し、「マージしたら `/hikyaku:conductor {cycle}` を実行すると CLOSE から再開する」と
  案内して**終了**する

#### 最後の PR が既にあるとき

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr ready conductor {cycle} --pr {PR}
```

監督が落ちて再実行された場合と、最後の PR に付いた指摘へビルドを足して対応する場合に来る。

- [ ] 最後の PR の本文に無い、conductor ブランチに取り込んだフェーズの PR があれば（指摘を受けて足した
  architect とビルドの PR）、本文の一覧に追記する（`gh pr edit {PR} --body-file {ファイル}`）。
  レビュアーのアサイン（上の手順。依頼済みの相手には重ねて依頼しない）を行い、PR の URL を示して
  **終了**する
- [ ] 追記するものが無ければ、PR の URL を示し、最後の PR の指摘にビルドを足して対応するかをユーザーに
  尋ねる（`AskUserQuestion`）。対応しないなら、マージ後の再開を案内して**終了**する
- [ ] 対応するなら、対応する指摘をユーザーから受け取る（PR のコメントの URL と内容。監督は指摘を選ばない）。
  architect のブランチ（`branch verify architect {cycle}` の `expected`）が残っていれば、前回の追加設計が
  途中で止まっている。そのこともユーザーに示す
- [ ] 指摘をスクラッチパッドのファイルに書き、architect を指摘からの追加設計として起動する。ブランチは
  Step 2 の architect と同じく、conductor ブランチから用意する（残っていればそれに切り替える）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" conductor launch architect {cycle} add \
  --message {指摘のファイル} --expect-digest {digest} --json
```

  - 以後は Step 3 と同じ。architect の PR を検証して conductor ブランチに取り込み、Step 1 から
    追加したビルドを進める。最後のビルドを取り込むと、またこの節に来て本文に追記する
  - 再開（`--resume`）では、Step 3 と同じく回答のファイルを `--message` に渡し、`--from` か `--notice` を添える

### Step 5: 完了

close-cycle の子が done になったら、`cycle status` が `closed` であることを確認する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" pr ready close {cycle} --pr {CLOSE の PR}
```

失敗したら再実行のコマンドを示す（`applied` が `false` なら `manual` を示す）。CLOSE の PR と、子が別のブランチで作った PR（見積もりのガイドの
見直し・フックの提案）があれば併せて示して終了する。監督はどれも取り込まない。

## 問いへの答え方

監督が答えてよいのは、**issue と承認済みの成果物から導ける回答**と、**挙動を狭める回答**だけ。
スコープを広げる回答、issue や user-stories と矛盾する回答が必要なら、どの種別でもユーザーに上げる。
`（--choice …）` は launch に渡す値。監督が選べる値は `conductor parse` の `ask.safe.safe` が正で、それ以外は launch が拒む。

| id | 答え方 |
|---|---|
| `cycle` | 対象サイクル名を答える |
| `branch` | Step 2 で用意したブランチなら「Hikyaku の規則に従う」。食い違いの理由が分からなければユーザーに上げる |
| `build-select` | Step 1 で選んだビルドを答える |
| `overlap` | このサイクルの design-delta で分担を決められるなら答える。**他のサイクルの設計を変える必要があればユーザーに上げる** |
| `G3` | 推奨案が user-stories と `constraints` に反していなければ推奨案を選ぶ（`--choice recommended`）。反していれば差し戻す（`rejected`）。推奨以外の案（`other`）は選べない。同意の回は `handler` が `user` になり、答えない |
| `G2` / `G4` / `G7` | 成果物を読み、承認観点（スキルが示すもの）に沿って承認するか差し戻す（`approved` / `rejected`。G4 の同意の回は答えない） |
| `retrospective` | 実施する（`run`） |
| `docs-link` | `--dry-run` の差分がマーカーで囲まれた索引ブロックの中だけなら承認する（`approved`） |
| `G6` | 分割・依存が design-delta と矛盾せず、各ビルドの予測ピークが見積もりの上限（`estimateLimit`）以下（超えるなら issue.md に許容する理由がある）なら承認する（`approved`）。「マージ時点で残る危険」を書いたビルドがあれば、`node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json` の `unsafeSplit.allowed` が true であることも確かめる |
| `G8` | 「検証の義務」の G8 を行い、満たしていれば承認する（`approved`） |
| `questions` | 成果物から導けるものだけ答える（`--choice` なし。リスクの申告が要る）。導けないものはユーザーに上げる |
| `adr-status` | 既存の形式に欄を足さない（挙動を狭める側） |
| `design-conflict` | 「architect に差し戻す」を選ぶ（`return`）。設計に合わせて要件を改める（`conform`）・ビルドの中で設計を改める（`adjust`）は選べず、必要ならユーザーに上げる |
| `unsafe-split` | 「上限を超えたまま1ビルドにまとめる」を選ぶ（`merge`。データ安全を保つ側）。**安全でない分割（`unsafe`）や設計に戻る（`redesign`）が必要ならユーザーに上げる** |
| `review-findings` | 明確なバグ・規約違反は「今修正する」（`fix`）。スコープ外は「新ビルド化」（`new-build`）。「そのまま進める」（`proceed`）は確度の低い懸念だけで、リスクの申告が要る |

## 検証の義務

| 時点 | 行うこと |
|---|---|
| G8 の前 | plan.md と test-spec.md が、issue.md の受け入れ基準をすべて網羅しているかを読む |
| builder の done の後 | テストを自分で再実行する。差分（`git diff {conductor}...HEAD --stat` と主要ファイル）が plan.md の範囲に収まっているかを読む |

テストのコマンドは handoff.md / plan.md から引く。再実行に許可が要ればユーザーに案内する。

## ユーザーに上げるとき

子の問いは `--escalate` で記録させて積み、「待っている問いを尋ねる」でまとめて尋ねる。障害（error）・
2回目の violation・stepProblems・`check-pr` の不合格・設定の変化（digest の食い違い）は、その場で尋ねる。
どちらも `AskUserQuestion` で、次を含めて尋ねる。

- どのフェーズの、どの問いか（`id` と種別）
- 子の問いの本文（要約しない）
- 監督が自分で答えなかった理由（launch が拒んだならその理由）
- 選択肢（子が示したもの）

ユーザーの回答は「回答（ユーザーの判断）」として `--from user` で子に渡す。ユーザーが「監督に任せる」と
答えても、監督は判断しない。ユーザーが答える問いへの `--from supervisor` は launch が拒むので、ユーザーに答えを求める。
