# 設計差分

設計判断の理由と退けた案は `.hikyaku/decisions/20261116-*.md` の ADR が正。ここには、作るものの責務・境界・データの流れだけを書く。

## このサイクルで作るもの

### 1. 承認の種類と上限（US-10・US-11・US-13・US-14・US-15）

- **ステップ定義が承認の種類を持つ。** gate の `StepDefinition` に `consent(ctx): "now" | "deferred" | false`（理由つき）と `enabled(ctx)` を足し、エンジンは同意の回を設定で外さない。`when` は構造の条件（options をスキップした等）だけを表す
  - G1: 常に `now`。`user_stories_gate` キーは廃止し、書かれていたら移行のヒントつきのエラー
  - G3: 差し戻しからの再設計の回か、options の報告（`--harm` / `--paths`）を `risk.mts` が上限と比べて超えれば同意（申告したパスが重い領域に当たれば、害の重さに関わらず超えるとみなす）。事後同意が有効なら `deferred`。`--harm` と `--paths` は options の done の必須欄で、欠けていれば同意（`now`）に倒す。G3 の時点では design-delta.md と ADR がまだ無いので、申告の裏取りは G4 で行う
  - G4: 差し戻しからの再設計の回なら同意（US-14.4）。`gate brief G4` が外との境界（`[boundaries] external`）の変更を検出したときも同意（`now`。外との境界はユーザーが同意するもので、事後同意には回さない）。G3 の申告の裏取りもここで行う: design-delta.md と ADR が触れるパスが重い領域に当たり、その領域が G3 の申告（`--paths`）に当たっていなければ、上限を超える受け入れとして同意にする（事後同意が有効なら `deferred`。申告が当たっていれば G3 がすでに同意になっている。LLM の申告は上げる向きにしか効かない）。それ以外は確認
  - `deferred` の意味: 同意の部分をマージの前の同意ゲートへ遅らせる。その回のゲート自体は確認として `enabled` で評価し（プロファイルで省ける）、`risk` の事項が記録されていることを `accepts` で確かめる
  - G6・G8: 確認。全プロファイルで有効のまま、conductor では監督が答える
  - G10: ゲート1つのまま、同意が要る変更があれば同意。同意が要る変更は、`decisions`・`constraints` への変更のうち、このサイクルの ADR の frontmatter の `status` を `accepted` から `implemented` に変えるだけのものを除いた全部（設計の質問 Q11。新しい ADR、本文の変更、覆された判断への書き換えは同意のまま）。`promotions.mts` の1つの関数がこれを判定し、G10 の `consent`（昇格の候補と、作業ツリーの差分の両方を見る）と `write` の `accepts` が同じ関数を使う。同意が要る変更が無ければ確認として `promotion_gate` で省ける。`promotions --json` が候補ごとに `approval` を返し、提示を分ける。`write` の `accepts` は、同意が要る差分があるのに同意の承認が無ければ受け付けず、directive の `args.reworkFrom` で G10 へ戻す（戻った回の G10 は差分を見て同意になる）
- **directive** が `approval` と理由を出し、conductor は `childStep` からそれを読んで `resolveAsk` に渡す。同意はユーザーに固定し、`delegate` でも上書きできない。`DEFAULT_HANDLERS.consent = "user"`、`consent` は `FIXED_CATEGORIES` に入る。ASKS の G6・G8 は confirm に直す
- **委任の前提が崩れた出来事**（US-14.2）: 差し戻しは `return.md`、設計と要件の衝突は builder が `（ask: design-conflict）` で `ledger open --type question --ask design-conflict` を記録する（progress.jsonl ではなく未決事項の記録に残るので、スクリプトが判定できる）。architect の差し戻しからの再設計の回の先頭と、builder で design-conflict の事項が記録された直後の `step next` に、gate `delegation` を置く。conductor では `delegation` をユーザーに固定する
- **監督の答えは安全側だけ**（US-15.1〜15.3）: 監督が答えてよい問い（confirm・spec）の directive に、スクリプトが決めた安全側の既定（推奨案、unsafe-split なら安全な分割、design-conflict なら差し戻し）を載せる。`conductor launch --from supervisor --choice <値>` は、安全側の既定以外の値なら受け付けず、ユーザーに上げるよう返す。事後同意が無効なときに監督の答えが上限を超える受け入れになる場合も、同じ検査でユーザーに上がる
- **答えの出どころ**（US-19.7）: `conductor launch --from user|supervisor` が子の環境変数 `HIKYAKU_ANSWER_FROM` を設定する。launch は、子の現在の問いの handler がユーザーなのに `--from supervisor` なら弾く。conductor の子（`HIKYAKU_CONDUCTOR_CHILD=1`）の中の `ledger decide --by user` は `HIKYAKU_ANSWER_FROM=user` を要し、その値を決定のレコードに残す。この検査は取り違えを防ぐもので、子が環境変数を自分で付ける偽装は防げない（ADR pending-items-ledger の「受け入れたこと」）。最後の PR の本文の決定の一覧には、答えの出どころを添える
- **新しい問い**: `delegation`（委任の前提が崩れた出来事のあと、委任を続けるか。US-14.2）と `deferred-consent`（事後同意の一覧。US-20）。どちらもユーザーに固定。`（ask: …）` タグと ASKS を同期する
- **G1 でプロファイルを確かめる**（US-14.1）: planner の G1 の args に profile と、サイクル設定の `[consent] deferred` の値を添え、提示に1行ずつ出す（事後同意の値は 3節の有効の判定に使う）
- **アプリケーションの状況**: ルート設定限定の `[app]`（`exposure` / `data` / `impact` と、マージがユーザーの関門である前提のキー）、`[[app.areas]]`（`paths` と3軸）、`[boundaries]`（`external` / `internal` のパス）。読み込みは `[data_integrity]` の先例に倣い、サイクル設定にあればエラー。`risk.mts` がパスごとの解決・上限の表・重い領域の照合を持つ。宣言が無ければ上限なし
- **上限はユーザーがマージした宣言で決める**: `risk.mts` は、作業ツリーの宣言と、ベースブランチ（`resolvePrBase` の `defaultBase`。`base_branch` か、デフォルトブランチ）との merge-base にある宣言のうち、厳しいほうを使う。PR のマージ先（`base`）は使わない（スタックでは未マージの前フェーズのブランチ、conductor では監督が取り込む conductor ブランチになり、どちらもユーザーのマージを経ていない）。作業中のブランチや conductor ブランチで宣言を緩めても、ユーザーがベースブランチへマージするまで上限は緩まない（基準を読めなければ作業ツリーの宣言を使い、そのことを `notices` に出す）。`[app]`・`[[app.areas]]`・`[boundaries]`・サイクル設定の `[consent]` の変更は、diff facts の「設定の変更」として並び、agreement-review が合意と突き合わせる
- **宣言の変更**（US-13.5）: `ledger premises --changed-from <base>` が、merge-base と HEAD の `[app]` の差分から変わったキーを出し、それを拠り所にした受け入れを並べる。対象は、作業ツリーにある全サイクルの `decisions.jsonl` の受け入れと、`decisions`（ADR）・`constraints` の「受け入れたこと」の行（US-6.6）。行の書式は `- <受け入れたこと>（拠り所: \`<前提の参照>\`[, \`<前提の参照>\`]）` に固定し（拠り所にする外の前提が無い行には付けない）、`ledger premises` が `docs.mts` の `loadGuide` で所在を引いて読む。宣言を変える PR はサイクルの中の出来事なので、Q12 のスコープ外（「いつ」をサイクルの外の出来事にすること）には当たらない（G4 で監督が判断、ユーザーの事後同意待ち）。各フェーズの `pr` の args に `declarationChanged` を添え、PR 本文に載せる。conductor の最後の PR（conductor ブランチ→ベースブランチ）の本文にも載せる（ユーザーが読んでマージするのはこの PR なので）。`validate --base` でも警告する（CI 向け）。ADR・`constraints` の「受け入れたこと」の節にあって、箇条書きでない行や、`（拠り所: …）` の中身が参照の書式に合わない行は、読み飛ばさずに `ledger premises` と `validate` の警告に出す

### 2. 未決事項と決定の記録（US-1・US-19）

- 作業単位ごとの `decisions.jsonl`（`planning/`・`design/`・`build-NN/`・サイクル直下・`patches/{YYYYMM}/{slug}/`）。書き手は `hikyaku ledger open / decide / object` だけ（`--dry-run` つき）。決定のレコードは、事項のあるファイルではなく、決めた作業単位のファイルに追記する（並行するビルドが前のフェーズのファイルへ追記して衝突しないように）。事項と決定は ID で結び、状態はサイクルの全ファイルを読んで導く。読み手は `ledger list / show / premises / consent-list / pr-section`
- 「誰が」は `user` / `ai:<phase>` / `supervisor`。表示は「ユーザー」「AI（<フェーズ>）」「監督」
- 期限が来た事項と過ぎた事項は、`buildDirective` の `notices`（現在は空のまま配線済み）に1事項1行で入る。Stop フック・step where の経路では読まない。`cycle status` の JSON とテキストに `ledger` の節（`due` / `open` / `rejected`）を足し、navigator は判定表に1行足す
- 記録する側（指示文は「`ledger open` を呼ぶ」ことと語彙だけ）: planner（未回答の質問）、architect（暫定の設計判断、異議）、build-manager（G6 の受け入れ）、builder（handoff の「残したこと」を事項にし、handoff には ID のポインタだけを書く）、サイクルに属す patch（`persist`）、close-cycle（`close` 期限の事項を示し、決定を記録）、conductor（子が記録する。監督の判断の記録先を headless-protocol で `decisions.jsonl` に改める）
- 異議を出す範囲（US-1.1）: すべてのゲート（G1〜G10・P1・P2）と、ユーザーに選ばせる問い。gate の directive に、スクリプトが固定の短い指示（どの宣言・記録と食い違うときに異を唱えるか、好みの違いには唱えない、`ledger object` の呼び方）と、照合に使える宣言・記録のポインタを載せる。各スキルの指示文には写さない
- 異議（US-1）: `ledger object` が `objection` の事項とユーザーの決定を対で書く。害が高なら `--accepts`（ユーザーの言葉）と `--premises` が必須。gate の `accepts` は、そのステップの高の異議に `accepts` 付きの決定があるかを見る。前提の参照の書式は `app.exposure` / `app.data` / `app.impact` / `app.merge_gate` / `area:<name>` / `constraints#<anchor>` / `adr:<file>`

### 3. 事後同意（US-20）

- サイクル設定限定の `[consent] deferred`（ルートに書いたらエラー。サイクル設定でだけ書けるキーの検査を `loadConfig` のルート側に新設）。有効になるのは、次のどちらかのときだけ: (a) G1 の承認の記録の値と、現在のサイクル設定の値が同じ。G1 の提示に事後同意の値を1行出し、`step report` が G1 の承認の記録（planning/progress.jsonl の任意欄）に、そのとき提示した値を残す。(b) ベースブランチ（`resolvePrBase` の `defaultBase`）との merge-base のサイクル設定に同じ値がある（ユーザーがマージしたコミットで入った）。G1 は常に同意でユーザーに固定なので、新しいゲートは足さない。G1 の後に作業中のブランチで AI が足しても効かず、後から選び直すには、ベースブランチへのマージか、planner を回し直して G1 を取り直すことが要る。PR のマージ先（`base`）は、スタックや conductor ではユーザーのマージを経ていないブランチになるので、判定に使わない。`ResolvedConfig.deferredConsent = { requested, effective, reason }`。前提の宣言が無ければ有効にせず、理由を `config`・`notices`・`conductor asks` に出し続ける
- 上限を超える受け入れ（G3・異議・監督の答え）は、有効なとき `risk` の事項（`who=user`、`when=merge`、`premises`・`loses` つき）として積む。G3 では options の報告から `step report` が自動で書き、`--loses` を必須にする
- `scripts/lib/steps/consent.mts` の `consentStep(skill)` が、architect・builder では `pr` の直前、patch では `publish` の直前に同意ゲートを置く。conductor の子では、最後のビルドのときだけ有効にし、サイクル全体の事項を対象にする（最後以外のビルドでは無効）。`accepts` は一覧の全項目にユーザーの決定があること
- 退け: 同じ作業単位の事項なら directive の `args.reworkFrom` でそのステップへ戻す。前のフェーズの事項なら `return.md` で差し戻す（return.md に「退けた項目」の節）。最新の決定が `rejected` の事項は「未解決の退け」として以後の PR 本文と `cycle status` に出し続け、作り直しのあとユーザーが `resolved` を記録すると消える
- PR 本文の「受け入れたリスク（事後同意）」「未解決の退け」「マージの前に決める事項」（`when=merge` の `question`・`provisional`）「期限を過ぎた事項」（US-19.5・19.6）の節は `ledger pr-section` が組み立てる。conductor の最後の PR（conductor ブランチ→ベースブランチ）の本文には、全フェーズの一覧と同意・退けの決定を載せる

### 4. conductor の走りきり（US-21）

- ユーザーに上げる問いは `AskUserQuestion` を出さずに子へ記録させ、blocked で終えさせる。`conductor waiting` と `next --json` の `waiting` が、待っている事項とビルドを導く。`available` が空になったらまとめて尋ね、答えごとに conductor ブランチを取り込んでから子を再開する
- Step 0 の委任の範囲の確認から「同意ゲートを監督に委任する」文面を除き、事後同意の有効・無効と、問いを積む方針を示す（`conductor asks` の JSON に `deferredConsent`）
- error・2回目の violation・check-pr の不合格は、従来どおりその場でユーザーに上げる

### 5. 差分の事実と合意の突き合わせ（US-2）

- `scripts/lib/diff-facts.mts` と `hikyaku diff facts <phase> [<cycle>] [--format json|pr]`（読み取り専用）。`git.mts` に `nameStatus` / `unifiedDiff` / `commitsTouchingSince` を足す。`[diff]` に `test_declarations` / `skip_markers` / `assertion_markers`（既定に追加される）
- builder に `agreement-review`（verify の後、review の前。`when` 無し、`produces: agreement.md`）。doc-reviewer に `agreement` の context。`skills/builder/steps/review.md` の自己確認（スコープとデータ安全）を削る
- PR 本文の節は `diff facts --format pr` が組み立てる。中身は、そのときの差分から作る事実と、`agreement.md` に builder が返した理由（US-2.6）。builder の pr.md はこの出力を貼る

### 6. 行き詰まりの報告（US-3）

- `scripts/lib/escalation.mts` の `checkEscalation`。`readReturn` が欠けを返し、builder の `stop`・`step restart architect --round return`・`escalates: true` のステップの `failed --reason`・`parseFinalText` で使う。テンプレートを「試したこと / 問題を変える選択肢（各項目に失うもの） / 推奨」にそろえる

### 7. 知見と基準（US-4・US-5・US-9）

- 置き場の順の先頭に「なくす（リファクタ）」と宛先 `refactor`。doc-triager から写していた順を消し、persistence.md を読ませる
- handoff の見出し「レビューの記録」。`review-records.mts` が回数と重い指摘を集め、`hikyaku rules` が移す候補・一致しない rule（既存の `stale`）・消す候補を並べる。builder と close-cycle の手順から呼ぶ
- rule の frontmatter の `prevents` / `basis` / `importance`。文書の基準と「永続化すること」の行の `（防ぐ: … / 立つ: … / 重要度: 高|中）`（US-9.5 の判定に使う）
- `git.mts` の `lastTouched`。`hikyaku areas dormant --paths <glob,...>` が、休眠した領域と結び付いた rule・ADR・constraints の項目を返す。architect の survey の後と builder の plan で、自分の挙げたパスを渡して呼ぶ（US-5.2）。置き場を決めるときと消す判断のときは `hikyaku rules` の各行に最終変更からの日数を添える（US-5.3・5.4）
- 基準を消す PR と、マージ前後2サイクルの指標（差し戻し・`rejected`・高の落とし穴・重い指摘）の比較は、close-cycle の `followups` の args（`ruleRemovals` / `metricsComparison`）に乗せる。揃わなければ「比較できない」。過去に消した基準とそのマージの時点は、状態を保存せずに導く: 消す PR は close-cycle の followups が `{close のブランチ}-criteria` のブランチで作り、`followups` の done の記録（サイクル直下の progress.jsonl の `pr`）に残る。後続のサイクルは closed のサイクルのこの記録と、ベースブランチの `git log` で削除したコミットの日時を引く
- 設定: `[rules] hit_threshold = 3`、`[areas] dormant_days = 180`、`[metrics] window = 2`

### 8. 記録のテンプレート（US-6・US-7・US-8）

- ADR のテンプレートに、外の前提（事実か仮定か・確かめた日）・推奨・受け入れたこと（拠り所の前提）・再評価条件・退けた推奨で失う利点・領域（任意。`領域: <glob>`、US-5.5）の欄を足す（このサイクルの ADR は領域を除いてこの形で書いた）。「受け入れたこと」は1件1行の箇条書きにし、外の前提を拠り所にする行は `（拠り所: \`<前提の参照>\`）` で終える（`ledger premises` が読む。拠り所にする外の前提が無い行には付けず、照合の対象にしない。参照の書式は2節と同じで、確かめていない前提は `assumption:<短い文>`）。`skills/architect/steps/adr.md` の記録項目も同時に直す
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

- `hikyaku feedback export [--dry-run]` が `{HIKYAKU_ROOT}/feedback/{YYYYMMDD}.md` に書き出す。中身は、progress.jsonl の中身を含まない欄（`at` / `skill` / `step` / `result` / `round` / `hikyaku`）から導いた「止まった手順」「ゲートにかかった時間」と、`upstream` の一覧。`input` / `reason` / `pr` / `session` は使わない。集計の単位はスキルとステップの ID だけで、サイクル名・ビルド番号・patch の slug・作業単位のパスは出力に含めない。`feedback/` が git の追跡対象外（`git check-ignore`）でなければ書き出さずに止める（導入済みのワークスペースでコミットされるのを防ぐ）。`upstream` の本文は自由文なので、下書きの中で「送る前に全文を読む」ことを示す
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
