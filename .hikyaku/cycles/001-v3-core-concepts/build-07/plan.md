# Build 07: conductor の走りきりと、監督は安全側にだけ倒すこと

設計は design-delta の 1節（監督の答えは安全側だけ・答えの出どころ）・3節（conductor の項）・4節、ADR conductor-runs-to-end・deferred-consent・pending-items-ledger。ここでは、そこから具体化した点と、このビルドの範囲だけを書く。

## 依存パッケージ

なし（実行時依存ゼロのまま）

## クラス設計

### 安全側の既定（`scripts/lib/conductor.mts`）

issue.md の「監督が答えてよい問いの directive」は、監督が受け取る1手（`conductor parse` の `ask`）と読む。子の `step next` の directive には載せない（子は監督の答えを選ばないので、子に示すと読む量が増えるだけ）。

```ts
/** 監督が答えてよい問いの、答えの値の表。safe に無い値を監督が渡すと launch が拒む */
export interface SafeAnswer {
  /** 答えの値と、その意味（監督とユーザーに示す） */
  choices: Record<string, string>;
  /** 監督が選んでよい値（安全側） */
  safe: string[];
  /** スクリプトが決めた既定（推奨案・安全な分割・差し戻し） */
  default: string;
}
export const SAFE_ANSWERS: Record<string, SafeAnswer>
export function safeAnswerOf(id: string): SafeAnswer | undefined
```

- 確認ゲート（G2・G4・G6・G7・G8・G10・docs-link）: `approved` / `rejected`。両方 safe（確認は監督に委ねた範囲。同意の回は handler が user になり、そもそも監督は答えない）。既定は `rejected`（差し戻すほうが受け入れが増えない）
- G3: `recommended`（推奨案）/ `other`（推奨以外の案）/ `rejected`。safe は `recommended`・`rejected`。既定は `recommended`
- retrospective: `run` / `skip`。safe は `run`
- design-conflict: `return`（architect に差し戻す）/ `conform`（設計に合わせて要件を改める）/ `adjust`（ビルドの中で設計を改める）。safe は `return`
- unsafe-split: `merge`（上限を超えたまま1ビルドにまとめる）/ `redesign`（設計に戻る）/ `unsafe`（安全でない分割）。safe は `merge`
- review-findings: `fix`（今修正する）/ `new-build`（新ビルド化）/ `proceed`（そのまま進める）。safe は3つとも。ただし `proceed` はリスクの申告（下の `--harm` か `--no-risk`）が必須
- 表に無い問い（questions・route の問いなど、自由文で答えるもの）は `--choice` を求めない。questions はリスクの申告（`--harm` か `--no-risk`）が必須
- `ResolvedAsk` に `safe: SafeAnswer | null` と `declaresRisk: boolean`（リスクの申告が要る問い）を足す（`resolveAsk` が埋める）。`conductor parse` と `conductor asks` の JSON に出る
- **（解釈）** 受け入れ基準1・design-delta 1節の「安全側の既定以外の答えを拒否」は、「`safe` の集合に無い答えを拒否」と読む。確認ゲートの承認（`approved`）は確認として監督に委ねた範囲で、差し戻し（`rejected`）は受け入れを増やさない側なので、どちらも安全側に入れる。既定（`default`）は、監督が判断に迷ったときに選ぶ値として示すだけ。test-spec で「（解釈）」の印を付け、G8 で示す

### 答えの出どころと launch の検査（`scripts/commands/conductor.mts`）

`conductor launch` に次を足す。

- `--from user|supervisor` — 回答を渡す再開（`--message`）に必須。子のコマンドの前に `HIKYAKU_ANSWER_FROM=<値>` を置く。回答の無い起動（初回・`--escalate`）は `HIKYAKU_ANSWER_FROM` を置かない
- `--ask <id>` — `--from supervisor` と `--escalate` に必須（`--from user` では任意）
- `--choice <値>` — `--from supervisor` で、`--ask` の問いに `SAFE_ANSWERS` があれば必須
- `--harm 高|中` と `--premises <ref,...>` / `--no-risk` — `--from supervisor` の答えが受け入れるリスクの申告。`declaresRisk` の問い（questions・review-findings の `proceed`）では、どちらかが無ければ拒む（付け忘れで上げる向きと逆に倒れないため）。ほかの問いでは任意
- `--escalate` — ユーザーに上げる問いを記録させる固定文で子を再開する（`--message` を取らない）
- `--closes <ID,...>` — `--from user` で、ユーザーの答えで閉じる待ちの事項。子への回答の先頭に、その ID に `ledger decide <unit> <ID> --decision decided --by user --input "<ユーザーの答え>"` を記録する固定文を足す（新しく起動して子が ID を知らないときも閉じられる）

`--from supervisor` の検査（`checkSupervisorAnswer`。拒むときは `HikyakuError` で、ユーザーに上げる案内を添える）:

1. `resolveAsk(id, …, approval)` の handler が user なら拒む。approval は、`--resume` の session-id から `locateSession` で子の手順の位置を引き（`childStep` と同じく `asConductorChild` で評価）、gate がその問いで止まっていればその回の approval。回によって同意になるゲート（`CONSENT_WHEN`）で位置を確かめられなければ consent に倒す（parse と同じ）
2. `SAFE_ANSWERS` があり、`--choice` が無い・choices に無い・safe に無い なら拒む
3. `declaresRisk` の問いで `--harm` も `--no-risk` も無ければ拒む
4. `--harm` があれば `exceedsCeilingFor(effectiveDeclaration(config), harm, premises)`（build-18）で上限と比べる。超えるなら、事後同意の有無に関わらず拒む（US-15.2。ユーザーに上げる）。事後同意が有効なときに子へ risk の事項を積ませて受け付ける分岐は build-19（子の事後同意の有効化と同じビルドで入れ、監督と子の判定を割らない。G6 の分割）

`--escalate` の固定文（`escalateMessage(unit, cycle, ask)`）: 問いを `ledger open {unit} {cycle} --type question --who user --when now --ask <id> --summary "<問いの本文>"` で記録し、コミット・push して、本文に `waiting: <記録した ID>` の行を置いた blocked で終える。`{unit}` は builder なら `build-NN`、architect なら `architect`、close-cycle なら `close`。

回答の無い初回の起動に `--message` を渡せるのは、従来どおり architect の add と、新たに `--from` を添えたとき（session-id が会話に無く、答えを新しい起動で渡す。ADR conductor-runs-to-end）。

### `ledger decide` の検査（`scripts/commands/ledger.mts`）

```ts
/** conductor の子で、ユーザーの決定を書いてよいか。だめなら理由（US-19.7） */
export function answerSourceProblem(by: Who, env?: NodeJS.ProcessEnv): string | undefined
export function answerSource(env?: NodeJS.ProcessEnv): string | undefined // HIKYAKU_ANSWER_FROM の値
```

- `HIKYAKU_CONDUCTOR_CHILD=1` で `--by user` かつ `HIKYAKU_ANSWER_FROM !== "user"` なら拒む（`--dry-run` でも）。`ledger object` の決定つきの記録（`--defer` でない）も同じ
- `HIKYAKU_ANSWER_FROM` があれば、`DecideRecord.from` に残す（`ledger decide` と `ledger object`）
- 置き場は `scripts/lib/ledger.mts`（commands と tests から使う）
- 子が環境変数を自分で付ける偽装は防がない（ADR pending-items-ledger で受け入れ済み）

### 答えを待つ blocked（`scripts/lib/conductor.mts`）

```ts
export interface ParseOptions {
  /** 本文の waiting: <id> が、実在する未決のユーザーの事項か */
  isWaitingItem?: (id: string) => boolean;
}
export function parseFinalText(text: string, options?: ParseOptions): …
export function parseResultJson(raw: string, options?: ParseOptions): ParsedResult
```

- `ParsedResult.waiting?: string[]`。blocked の本文の行頭 `waiting: <id>` を集め、`isWaitingItem` がすべて true なら行き詰まりの報告の検査（`checkEscalation`）を外し、outcome は `blocked` のまま `waiting` を返す。1つでも指す先が無ければ従来どおり検査する（欠ければ violation）
- `conductor parse` は `isWaitingItem` に「サイクルの記録（作業ツリー）に、その ID の `question`・`who=user`・`when=now` の事項があり、決定が無い」を渡す
- ADR escalation-report-check は「conductor の blocked はすべて検査する」と決めており、build-09 の handoff も同じ前提。答えを待つ blocked は、問いを ID で記録に裏取りできる（行き詰まりではなく、ユーザーの答えを待つだけ）ので外す。issue.md・design-delta 4節・ADR conductor-runs-to-end が定めた変更で、ADR escalation-report-check の再評価条件（検査する経路が増減したとき）に当たる。ADR の補足を handoff の「永続化すること」に残す（close-cycle が反映）

### 待っている問いとビルド（`scripts/lib/waiting.mts`・新規）

```ts
export interface WaitingItem { id: string; unit: string; summary: string; ask: string | null; source: string /* "worktree" | origin/<branch> */ }
export interface WaitingBuild { id: string; waitingFor: string[] }
export interface Waiting { items: WaitingItem[]; builds: WaitingBuild[]; unavailable: string[] }
export async function deriveWaiting(config: ResolvedConfig, cycle: CycleContext, builds: BuildRecord[]): Promise<Waiting>
```

- 読む記録: 作業ツリーのサイクルの全 `decisions.jsonl` と、architect と tasklist の各ビルドの origin のブランチ（`branchName(config.branch, phase, cycle)`）にある、その作業単位の `decisions.jsonl`（`readFileAtRef`）。ブランチが無ければ読まない
- open を ID で重ね（同じ ID は1つ）、どの断面にも decide の無い `question`・`who=user`・`when=now` の事項を待ちとする
- 待つビルド: 事項の単位が `build-NN` ならそのビルドと、依存グラフ（`dependsOn`）で推移的に依存するビルド。`architect`（`plan`・`create` も）なら全ビルド。`close` は対象外（ビルドは無い）
- 読めない断面は `unavailable` に理由を入れ、判定を止めない（待ちが見えないだけで、`next` の着手可否は変わらない）
- 状態は保存しない

`hikyaku conductor waiting [<cycle>] [--json]` を足し、`next --json` に `waiting`（`{ items, builds }`）を足す。`next` のテキストは、待ちがあれば「答えを待っているビルド」の節を足す。

### `conductor asks`（このビルドの分）

- JSON に `queueing`（問いを積む方針の1行）。テキストに「ユーザーに上げる問いは記録に積み、依存しないビルドを先に進める」の1行。`deferredConsent` は build-19

### 手順・docs

- `skills/conductor/SKILL.md`:
  - Step 0: 確認文に、問いを積む方針の行を足す（事後同意の行は build-19）。「同意ゲートは監督に委任しない」の文面は残す
  - Step 1: 状態は conductor ブランチの上で見る。`resumeAt` が待っているビルド（`conductor waiting` の `builds`）を指していれば、再開に選ばない。`available` が空になったら `conductor waiting` を実行し、待っている問いがあれば `AskUserQuestion` でまとめて尋ねる（`deferred-consent` の待ちの示し方は build-19）。答えごとに、待っているビルドのブランチ（ARCHITECT なら architect のブランチ）へ conductor ブランチを取り込んでから（`git merge`・push）、`--from user --closes <待ちの ID>` で子を再開する（session-id が会話に無ければ新しく起動して `--message` で渡す）。逐次実行は保つ
  - Step 3 gate: `handler: user` は `AskUserQuestion` を出さず、`conductor launch --resume … --escalate --ask <id>` で子に記録させる。`supervisor` は `ask.safe` から選び、`--from supervisor --ask <id> --choice <値>`（`declaresRisk` なら `--harm … --premises …` か `--no-risk`）で再開する。launch が拒んだらユーザーに上げる側（`--escalate`）へ
  - Step 3 blocked: `waiting` があれば待ちとして、conductor ブランチに切り替えてから Step 1 へ（ユーザーに上げない）
  - 「人間に上げるとき」: ユーザーが「監督に任せる」と答えたら監督が判断する経路を消す。handler が user の問いを監督が答える経路は launch が拒むので（US-15.3・US-21.4）、ユーザーに答えを求める
  - error・2回目の violation・check-pr の不合格は従来どおりその場でユーザーに上げる
  - 「問いへの答え方」の表に `--choice` の値を添える
  - Step 4 の最後の PR の本文の「監督が答えた確認ゲート」の一覧に、`--no-risk`（リスクなしと申告した答え）で答えた問いを1行ずつ並べる（LLM の申告で上限の検査を外した答えを、ユーザーが後から見つけられるようにする）。launch の JSON に `riskDeclaration`（`none` か、害と前提）を出す
- `skills/conductor/references/headless-protocol.md`: ユーザーに上げる問いの記録と `waiting:` の blocked、`HIKYAKU_ANSWER_FROM` と `--by user`（最後のビルドの同意ゲートは build-19）
- `docs/workflow/conductor.md`・`docs/reference/cli.md`（いつ・なぜだけ）、CHANGELOG の `[3.0.0]`

## 実装ステップ

1. `SAFE_ANSWERS`・`resolveAsk` の `safe`・`parseFinalText` の waiting（lib/conductor.mts）
2. `answerSourceProblem` / `answerSource`（ledger.mts）、`ledger decide` / `object` の検査と `from`
3. launch の `--from` / `--ask` / `--choice` / `--harm` / `--premises` / `--no-risk` / `--escalate` / `--closes`、parse の waiting、asks の `queueing`
4. waiting.mts と `conductor waiting`・`next --json` の `waiting`
5. テスト（`tests/conductor.test.mts`・`tests/ledger.test.mts` に追加）
6. SKILL.md・headless-protocol.md・docs・CHANGELOG

## 非機能要件

- **マージ時点のデータ安全**: 本番データは無い（ワークフローの CLI とスキル）。ワークスペースのデータは、`decisions.jsonl` の decide に任意欄 `from` を足すだけで、既存の記録はそのまま読める。conductor の子の挙動が変わるのは、このビルドの後に起動した子だけ
- **安全側**: 監督が答えてよい範囲は狭める方向にだけ変える（handler が user の問いと safe に無い値は拒む）。位置を確かめられない回は同意に倒す（parse と同じ）
- **状態を保存しない**: 待ちは作業ツリーと origin のブランチから毎回導く。session-id は保存しない
- **互換**: `conductor launch` の `--resume --message` は `--from` が必須になる（監督の手順と同じ PR で直す）
- **build-19 より前のマージ時点**: conductor の子は従来どおり同意ゲートを置かず、決定の無い同意の項目は pr の `accepts` で止まってユーザーに上がる。上限を超える監督の申告は、事後同意の有無に関わらず拒否する（監督と子の判定が割れない）
- **受け入れたこと（G8 で示す）**: `HIKYAKU_ANSWER_FROM=user` は、ユーザーの答えで再開した子のプロセス全体に効く。その実行の中で、ユーザーが答えていない事項にも `--by user` を書ける。検査は取り違え（監督の答えをユーザーの答えとして記録する）を防ぐもので、子の振る舞いの偽装は防がない（ADR pending-items-ledger）。答えた事項に限るには、launch が `--closes` の ID を環境変数で渡し `ledger decide` が照合する形があるが、同意ゲートでは一覧の項目ごとに決定を書くので ID の列挙が増える。このビルドでは足さない案とし、受け入れるかはユーザーが決める（受け入れたリスクはユーザーが持つもの。原則 9・11）。G8 の提示で「ユーザーが決める受け入れ」として示し、監督に判断を求めない（conductor では監督がユーザーに上げる）。ユーザーが受け入れなければ、`--closes` の ID を環境変数で渡して `ledger decide --by user` が照合する形をこのビルドに足す

## 予測ピーク

G6 で build-19 を分けた後の見積もり（issue.md の 420k と同じ成分）。

読むファイル: `skills/conductor/SKILL.md`・`references/headless-protocol.md`、`scripts/lib/conductor.mts`・`scripts/commands/conductor.mts`、`scripts/commands/next.mts`、`scripts/lib/ledger.mts`・`scripts/commands/ledger.mts`（該当部分）、`scripts/lib/tasklist.mts`・`risk.mts`・`escalation.mts`・`branch.mts`・`git.mts`・`steps/locate.mts`・`steps/engine.mts`（該当部分）、build-06・09・16・17・18 の handoff、`docs/workflow/conductor.md`・`docs/reference/cli.md`、`tests/conductor.test.mts`・`tests/ledger.test.mts`（該当部分）
作成・変更するファイル: 上記の lib・commands・手順・docs、`scripts/lib/waiting.mts`（新規）、`tests/conductor.test.mts`・`tests/ledger.test.mts`、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 160k | 読んだもの（約 110k）: conductor の lib・commands・SKILL.md・headless-protocol、next、ledger と commands/ledger の該当部分、consent・directive・builder steps、deferred-consent・git の一部、handoff 5件と ADR。残り（約 50k）: tasklist・risk・escalation・locate・engine・branch の該当部分、docs/workflow/conductor.md・docs/reference/cli.md、tests/conductor.test.mts・tests/ledger.test.mts の該当部分 |
| 実装 | 80k | lib/conductor.mts（SAFE_ANSWERS・waiting の解析 約120行）、commands/conductor.mts（launch の検査・--escalate/--closes・waiting コマンド 約180行）、waiting.mts 新規（約150行）、ledger の出どころの検査と from（約40行）、next（約30行）、SKILL.md Step 0/1/3・headless-protocol・docs・CHANGELOG（約150行） |
| テスト | 50k | conductor.test.mts（launch の拒否・リスクの申告・--escalate・waiting の blocked・waiting の導出・`next --json` の available と waiting）、ledger.test.mts（出どころの検査と from） |
| 未知の領域 | 40k | 子の再開と取り込みの手順、既存の conductor の結合テストの調整（--from 必須化）、origin のブランチを使う waiting の結合テストの準備 |
| **予測ピーク** | **420k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 付録: build-19 へ移した設計（このビルドでは実装しない）

G6 で分割する前の plan.md の節を、build-19 の issue.md が指す下書きとしてそのまま残す。plan-review の指摘（close-cycle の子の扱い・resumed の扱い）を反映済み。

### 最後のビルドの同意ゲート（`scripts/lib/steps/consent.mts`・`scripts/lib/ledger.mts`）

```ts
// ledger.mts
/** サイクル全体の同意の対象（who=user・when=merge@<どこでも> の risk・objection） */
export function cycleConsentItems(ledger: Ledger): LedgerItem[]
// consent.mts
/** 作業ツリーの tasklist で、このビルド以外の全ビルドの PR 列が埋まっているか */
export function isLastBuild(ctx: Pick<StepContext, "cycle" | "unit">): boolean
/**
 * conductor の子の同意の扱い: "last"（最後のビルドの子。サイクル全体）| "deferred"（architect・最後以外のビルドの子。最後のビルドへ回す）
 * | "none"（子でない、または close-cycle など architect・ビルド以外の子。従来どおり pr の accepts で止める）
 */
export function conductorConsentMode(ctx): "last" | "deferred" | "none"
/** 同意ゲート・pr の accepts・consent-list・pr-section が使う対象（"last" ならサイクル全体） */
export function consentTargets(ledger: Ledger, ctx): LedgerItem[]
```

- `consentStep` の slot: `!isConductorChild()` を `conductorConsentMode(ctx) !== "deferred"` に変える（子なら最後のビルドだけゲートを置く）。architect の子は常に deferred（ビルドではない）
- `hasConsentItems`: "last" なら `cycleConsentItems(readLedger(cycle))` が空でないか（positionOnly なら true。読めなければ true）
- `consentProblem`: "deferred" なら決定の無い項目では止めない（最後のビルドの同意ゲートへ回す）。退けの作り直しの検査はそのまま。"last" なら対象をサイクル全体にする。案内の文面の「conductor の子では同意ゲートが手順に入りません」を消し、ゲートの手順へ案内する
- `consentStep` の args・reopens も `consentTargets` を使う（"last" の reopens はサイクル全体を読む。読めなければ取り直す）
- close-cycle の子は "none"。最後のビルドの同意ゲートを過ぎたあとなので、遅らせる先が無い。pr の `accepts` は従来どおり決定の無い項目で止め、案内は「PR を完了にせず、blocked でユーザーに上げる」のまま（テストで確かめる）
- 退けた項目の扱い（build-17 の handoff の問い。最後のビルドの子）:
  - 同じ作業単位の作り直し（`args.reworkFrom`）は子の中で完結する（戻り先を作り直して done で報告し直す。ユーザーへの問いは要らない）
  - 前のフェーズの項目（`returns`）は build-17 の return.md の経路で最後のビルドから差し戻し、差し戻しの blocked で終える。コードは変えない
  - 差し戻しの再設計を経て再開した項目（`resumed`）は、作り直しが済んだかをユーザーに尋ねる問いになるので、ユーザーに上げる問いと同じく `deferred-consent` の問いとして gate を出す（監督が `--escalate` で積む）。consent.md に、conductor の子では resolved の問いも gate で止まることを書く
- `consentGateSlot`（`ledger object --defer` の拒否）: "deferred" の子なら置き場を問わない（最後のビルドの同意ゲートへ回る）。"none" の子（close-cycle）は従来どおり拒む
- `childStep`（監督の評価）は `asConductorChild` のまま。条件は ctx から決まるので、子と監督で同じ評価になる（build-06 の handoff の2か所をそろえる）
- `deferred-consent.mts`: conductor の子で無効にしていた行を消す（有効の判定は子でない場合と同じ）

### `ledger consent-list` / `ledger pr-section`

- consent-list: 対象を `consentTargets`（子の最後のビルドならサイクル全体）にする
- pr-section: `--all` を足す（サイクル全体の同意の対象と、全作業単位の `merge@` の question・provisional）。conductor の Step 4 の最後の PR が使う。決定の行に答えの出どころ（`from`）を添える（`決定: consented（ユーザー・出どころ: user）`）。子の pr.md で使う既定（`--all` なし）でも、最後のビルドの子は自動でサイクル全体になる

### `conductor asks`

- JSON に `deferredConsent`（`deferredConsent(config, cycle.directory)` の `{ requested, effective, reason }`）と `queueing`（問いを積む方針の1行）。テキストに「事後同意: 有効 / 無効（理由）」「ユーザーに上げる問いは記録に積み、依存しないビルドを先に進める」の2行

