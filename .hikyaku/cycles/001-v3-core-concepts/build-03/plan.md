# Build 03: 未決事項と決定の記録（ledger の中核）

## 依存パッケージ

なし

## クラス設計

### `scripts/lib/jsonl.mts`（新規。progress.mts から切り出し）

```ts
/** 追記型の JSONL を厳密に読む。空行は読み飛ばし、JSON でない行・形の合わない行は HikyakuError（行番号つき） */
export function readJsonl<T>(path: string, isRecord: (value: unknown) => value is T, labels: { writer: string; shape: string }): T[];
/** 1行追記する（ディレクトリが無ければ作る） */
export function appendJsonl(path: string, record: unknown): void;
```

`progress.mts` の `readProgress` / `appendProgress` はこれを使う（文言は変えない）。

### `scripts/lib/ledger.mts`（新規）

```ts
export const LEDGER_FILE = "decisions.jsonl";
export type ItemType = "question" | "provisional" | "objection" | "risk";
export type Decision = "decided" | "consented" | "rejected" | "resolved";
export type Harm = "高" | "中";            // risk.mts の Harm を再利用
/** 「誰が」: user / ai:<phase> / supervisor */
export type Who = "user" | `ai:${string}` | "supervisor";

export interface OpenRecord {
  record: "open"; at: string; id: string;
  /** 事項を記録した作業単位（フェーズ: plan / architect / build-NN / close / create / patch-YYYYMM-slug） */
  unit: string;
  type: ItemType; summary: string;
  /** 正規化した「いつ」（gate・merge は @unit を補って保存） */
  when: string; who: Who;
  premises?: string[]; loses?: string; harm?: Harm; ask?: string;
  session?: string; hikyaku?: string;
}
export interface DecideRecord {
  record: "decide"; at: string; id: string;
  /** 決めた作業単位（このファイルの置き場） */
  unit: string;
  decision: Decision; by: Who;
  input?: string;      // ユーザーの答え（by=user で必須）
  accepts?: string;    // ユーザーが受け入れると書いた言葉
  reason?: string;
  from?: string;       // 答えの出どころ（値を入れるのは build-07）
  session?: string; hikyaku?: string;
}

/** 「いつ」 */
export type When =
  | { kind: "now" } | { kind: "phase"; phase: string }
  | { kind: "gate"; gate: string; unit: string } | { kind: "merge"; unit: string } | { kind: "close" };
export function parseWhen(raw: string, ctx: RefContext): When;     // 語彙外・参照先の不在は HikyakuError
export function formatWhen(when: When): string;
export function parseWho(raw: string): Who;                         // ai:<phase> の phase も isPhase で検査
export function whoLabel(who: Who): string;                         // ユーザー / AI（build-03）/ 監督
/** 前提の参照。app.exposure / app.data / app.impact / app.merge_gate / area:<name> / constraints#<anchor> / adr:<file> / assumption:<短い文> */
export function parsePremise(raw: string): Premise;                 // 書式外は HikyakuError
export function parsePremises(raw: string): string[];               // カンマ区切り。assumption は文中のカンマを許さない（区切りに使う）

/** 参照先の検査に使う、サイクルの実在する単位 */
export interface RefContext { cycleDirectory: string; builds: BuildRecord[]; opening: string }
/** ゲート ID → それを持つスキル（SKILL_STEPS の gate のうち G<n> / P<n>） */
export function gateOwners(gate: string): SkillSteps[];

export interface LedgerItem { open: OpenRecord; decisions: DecideRecord[]; latest: DecideRecord | undefined }
/** サイクルの全作業単位（直下・planning・design・build-NN・patches/*/*）の decisions.jsonl を読み、ID で結ぶ */
export function readLedger(cycleDirectory: string): LedgerItem[];
export function ledgerDirectoryOf(cycleDirectory: string, phase: Phase): string;  // ownerOf(phase).directory
export function nextItemId(items: LedgerItem[], unit: string): string;            // `{unit}.{n}`
export function openItem(cycleDirectory: string, record: OpenRecord, items: LedgerItem[]): void;   // 同じ ID の2回目は HikyakuError
export function decideItem(cycleDirectory: string, record: DecideRecord, items: LedgerItem[]): void;
/** 付け替えの禁止: who=user の事項は by=user だけ。by=user は input 必須。ai の事項は ai:* か user、supervisor の事項は supervisor か user */
export function assertDecider(item: OpenRecord, by: Who, input: string | undefined): void;

/** 期限の判定 */
export type Timing = "pending" | "due" | "overdue";
export interface UnitPosition { events: ProgressEvent[]; current: string | undefined /* 現在のステップ。done なら undefined */; done: boolean }
export interface CycleTimeline { active: boolean; units: Map<string, UnitPosition> }
export function timingOf(item: LedgerItem, timeline: CycleTimeline): Timing;
/** サイクルの作業単位の位置を engine で評価して集める（cycle status 用。directive は自分の評価を上書きで渡す） */
export function cycleTimeline(config: ResolvedConfig, cycle: CycleContext): CycleTimeline;
export interface LedgerSummary { due: Array<LedgerItem & { timing: "due" | "overdue" }>; open: LedgerItem[]; rejected: LedgerItem[] }
export function summarize(items: LedgerItem[], timeline: CycleTimeline): LedgerSummary;
export function noticeLines(summary: LedgerSummary): string[];     // 1事項1行
```

- **「いつ」の期限**（状態は保存せず、progress.jsonl と cycles.md から導く）
  - `now`: 記録した時点から来ている（過ぎない。決まるまで示す）
  - `phase:<P>`: P の作業単位に記録があれば来た。P の `pr` が記録されたら過ぎた（`phase:close` は cycles.md の status が active でなくなったら過ぎた）。P は plan / architect / build-NN（tasklist に在る）/ close
  - `gate:<G>[@<unit>]`: unit の現在のステップが G か、G の記録があれば来た。G の最新の記録が `approved` なら過ぎた。@unit を省くと、G を持つスキルが固定のフェーズ（G1→plan、G2〜G4→architect、G10→close）ならそのフェーズ、そうでなければ（G6・G7・G8・P1・P2）事項を記録した作業単位。G を持つスキルがその unit を担わないならエラー
  - `merge[@<unit>]`: unit の現在のステップが `pr` 以降（`pr`・`publication`・完了）なら来た。`pr` の記録（PR の URL）があれば過ぎた（PR を作るまでに決める機会を過ぎた。マージの前に決めるべき事項は、PR の本文とその後の `cycle status` に出続ける）。@unit 省略は記録した作業単位
  - `close`: サイクル直下に close-cycle の記録があれば来た。cycles.md の status が active でなくなったら過ぎた
  - 参照先の実在: build-NN は tasklist.md に、patch はサイクルの patches/ に在ること。plan / architect / close は常に在る
- **決まったか**: 最新の `decide`（`at` 順、同時刻はファイル順）。`decide` が無ければ未決。最新が `rejected` なら「未解決の退け」（`resolved` で消える）。期限の判定は未決の事項だけ
- **置き場**: `open` は記録した作業単位のファイル、`decide` は決めた作業単位（`ledger decide` に渡したフェーズ）のファイル

### `scripts/commands/ledger.mts`（新規）

```
hikyaku ledger open <phase> [<cycle>] --type <type> --when <when> --who <who> --summary <text>
                    [--premises <ref,...>] [--loses <text>] [--harm 高|中] [--ask <id>] [--dry-run] [--json]
hikyaku ledger decide <phase> <id> [<cycle>] --decision <decision> --by <who>
                    [--input <text>] [--accepts <text>] [--reason <text>] [--dry-run] [--json]
hikyaku ledger list [<cycle>] [--json]      # 未決・期限・未解決の退け
hikyaku ledger show <id> [<cycle>] [--json] # 事項と決定の全欄
```

- `<phase>` は `requirePhase` + `scopeFor`。サイクルに属さない patch はエラー（スコープ外 Q13）
- `--ask` は `conductor.mts` の `ASK_IDS` に在ること。`--harm` は 高 / 中
- `open` の `--when` は `--who` と合わせて検査。`--premises` は書式の検査
- `decide` は `assertDecider`、決めた作業単位のファイルに追記
- 記録に `session`（CLAUDE_CODE_SESSION_ID）と `hikyaku`（版）を添える（progress と同じ）

### `scripts/lib/steps/directive.mts`

- `BuildOptions.notices?: boolean`（既定 true）。`locate.mts` の `directiveOf`（Stop フック・step where・conductor parse の経路）は `notices: false` を渡す
- `buildDirective` は、サイクルがあり notices が有効なら、`cycleTimeline` に自分の評価（現在のステップ）を重ねて `summarize` し、`noticeLines` を `notices` に入れる

### `scripts/commands/cycle.mts`（status）

- JSON に `ledger: { due, open, rejected }`（各要素は id・unit・type・summary・when・who・timing / 最新の決定）
- テキストに「未決事項」の節（期限が来た・過ぎた事項を1行ずつ、未決の総数、未解決の退け）。無ければ出さない

### `skills/navigator/SKILL.md`

判定表に1行: `cycle status` の `ledger.due` か `ledger.rejected` があれば、次の一手に添えて伝える（スキルは変えない）。

### docs・CHANGELOG

- `docs/reference/directory-layout.md`: 作業単位の `decisions.jsonl`（書き手は CLI だけ、決定は決めた作業単位に置く）
- `docs/reference/cli.md`: ledger の4コマンドを「いつ、なぜ使うか」で
- `CHANGELOG.md` の `[3.0.0]` Added

## 非機能要件

- **セキュリティ**: 外部に出す処理なし。記録は作業単位のファイルに追記するだけ
- **パフォーマンス**: notices は step next / report のときだけ読む（Stop フックの経路では読まない）。サイクルの decisions.jsonl はファイル数が作業単位の数で、全件読みで足りる
- **エラーハンドリング**: 壊れた行・語彙外の値・参照先の不在・付け替えはエラー（黙って捨てない）
- **マージ時点のデータ安全**: 該当なし（プラグインのスクリプトと文書の変更）。新しいファイルを足すだけで、progress.jsonl・tasklist.md・cycles.md の形は変えない。書き手（各スキルの手順）はまだ無いので、decisions.jsonl が無いワークスペースでは notices と status の節が空になるだけ

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 355k |
| builderフェーズ段階 | 385k |

**読むファイル**

- 読了: issue.md、design-delta、ADR pending-items-ledger、`progress.mts`、`steps/directive.mts`・`locate.mts`・`engine.mts`（型）・`builder.mts`（ゲート）・`index.mts`、`branch.mts`・`patch.mts`・`stack.mts` の一部、`commands/cycle.mts` の status、navigator の判定表
- これから: `commands/step.mts` の一部、`workspace.mts`・`conductor.mts`（ASK_IDS）の一部、`tests/helpers.mts`・`cli.test.mts` の一部、`docs/reference/cli.md`・`directory-layout.md`、`CHANGELOG.md` の `[3.0.0]`

**作成・変更するファイル**

- `scripts/lib/jsonl.mts`・`ledger.mts`（新規）、`scripts/commands/ledger.mts`（新規）、`scripts/hikyaku.mts`（登録）
- `scripts/lib/progress.mts`・`steps/directive.mts`・`steps/locate.mts`、`scripts/commands/cycle.mts`
- `tests/ledger.test.mts`（新規）
- `skills/navigator/SKILL.md`、`docs/reference/directory-layout.md`・`cli.md`、`CHANGELOG.md`

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | — |
| 読み込み | 110k | 読了: progress.mts・directive.mts・locate.mts・engine.mts 冒頭・design-delta・ADR・cycle.mts status・builder steps・navigator の表。これから: cycle.mts の残り・stack/workspace の一部・tests/helpers.mts・step.test/cli.test の一部・docs の cli.md・directory-layout.md・CHANGELOG [3.0.0] |
| 実装 | 95k | jsonl.mts（progress から切り出し）、ledger.mts 新規（約500行: 欄・語彙・前提の参照・参照先の検査・導出・期限）、commands/ledger.mts（約300行）、directive の notices、cycle status の節、navigator の1行、docs 2本と CHANGELOG |
| テスト | 60k | ledger の unit（語彙・付け替え・導出・期限）、CLI 結合（dry-run・decide の置き場・2ブランチのマージで衝突しない・notices・status --json） |
| 未知の領域 | 30k | Stop フック経路で読まない分岐、期限の判定（ゲートの現在地・PR の記録）を engine の評価から引く部分 |
| **予測ピーク** | **385k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: `jsonl.mts` の切り出しと `progress.mts` の置き換え
- [ ] Step 2: `ledger.mts`（欄・語彙・前提の参照・参照先の検査・付け替えの禁止・読み書き・導出・期限）
- [ ] Step 3: `commands/ledger.mts`（open / decide / list / show）と登録
- [ ] Step 4: directive の notices（Stop フックの経路は読まない）、cycle status の節、navigator の1行
- [ ] Step 5: テスト（unit・CLI 結合・2ブランチのマージ）
- [ ] Step 6: docs・CHANGELOG
- [ ] Step 7: ローカル検証（`npx tsc --noEmit`・`npm test`・`step lint`・`conductor lint`）
