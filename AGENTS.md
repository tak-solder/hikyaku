## About Hikyaku

@README.md

## 用語集

| 用語 | 意味 |
|------|------|
| **サイクル** | PLAN → ARCHITECT → BUILD → CLOSE の1周。1サイクル = 1チケットを想定。`cycles/{NNN}-{slug}/` に対応する |
| **フェーズ** | サイクル内の4段階（PLAN / ARCHITECT / BUILD / CLOSE） |
| **セッション** | 1つのAI実行単位（20万トークン目安）。1フェーズまたは1ビルドにつき1セッション |
| **ビルド** | 1セッションで完結する実装作業の単位。`build-{NN}/` ディレクトリに対応する |
| **buildID** | ビルドの識別番号。tasklist.md の行と `build-{NN}/` ディレクトリに対応する |
| **ステップ** | フェーズ内の手順（Step 1〜）。plan.md 内の実装手順もステップと呼ぶ |
| **永続ドキュメント** | 実装済みの現実（as-is）を表す。所在は `document-guide.md` が宣言する |
| **サイクルドキュメント** | これから作るもの（to-be）と作業記録。`cycles/{NNN}-{slug}/` 配下 |

## Agent Skills

スキルを編集する際は次のページを参照して、仕様やベストプラクティスを遵守してください。

Agent Skillsの仕様については次のページを参照してください
- https://agentskills.io/specification.md

スキル作成のベストプラクティス
- https://platform.claude.com/docs/ja/agents-and-tools/agent-skills/best-practices.md

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

## 作業時の注意

- `skills/`, `agents/`, `scripts/` 配下のファイルを変更したときは、各スキルのフロントマターに記載されているバージョンと `.claude-plugin/plugin.json` の `version` を更新してください。
    - バージョンは `MAJOR.MINOR.PATCH` の形式で、変更の内容に応じて適切にインクリメントしてください。
    - すべてのスキルのバージョンと plugin.json のバージョンは統一してください。つまり、1つでもスキルまたはエージェントを変更したら、すべてのスキルと plugin.json のバージョンを更新する必要があります。
- バージョンを上げる際は`CHANGELOG.md`に変更内容を記載してください。
    - 変更内容は、どのスキルまたはエージェントをどのように変更したかを具体的に説明してください。
    - 変更内容がユーザーに与える影響（例: 互換性の有無、必要な対応など）も明記してください。

## プラグイン構成

このリポジトリは Claude Code のプラグイン仕様（[plugins.md](https://code.claude.com/docs/en/plugins.md), [plugins-reference.md](https://code.claude.com/docs/en/plugins-reference.md)）に準拠しています。

- `.claude-plugin/plugin.json`: プラグインマニフェスト
- `.claude-plugin/marketplace.json`: マーケットプレイス定義（リポジトリ自身を単一プラグイン構成のマーケットプレイスとして配布）
- `skills/<name>/SKILL.md`: 各スキル定義。インストール後は `/hikyaku:<name>` で呼び出される
- `agents/<name>.md`: スキルから委任される各サブエージェント定義