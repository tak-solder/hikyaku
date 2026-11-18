# 既存コードベース調査結果

`overview` は未作成のため、今回のスコープに関わる範囲を全体から調べた。

## リポジトリ概要

- **技術スタック**: TypeScript（`.mts`）を Node ≥22.18 の型剥がしで直接実行。実行時依存ゼロ（TOML パーサも自前の `scripts/lib/toml.mts`）。スキル（`skills/*/SKILL.md`・`steps/*.md`）とエージェント定義（`agents/*.md`）は Markdown
- **パッケージマネージャ**: npm（`npm test` と `npx tsc --noEmit` のみ。テスト用の依存も無い）

## ディレクトリ構成

```
scripts/
├── hikyaku.mts      CLI のエントリ。commands/*.mts を import し、register の副作用で登録する
├── commands/        引数の解釈と出力・終了コードだけ。判定は lib に置く
└── lib/             設定（config）・状態の導出（phase / progress）・conductor・integrity・promotions・rules・docs など
    └── steps/       手順の唯一の正。engine（評価器）/ directive（1手の組み立て）/ <skill>.mts（フェーズごとの定義）
skills/<name>/       SKILL.md（転送ループ）、steps/<id>.md（ステップの指示。step lint が 1:1 を検査）、references/
agents/              サブエージェント定義（doc-reviewer / doc-triager / code-explorer / code-architect / cycle-scanner）
tests/               node:test。<lib名>.test.mts（単体）と step*.test.mts・cli.test.mts（一時 Git リポジトリでの結合）。helpers.mts
docs/                利用者向けの説明（concepts.md が今回の要件の文書側の正）
```

## ユーザーストーリーとの関連箇所

### US-1: 食い違う選択に異を唱え、異議と決定を記録する

- `scripts/lib/progress.mts:30-54` — `ProgressEvent` に異議・受け入れたこと・拠り所の前提を入れる欄が無い。`isEvent`（:89-98）は必須欄しか見ないので、任意欄を足しても既存の記録は読める
- `scripts/commands/step.mts:140-230` `buildEvent` — gate の報告の検査。`rejected` に `--input` 必須（:180）と同じ形で、approved に条件付きの必須欄を足せる
- 異議を出す手順・記録の形式は、どのスキルにも無い

### US-2: AI が問題を黙って変えた差分を、別のレビューが合意と突き合わせる

- `scripts/lib/git.mts:445-495` `diffStats` — merge-base..HEAD の `{path, added, deleted, isNew}`。削除・変更・リネームの区別が無く、hunk を読む処理はリポジトリのどこにも無い（テストの skip・削除・期待値の変化の検出は新規）
- `scripts/lib/diff-stats.mts:98` `classifyPath` — generated / test / implementation の振り分け（`[diff]` 設定）。変更の種類のうちテストか実装かに使える
- `scripts/commands/tokens.mts:352-373` `buildHistory` と `scripts/lib/stack.mts:322` `resolvePrBase` — 差分の基準の解決（スタック対応）の手本
- G8 承認後の test-spec.md の書き換え: G8 の承認は progress.jsonl の `builder/G8/approved` で `at` を持つがコミット SHA は無い。`at` 以降の `git log -- build-NN/test-spec.md` で導ける（新規）。承認を成果物のハッシュで無効にしない方針は `scripts/lib/steps/engine.mts:18-20`
- `skills/builder/steps/review.md:47-57` — builder 自身のスコープ準拠とデータ安全の確認（US-2.5 で移す対象）。`skills/patch/steps/review.md:20-24` に patch 版の同じ自己確認
- `skills/builder/steps/review.md:69-96` と `scripts/lib/review.mts:283` `reviewAction` — 指摘の統合と done/fix/confirm。合意に無い変更を `--has-findings` に乗せれば Q6 の扱いになる
- `agents/doc-reviewer.md` — context の一覧はこのファイルの中だけ（description・役割・入力・ラベル・出力の各節）。入力ファイル以外を読まない制約（:215）。プロンプトに内容を含める前例は tasklist（:40-42）
- `scripts/commands/review.mts:347-362` / `scripts/lib/review.mts:224` `docPrompt` — `--context` は検査しない自由文字列、`--files` で入力を渡す
- `scripts/lib/steps/builder.mts:50-115` — `review` は run で args に code/security の有効値を渡すだけ（evidence/accepts 無し）
- `skills/builder/steps/pr.md:25-32` — PR 本文は LLM が書く。スクリプトの組み立ては無い

### US-3: 行き詰まったら、問題を変える選択肢として人間に上げる

- `skills/builder/references/templates.md:111-132` — return.md は「何が崩れたか / architect で決め直すこと / このビルドの状態」。試したこと・選択肢と失うもの・推奨の欄が無い
- `scripts/lib/phase.mts:46-70` `readReturn` — 見出しだけを読む。return.md は step の外で書かれ（`skills/builder/references/return.md:14-17`）、内容を確かめる CLI が無い
- `skills/builder/references/return.md:8-12`（ask: design-conflict）、`skills/builder/references/retry-policy.md:24-44`（ask: retry-limit。「問題 / 試したこと / 原因 / 次のアクション」）
- `skills/conductor/references/headless-protocol.md:74-83` の `<hikyaku-blocked>` は本文が自由。`scripts/lib/conductor.mts:269-308` `parseFinalText` は本文を検査しない。人間に上げる内容は `skills/conductor/SKILL.md:433-443`

### US-4: 知見を「なくす」から考え、書いた基準を機械の検査やリファクタへ移す

- `skills/close-cycle/references/persistence.md:25-37` — 置き場の順は 1「機械で防げる」から。「なくす（リファクタ）」の行が無い（`docs/concepts.md:79` と食い違い）
- `agents/doc-triager.md:16-22, 54-57` — 置き場の順を写している（AGENTS.md の「persistence.md を写さない」規約に反する現状）。`docs/configuration/persistence.md:25-33` も同じく「なくす」が無い
- `scripts/lib/rules.mts:225-235` `measureRules` の `stale` と `scripts/commands/rules.mts:61-69` — どのファイルにも一致しない rule の検出は**既に実装済み**（US-4.3）。手順側（builder / close-cycle）からの接続だけが無い
- `scripts/lib/rules.mts:113` `matchesRule`、`:212` `trackedFiles` — パスと rule の照合の部品
- レビューの指摘がどの rule を引いたかの記録は無い。生の出力は `.git/hikyaku/reviews/<cycle>/<phase>/round-<n>-<kind>.md`（コミットされない、`scripts/commands/review.mts:267-269`）
- `scripts/lib/promotions.mts:128-140` `parseCandidate` / `PLAIN_TARGETS` — 宛先・印・理由の語を足す場所

### US-5: 領域の開発頻度を、置き場と見直しの判断に反映する

- `scripts/lib/git.mts` — パスの最終コミット日を返す関数は無い。`tryGit`（:29-47、private、終了コードで判定）の上に足せる
- 前提・基準をパスに結び付けて記録する形式はどこにも無い（US-5.5 は新規）
- 閾値は現状すべて定数（`RULE_LOAD_WARNING`、`GUIDE_REVIEW_*`）。設定で変える前例は `[context]`・`[diff]`（`scripts/lib/config.mts:878-888` `readDiffPatterns`）

### US-6 / US-7: ADR・constraints・design-questions に分けて書く

- `skills/architect/references/templates.md:72-100` — ADR は「決定 / 文脈 / 検討した案 / 採用理由 / トレードオフ / 影響範囲」。外の前提（事実か仮定か・確かめた日）・推奨・受け入れたこと・再評価条件の欄が無い。`skills/architect/steps/adr.md:9-12` が項目を写している
- `skills/architect/references/templates.md:3-13` — design-questions.md は「Q / 回答」のみ
- **constraints のテンプレートは存在しない**（close-cycle・init のどちらにも無い。`skills/close-cycle/steps/G10.md:24` に注意が1行あるだけ）
- スクリプトは ADR も design-questions.md も解析していない

### US-8: ポインタに件数や範囲を書かない

- `scripts/commands/validate.mts:50-163` — 問題はすべて `ValidationError`（終了コード 2）で、**警告の段階が無い**。永続ドキュメントの本文は読んでいない（パスは `loadGuide` で引ける）
- ID 範囲の書式を検出する正規表現は無い。近いのは `scripts/lib/traceability.mts:13` と `proseLines`（`integrity.mts:154` と `traceability.mts:18` に同じ実装が重複）
- 件数を添えさせている指示: `skills/build-manager/references/templates.md:112`（「（8ファイル）」）、`skills/builder/references/templates.md:41,45,46`（plan.md の「約 〇 行」。予測ピークの根拠）、`skills/close-cycle/steps/G10.md:52-57`・`collect.md:20`、`skills/init/steps/pr.md:27`・`triage-approval.md:5-26`、`skills/conductor/SKILL.md:289`、`skills/token-guide/steps/propose.md:19`。ID 範囲（`X-1〜X-5`）を書かせる箇所は無い

### US-9: 基準に理由を残し、消して指標を見る経路を持つ

- `scripts/lib/promotions.mts:142-156, 232-243` — 「役に立たなかった記述」（古い / 自明 / 無関係）の読み取りと束ねは既存。消す候補の入力になる
- 基準の理由（何を防ぐか・何に立つか）と重要度の書式は、rule の雛形（`persistence.md:63-73`、frontmatter は `paths` だけ）にも `Candidate`（`promotions.mts:31-42`）にも無い
- 品質の指標の元: 差し戻し＝`design/progress.jsonl` の `result:"restart", round:"return"`（return.md は消えるので progress から数える）、ゲートの差し戻し＝`result:"rejected"`、重要度が高の落とし穴＝promotions の `importance === "高"`。**レビューの重い指摘はコミットされた記録に無い**
- サイクルをまたいで集める前例: `scripts/lib/tokens-history.mts:212-231` `collectPeakRecords`、`:285-310` `guideReview`（閾値の定数と判定理由の文を返す）
- 別ブランチの PR の型: `scripts/lib/steps/close-cycle.mts:70-82` の `followups`（args に `guideReview` / `hooks`）と `skills/close-cycle/steps/followups.md`。`scripts/lib/steps/token-guide.mts:31-78` の `auto` の回（ゲート無し）

### US-10 / US-11: 承認を確認と同意に分ける・G10 を分ける

- `scripts/lib/steps/engine.mts:46-85` — `StepDefinition` に確認か同意かの属性が無い。`when` が false のゲートは手順から外れる
- `scripts/lib/steps/planner.mts:32-38` — G1 は `when: ctx.config.gates.userStories`。`user_stories_gate = false`（`scripts/lib/config.mts:1224`）で**外せてしまう**。`docs/configuration/profiles.md:37`「G1 は常に有効」と食い違う
- `scripts/lib/config.mts:58-85`（Gates）, `:187-282`（PROFILES）, `:1223-1230`（個別キー）
- `scripts/lib/conductor.mts:17-41` — `DEFAULT_HANDLERS.consent = "supervisor"`。**同意ゲートも既定で監督が答える**。`FIXED_CATEGORIES` は abandon と unknown だけ。`:62-89` ASKS は G2/G3/G4/G7 が confirm、G6/G8/G10 が consent の静的分類で、`enabledWhen` は gates と reviews しか見ない（中身や回の種類で分類を変えられない）
- `skills/conductor/SKILL.md:82-97` — 同意ゲートを監督に委任すると合意させる文面（`docs/concepts.md:190`・US-10.1・US-11.1 と食い違い）
- `scripts/lib/promotions.mts:27-42, 114-120` と `scripts/commands/promotions.mts:44-49` — 論理名の宛先はすべて `kind: "doc"` で区別されない。`skills/close-cycle/steps/G10.md` は全置き場を1回の提示で承認。`scripts/lib/steps/close-cycle.mts:57` でゲートは1つ
- `docs/configuration/profiles.md:22-39` — ゲート表に確認か同意かの列が無い

### US-12: G4 と G8 で、人間が判断すべきものだけを示す

- `skills/architect/steps/G4.md` — design-delta.md と指摘への対処を見せる。境界・パスの判定は無い
- `skills/builder/steps/G8.md:12-14` — plan.md と test-spec.md を全文提示。「（解釈）」の印はリポジトリのどこにも無い
- `skills/builder/steps/test-spec.md:20, 30` — シナリオごとの `- 対応: US-1.1` 行。これを読むスクリプトは無い
- `scripts/lib/traceability.mts:10-64` — user-stories の US-N.M 抽出と issue.md の「対応する受け入れ基準」の読み取り。test-spec は対象外
- `scripts/lib/steps/directive.mts:238, 277-279` — gate に値を渡す経路は `args` だけで、`renderDirective` は1行に潰す。量のある提示には専用コマンドが要る

### US-13: アプリケーションの状況を宣言する

- 新しい宣言キーの先例は `[data_integrity]`: 読み込み `scripts/lib/config.mts:387-395, 1039-1049`、ルート設定限定 `:1080-1091`（`assertCycleOverridable` :1057-1104）、表示 `scripts/commands/config.mts:39, 58-118`、判定 `scripts/lib/integrity.mts:80-147`（判定できないときは許さない側）
- glob の照合は `scripts/lib/integrity.mts:28-50` `branchPatternToRegExp`（`*` と `**`）か `scripts/lib/rules.mts:113` `matchesRule`
- `scripts/lib/conductor.mts:437-451` `settingsDigest` — 設定ファイルの内容ごと入るので、新しいキーは自動でダイジェストに入る
- 未知のキーはエラー（`assertKnownKeys` `config.mts:575`）

### US-14: 委任の前提を確かめ、崩れたら尋ねる

- `scripts/lib/config.mts:15-16, 1058-1066` — profile は cycles.md が唯一の正。profile を切り替えるコードは無い（US-14.3 は現状で満たす）
- `scripts/lib/steps/architect.mts:149-155, 177-183` — G3・G4 の `when` に回の種類の条件が無く、express の再設計回では G3 も G4 も省かれる（US-14.4 は未実装）
- 設計と要件の衝突（ask: design-conflict）は build-NN/questions.md に残るだけで、progress.jsonl の出来事にならない。「委任を続けるか」を尋ねる問いはどこにも無い

### US-15: conductor の監督は安全側にだけ倒す

- `skills/conductor/SKILL.md:399-421` — G3 は「推奨案が user-stories と constraints に反していなければ推奨案」、unsafe-split・design-conflict は安全側。安全側の原則は指示文だけにあり、スクリプトの判定は無い
- `scripts/lib/conductor.mts:228-244` `resolveAsk` — 優先順は fixed → escalate → delegate → 既定
- `skills/conductor/references/headless-protocol.md:85-97` — 監督の判断の記録先（design-questions.md / build-NN/questions.md / コミットメッセージ）

### US-16: 中身を含まないフィードバック

- `scripts/lib/progress.mts:30-54` — 中身を含まない欄は `at / skill / step / result / round / peak / context / hikyaku`。`input`（人間の答え）・`reason`（自由文）・`pr`（URL）・`session` は中身か識別子を含む
- 止まった手順は `result:"failed"`、ゲートの時間はゲートの記録の `at` と直前の記録の `at` の差で導ける（ゲートの判別は `scripts/lib/steps/index.mts:23-38` の `kind:"gate"`）
- `upstream` は `promotions.mts:28, 138` で `kind:"upstream"` として読めるが、本文は自由文でプロジェクトの中身を含みうる
- 書き出しのコマンドは無い

### US-17: document-guide.md のアンカー

- `scripts/lib/docs.mts:120-128` `extractPath` は `#` を剥がさない。`:211-214` `validateGuide` は `existsSync` で検査するので `docs/concepts.md#用語` は「パスが存在しません」になる
- `scripts/commands/context.mts:272`（存在の検査）、`:98-103` `isAutoLoaded`（完全一致）、`scripts/lib/docs.mts:238-258` `renderIndexBlock`（パスをそのまま書く）
- 見出しから GitHub 式アンカーを作る関数は無い。見出しの節を拾う部品は `promotions.mts:82-112` `sectionItems`

### US-18: `gh` が使えない環境

- `scripts/commands/reviewers.mts:48-59` — 設定が空でも skip でも、先に `gh pr view` を実行して失敗すると終了コード 1。`scripts/lib/reviewers.mts:61-71` `planReviewers` は skip と空の一覧を PR の状態より前に決められる形（conductor ブランチ向けの判定だけ `baseRefName` が要る）。終了コード 1 は `tests/conductor.test.mts:888-897` で固定されている
- `scripts/commands/pr-ready.mts:35` — `gh pr view` を try で囲んでおらず、ENOENT がスタックトレースのまま出る
- 手本: `scripts/commands/external.mts:79-86, 138-165` — `hasGh` で判定し、`reason:"gh-not-found"`・人間の代わりの手順・終了コード 0
- `skills/*/steps/publish.md:10-11` — レビュアーの依頼の失敗は指示文で「伝えて完了」としているが、CLI の終了コードでは区別されない

### US-19: 未決事項と暫定の決定の記録（G3 の途中で追加）

- 追記型の記録の前例は作業単位ごとの progress.jsonl だけ（`scripts/lib/progress.mts:17, 64, 100-103`）。サイクル全体で1本の追記型の記録は無い
- サイクルの記録を集める型: `scripts/lib/promotions.mts:164-185` `promotionSources`（planning / design / 各 build-NN / 各 patch を固定の順で列挙）と `:187-217` `collectPromotions`。作業ツリーだけを読むので、いま居るブランチに在るものしか見えない
- 記録する側の現状
  - planner: `skills/planner/references/templates.md:3-13` の questions.md は `### Qn:` / `**回答**:` だけ。未回答の書式は決まっていない（`steps/user-stories.md:8-9`）
  - builder: questions.md は `## Qn:`（見出しの深さが planner と違う。`skills/builder/references/templates.md:65-77`）。handoff.md の「残したこと」（`:93-96`）は自由文で、いつ・誰が決めるかの欄は無い
  - サイクルに属す patch: `cycles/{cycle}/patches/{YYYYMM}/{slug}/` に progress.jsonl と handoff.md を書ける（`scripts/lib/patch.mts:6-7, 24-27`、`scripts/lib/steps/patch.mts:28, 45-51`）
  - conductor: 監督の判断は design-questions.md / build-NN/questions.md、G6・G10 はコミットメッセージ（`skills/conductor/references/headless-protocol.md:85-97`）。どれもスクリプトは読まない
- questions 系（planning/questions.md・design-questions.md・build-NN/questions.md）を解析するスクリプトは無い

「いつ」に使えるサイクルの中の出来事と、それを判定する既存の関数:

- フェーズの開始: `scripts/lib/phase.mts:116-193` `deriveState`、作業単位の記録の有無（`scripts/lib/steps/locate.mts:72-111, 159-175`）
- ゲートの開始: `scripts/lib/steps/engine.mts:163-241` `evaluate` の `current` が gate であること（`directive.mts:241-243` で `ask` にゲート ID）
- PR のマージの前: 各フェーズの `pr` ステップ（`recordsPr`）が current になった時点。`publicationStep`（`scripts/lib/steps/publication.mts:4-15`）。サイクル側の `mergePending`（`phase.mts:122-125`）。conductor の最後の PR は指示文の中だけで、step の定義は無い
- サイクルの close: `scripts/lib/steps/close-cycle.mts:31-33` `cycleClosed`、`:67` の close ステップ、`scripts/commands/cycle.mts:680-734`

示す先:

- `scripts/lib/steps/directive.mts:143` の `notices: string[]` は描画（`:291`）まで配線済みだが、`:199` で常に `[]` で、どこからも値が入っていない。`buildDirective` は step next / report / restart と `directiveOf`（Stop フック・step where・conductor parse）から呼ばれるので、差し込めば全経路に効く
- `scripts/commands/cycle.mts:534-667` `cycle status`（JSON `:589-607`、テキスト `:609-663`）。差し戻しの注記（`:614-621`）が節の手本
- `skills/navigator/SKILL.md:33-79, 85-99` は `cycle status` などの JSON だけを根拠にする。JSON に欄を足せば判定表に1行足すだけ
- PR 本文はすべてのフェーズで LLM が書く（`skills/*/steps/pr.md`）。スクリプトが組み立てる前例は `pr title`（`scripts/commands/naming.mts:168`）と `external ref` の1行だけ。directive の値で節の有無を切り替える型は architect の `designChoiceGate`（`skills/architect/steps/pr.md:13-14`）

### US-20: 事後同意（G3 の途中で追加）

- サイクル設定の読み込みは `scripts/lib/config.mts:1106-1194` `loadConfig`。マージの前はルートとサイクルを別の table で持つ（ルートは `:1110-1128`、サイクルは `:1178-1191`）
- サイクル設定で弾くキー: `assertCycleOverridable`（`:1057-1104`。profile / ask / `data_integrity.release_branches`）、`CYCLE_LOCKED_KEYS`（`:417`）。**「サイクル設定でのみ書けて、ルートでは不可」のキーの前例は無い**。ルート側の検査は `:1124-1128` の並びに足せる
- サイクル設定は create-cycle が書き出す（`scripts/commands/cycle.mts:55, 291`）。設定ファイルの内容ごと conductor の digest に入る（`scripts/commands/conductor.mts:556-559`）

### US-21: conductor の走りきり（G3 の途中で追加）

- `skills/conductor/SKILL.md:39` は「逐次実行」と固定。`:117-127` は `resumeAt` か、`available` のうち番号が最小の1件を選ぶ。順序と並行を決める処理はスクリプトに無く、指示文（LLM）が選ぶ
- 依存の判定: `scripts/lib/tasklist.mts:302-311` `readyBuilds`、`:314-317` `blockedBuilds`。tasklist の dependencies はビルド ID の列挙だけで、ビルド以外（問い）への依存を書く列は無い（`:16, 89-92`）
- `scripts/commands/next.mts:76` は差し戻し中なら `available=[]` で全ビルドを止める。`:77-79` は origin にブランチがあるビルドを `inProgress` として外す
- ループ全体が止まる箇所: human の gate で `AskUserQuestion` を待つ（`SKILL.md:197, 433-443`）。blocked で returned が無いとき（`:295-300`）。violation の2回目（`:306-308`）。error（`:310-315`）。check-pr の不合格・headSha・digest の不一致（`:252-275`）
- 再開: `conductor launch … --resume {sessionId} --message {回答ファイル}`（`scripts/commands/conductor.mts:164-196`）。状態も session-id も保存しない（`SKILL.md:27-28`）
- 最後の PR の本文は監督（LLM）が組み立てる（`SKILL.md:338-344`）。`pr body` に当たるコマンドは無い
- Step 0 の委任の範囲の確認: 文面は `SKILL.md:82-95`、データは `conductor asks`（`scripts/commands/conductor.mts:65-111`）

## 既存の規約・パターン

- **命名規約**: CLI は `register({ name: "<group> <verb>", usage, details, writes, run })`。判定関数は `validateX(...) → Problem[]`、`readXSection(issue)`。見出しの定数は export する（`PROMOTE_HEADING` など）
- **ディレクトリ構成方針**: 判定・集計は `scripts/lib/*.mts` の純粋な関数、git / gh の呼び出しと出力は `scripts/commands/*.mts`。手順の条件は `scripts/lib/steps/<skill>.mts` の `when / evidence / requires / accepts / args / stop`。ステップを足したら `skills/<skill>/steps/<id>.md` が必須（`step lint`）、問いを足したら `（ask: id）` と `ASKS` を同期（`conductor lint`）
- **エラーハンドリング**: 利用者の誤りは `HikyakuError(message, hint)`、検査の失敗は `ValidationError`（終了コード 2）。読めない行は捨てずに `unparsed` で返す。git は終了コードで判定し、locale 依存の文字列を見ない。判定できないときは安全側に倒す（`integrity.mts:80-83`）。外部に届かないことでワークフローを止めない（`external.mts:117`）
- **設定**: 未知のキー・不正な値はエラー。ルート設定限定のキーは `assertCycleOverridable` で弾く。`ResolvedConfig`（`config.mts:332-370`）に型を足し、`finalize`（:1254-1288）で読む
- **テスト**: `tests/<module>.test.mts`（node:test・node:assert/strict）。手順の結合は `step*.test.mts` で `workspace(t, true)`。偽の gh は `useGh`（`tests/conductor.test.mts:464`）

## 拡張ポイント

- `scripts/lib/steps/engine.mts` `StepDefinition` — 判断の種類（確認 / 同意）を持たせる場所。gate の `when` と組み合わせて「同意は外せない」をエンジンで保証できる
- `scripts/lib/conductor.mts` `AskDefinition` / `DEFAULT_HANDLERS` / `resolveAsk` — 同意を人間に固定する場所
- `scripts/lib/progress.mts` `ProgressEvent` と `scripts/commands/step.mts` `buildEvent` — 異議・受け入れたこと・拠り所の前提を報告に添える場所（`peak` / `recordsPr` の型に倣う）
- `scripts/lib/config.mts` — アプリケーションの状況・重い領域と境界のパス・休眠の期間・rule の閾値の新しいテーブル
- `scripts/lib/git.mts` — `--name-status` と hunk、パスの最終コミット日を取る関数
- `agents/doc-reviewer.md` — 合意と差分を突き合わせる新しい context
- `scripts/lib/promotions.mts` — G10 の同意と確認の区分、宛先「なくす」、基準の理由
- `scripts/lib/steps/close-cycle.mts` の `followups` — 基準を消す別ブランチの PR と、指標の比較
- `scripts/lib/docs.mts` `DocEntry` — `path` と `anchor` を分ける
- `scripts/commands/validate.mts` — 警告の段階、ID 範囲の検査、アンカーの節の検査
- `scripts/commands/reviewers.mts` / `pr-ready.mts` — `gh` の失敗を external.mts と同じ形に寄せる

## 永続ドキュメントとコードの食い違い（コードを正とし、ここに記録するだけ）

- `docs/configuration/profiles.md:37` は「G1 は常に有効」と書くが、コードは `user_stories_gate = false` で外せる
- `skills/conductor/SKILL.md:82-97` は同意ゲートを監督に委任させるが、`docs/concepts.md:190` と AGENTS.md の原則 11 は「同意は conductor でも省かない」
- `agents/doc-triager.md:16-22` は persistence.md の置き場の順を写している（AGENTS.md のスクリプト規約「写さず persistence.md を読ませる」に反する）
- `skills/conductor/SKILL.md:39`（逐次実行）と human の gate で監督のセッション全体が止まること（`:197`）は、`docs/concepts.md` の「conductor は、明示した範囲で委任する」の走りきりの段落（US-21.2）と食い違う
- `docs/concepts.md` の「知見の置き場」「基準は少なく保ち」「Hikyaku 自身を直す」節は、まだ仕組みが無い理想の姿（このサイクルの対象そのもの）
