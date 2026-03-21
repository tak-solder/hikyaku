## About Hikyaku

@../README.md

## 用語集

| 用語 | 意味 |
|------|------|
| **フェーズ** | ワークフロー全体の3段階（PLAN / ARCHITECT / BUILD） |
| **セッション** | 1つのAI実行単位（20万トークン目安）。1フェーズまたは1ビルドにつき1セッション |
| **ビルド** | 1セッションで完結する実装作業の単位。`build-{NN}/` ディレクトリに対応する |
| **buildID** | ビルドの識別番号。tasklist.md の行と `build-{NN}/` ディレクトリに対応する |
| **ステップ** | フェーズ内の手順（Step 1〜）。plan.md 内の実装手順もステップと呼ぶ |

## Agent Skills

Agent Skillsの仕様については次のページを参照してください
https://agentskills.io/specification.md