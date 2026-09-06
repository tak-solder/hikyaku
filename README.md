# Hikyaku (飛脚)

Hikyaku は **PLAN → ARCHITECT → BUILD → CLOSE の4フェーズ**で構成される、AIエージェント協働開発ワークフローです。Claude Code のプラグインとして配布され、Agent Skills の仕様に準拠しています。

AIエージェントと開発を進めると、2つの問題に必ず突き当たります。1つは、機能が大きくなるほど1セッションのコンテキストに収まらなくなること。もう1つは、設計ドキュメントが実装とずれていき、しかもずれていることに誰も気づけなくなることです。

Hikyaku は前者をフェーズとビルドへの分割で、後者を「実装済みの現実」と「これから作るもの」の分離で解きます。

## 特徴

- **セッション分離** — 各フェーズは別の AI セッションが担当する。引き継ぎはファイル経由で、会話履歴を持ち越さない
- **永続ドキュメントとサイクルドキュメントの分離** — 未実装の設計が「現実」として読まれる事故を防ぐ
- **複数サイクルの並行実行** — 1リポジトリで複数のラインを同時に回せる
- **リポジトリがマスター** — issue も設計判断もリポジトリ側に置き、外部システムへは片方向で投影するだけ
- **決定的な状態管理** — 状態は保存せず、ファイル・ブランチ・PR 列から導出する
- **プロファイル** — 承認とレビューの量をサイクルごとに選べる

## インストール

```bash
claude plugin marketplace add tak-solder/hikyaku
claude plugin install hikyaku@hikyaku
```

**Node.js v22.18.0 以上が必要です。** スクリプトは TypeScript のまま Node で直接実行します（型剥がしがフラグ無しで有効になる最小バージョンです）。実行時依存はゼロで、`npm install` もビルドも不要です。

```bash
node --version
```

環境が要件を満たしているかは `/hikyaku:init` が最初に確認します。CLI を自分のシェルからも叩きたい場合は [実行方法](docs/reference/cli.md#実行方法) を参照してください。

## 使い始める

導入したいリポジトリで初期化し、あとは4つのフェーズを順に回します。

```
/hikyaku:init            → ワークスペースを初期化（リポジトリにつき1回）
      ↓
/hikyaku:create-cycle    → サイクルを作成し profile を選択
      ↓
/hikyaku:planner         → 何を作るか（planning/）
      ↓
/hikyaku:architect       → どう作るか、どう割るか（design/ + tasklist.md + build-NN/issue.md）
      ↓
/hikyaku:builder         → 実装 → PR（依存が無ければ並行実行可）
      ↓
/hikyaku:close-cycle     → 永続ドキュメントへ昇格し、サイクルを closed に
```

`init` と `create-cycle` は明示的に制御したいときの入口で、planner が必要に応じて代行します。実質の最短経路は4フェーズです。

最初の1サイクルを通す手順は [Getting Started](docs/getting-started.md) にあります。

## ドキュメント

- [Getting Started](docs/getting-started.md) — インストールから最初の1サイクル完走まで
- [概念と設計思想](docs/concepts.md) — 用語集と、この形になっている理由
- [ワークフロー](docs/workflow/README.md) — 各フェーズで何が起き、どこで承認を求められるか
- [設定](docs/configuration/config-file.md) — `.hikyaku.config` / [プロファイル](docs/configuration/profiles.md) / [ドキュメントガイド](docs/configuration/documents.md) / [外部連携](docs/configuration/external.md)
- [運用](docs/operations/multi-cycle.md) — 並行運用 / [トラブルシューティング](docs/operations/troubleshooting.md) / [CI](docs/operations/ci.md)
- [リファレンス](docs/reference/cli.md) — CLI / [ディレクトリ構造](docs/reference/directory-layout.md) / [内部スキルとエージェント](docs/reference/agents-and-skills.md)
- [v1 → v2 移行ガイド](docs/migration/v1-to-v2.md)

## 開発

プラグイン本体を開発する場合は [AGENTS.md](AGENTS.md) を参照してください。変更履歴は [CHANGELOG.md](CHANGELOG.md) にあります。
