## About Hikyaku

@README.md

利用者向けの説明は `docs/` にあります。仕様を確認するときは `docs/reference/` を、フェーズの手順を確認するときは各 `skills/<name>/SKILL.md` を読んでください。

## 用語集

用語の定義は [docs/concepts.md](docs/concepts.md#用語) が唯一の正です。ここに表を複製しないでください。

## 設計の原則（v3）

スキル・エージェント・スクリプトを変えるときは、次の原則に沿っているかを確かめてください。理由の説明は [docs/concepts.md](docs/concepts.md) が正で、ここには「変更するときに何を守るか」だけを書きます。並びは concepts.md の節と同じです。原則に反する変更が必要になったら、黙って例外を作らず、原則のほうを見直す提案としてユーザーに確認してください。

### 責任の分け方

1. **責任で分け、手順と判定はスクリプトが決める。** ユーザーは意図・外の前提・リスクの引き受け・境界の理解・問題を変える判断を、LLM は判断と生成を、スクリプトは手順と判定を担います。手順の並び・実行条件・完了の条件は `scripts/lib/steps/` の定義が唯一の正で、SKILL.md は `step next` の転送ループと原則だけを持ちます。数値の比較、集計、形式の検査、書式の決まった記録の収集を、指示文で LLM にやらせないでください。逆に、取捨選択・重複の判定・文面の作成をスクリプトに持たせません。ユーザーの責務を LLM に決めさせる手順も足しません。
2. **ユーザーの方針は黙って切り替えず、黙って従わない。** プロファイルや宣言のようにユーザーが決めた方針を、スクリプトも LLM も切り替えません。前提が崩れたこと（差し戻しなど、記録に残る出来事）をユーザーに知らせるところまでにします。ユーザーの選択がその人自身の宣言・記録・前提と食い違うときは、LLM が根拠と失うものを示して異を唱え、異議と決定の両方を記録に残す手順にしてください。異議の強さは害の重さに合わせ、好みの違いには異を唱えさせません。
3. **AI が変えてよいのは解き方だけ。** テストの削除・スキップ・期待値の緩和、受け入れ基準の未実現、スコープの変更を、ユーザーの目に触れずに通る経路を作らないでください。こうした変更はスクリプトが差分から事実として並べ、作った本人ではないレビューが合意と突き合わせます。行き詰まってユーザーに上げるときは、試したこと、問題を変える選択肢とそれぞれで失うもの、推奨を示させます。

### 引き継ぎを会話の外に出す

4. **セッションごとに読む量を絞る。** 各フェーズは別のセッションで動き、引き継ぎはファイルで行います。全文を読むのは設計するフェーズで、実装するフェーズには必要な節へのポインタだけを渡します。大量に読む作業はサブエージェントに委任し、結論だけを返させます。ビルドの大きさは予測ピーク（メインセッションのコンテキストの予測）で判定します。
5. **知見の置き場は、読み込まれ方で選ぶ。** 読まれる頻度が、使われる頻度を上回る場所に載せません。重要度（害が成果物に残るなら高、セッションのコストなら中、すぐ直せるなら低）で残すものを絞り、なくす（リファクタ） → 機械で防ぐ → パス指定の rule → スキル → `conventions` → `overview` / `decisions` / `constraints` の順に当てはめます。低はどこにも書かせません。書かれた基準を、機械の検査やリファクタへ移す経路も持たせてください。基準の正は `skills/close-cycle/references/persistence.md` です。

### ずれに気づけて、直せるようにする

6. **as-is と to-be を分ける。** 永続ドキュメントは実装済みの現実だけを表し、これから作るものはサイクルの `design-delta.md` に書きます。永続ドキュメントと `instructions.md` を書けるのは close-cycle だけです（ADR の追記は architect）。例外はサイクルに属さない patch で、コードと同じ PR で直します（同じ PR でマージされるので、マージした時点で as-is が保たれる）。サイクルに属す patch は書かずに handoff.md に残します。ほかのスキルに書き込みの手順を足さないでください。
7. **コピーではなくポインタを持たせる。** コード・diff・PR から復元できる情報を、文書やテンプレートに写させないでください。ポインタに件数や範囲を添えるのもコピーです。テンプレートに節を足すときは、その節を読むフェーズが具体的に決まっていて、ほかから復元できないことを確かめます。
8. **状態は保存せず、導出する。** 保存する状態は `cycles.md` の `status` だけです。フェーズ・着手可否・中断点は、ファイル・ブランチ・`progress.jsonl` の記録（ビルドの完了は builder の pr の `done`）から毎回導きます。`tasklist.md` の PR 列は close-cycle が記録から埋める一覧で、サイクルの途中は書きません（並行するビルドの PR が隣り合う行でコンフリクトするため）。「現在地」や「完了」を表す列やファイルを足さないでください。
9. **前提・判断・基準を分けて書かせる。** 永続ドキュメントと設計の記録のテンプレートでは、外の前提（事実か仮定か、確かめた日）、判断、推奨、受け入れたこと、再評価条件、基準を、混ぜずに書ける形にしてください。外の前提と受け入れたリスクはユーザーが持つものなので、AI が黙って書き換えたり消したりする手順を足しません。
10. **足すだけでなく、消す経路を持つ。** 文書に追記する手順を足すときは、その記述が古くなったり役に立たなくなったりしたときに、誰がどの根拠で消すかも決めてください。消せるように、基準には何を防ぐためのものかと、何に立っているかを残させます。「役に立たなかった」という信号だけでは働いている基準を消しかねないので、消して指標を見る経路も持たせます。害が成果物に残る基準は、試しに消す対象にしません。

### 委ねる範囲を決める

11. **承認は、判断の種類で「確認」と「同意」に分ける。** 省けるのは確認だけです。意図を変える判断、外の前提に関わる判断、AI に任せてよい上限を超えるリスクを受け入れる判断は同意で、どのプロファイルでも、conductor でも省きません。G1（要件の合意）と、G10（永続ドキュメントへの昇格の承認）のうち `decisions`・`constraints` の変更がこれに当たります。委ねる範囲を決めるのは、スクリプトが判定できる宣言と出来事だけにし、LLM の判断はユーザーに上げる向きにだけ使ってください。conductor の監督は、安全側にだけ倒してよいものとします。上限を超えるリスクの受け入れは、ユーザーが事後同意を明示して選んでいれば、止めずにマージの前の一覧に積めます（同意を遅らせるだけで、省くのではない）。後で決める事項は、いつ（サイクルの中の出来事）・誰が決めるかを付けて記録させ、その時が来たらスクリプトが示す形にしてください。ユーザーが決める事項を AI や監督に付け替える経路は作りません。
12. **ユーザーに見せる量は、限られた時間で読める量に合わせる。** 読まれない承認は、確かめたという記録だけを残します。ゲートで示す中身は、ユーザーが判断すべきもの（境界の変更、AI が解釈で決めた振る舞い、受け入れたリスクなど）に絞り、全文は求められたときに見せます。何を示すかはスクリプトが組み立てます。
13. **採否を分けて判断したいものは、別のブランチの PR にする。** 見積もりのガイドの見直しやフックのように、ワークスペース全体や全セッションに効く変更は、フェーズの PR に混ぜません。必要かどうかをスクリプトが判定し、スキルが作業して別の PR にし、採るかどうかはユーザーがマージで決めます。この型に乗せるものには承認のゲートを置きません。

### Hikyaku 自身を直す

14. **指示文は、いまのモデルに必要な分だけ書く。** 主な対象は Claude Opus 5.5 です。コードを正確に読め、報告も自然にまとまるので、念押しの繰り返しや、コードを読めば分かることの説明は足しません。指示を足す前に、その指示が無いと実際に何が起きたかを根拠にしてください。旧モデル向けの緩和策は、必要かを確かめてから残します。
15. **ユーザーのリポジトリの中身を、外に出す処理を足さない。** Hikyaku へのフィードバックは、ユーザーのリポジトリの中で作り、中身を含まない記録に絞ります。AI は文章を用意するところまでにし、送るかどうかの判断と起票はユーザーが行う手順にしてください。

## Agent Skills

スキルを編集する際は次のページを参照して、仕様やベストプラクティスを遵守してください。

- Agent Skills の仕様: https://agentskills.io/specification.md
- スキル作成のベストプラクティス: https://platform.claude.com/docs/ja/agents-and-tools/agent-skills/best-practices.md

## スクリプト（`scripts/`）

決定的な処理は TypeScript の CLI が担います。**スクリプト = 計算・解析・整形・検証 / LLM = 判断・生成・対話**という境界を守ってください。

- **TypeScript を Node で直接実行します。** ビルド済み JS は同梱しません（ソースと dist の二重管理を避けるため）
- **拡張子は `.mts`**。package.json の `type` に依存せず ESM が確定するため
- **実行時依存ゼロ**が必須要件です。`claude plugin install` されたディレクトリに `node_modules` は無いため、TOML パーサも自前実装しています
- **Node の型剥がしで動く構文だけを使ってください**（`tsconfig` の `erasableSyntaxOnly` が CI で弾きます）
  - ❌ `enum` / 実行時 `namespace` / パラメータプロパティ / デコレータ / import alias
  - ✅ import は拡張子必須（`import { x } from "./config.mts"`）。パスエイリアスは使えません
- 変更したら `npx tsc --noEmit` を通してください
- スクリプトのテストは `tests/` の `.test.mts` に置き、Node 標準の `node:test` と `node:assert/strict` を使います。`npm test` で実行し、テスト用の依存も増やしません。CLI の結合テストは一時 Git リポジトリで実行し、作業中のワークスペースや外部サービスに依存させないでください
- スクリプトを変更したら `npm test` も通してください。CI の `check-scripts` はテスト本体・補助ファイルを型チェックし、単体・CLI 結合テストをファイル単位で分けて並列に実行します。CLI はテストから `tests/helpers.mts` の `cli` 系で起動してください（型剥がしの結果を使い回すローダーを通すため）
- 予測ピークの標準のガイド（`skills/build-manager/references/token-guide.md`）の本文を変えたら、先頭の `version` を上げて `hash` を本文に合わせてください。`tests/tokens.test.mts` が食い違いを検出し、CI（check-scripts）も同じテストを実行します
- 書き込みを伴うコマンドには必ず `--dry-run` を用意してください。承認はスキル側が取ります
- patch のブランチ名（`{prefix}{sep}patch{sep}{YYYYMM}{sep}{slug}`）と作業単位（`patches/{YYYYMM}/{slug}/`）の対応は `scripts/lib/branch.mts` と `scripts/lib/patch.mts` が正です。Stop フックに限らず、ユーザーが手で呼ぶコマンドも含めて、patch の記録を全件走査する処理を足さないでください。`{HIKYAKU_ROOT}/patches/` を読む処理は、現在のブランチの patch か、サイクルの中の patch に絞ります（サイクルに属さない patch の記録はマージのたびに増えます）
- 子として動くスキル（architect / builder / build-manager / close-cycle / retrospective）にユーザーへ尋ねる箇所を足したら、`（ask: <id>）` のタグを付け、`scripts/lib/conductor.mts` の `ASKS` にも同じ ID を足してください。ID の改名・削除も両方で行います。`node scripts/hikyaku.mts conductor lint` が食い違いを検出し、CI（check-scripts）も同じコマンドを実行します。タグの付け忘れは検出できません
- 知見の重要度と置き場の基準は `skills/close-cycle/references/persistence.md` が唯一の正です。builder・retrospective・close-cycle の手順と `agents/doc-triager.md` には写さず、このファイルを読ませてください。rule の書き方は同じディレクトリの `rule-writing.md` に分け、rule を書く手順だけに読ませます（persistence.md は振り返りでも毎フェーズ読まれるため、読む人が限られる節を足さないでください）。close-cycle での扱いは `skills/close-cycle/steps/G10.md` が正です。利用者向けの説明は `docs/configuration/persistence.md` に置きます
- handoff.md と retrospective.md の「永続化すること」「役に立たなかった記述」は、`scripts/lib/promotions.mts` が見出しと行頭を読みます。見出し・宛先・理由の語を変えるときは、テンプレート（`skills/builder/references/templates.md`・`skills/retrospective/steps/write.md`）と `persistence.md` とスクリプトを同じ PR で直してください
- ゲートの承認の種類・条件や、directive の args の値の意味を変えたら、`scripts/lib/conductor.mts` の `CONSENT_WHEN`・`scripts/commands/config.mts` のゲートの説明行と、`skills/`・`docs/` 全体でその値名・ゲート ID を検索し、前提にしている説明を同じ PR で直してください（直し漏れはテストも lint も通ったまま、誤った説明として残ります）
- 次のものは唯一の正が決まっています。片方だけを変えると、記録や候補が黙って読めなくなるので、組になっているものは同じ PR で直してください
  - `decisions.jsonl` を書くのは `hikyaku ledger` だけで、期限の判定は `scripts/lib/ledger.mts` の `timingOf` だけに置きます
  - ADR・constraints の「受け入れたこと」の行の書式（1件1行、行末の `（拠り所: \`<参照>\`）`）は、テンプレートと `premises.mts` の `parseAcceptedSection` が組です
  - 行き詰まりの報告の3つの節（試したこと / 問題を変える選択肢と `失うもの:` / 推奨）は、`scripts/lib/escalation.mts` と、テンプレート（`skills/builder/references/templates.md` の return.md・`skills/builder/references/retry-policy.md`・`skills/conductor/references/headless-protocol.md`）が組です
  - 基準の理由の行末 `（防ぐ: … / 立つ: … / 重要度: 高|中）` と「レビューの記録」の行は、`persistence.md`・テンプレート（builder の templates.md・retrospective の write.md）と、`promotions.mts` の `parseCriterionReasons`・`review-records.mts` の `parseReviewRecord` が組です
  - G10 の同意が要る変更の判定は `promotions.mts` の `consentChanges` だけに置き、G10 の consent・write の accepts・promotions の approval が同じ判定を使います
  - `（ask: delegation）`・`（ask: deferred-consent）` は consent の種別でユーザーに固定し、`[conductor] delegate` の対象にしません
  - PR 本文の事実の節（`diff facts --format pr`・`ledger pr-section` など）は CLI の出力を貼り、スキルの指示文で書き写させません。各フェーズの PR の手順は `pr body`（`scripts/commands/pr-body.mts`）を通して貼るので、節を足すときは `pr body` に足してください
- PR を作るスキルを足したら、PR を作った直後に `hikyaku pr request-reviewers <phase> [<cycle>] --pr <PR>` を呼ぶ手順を入れ、そのフェーズを `scripts/lib/config.mts` の `REVIEWER_SKIP_TARGETS` にも足してください（`[pr] reviewers_skip` でオフにできるようにするため）

## ドキュメント

ファイルごとに役割が分かれています。書く場所を間違えると必ず内容が食い違います。

| ファイル | 役割 | 書かないこと |
|---|---|---|
| `README.md` | 何であり、なぜ存在し、どう使い始めるか | 設定キー・profile 表・CLI 詳細（`docs/` が正） |
| `docs/` | 利用者向けの説明のすべて | プラグイン本体の開発方法 |
| `AGENTS.md`（このファイル） | プラグイン本体を開発するときのルール | 利用者向けの説明 |
| `CHANGELOG.md` | バージョン間の変更と、利用者が必要な対応 | 設計判断の経緯（issue に書く） |

- **同じ表を2箇所に置かないでください。** 用語集は `docs/concepts.md`、profile とゲートの表は `docs/configuration/profiles.md`、フェーズごとに読むドキュメントの対応は `hikyaku context`（`scripts/commands/context.mts`）が唯一の正です
- **CLI の引数リファレンスは `hikyaku help` が正です。** `docs/reference/cli.md` と SKILL.md には「いつ、なぜ使うか」だけを書いてください
- **`${CLAUDE_PLUGIN_ROOT}` を `docs/` に書かないでください。** この変数は Claude Code がスキルやフックを実行するときにしか定義されず、ユーザーのシェルでは空になります。SKILL.md の中でのみ使い、`docs/` のコマンド例は `hikyaku <command>`（[実行方法](docs/reference/cli.md#実行方法) のシェル関数）で書きます
- **プラグインのインストール先を推測して書かないでください。** 古いバージョンのディレクトリは更新後も残り、ディレクトリ名はバージョン番号とは限りません（コミットハッシュや `unknown` になります）。パスは `claude plugin list --json` の `installPath` から引きます
- **`docs/` は人間が読むため、文章を基本にしてください。** 箇条書きは並列な列挙に限り、説明・理由・因果は段落で書きます。太字は数カ所に絞り、「本章では〜」のような予告文は書きません。SKILL.md・エージェント定義・このファイルは AI 向けなので対象外で、トリガー精度と機械可読性を優先します
- 挙動を変えたら、対応する `docs/` の記述も同じ PR で直してください

## 作業時の注意

- 開発の取り込み先は `main` です。v3 で Codex のホスト対応（`codex-plugin` ブランチの配布）は廃止しました。Codex はレビューの実行先（`[review] provider = "codex"`）としてだけ使い、Codex で Hikyaku のスキルを動かすための入口や読み替えは足さないでください。
- `main` 向け PR で `skills/`, `agents/`, `scripts/`, `hooks/`, `.claude-plugin/` を変更したときは、`.claude-plugin/plugin.json` の `version` を更新してください。
- `beta/v<N>` や `feature/v<N>-*`（次のメジャーを積むブランチと、その前段を積むブランチ）向けの PR では、`version` を `<N>.0.0` に固定し、CHANGELOG は `[<N>.0.0]` の節に追記してください。PR ごとには上げません。
- バージョンは `MAJOR.MINOR.PATCH` の形式で、変更の内容に応じて適切にインクリメントしてください。スキルのフロントマターに `metadata` は置かず、プラグインのマニフェストで管理します。
- `docs/`, `README.md`, `AGENTS.md`, `CHANGELOG.md` だけの変更ではバージョンを上げません（プラグインの挙動が変わらないため）。
- バージョンを上げる際は`CHANGELOG.md`に変更内容を記載してください。
    - **何が変わったか**（どのスキル・エージェント・設定キーがどうなったか）を具体的に書いてください。
    - **利用者に必要な対応**（互換性の有無、移行手順、既定値の変化）を `Migration` に書いてください。
    - **理由は必要なときだけ一文で**書いてください。判断の経緯は issue に記録し、CHANGELOG からはリンクします。

## プラグイン構成

このリポジトリは Claude Code のプラグイン仕様（[plugins.md](https://code.claude.com/docs/en/plugins.md), [plugins-reference.md](https://code.claude.com/docs/en/plugins-reference.md)）に準拠しています。

```
./
├── .claude-plugin/
│   ├── plugin.json            # プラグインマニフェスト
│   └── marketplace.json       # マーケットプレイス定義（リポジトリ自身を単一プラグイン構成のマーケットプレイスとして配布）
├── agents/<name>.md           # スキルから委任される各サブエージェント定義
├── hooks/hooks.json           # Claude Code のフック（Stop: 手順の途中で止まるのを1回だけ引き止める）
├── scripts/                   # CLI（実行時依存ゼロ）
│   ├── hikyaku.mts
│   ├── lib/
│   └── commands/
├── skills/<name>/SKILL.md     # 各スキル定義。インストール後は /hikyaku:<name> で呼び出される
└── docs/                      # 利用ドキュメント
```

<!-- hikyaku:docs:begin -->
## 設計ドキュメント

- decisions: `.hikyaku/decisions/` — 設計判断（ADR）。コードから復元できない唯一の情報。1判断1ファイル（`{YYYYMMDD}-{slug}.md`）
- conventions: `AGENTS.md` — リポジトリ全体に効く取り決め（設計の原則 v3・スクリプト規約・ドキュメントの役割・バージョン運用）
- glossary: `docs/concepts.md#用語` — 「用語」節だけが対象の用語集。AGENTS.md が唯一の正と宣言している。ほかの節は利用者向けの説明なので、Hikyaku は追記しない

この一覧は Hikyaku が document-guide.md から生成しています（`hikyaku docs link`）。
編集は document-guide.md 側で行ってください。
<!-- hikyaku:docs:end -->
