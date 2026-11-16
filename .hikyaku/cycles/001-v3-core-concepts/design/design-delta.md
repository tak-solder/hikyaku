# 設計差分

設計判断の理由と退けた案は `.hikyaku/decisions/20261116-*.md` の ADR が正。ここには、作るものの責務・境界・データの流れだけを書く。

## このサイクルで作るもの

### 1. 承認の種類と上限（US-10・US-11・US-13・US-14・US-15）

- **ステップ定義が承認の種類を持つ。** gate の `StepDefinition` に `consent(ctx): "now" | "deferred" | false`（理由つき）と `enabled(ctx)` を足し、エンジンは同意の回を設定で外さない。`when` は構造の条件（options をスキップした等）だけを表す
  - G1: 常に `now`。`user_stories_gate` キーは廃止し、書かれていたら移行のヒントつきのエラー
  - G3: 差し戻しからの再設計の回か、options の報告（`--harm` / `--paths`）を `risk.mts` が上限と比べて超えれば同意。事後同意が有効なら `deferred`
  - G4: 差し戻しからの再設計の回なら同意（US-14.4）
  - G6・G8: 確認。全プロファイルで有効のまま、conductor では監督が答える
  - G10: ゲート1つのまま、候補に `decisions`・`constraints` があれば同意。それ以外の候補だけなら確認として `promotion_gate` で省ける。`promotions --json` が候補ごとに `approval` を返し、提示を分ける。`write` の `accepts` は、`decisions`・`constraints` のパスに触れる差分があるのに同意の承認が無ければ受け付けない
- **directive** が `approval` と理由を出し、conductor は `childStep` からそれを読んで `resolveAsk` に渡す。同意はユーザーに固定し、`delegate` でも上書きできない。`DEFAULT_HANDLERS.consent = "user"`、`consent` は `FIXED_CATEGORIES` に入る。ASKS の G6・G8 は confirm に直す
- **新しい問い**: `delegation`（委任の前提が崩れた出来事のあと、委任を続けるか。US-14.2）と `deferred-consent`（事後同意の一覧。US-20）。どちらもユーザーに固定。`（ask: …）` タグと ASKS を同期する
- **G1 でプロファイルを確かめる**（US-14.1）: planner の G1 の args に profile を添え、提示に1行出す
- **アプリケーションの状況**: ルート設定限定の `[app]`（`exposure` / `data` / `impact` と、マージがユーザーの関門である前提のキー）、`[[app.areas]]`（`paths` と3軸）、`[boundaries]`（`external` / `internal` のパス）。読み込みは `[data_integrity]` の先例に倣い、サイクル設定にあればエラー。`risk.mts` がパスごとの解決・上限の表・重い領域の照合を持つ。宣言が無ければ上限なし
- **宣言の変更**（US-13.5）: `ledger premises --changed-from <base>` が、merge-base と HEAD の `[app]` の差分から変わったキーを出し、それを拠り所にした受け入れを並べる。各フェーズの `pr` の args に `declarationChanged` を添え、PR 本文に載せる。`validate --base` でも警告する（CI 向け）

### 2. 未決事項と決定の記録（US-1・US-19）

- 作業単位ごとの `decisions.jsonl`（`planning/`・`design/`・`build-NN/`・サイクル直下・`patches/{YYYYMM}/{slug}/`）。書き手は `hikyaku ledger open / decide / object` だけ（`--dry-run` つき）。読み手は `ledger list / show / premises / consent-list / pr-section`
- 「誰が」は `user` / `ai:<phase>` / `supervisor`。表示は「ユーザー」「AI（<フェーズ>）」「監督」
- 期限が来た事項と過ぎた事項は、`buildDirective` の `notices`（現在は空のまま配線済み）に1事項1行で入る。Stop フック・step where の経路では読まない。`cycle status` の JSON とテキストに `ledger` の節（`due` / `open` / `rejected`）を足し、navigator は判定表に1行足す
- 記録する側（指示文は「`ledger open` を呼ぶ」ことと語彙だけ）: planner（未回答の質問）、architect（暫定の設計判断、異議）、build-manager（G6 の受け入れ）、builder（handoff の「残したこと」を事項にし、handoff には ID のポインタだけを書く）、サイクルに属す patch（`persist`）、close-cycle（`close` 期限の事項を示し、決定を記録）、conductor（子が記録する。監督の判断の記録先を headless-protocol で `decisions.jsonl` に改める）
- 異議（US-1）: `ledger object` が `objection` の事項とユーザーの決定を対で書く。害が高なら `--accepts`（ユーザーの言葉）と `--premises` が必須。gate の `accepts` は、そのステップの高の異議に `accepts` 付きの決定があるかを見る。前提の参照の書式は `app.exposure` / `app.data` / `app.impact` / `app.merge_gate` / `area:<name>` / `constraints#<anchor>` / `adr:<file>`

### 3. 事後同意（US-20）

- サイクル設定限定の `[consent] deferred`（ルートに書いたらエラー。サイクル設定でだけ書けるキーの検査を `loadConfig` のルート側に新設）。`ResolvedConfig.deferredConsent = { requested, effective, reason }`。前提の宣言が無ければ有効にせず、理由を `config`・`notices`・`conductor asks` に出し続ける
- 上限を超える受け入れ（G3・異議・監督の答え）は、有効なとき `risk` の事項（`who=user`、`when=merge`、`premises`・`loses` つき）として積む。G3 では options の報告から `step report` が自動で書き、`--loses` を必須にする
- `scripts/lib/steps/consent.mts` の `consentStep(skill)` が、architect・builder では `pr` の直前、patch では `publish` の直前に同意ゲートを置く。conductor の子では、最後のビルドのときだけサイクル全体の事項を対象にする。`accepts` は一覧の全項目にユーザーの決定があること
- 退け: 同じ作業単位の事項なら directive の `args.reworkFrom` でそのステップへ戻す。前のフェーズの事項なら `return.md` で差し戻す（return.md に「退けた項目」の節）。最新の決定が `rejected` の事項は「未解決の退け」として以後の PR 本文と `cycle status` に出し続け、作り直しのあとユーザーが `resolved` を記録すると消える
- PR 本文の「受け入れたリスク（事後同意）」と「未解決の退け」の節は `ledger pr-section` が組み立てる。conductor の最後の PR（conductor ブランチ→ベースブランチ）の本文には、全フェーズの一覧と同意・退けの決定を載せる

### 4. conductor の走りきり（US-21）

- ユーザーに上げる問いは `AskUserQuestion` を出さずに子へ記録させ、blocked で終えさせる。`conductor waiting` と `next --json` の `waiting` が、待っている事項とビルドを導く。`available` が空になったらまとめて尋ね、答えごとに conductor ブランチを取り込んでから子を再開する
- Step 0 の委任の範囲の確認から「同意ゲートを監督に委任する」文面を除き、事後同意の有効・無効と、問いを積む方針を示す（`conductor asks` の JSON に `deferredConsent`）
- error・2回目の violation・check-pr の不合格は、従来どおりその場でユーザーに上げる

### 5. 差分の事実と合意の突き合わせ（US-2）

- `scripts/lib/diff-facts.mts` と `hikyaku diff facts <phase> [<cycle>] [--format json|pr]`（読み取り専用）。`git.mts` に `nameStatus` / `unifiedDiff` / `commitsTouchingSince` を足す。`[diff]` に `test_declarations` / `skip_markers` / `assertion_markers`（既定に追加される）
- builder に `agreement-review`（verify の後、review の前。`when` 無し、`produces: agreement.md`）。doc-reviewer に `agreement` の context。`skills/builder/steps/review.md` の自己確認（スコープとデータ安全）を削る

### 6. 行き詰まりの報告（US-3）

- `scripts/lib/escalation.mts` の `checkEscalation`。`readReturn` が欠けを返し、builder の `stop`・`step restart architect --round return`・`escalates: true` のステップの `failed --reason`・`parseFinalText` で使う。テンプレートを「試したこと / 問題を変える選択肢（各項目に失うもの） / 推奨」にそろえる

### 7. 知見と基準（US-4・US-5・US-9）

- 置き場の順の先頭に「なくす（リファクタ）」と宛先 `refactor`。doc-triager から写していた順を消し、persistence.md を読ませる
- handoff の見出し「レビューの記録」。`review-records.mts` が回数と重い指摘を集め、`hikyaku rules` が移す候補・一致しない rule（既存の `stale`）・消す候補を並べる。builder と close-cycle の手順から呼ぶ
- rule の frontmatter の `prevents` / `basis` / `importance`。文書の基準と「永続化すること」の行の `（防ぐ: … / 立つ: …）`
- `git.mts` の `lastTouched`。`hikyaku areas dormant --paths <glob,...>` が、休眠した領域と結び付いた rule・ADR・constraints の項目を返す。architect の survey の後と builder の plan で、自分の挙げたパスを渡して呼ぶ（US-5.2）。置き場を決めるときと消す判断のときは `hikyaku rules` の各行に最終変更からの日数を添える（US-5.3・5.4）
- 基準を消す PR と、マージ前後2サイクルの指標（差し戻し・`rejected`・高の落とし穴・重い指摘）の比較は、close-cycle の `followups` の args（`ruleRemovals` / `metricsComparison`）に乗せる。揃わなければ「比較できない」
- 設定: `[rules] hit_threshold = 3`、`[areas] dormant_days = 180`、`[metrics] window = 2`

### 8. 記録のテンプレート（US-6・US-7・US-8）

- ADR のテンプレートに、外の前提（事実か仮定か・確かめた日）・推奨・受け入れたこと（拠り所の前提）・再評価条件・退けた推奨で失う利点の欄を足す（このサイクルの ADR はこの形で書いた）。`skills/architect/steps/adr.md` の記録項目も同時に直す
- constraints のテンプレートを `skills/close-cycle/references/` に新しく作る（前提・事実か仮定か・確かめた日・受け入れたこと・再評価条件・領域）
- design-questions.md のテンプレートに、質問ごとの選択肢・各案の欠点・推奨・回答と、推奨を退けたときに失う利点の欄を足す
- ポインタに件数や範囲を添えさせている指示文（codebase-survey の US-8 の節）を直す。`validate` に警告の段階（JSON の `warnings`、終了コード 0）を足し、永続ドキュメントとサイクルドキュメントの ID の範囲（`X-1〜X-5` の形）を警告する

### 9. G4 と G8 の提示（US-12）

- `hikyaku gate brief G4|G8 <phase> [<cycle>]`（読み取り専用）が提示の中身を組み立てる
  - G4: design-delta.md と ADR が触れるパスを `[boundaries]` の `external` / `internal` と照合し、外との境界の変更（同意が要る変更）と内部の境界の変更（確かめる変更）を分けて示す。宣言が無ければ従来どおりの提示
  - G8: test-spec.md の「（解釈）」の印が付いたシナリオと、どのシナリオの `- 対応:` にも無い受け入れ基準（`traceability.mts` に test-spec の読み取りを足す）だけを示す
  - 全文は `--full` で出す
- test-spec.md のテンプレートに「（解釈）」の印の書き方を足す

### 10. フィードバック（US-16）

- `hikyaku feedback export [--dry-run]` が `{HIKYAKU_ROOT}/feedback/{YYYYMMDD}.md` に書き出す。中身は、progress.jsonl の中身を含まない欄（`at` / `skill` / `step` / `result` / `round` / `hikyaku`）から導いた「止まった手順」「ゲートにかかった時間」と、`upstream` の一覧。`input` / `reason` / `pr` / `session` は使わない。`upstream` の本文は自由文なので、下書きの中で「送る前に全文を読む」ことを示す
- `feedback/` を `.gitignore` の対象にする（init が足す）。起票の下書き（issue の本文）は AI が用意し、送る処理は持たない

### 11. 文書の登録と `gh`（US-17・US-18）

- `DocEntry` が `path` と `anchor` を分けて持つ。`validateGuide`・`context` の存在の検査・`isAutoLoaded`・`renderIndexBlock` はアンカーを除いたパスで比べる。`context` はアンカー付きで返す。見出しから GitHub 式のアンカーを作る関数を足し、`validate` が節の消失を検出する
- `pr request-reviewers` は、skip と空の一覧を `gh` より前に判定する。`gh` の失敗は `external sync` と同じく `applied: false`・理由・ユーザーが代わりに行うこと・終了コード 0 にする（`tests/conductor.test.mts` の期待値を変える）。`pr-ready` の `gh` の呼び出しも同じ扱いにする

### 12. 用語（G3 で受けた指示）

- docs/・スキル・エージェント・CLI の出力で、コーディングエージェントを操作する人を「人間」と書いているところを「ユーザー」に改める（concepts.md と AGENTS.md は直し済み）。conductor の `Handler` の値は `"human"` → `"user"`

## 永続ドキュメントの更新予定

- `decisions`（`.hikyaku/decisions/`）: このサイクルの ADR を `accepted` → `implemented`。ADR のテンプレートの欄（US-6）は、このサイクルの ADR がすでに満たす
- `conventions`（`AGENTS.md`）の「スクリプト」: `decisions.jsonl` は CLI だけが書くこと、サイクル設定でだけ書けるキーの扱い、ゲートの `consent` / `enabled` の書き方、`（ask: delegation）`・`（ask: deferred-consent）` の追加に伴う規約、PR 本文の事実の節は CLI の出力を貼ること
- `conventions`（`AGENTS.md`）の「プラグイン構成」: 作業単位に `decisions.jsonl` が増えること（ディレクトリの説明は docs/reference/directory-layout.md が正なので、ここにはポインタだけ）
- `glossary`（`docs/concepts.md`「用語」）: 追記なし（未決事項・事後同意は直し済み）。`ゲート` の説明が profiles.md の確認・同意の列を指すことを確かめる
- `overview`: 未作成のまま。close-cycle で作るかを G10 で決める（作るなら「ステップエンジン・CLI・スキルの責務と、正の所在へのポインタ」）
- `constraints`: 未作成のまま。このサイクルで新しく作るテンプレートを使うのは次に制約が出たとき

## 既存構造への影響

- **設定**: `user_stories_gate` を廃止（書かれていればエラー）。新しいテーブル `[app]`・`[[app.areas]]`・`[boundaries]`・`[consent]`・`[rules]`・`[areas]`・`[metrics]`、`promotion_gate`、`[diff]` の3キー。互換は要件にしない（Q5）
- **ワークスペースのデータ**: 新しいファイル（`decisions.jsonl`、`agreement.md`、`feedback/`）を足すだけで、progress.jsonl・tasklist.md・cycles.md の形は変えない。既存の記録はそのまま読める。追加の順は、読み手（lib と CLI）を先に、書き手（スキルの手順）を後にすれば、どのビルドのマージ時点でも、書かれていない記録を読みに行くだけで壊れない
- **エンジン**: `StepDefinition` に欄が増える。`when` から `gates.*` の条件を `enabled` に移すので、各 `steps/<skill>.mts` の G2・G3・G4・G7 の定義が変わる。`step lint` に「gate は承認の種類を持つ」の検査を足す
- **conductor**: `Handler` の値が `user` に変わる。同意ゲートを監督が答えなくなる（既定の振り分けの変更）。`skills/conductor/SKILL.md` の逐次実行の原則は保ち、待っているビルドを飛ばす
- **builder**: ステップが増える（`agreement-review`、同意ゲート）。review の自己確認が消える。handoff に「レビューの記録」の見出しが増え、「残したこと」は ID のポインタになる
- **close-cycle**: G10 の提示が同意と確認に分かれる。`followups` に基準を消す PR と指標の比較が増える
- **テスト**: `tests/conductor.test.mts`（gh の失敗の終了コード、同意の振り分け）、`tests/config.test.mts`（廃止キー、新キー、サイクル限定キー）、`tests/step*.test.mts`（ゲートの評価）の期待値が変わる
- **docs**: `profiles.md`（確認・同意の列、G1 の扱い）、`config-file.md`（新キー）、`workflow/*.md`、`reference/cli.md`・`directory-layout.md`・`agents-and-skills.md`、`configuration/persistence.md`、`operations/ci.md`（`validate --base`）。プラグインのバージョンは 3.0.0 のまま、CHANGELOG の `[3.0.0]` に積む（Q2）
