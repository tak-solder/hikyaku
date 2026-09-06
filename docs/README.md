# Hikyaku ドキュメント

Hikyaku を自分のリポジトリで使うためのドキュメントです。プラグイン本体の開発については [AGENTS.md](../AGENTS.md) を参照してください。

## はじめて使う

[Getting Started](getting-started.md) がインストールから最初の1サイクル完走までを一本道で案内します。所要は初回セットアップに15分程度、そこから先はサイクルの規模次第です。

Hikyaku がなぜこの形をしているのか（永続ドキュメントとサイクルドキュメントを分ける理由、状態を保存しない理由）は [概念と設計思想](concepts.md) にまとめてあります。用語集もここです。

## 使う

4つのフェーズは別々のセッションが担当します。それぞれで何が起き、どこで承認を求められるかは各ページにあります。

- [ワークフロー全体](workflow/README.md) — 4フェーズの流れ、どこから始められるか
- [PLAN — 企画](workflow/plan.md)
- [ARCHITECT — 設計](workflow/architect.md)
- [BUILD — 実装](workflow/build.md)
- [CLOSE — サイクル終了](workflow/close.md)

## 設定する

- [.hikyaku.config](configuration/config-file.md) — 設定キーの一覧と、サイクル単位の上書き
- [プロファイル](configuration/profiles.md) — 承認ゲートとレビューの量をサイクルごとに選ぶ
- [ドキュメントガイド](configuration/documents.md) — 永続ドキュメントの所在を宣言する
- [外部システムへの投影](configuration/external.md) — GitHub / Asana へ片方向で投影する

## 運用する

- [複数サイクルの並行運用](operations/multi-cycle.md) — 対象サイクルの決まり方、中断と再開
- [トラブルシューティング](operations/troubleshooting.md) — エラーメッセージ別の対処
- [CI での検証](operations/ci.md)

## 調べる

- [CLI リファレンス](reference/cli.md)
- [ディレクトリとファイル](reference/directory-layout.md)
- [内部スキルとエージェント](reference/agents-and-skills.md)

## v1 から移行する

[v1 → v2 移行ガイド](migration/v1-to-v2.md)。進行中のサイクルがある場合は、プラグインのバージョンを固定して完走してから移行してください。
