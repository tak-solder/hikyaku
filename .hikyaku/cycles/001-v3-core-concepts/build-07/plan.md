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
- 表に無い問い（questions・review-findings・route の問いなど、自由文で答えるもの）は `--choice` を求めない
- `ResolvedAsk` に `safe: SafeAnswer | null` を足す（`resolveAsk` が埋める）。`conductor parse` と `conductor asks` の JSON に出る

### 答えの出どころと launch の検査（`scripts/commands/conductor.mts`）

`conductor launch` に次を足す。

- `--from user|supervisor` — 回答を渡す再開（`--message`）に必須。子のコマンドの前に `HIKYAKU_ANSWER_FROM=<値>` を置く。回答の無い起動（初回・`--escalate`）は `HIKYAKU_ANSWER_FROM` を置かない
- `--ask <id>` — `--from supervisor` と `--escalate` に必須（`--from user` では任意）
- `--choice <値>` — `--from supervisor` で、`--ask` の問いに `SAFE_ANSWERS` があれば必須
- `--harm 高|中` と `--premises <ref,...>` — `--from supervisor` の答えがリスクを受け入れるとき（任意）
- `--escalate` — ユーザーに上げる問いを記録させる固定文で子を再開する（`--message` を取らない）

`--from supervisor` の検査（`checkSupervisorAnswer`。拒むときは `HikyakuError` で、ユーザーに上げる案内を添える）:

1. `resolveAsk(id, …, approval)` の handler が user なら拒む。approval は、`--resume` の session-id から `locateSession` で子の手順の位置を引き（`childStep` と同じく `asConductorChild` で評価）、gate がその問いで止まっていればその回の approval。回によって同意になるゲート（`CONSENT_WHEN`）で位置を確かめられなければ consent に倒す（parse と同じ）
2. `SAFE_ANSWERS` があり、`--choice` が無い・choices に無い・safe に無い なら拒む
3. `--harm` があれば `exceedsCeilingFor(effectiveDeclaration(config), harm, premises)`（build-18）で上限と比べる。超えるとき、`deferredConsent(config, cycleDirectory).effective`（監督のプロセスで評価する。子として評価すると build-16 の判定が有効にならないので、子の環境に合わせない）なら受け付け、子への回答の先頭に固定文（`risk` の事項を `--who user --when merge --premises … --loses …` で積んでから進む）を足す。有効でなければ拒む（US-15.2・US-15.4）

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

### 最後のビルドの同意ゲート（`scripts/lib/steps/consent.mts`・`scripts/lib/ledger.mts`）

```ts
// ledger.mts
/** サイクル全体の同意の対象（who=user・when=merge@<どこでも> の risk・objection） */
export function cycleConsentItems(ledger: Ledger): LedgerItem[]
// consent.mts
/** 作業ツリーの tasklist で、このビルド以外の全ビルドの PR 列が埋まっているか */
export function isLastBuild(ctx: Pick<StepContext, "cycle" | "unit">): boolean
/** conductor の子の同意の扱い: "last"（最後のビルド。サイクル全体）| "deferred"（最後のビルドへ回す）| "none"（子でない） */
export function conductorConsentMode(ctx): "last" | "deferred" | "none"
/** 同意ゲート・pr の accepts・consent-list・pr-section が使う対象（"last" ならサイクル全体） */
export function consentTargets(ledger: Ledger, ctx): LedgerItem[]
```

- `consentStep` の slot: `!isConductorChild()` を `conductorConsentMode(ctx) !== "deferred"` に変える（子なら最後のビルドだけゲートを置く）。architect の子は常に deferred（ビルドではない）
- `hasConsentItems`: "last" なら `cycleConsentItems(readLedger(cycle))` が空でないか（positionOnly なら true。読めなければ true）
- `consentProblem`: "deferred" なら決定の無い項目では止めない（最後のビルドの同意ゲートへ回す）。退けの作り直しの検査はそのまま。"last" なら対象をサイクル全体にする。案内の文面の「conductor の子では同意ゲートが手順に入りません」を消し、ゲートの手順へ案内する
- `consentStep` の args・reopens も `consentTargets` を使う（"last" の reopens はサイクル全体を読む。読めなければ取り直す）
- 前のフェーズの退けは `consentRejections` の `returns`（記録した単位が別）になり、build-17 の return.md の経路で最後のビルドから差し戻す。コードは変えない。最後のビルドの子は差し戻しを blocked（return.md）で終える
- `consentGateSlot`（`ledger object --defer` の拒否）: conductor の子なら置き場を問わない（最後のビルドの同意ゲートへ回る）
- `childStep`（監督の評価）は `asConductorChild` のまま。条件は ctx から決まるので、子と監督で同じ評価になる（build-06 の handoff の2か所をそろえる）
- `deferred-consent.mts`: conductor の子で無効にしていた行を消す（有効の判定は子でない場合と同じ）

### `ledger consent-list` / `ledger pr-section`

- consent-list: 対象を `consentTargets`（子の最後のビルドならサイクル全体）にする
- pr-section: `--all` を足す（サイクル全体の同意の対象と、全作業単位の `merge@` の question・provisional）。conductor の Step 4 の最後の PR が使う。決定の行に答えの出どころ（`from`）を添える（`決定: consented（ユーザー・出どころ: user）`）。子の pr.md で使う既定（`--all` なし）でも、最後のビルドの子は自動でサイクル全体になる

### `conductor asks`

- JSON に `deferredConsent`（`deferredConsent(config, cycle.directory)` の `{ requested, effective, reason }`）と `queueing`（問いを積む方針の1行）。テキストに「事後同意: 有効 / 無効（理由）」「ユーザーに上げる問いは記録に積み、依存しないビルドを先に進める」の2行

### 手順・docs

- `skills/conductor/SKILL.md`:
  - Step 0: 確認文に事後同意の行と、問いを積む方針の行を足す。「同意ゲートは監督に委任しない」の文面は残し、同意ゲートの答えも問いを積む経路に乗ることを書く
  - Step 1: `available` が空になったら `conductor waiting` を実行し、待っている問いがあれば `AskUserQuestion` でまとめて尋ねる。答えごとに、待っているビルドのブランチ（ARCHITECT なら architect のブランチ）へ conductor ブランチを取り込んでから（`git merge`・push）、`--from user` で子を再開する（session-id が会話に無ければ新しく起動して `--message` で渡す）。逐次実行は保つ
  - Step 3 gate: `handler: user` は `AskUserQuestion` を出さず、`conductor launch --resume … --escalate --ask <id>` で子に記録させる。`supervisor` は `ask.safe` の既定から選び、`--from supervisor --ask <id> --choice <値>` で再開する。launch が拒んだらユーザーに上げる側（`--escalate`）へ
  - Step 3 blocked: `waiting` があれば待ちとして Step 1 へ（ユーザーに上げない）
  - error・2回目の violation・check-pr の不合格は従来どおりその場でユーザーに上げる
  - Step 4: 本文に `ledger pr-section <最後のビルド> {cycle} --all` の出力（全フェーズの受け入れと同意・退けの決定、答えの出どころ）と、`ledger premises --changed-from <ベースブランチ> --format pr`（conductor ブランチとベースブランチの差分）を貼る
  - 「問いへの答え方」の表に `--choice` の値を添える
- `skills/conductor/references/headless-protocol.md`: ユーザーに上げる問いの記録と `waiting:` の blocked、`HIKYAKU_ANSWER_FROM` と `--by user`、最後のビルドの同意ゲート
- `docs/workflow/conductor.md`・`docs/reference/cli.md`（いつ・なぜだけ）、CHANGELOG の `[3.0.0]`

## 実装ステップ

1. `SAFE_ANSWERS`・`resolveAsk` の `safe`・`parseFinalText` の waiting（lib/conductor.mts）
2. `answerSourceProblem` / `answerSource`・`cycleConsentItems`（ledger.mts）、`ledger decide` / `object` の検査と `from`
3. consent.mts の最後のビルドの扱いと deferred-consent.mts、consent-list・pr-section の `--all`
4. launch の `--from` / `--ask` / `--choice` / `--harm` / `--premises` / `--escalate`、parse の waiting、asks の `deferredConsent`
5. waiting.mts と `conductor waiting`・`next --json` の `waiting`
6. テスト（`tests/conductor.test.mts`・`tests/ledger*.test.mts`・`tests/step-consent.test.mts` に追加）
7. SKILL.md・headless-protocol.md・docs・CHANGELOG

## 非機能要件

- **マージ時点のデータ安全**: 本番データは無い（ワークフローの CLI とスキル）。ワークスペースのデータは、`decisions.jsonl` の decide に任意欄 `from` を足すだけで、既存の記録はそのまま読める。conductor の子の挙動が変わるのは、このビルドの後に起動した子だけ
- **安全側**: 監督が答えてよい範囲は狭める方向にだけ変える（handler が user の問いと safe に無い値は拒む）。位置を確かめられない回は同意に倒す（parse と同じ）
- **状態を保存しない**: 待ちは作業ツリーと origin のブランチから毎回導く。session-id は保存しない
- **互換**: `conductor launch` の `--resume --message` は `--from` が必須になる（監督の手順と同じ PR で直す）

## 予測ピーク

読むファイル: `skills/conductor/SKILL.md`・`references/headless-protocol.md`、`scripts/lib/conductor.mts`・`scripts/commands/conductor.mts`、`scripts/commands/next.mts`、`scripts/lib/ledger.mts`（一部）・`scripts/commands/ledger.mts`（一部）、`scripts/lib/steps/consent.mts`・`directive.mts`・`builder.mts`、`scripts/lib/deferred-consent.mts`（一部）、`scripts/lib/git.mts`（一部）、build-06・09・16・17・18 の handoff、ADR conductor-runs-to-end、`docs/workflow/conductor.md`、`tests/conductor.test.mts`（一部）・`tests/step-consent.test.mts`（一部）
作成・変更するファイル: 上記の lib・commands・手順・docs、`scripts/lib/waiting.mts`（新規）、`tests/conductor.test.mts`・`tests/ledger.test.mts`・`tests/step-consent.test.mts`、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 150k | conductor の lib・commands・SKILL.md・headless-protocol、next、ledger と consent・directive・builder の steps、deferred-consent・git の一部、依存ビルドの handoff 5件と ADR（ここまでで約 100k 読んだ）。残りは docs/workflow/conductor.md と既存テストの該当部分 |
| 実装 | 95k | SAFE_ANSWERS と launch の検査、answer-from の検査と記録、waiting の blocked、waiting.mts と conductor waiting・next の waiting、最後のビルドの同意ゲート（consent.mts・deferred-consent）、pr-section の --all、asks の deferredConsent、SKILL.md と headless-protocol と docs の書き換え |
| テスト | 55k | 一時リポジトリでの launch の拒否・出どころの検査・待ちの blocked・waiting の導出・最後以外の子が止まらないこと・最後のビルドの同意ゲート・asks の表示 |
| 未知の領域 | 40k | 既存の conductor・consent の結合テストの調整と、循環 import の初期化順 |
| **予測ピーク** | **430k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
