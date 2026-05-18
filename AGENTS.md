## About Hikyaku

@README.md

## 用語集

| 用語 | 意味 |
|------|------|
| **フェーズ** | ワークフロー全体の3段階（PLAN / ARCHITECT / BUILD） |
| **セッション** | 1つのAI実行単位（20万トークン目安）。1フェーズまたは1ビルドにつき1セッション |
| **ビルド** | 1セッションで完結する実装作業の単位。`build-{NN}/` ディレクトリに対応する |
| **buildID** | ビルドの識別番号。tasklist.md の行と `build-{NN}/` ディレクトリに対応する |
| **ステップ** | フェーズ内の手順（Step 1〜）。plan.md 内の実装手順もステップと呼ぶ |

## Agent Skills

スキルを編集する際は次のページを参照して、仕様やベストプラクティスを遵守してください。

Agent Skillsの仕様については次のページを参照してください
- https://agentskills.io/specification.md

スキル作成のベストプラクティス
- https://platform.claude.com/docs/ja/agents-and-tools/agent-skills/best-practices.md

## 作業時の注意

- `skills/` または `agents/` 配下のファイルを変更したときは、各スキルのフロントマターに記載されているバージョンと `.claude-plugin/plugin.json` の `version` を更新してください。
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