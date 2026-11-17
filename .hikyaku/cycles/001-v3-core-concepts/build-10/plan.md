# Build 10: 知見の置き場の「なくす」と、rule を移すきっかけ・領域の開発頻度

## 依存パッケージ

なし（実行時依存ゼロのまま）

## クラス設計

### 設定（`scripts/lib/config.mts`）

- `ResolvedConfig` に `rules: { hitThreshold: number }`（`[rules] hit_threshold`、既定 3、正の整数）と
  `areas: { dormantDays: number }`（`[areas] dormant_days`、既定 180、正の整数）を足す
- `readRulesConfig(table)` / `readAreasConfig(table)`。不正な値は `HikyakuError`。サイクル設定でも上書きできる
  （閾値と期間は、上限を緩める宣言ではなく、候補を出す感度なので）

### 知見の置き場（`scripts/lib/promotions.mts`）

- `PLAIN_TARGETS` に `refactor` を足す。`Candidate["kind"]` に `"refactor"` を足す。重要度は必須（`upstream` だけが例外のまま）
- 「永続化すること」の行の末尾に、任意の理由 `（防ぐ: … / 立つ: … / 重要度: 高|中）` を読む
  - `parseCriterionReasons(text: string): { text: string; reasons: CriterionReasons | undefined } | string`
  - `CriterionReasons = { prevents: string; basis: string; importance: Importance | undefined }`
  - `Candidate.reasons: CriterionReasons | undefined`。理由の中の `重要度` と行の `[高|中]` が食い違えば unparsed。
    理由が無い行も候補として読む（既存の handoff・振り返りを壊さない。理由の欠けを消す候補にするのは build-11）
  - 理由の書式は、文書の基準（`conventions` などに書かれた行）と同じ1つの関数で読む（build-11 が文書の基準を読むときに使う）
- 見出し「レビューの記録」の定数 `REVIEW_RECORD_HEADING` を置く（行の解析は review-records.mts）

### レビューの記録（`scripts/lib/review-records.mts`、新規）

- 行の書式: `- [重|軽] \`rule:<パス>\`: 指摘の要約`。rule に当たらなければ宛先は `` `-` ``
- `parseReviewRecord(item: string): ReviewRecordLine | string`
  - `ReviewRecordLine = { weight: "重" | "軽"; rule: string | undefined; text: string }`
- `collectReviewRecords(hikyakuRoot: string, cycles: CycleRecord[]): { records: ReviewRecord[]; unparsed: Unparsed[] }`
  - `ReviewRecord = ReviewRecordLine & { cycle: string; build: string; source: string }`
  - 全サイクル（closed を含む）の `build-NN/handoff.md` を `collectPeakRecords` と同じ型で走査する。
    patch の handoff.md は読まない（patch の手順に「レビューの記録」を書かせるのはこのビルドの範囲外。handoff の「残したこと」に残す）
- `ruleHits(records: ReviewRecord[]): Map<string, { count: number; heavy: number; sources: string[] }>`（rule のパスごと）
- `heavyCountByCycle(records)`: サイクルごとの重い指摘の数（build-11 の指標の比較が使う）

### rule（`scripts/lib/rules.mts`）

- `parseRule` が frontmatter の `prevents` / `basis` / `importance`（`高` | `中`）を読む。`RuleFile` に
  `reasons: { prevents?: string; basis?: string; importance?: "高" | "中" }` と `problems: string[]` を足す
  （不正な importance は reasons に入れず problems に出す）
- `ruleCandidates(input): RuleCandidate[]`
  - 入力: 測った rule（`measureRules` の結果）、`ruleHits`、閾値、rule ごとの最終変更日
  - `RuleCandidate = { path; kind: "move" | "stale" | "missing"; hits?: number; heavy?: number; lastTouchedDays: number | undefined; reasons }`
  - 移す候補（`move`）: 引かれた回数 ≥ 閾値。一致しない rule（`stale`）は既存の判定。
    記録に挙がったが `.claude/rules/` に無い rule は `missing` として並べる（パスの書き間違いを黙って落とさない）
  - 日数は rule の `paths` に当たる追跡ファイルの最終変更から（paths が無い rule・一致しない rule は rule ファイル自身）。
    移すか消すかは決めない

### git（`scripts/lib/git.mts`）

- `lastTouched(cwd: string, files: string[]): Promise<Date | null | undefined>`
  - `git log -1 --format=%cI -- <files...>`。glob は渡さない: 呼び出し側が追跡ファイルを `matchesRule`（rule と同じ glob の意味。
    `/` の無いパターンはどの階層にも当たり、`{a,b}` を展開する）で絞ってから渡す。git の pathspec と glob の意味の差を作らないため。
    引数が多ければ分けて呼び、最も新しい日時を取る。ファイルが空・履歴が無ければ null、失敗は undefined

### 休眠した領域（`scripts/lib/areas.mts`、新規）

- `parseAreaLine(line)`: build-05 の書式 `- **領域**: \`<glob>\`, \`<glob>\`` を読む（コードブロックの中は読まない）
- `linkedCriteria(config): LinkedCriterion[]`
  - `LinkedCriterion = { kind: "rule" | "adr" | "constraints"; source: string; title: string; globs: string[] }`
  - rule は frontmatter の `paths`、ADR は1ファイル1行の「領域」（superseded は読まない）、constraints は `##` の項目ごとの「領域」
  - ADR・constraints の所在は `premises.mts` の `documentFiles` で引く
- `dormantAreas(config, paths: string[], now?: Date): Promise<DormantResult>`
  - 渡された glob ごとに、当たる追跡ファイルを `matchesRule` で絞って `lastTouched` を引き、`[areas] dormant_days` を超えていれば休眠
  - 休眠した glob と重なる基準（渡された glob に当たる追跡ファイルが、基準の glob にも `matchesRule` で当たる）を並べる。
    判定も重なりも同じ matcher を使う
  - `DormantResult = { dormantDays; areas: { glob; lastTouched: string | null; days: number | null; dormant: boolean; linked: LinkedCriterion[] }[]; notices: string[] }`
  - 履歴の無いパス（新規）は休眠とみなさない（前提が古びる元のコードが無い）

### CLI

- `hikyaku rules candidates [--json]`（`scripts/commands/rules.mts`）: 移す候補・一致しない rule・記録に挙がったが無い rule を、
  回数・重い指摘・最終変更からの日数・理由（防ぐ・立つ・重要度）とともに並べる。回数はサイクルをまたいで数えるので、サイクルの引数は取らない。
  読み取り専用、終了コード 0
  （`rules check` は今のまま。一致しない rule で 2 を返すのは check の役目）
- `hikyaku areas dormant --paths <glob,...> [--json]`（`scripts/commands/areas.mts`、新規）: 休眠した領域と結び付いた基準。読み取り専用、終了コード 0
- `scripts/hikyaku.mts` に areas を登録する

### 手順・テンプレート・文書

- `skills/close-cycle/references/persistence.md`: 置き場の表の先頭に「0. なくす（リファクタ）」と宛先 `refactor`、
  記録の書式に理由の欄と「レビューの記録」、rule の frontmatter の `prevents` / `basis` / `importance`、
  置き場を決めるときに `rules candidates` の日数（領域の開発頻度）を見ること
- `agents/doc-triager.md`: 「要点」の写しを消し、persistence.md を読ませるだけにする。出力の置き場に「なくす」を入れる
- `skills/builder/references/templates.md`: handoff に「レビューの記録」の節、「永続化すること」の例に理由の欄
- `skills/builder/steps/review.md`: 指摘ごとに、引いた rule と重さを控える（handoff で書く）
- `skills/builder/steps/handoff.md`: 「レビューの記録」を書く。置き場を決める前に `rules candidates` を呼ぶ
- `skills/builder/steps/plan.md`: 触るパスを `areas dormant --paths` に渡し、休眠していれば、休眠の事実と結び付いた基準の所在
  （rule のパス・ADR のファイル名・constraints のアンカー）だけを plan.md に書き、その基準を読む（本文は写さない）
- `skills/architect/steps/survey.md`: survey の後に、変更するパスを `areas dormant --paths` に渡し、休眠の事実と基準の所在だけを codebase-survey.md に書く
- `skills/builder/SKILL.md`: 知見の表の先頭に「なくす（リファクタで知見そのものを不要にできる）」の行。基準は persistence.md を指すだけにする
- `skills/retrospective/steps/write.md`: 「永続化すること」の例に理由の欄
- `skills/close-cycle/steps/collect.md`: `rules candidates` を呼ぶ（移す候補と一致しない rule を G10 の材料にする）
- `skills/close-cycle/steps/G10.md`・`pr.md`: 宛先 `refactor` は文書に書かず、「リファクタの提案」として G10 で示し、PR 本文に並べる
  （close-cycle はコードを直さない。採るなら後続のサイクルか patch で行う）
- `skills/close-cycle/steps/write.md`・`skills/init/steps/triage-write.md`: 「frontmatter には `paths` だけ」を、persistence.md の
  「rule の書き方」（理由の欄）と、文書の基準の行末の理由へのポインタに直す
- `docs/configuration/persistence.md`・`docs/configuration/config-file.md`（`[rules]`・`[areas]`）・`docs/reference/cli.md`（`rules candidates`・`areas dormant`）・
  `docs/workflow/build.md`（レビューの記録・休眠）・`docs/workflow/architect.md`（survey の休眠）・`docs/workflow/close.md`（rules candidates・refactor）
- CHANGELOG の `[3.0.0]` に追記

## 非機能要件

- **エラーハンドリング**: 記録の読めない行は捨てずに unparsed として返す（promotions と同じ）。git が使えないときは日数を「不明」にして続け、notices に出す
- **パフォーマンス**: `lastTouched` は渡された glob ごとと rule ごとに1回の `git log -1`。全サイクルの handoff.md を読むのは `collectPeakRecords` と同じ規模
- **マージ時点のデータ安全**: 該当なし（読み取り専用のコマンドとテンプレートの追加。既存の handoff・振り返りは、新しい見出しと理由の欄が無くても今までどおり読める）

## 予測ピーク

| 段階 | 予測ピーク |
|------|------------|
| architectフェーズ段階 | 345k |
| builderフェーズ段階 | 400k |

**読むファイル**

- `design/design-delta.md` の「7. 知見と基準」、ADR `20261116-review-records-and-criterion-reasons.md`、build-05 の handoff.md
- `scripts/lib/promotions.mts`（約 250 行）、`scripts/lib/rules.mts`（約 235 行）、`scripts/commands/rules.mts`（約 70 行）、`scripts/commands/promotions.mts`（約 120 行）
- `scripts/lib/git.mts` の該当節、`scripts/lib/tokens-history.mts` の `collectPeakRecords`、`scripts/lib/config.mts` の該当節、`scripts/lib/premises.mts`
- `tests/rules.test.mts`・`tests/promotions.test.mts`・`tests/helpers.mts`・`tests/config.test.mts` の書き方
- `skills/close-cycle/references/persistence.md`・`constraints-template.md`、`skills/architect/references/templates.md`、`agents/doc-triager.md`
- `skills/builder/SKILL.md`・`references/templates.md`・`steps/handoff.md`・`steps/plan.md`・`steps/review.md`、`skills/retrospective/steps/write.md`、`skills/architect/steps/survey.md`
- `skills/close-cycle/steps/collect.md`・`G10.md`・`write.md`・`pr.md`、`skills/init/steps/triage-write.md`
- `docs/configuration/persistence.md`・`config-file.md`、`docs/reference/cli.md`、`docs/workflow/build.md`・`architect.md`・`close.md`

**作成するファイル**

- `scripts/lib/review-records.mts`（約 130 行）、`scripts/lib/areas.mts`（約 170 行）、`scripts/commands/areas.mts`（約 70 行）
- `tests/review-records.test.mts`（約 150 行）、`tests/areas.test.mts`（約 150 行）
- 変更: promotions.mts・rules.mts・commands/rules.mts・git.mts・config.mts・hikyaku.mts、tests/promotions・rules・config、上記の手順・テンプレート・エージェント・docs、CHANGELOG.md

**builderフェーズ段階の内訳**

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 標準ガイドの出発点 80k〜100k の中央。plan までで既に約 150k が載っている |
| 読み込み | 135k | promotions・rules・commands/rules・commands/promotions・git・tokens-history・config・premises・patch.mts の該当節、tests の rules・promotions・helpers・config、persistence.md・constraints-template・architect の templates・doc-triager、builder の SKILL.md・templates・plan/handoff/review、retrospective の write、architect の survey、close-cycle の collect・G10・write・pr、init の triage-write、docs の persistence・config-file・cli・workflow の build・architect・close |
| 実装 | 85k | review-records.mts・areas.mts（lib と command）新規、rules.mts の frontmatter の理由と ruleCandidates、lastTouched、config の [rules]/[areas]、promotions の refactor と理由の欄、rules candidates コマンド、手順書 10 本・persistence.md・doc-triager・docs 6 本・CHANGELOG |
| テスト | 50k | promotions の refactor と理由、review-records のサイクルをまたいだ結合、rules candidates、areas dormant（一時リポジトリのコミット日時）、config の [rules]/[areas] |
| 未知の領域 | 40k | rule の glob（matchesRule）と git の pathspec の意味の差を避けるため追跡ファイルを JS で絞ってから git log に渡す実装、コミット日時（GIT_COMMITTER_DATE）と now を注入するテストの修正ループ、rule の frontmatter の解析と既存実装の整合 |
| **予測ピーク** | **400k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |

## 実装ステップ

- [ ] Step 1: config に `[rules]`・`[areas]`、git に `lastTouched`
- [ ] Step 2: promotions の `refactor` と理由の欄、review-records.mts
- [ ] Step 3: rules.mts の frontmatter の理由と `ruleCandidates`、`rules candidates` コマンド
- [ ] Step 4: areas.mts と `areas dormant` コマンド
- [ ] Step 5: テスト（promotions・review-records のサイクルをまたいだ結合・rules candidates・areas dormant の一時リポジトリのコミット日時・config）
- [ ] Step 6: persistence.md・doc-triager・テンプレート・手順・docs・CHANGELOG
- [ ] Step 7: ローカル検証（`npx tsc --noEmit`・`npm test`・`conductor lint`・`step lint`）
