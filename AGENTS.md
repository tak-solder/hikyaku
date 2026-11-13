## About Hikyaku

@README.md

利用者向けの説明は `docs/` にあります。仕様を確認するときは `docs/reference/` を、フェーズの手順を確認するときは各 `skills/<name>/SKILL.md` を読んでください。

## 用語集

用語の定義は [docs/concepts.md](docs/concepts.md#用語) が唯一の正です。ここに表を複製しないでください。

## 設計の原則（v3）

スキル・エージェント・スクリプトを変えるときは、次の原則に沿っているかを確かめてください。理由の説明は [docs/concepts.md](docs/concepts.md) が正で、ここには「変更するときに何を守るか」だけを書きます。原則に反する変更が必要になったら、黙って例外を作らず、原則のほうを見直す提案としてユーザーに確認してください。

1. **as-is と to-be を分ける。** 永続ドキュメントは実装済みの現実だけを表し、これから作るものはサイクルの `design-delta.md` に書きます。永続ドキュメントと `instructions.md` を書けるのは close-cycle だけです（ADR の追記は architect）。ほかのスキルに書き込みの手順を足さないでください。
2. **コピーではなくポインタを持たせる。** コード・diff・PR から復元できる情報を、文書やテンプレートに写させないでください。テンプレートに節を足すときは、その節を読むフェーズが具体的に決まっていて、ほかから復元できないことを確かめます。
3. **知見の置き場は、読み込まれ方で選ぶ。** 読まれる頻度が、使われる頻度を上回る場所に載せません。重要度（害が成果物に残るなら高、セッションのコストなら中、すぐ直せるなら低）で残すものを絞り、機械で防ぐ → パス指定の rule → スキル → `conventions` → `overview` / `decisions` / `constraints` の順に当てはめます。低はどこにも書かせません。基準の正は `skills/close-cycle/references/persistence.md` です。
4. **足すだけでなく、消す経路を持つ。** 文書に追記する手順を足すときは、その記述が古くなったり役に立たなくなったりしたときに、誰がどの根拠で消すかも決めてください。いまは振り返りの「役に立たなかった記述」と close-cycle の削除・置き換えが担っています。
5. **セッションごとに読む量を絞る。** 各フェーズは別のセッションで動き、引き継ぎはファイルで行います。全文を読むのは設計するフェーズで、実装するフェーズには必要な節へのポインタだけを渡します。大量に読む作業はサブエージェントに委任し、結論だけを返させます。ビルドの大きさは予測ピーク（メインセッションのコンテキストの予測）で判定します。
6. **状態は保存せず、導出する。** 保存する状態は `cycles.md` の `status` だけです。フェーズ・着手可否・中断点は、ファイル・ブランチ・`tasklist.md` の PR 列・`progress.jsonl` の記録から毎回導きます。「現在地」や「完了」を表す列やファイルを足さないでください。
7. **手順と判定はスクリプトが決め、LLM は判断と生成を担う。** 手順の並び・実行条件・完了の条件は `scripts/lib/steps/` の定義が唯一の正で、SKILL.md は `step next` の転送ループと原則だけを持ちます。数値の比較、集計、形式の検査、書式の決まった記録の収集を、指示文で LLM にやらせないでください。逆に、取捨選択・重複の判定・文面の作成をスクリプトに持たせません。
8. **承認は「確認」と「同意」を分ける。** プロファイルで省けるのは確認だけです。要件の合意（G1）と、何を残し何を消すかの取捨選択（G10）は、どのプロファイルでも省きません。conductor は同意を省くのではなく、人間が範囲を確認したうえで監督に委任します。
9. **採否を分けて判断したいものは、別のブランチの PR にする。** 見積もりのガイドの見直しやフックのように、ワークスペース全体や全セッションに効く変更は、フェーズの PR に混ぜません。必要かどうかをスクリプトが判定し、スキルが作業して別の PR にし、採るかどうかは人間がマージで決めます。この型に乗せるものには承認のゲートを置きません。
10. **指示文は、いまのモデルに必要な分だけ書く。** 主な対象は Claude Opus 5.5 です。コードを正確に読め、報告も自然にまとまるので、念押しの繰り返しや、コードを読めば分かることの説明は足しません。指示を足す前に、その指示が無いと実際に何が起きたかを根拠にしてください。旧モデル向けの緩和策は、必要かを確かめてから残します。

## Agent Skills

このリポジトリの開発用 Codex スキルは `.agents/skills/` に置きます。`$sync-codex-plugin <PR番号またはURL>` は、`main → codex-plugin` の差分を調べ、main由来の `update-for-codex` ブランチでCodex向けの修正・検証を行い、pushしてmain向けPRを作成・更新します。既存ブランチは原則引き継ぎます。Claude側の変更が必要なら停止してユーザーに確認し、codex-pluginへのpushやPRのマージは行いません。配布する Hikyaku のスキル（`skills/` と `codex/skills/`）とは別に管理します。

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
- スクリプトを変更したら `npm test` も通してください。CI の `check-scripts` はテスト本体・補助ファイルを型チェックし、単体・CLI 結合テストを実行します
- 予測ピークの標準のガイド（`skills/build-manager/references/token-guide.md`）の本文を変えたら、先頭の `version` を上げて `hash` を本文に合わせてください。`tests/tokens.test.mts` が食い違いを検出し、CI（check-scripts）の `npm test` も同じテストを実行します
- 書き込みを伴うコマンドには必ず `--dry-run` を用意してください。承認はスキル側が取ります
- 子として動くスキル（architect / builder / build-manager / close-cycle / retrospective）にユーザーへ尋ねる箇所を足したら、`（ask: <id>）` のタグを付け、`scripts/lib/conductor.mts` の `ASKS` にも同じ ID を足してください。ID の改名・削除も両方で行います。`node scripts/hikyaku.mts conductor lint` が食い違いを検出し、CI（check-scripts）も同じコマンドを実行します。タグの付け忘れは検出できません
- 知見の重要度と置き場の基準は `skills/close-cycle/references/persistence.md` が唯一の正です。builder・retrospective・close-cycle の手順と `agents/doc-triager.md` には写さず、このファイルを読ませてください。利用者向けの説明は `docs/configuration/persistence.md` に置きます
- handoff.md と retrospective.md の「永続化すること」「役に立たなかった記述」は、`scripts/lib/promotions.mts` が見出しと行頭を読みます。見出し・宛先・理由の語を変えるときは、テンプレート（`skills/builder/references/templates.md`・`skills/retrospective/steps/write.md`）と `persistence.md` とスクリプトを同じ PR で直してください
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

- Claude Code 用の開発の取り込み先は `main`、Codex 用は `codex-plugin` です。
- `main` 向け PR で `skills/`, `agents/`, `scripts/`, `hooks/`, `.claude-plugin/` を変更したときは、`.claude-plugin/plugin.json` の `version` を更新してください。
- `beta/v<N>`（次のメジャーを積むブランチ）向けの PR では、`version` を `<N>.0.0` に固定し、CHANGELOG は `[<N>.0.0]` の節に追記してください。PR ごとには上げません。
- `codex-plugin` 向け PR で `skills/`, `agents/`, `scripts/`, `codex/`, `.codex-plugin/`, `.agents/plugins/` を変更したときは、`.codex-plugin/plugin.json` の `version` を更新してください。共通手順・エージェント・CLI の変更も Codex に影響します。
- バージョンは `MAJOR.MINOR.PATCH` の形式で、変更の内容に応じて適切にインクリメントしてください。スキルのフロントマターに `metadata` は置かず、各プラグインのマニフェストで管理します。CHANGELOG は共通のため、Codex向けの同期時には両ホストのバージョンを揃えます。
- Codex 向けの共通部分の変更では、入口と `codex/compatibility.md` で読み替えられるか確認し、必要なら同じ PR で修正してください。バージョン検証だけでは動作の互換性は保証されません。
- `docs/`, `README.md`, `AGENTS.md`, `CHANGELOG.md` だけの変更ではバージョンを上げません（プラグインの挙動が変わらないため）。
- バージョンを上げる際は`CHANGELOG.md`に変更内容を記載してください。
    - **何が変わったか**（どのスキル・エージェント・設定キーがどうなったか）を具体的に書いてください。
    - **利用者に必要な対応**（互換性の有無、移行手順、既定値の変化）を `Migration` に書いてください。
    - **理由は必要なときだけ一文で**書いてください。判断の経緯は issue に記録し、CHANGELOG からはリンクします。

## プラグイン構成

このリポジトリは Claude Code のプラグイン仕様（[plugins.md](https://code.claude.com/docs/en/plugins.md), [plugins-reference.md](https://code.claude.com/docs/en/plugins-reference.md)）と [Codex のプラグイン仕様](https://developers.openai.com/plugins/build/plugins) に準拠しています。

```
./
├── .claude-plugin/
│   ├── plugin.json            # プラグインマニフェスト
│   └── marketplace.json       # マーケットプレイス定義（リポジトリ自身を単一プラグイン構成のマーケットプレイスとして配布）
├── .codex-plugin/plugin.json  # Codex 用マニフェスト。Codex 用スキルだけを指定
├── .agents/plugins/marketplace.json # Codex 用マーケットプレイス定義
├── agents/<name>.md           # スキルから委任される各サブエージェント定義
├── hooks/hooks.json           # Claude Code のフック（Stop: 手順の途中で止まるのを1回だけ引き止める）
├── codex/
│   ├── compatibility.md       # Codex での呼び出しとパスの読み替え
│   └── skills/<name>/SKILL.md # Codex 専用入口。詳細は skills/ を参照
├── scripts/                   # CLI（実行時依存ゼロ）
│   ├── hikyaku.mts
│   ├── lib/
│   └── commands/
├── skills/<name>/SKILL.md     # 各スキル定義。インストール後は /hikyaku:<name> で呼び出される
└── docs/                      # 利用ドキュメント
```
