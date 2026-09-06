## About Hikyaku

@README.md

利用者向けの説明は `docs/` にあります。仕様を確認するときは `docs/reference/` を、フェーズの手順を確認するときは各 `skills/<name>/SKILL.md` を読んでください。

## 用語集

用語の定義は [docs/concepts.md](docs/concepts.md#用語) が唯一の正です。ここに表を複製しないでください。

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
- 書き込みを伴うコマンドには必ず `--dry-run` を用意してください。承認はスキル側が取ります

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
- **`docs/` は人間が読むため、文章を基本にしてください。** 箇条書きは並列な列挙に限り、説明・理由・因果は段落で書きます。太字は数カ所に絞り、「本章では〜」のような予告文は書きません。SKILL.md・エージェント定義・このファイルは AI 向けなので対象外で、トリガー精度と機械可読性を優先します
- 挙動を変えたら、対応する `docs/` の記述も同じ PR で直してください

## 作業時の注意

- `skills/`, `agents/`, `scripts/` 配下のファイルを変更したときは、各スキルのフロントマターに記載されているバージョンと `.claude-plugin/plugin.json` の `version` を更新してください。
    - バージョンは `MAJOR.MINOR.PATCH` の形式で、変更の内容に応じて適切にインクリメントしてください。
    - すべてのスキルのバージョンと plugin.json のバージョンは統一してください。つまり、1つでもスキルまたはエージェントを変更したら、すべてのスキルと plugin.json のバージョンを更新する必要があります。
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
├── scripts/                   # CLI（実行時依存ゼロ）
│   ├── hikyaku.mts
│   ├── lib/
│   └── commands/
├── skills/<name>/SKILL.md     # 各スキル定義。インストール後は /hikyaku:<name> で呼び出される
└── docs/                      # 利用ドキュメント
```
