# Codex で使い始める

Hikyaku は Codex でも PLAN → ARCHITECT → BUILD → CLOSE の順で進めます。サイクルドキュメント、設定、CLI は Claude Code 版と共通です。フェーズごとに新しいセッションを開き、成果物をファイルで引き継ぎます。

Node.js v22.18.0 以上が必要です。Codex のプラグインには TypeScript の CLI が同梱され、実行時の `npm install` は不要です。

## インストール

Codex CLI でマーケットプレイスを追加し、`/plugins` から Hikyaku をインストールします。

```bash
codex plugin marketplace add tak-solder/hikyaku
codex
```

このリポジトリを clone して試す場合は、`codex plugin marketplace add /path/to/hikyaku` としてローカルのマーケットプレイスを追加できます。どちらもインストール後は新しいセッションを開いてください。プラグインの実ファイルの場所を固定してコマンドに埋め込む必要はありません。

## スキルを起動する

Codex CLI または IDE 拡張では `/skills` から選ぶか、依頼文中で `$hikyaku:init` のように指定します。最初に `$hikyaku:init` で作業対象リポジトリを初期化し、`$hikyaku:create-cycle` でサイクルを作成します。以降は新しいセッションごとに `$hikyaku:planner`、`$hikyaku:architect`、`$hikyaku:builder`、`$hikyaku:close-cycle` を指定します。builder はビルドごとに新しいセッションで実行します。

サイクルやビルドを明示する場合は、たとえば「`$hikyaku:builder` で 001-billing の build 2 を実装して」と依頼してください。省略時はスキルがブランチやワークスペースの状態から対象を解決します。各フェーズで作るものと承認箇所は [Getting Started](getting-started.md#2-ワークスペースを初期化する) と [ワークフロー](workflow/README.md) を参照してください。

builder から設計を差し戻された場合は、「`$hikyaku:architect` で 001-billing の build-02 の差し戻しを再設計して」と依頼します。全ビルド完了後のレビュー指摘に対応するビルドを追加する場合は、「`$hikyaku:architect` で 001-billing add」に続けて指摘を渡します。改行して渡した指摘も追加設計の入力になります。

conductor は Claude Code 専用です。Codex では各フェーズを個別のセッションで実行してください。共通 CLI が conductor を案内しても、対応する Codex 用スキルはありません。

PR 作成後は共通の設定に従ってレビュアーを割り当てます。設定方法は [設定ファイル](configuration/config-file.md) を参照してください。

BP 基準表の確認・調整には `$hikyaku:bp-guide` を使います。`build-manager` と `retrospective` はフェーズの途中で呼ばれる内部手順です。

Hikyaku CLI の一部の案内には Claude Code の `/hikyaku:...` 表記が残っています。Codex のスキルは、conductor を除き、その案内を対応する `$hikyaku:...` スキルとして解釈します。シェルから CLI を直接実行する場合は [実行方法](reference/cli.md#実行方法) を参照してください。
