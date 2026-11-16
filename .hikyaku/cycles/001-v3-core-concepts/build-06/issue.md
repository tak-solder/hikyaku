# Build 06: 事後同意（PR を作る直前の同意ゲート）

## やること

- サイクル設定限定の `[consent] deferred` を足す。ルートに書いたらエラー（サイクル設定でだけ書けるキーの検査を `loadConfig` のルート側に新設）。`ResolvedConfig.deferredConsent = { requested, effective, reason }`。有効になるのは、`[app]` にマージがユーザーの関門である前提（`merge_gate`）が書かれ、かつ次のどちらかのときだけ: (a) G1 の承認の記録の値と現在のサイクル設定の値が同じ、(b) ベースブランチ（`resolvePrBase` の `defaultBase`）との merge-base のサイクル設定に同じ値がある。PR のマージ先（`base`）は判定に使わない。有効でなければ理由を `config`・`notices` に出し続ける
- planner の G1 の args に、サイクル設定の `[consent] deferred` の値を添え、提示に1行出す（build-04 のプロファイルの行と並べる）。`step report` が G1 の承認の記録（planning/progress.jsonl の任意欄 `deferredConsent`）に、そのとき提示した値を残す。値は設定からスクリプトが読み、LLM の引数では受け取らない
- `consent(ctx)` の `deferred`: 同意の部分をマージの前の同意ゲートへ遅らせ、その回のゲートは確認として `enabled` で評価する。`deferred` を返せるのは上限を超えるリスクの受け入れだけ（G3 と、build-15 の G4 の裏取りがこれに当たる。G1・G10 の `decisions`・`constraints`・宣言の変更・意図を変える判断・外の前提が要る判断・外との境界の変更は常に `now`）
- 上限を超える受け入れを `risk` の事項（`who=user`、`when=merge`、`premises`・`loses`）として積む: G3 は options の報告から `step report` が自動で書き、`--loses` を必須にする。異議は `ledger object --defer`（根拠が `app.*` / `area:*` のときだけ）。異議の害の重さを `risk.mts` の上限と比べ、上限を超える受け入れかを判定するのはこの build（US-13.3。上限を超えなければ、事後同意に関わらず build-04 のとおりその場で扱う）
- `scripts/lib/steps/consent.mts` の `consentStep(skill)` で、architect・builder は `pr` の直前、patch は `publish` の直前に同意ゲート（`（ask: deferred-consent）`、ユーザーに固定）を置く。`accepts` は一覧の全項目にユーザーの決定があること
- `ledger consent-list`（1項目を「受け入れたリスク / 拠り所の前提 / 失うもの」の3行に収め、`--full` で全文）と `ledger pr-section`（「受け入れたリスク（事後同意）」「未解決の退け」「マージの前に決める事項」「期限を過ぎた事項」の節）を足す。各 pr.md でその出力を本文に貼る
- 退け: 同じ作業単位の事項なら directive の `args.reworkFrom` でそのステップへ戻す。前のフェーズの事項なら `return.md` で差し戻す。退けによる return.md も build-09 の3節（試したこと＝退けられた受け入れとその拠り所 / 問題を変える選択肢と失うもの / 推奨）で書き、「退けた項目」に事項の ID を書く（`ledger` が下書きを出し、LLM が選択肢と推奨を書く）。最新の決定が `rejected` の事項を「未解決の退け」として PR 本文と `cycle status` に出し続け、作り直しのあとユーザーが `resolved` を記録すると消える
- conductor の子の中では、この build の時点では事後同意を有効にしない（安全側。conductor での扱いは build-07）
- ASKS とタグを同期する。`docs/configuration/config-file.md`・`profiles.md`・各フェーズの docs を直す。CHANGELOG に追記する

## やらないこと

- conductor での事後同意（最後のビルドの子の同意ゲート、最後の PR の本文、Step 0 の表示。build-07）
- 意図を変える判断・外の前提が要る判断の事後同意（スコープ外 Q7）
- マージを機械で止めること（スコープ外 Q18）、マージが関門かを GitHub の設定から確かめること（スコープ外 Q9）

## 対応する受け入れ基準

- US-10.5, US-13.3, US-19.5, US-19.6, US-20.1, US-20.2, US-20.3, US-20.4, US-20.5, US-20.7, US-20.8, US-20.10, US-20.11

## 受け入れ基準

- [ ] ルートに `[consent]` を書くとエラー。前提の宣言が無いときは有効にならず、理由が示される
- [ ] G1 の承認の後に作業中のブランチで `[consent] deferred` を足しても有効にならない。スタックした前フェーズのブランチや conductor ブランチに入っているだけでも有効にならない。G1 で提示して承認された値か、ベースブランチにマージされた値なら有効になる（一時リポジトリの結合テスト）
- [ ] 事後同意が有効なサイクルで、上限を超える受け入れが止まらずに `risk` の事項として積まれ、PR を作る直前の同意ゲートで一覧が示される
- [ ] 一覧の全項目にユーザーの決定が無ければ、同意ゲートも pr も完了にならない
- [ ] 退けた項目が同じ作業単位ならそのステップに戻り、前のフェーズなら return.md の経路に乗る。未解決の退けが PR 本文と `cycle status` に出続ける
- [ ] 上限を超えない異議と、根拠が宣言（`app.*` / `area:*`）でない `--defer` は、事後同意の一覧に積まれない
- [ ] PR 本文の節に、マージの前に決める事項と、期限を過ぎて決定の無い事項が載る
- [ ] 退けによる return.md が行き詰まりの報告の検査を通り、architect の再設計の回を始められる
- [ ] conductor の子では事後同意が有効にならない（この build の時点）
- [ ] `conductor lint`・`step lint`・`npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「3. 事後同意」と「1. 承認の種類と上限」（`deferred` の意味の項）
- `decisions` の `20261116-deferred-consent.md` — キー・同意ゲート・退けの経路がこの判断に従う
- `decisions` の `20261116-approval-kind-in-step-definitions.md` — `deferred` の評価がこの判断に従う

## 予測ピーク

読むファイル: `scripts/lib/config.mts`、`scripts/lib/ledger.mts`、`scripts/lib/risk.mts`、`scripts/lib/steps/engine.mts`・`publication.mts`・`planner.mts`・`architect.mts`・`builder.mts`・`patch.mts`、`skills/planner/steps/G1.md`、各スキルの `steps/pr.md`、`skills/builder/references/templates.md`（return.md）、`scripts/lib/escalation.mts`、`scripts/commands/step.mts`・`ledger.mts`、`scripts/lib/conductor.mts`
作成・変更するファイル: `scripts/lib/steps/consent.mts`、`skills/architect/steps/consent.md`・`skills/builder/steps/consent.md`・`skills/patch/steps/consent.md`、`scripts/commands/ledger.mts`（consent-list・pr-section）、上記の lib・手順・テスト・docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 115k | config.mts（loadConfig のルート側）・ledger.mts と commands/ledger.mts・risk.mts・engine.mts・steps/publication.mts・planner と architect と builder と patch の steps 定義・planner の G1.md・各 pr.md・builder の return テンプレート・escalation.mts・commands/step.mts・conductor.mts・ADR deferred-consent |
| 実装 | 90k | サイクル限定キー [consent] deferred と有効の判定（G1 の記録の値・ベースブランチ側）、G1 の提示と記録、deferred の評価、異議の上限との比較、risk 事項の自動記録、consentStep 新規、consent-list と pr-section（4節）、退けの行き先（reworkFrom・3節の return.md）、未解決の退けの表示、ASKS deferred-consent |
| テスト | 60k | ルートに書いたらエラー、前提の欠け、同意ゲートの出現と accepts、退け、pr-section の出力 |
| 未知の領域 | 40k | エンジンのやり直しの規則と、退けの戻り先の組み合わせ |
| **予測ピーク** | **395k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
