# Codex で使い始める

Hikyaku は Codex でも PLAN → ARCHITECT → BUILD → CLOSE の順で進めます。サイクルドキュメント、設定、CLI は Claude Code 版と共通です。各フェーズは別のセッションで実行し、成果物をファイルで引き継ぎます。手動で起動するほか、conductor に子セッションの進行を任せることもできます。

Node.js v22.18.0 以上が必要です。Codex のプラグインには TypeScript の CLI が同梱され、実行時の `npm install` は不要です。

## インストール

Codex 用プラグインは `codex-plugin` ブランチで配布します。Codex CLI にこのブランチをマーケットプレイスとして追加し、`/plugins` から Hikyaku をインストールします。

```bash
codex plugin marketplace add tak-solder/hikyaku@codex-plugin
codex
```

マーケットプレイスは Codex のホームディレクトリ配下に clone されるため、自分で clone したリポジトリを残しておく必要はありません。新しいバージョンは `codex plugin marketplace upgrade` で取り込みます。インストールや更新のあとは新しいセッションを開いてください。

手元で変更を試す場合は、`codex-plugin` ブランチをチェックアウトしたリポジトリを `codex plugin marketplace add /path/to/hikyaku` で追加します。この場合はコピーされず、指定したディレクトリがそのまま参照されます。

## スキルを起動する

Codex CLI または IDE 拡張では `/skills` から選ぶか、依頼文中で `$hikyaku:init` のように指定します。最初に `$hikyaku:init` で作業対象リポジトリを初期化し、`$hikyaku:create-cycle` でサイクルを作成します。以降は新しいセッションごとに `$hikyaku:planner`、`$hikyaku:architect`、`$hikyaku:builder`、`$hikyaku:close-cycle` を指定します。builder はビルドごとに新しいセッションで実行します。

サイクルやビルドを明示する場合は、たとえば「`$hikyaku:builder` で 001-billing の build 2 を実装して」と依頼してください。省略時はスキルがブランチやワークスペースの状態から対象を解決します。各フェーズで作るものと承認箇所は [Getting Started](getting-started.md#2-ワークスペースを初期化する) と [ワークフロー](workflow/README.md) を参照してください。

builder から設計を差し戻された場合は、「`$hikyaku:architect` で 001-billing の build-02 の差し戻しを再設計して」と依頼します。全ビルド完了後のレビュー指摘に対応するビルドを追加する場合は、「`$hikyaku:architect` で 001-billing add」に続けて指摘を渡します。改行して渡した指摘も追加設計の入力になります。

PLAN を終えたサイクルは、「`$hikyaku:conductor` で 001-billing を進めて」と依頼すると、Codex が監督になって ARCHITECT から BUILD を子セッションで進めます。最初に委任の範囲を確認し、最後の統合 PR を作って止まります。人間がマージしたあと、再び `$hikyaku:conductor` を実行すると CLOSE から再開します。詳細は [conductor](workflow/conductor.md) を参照してください。

監督が Codex でも、子の CLI は `[conductor] provider` とクラウド判定で決まります。ローカルで Codex CLI だけを使う場合は `provider = "codex"` を指定してください。クラウドでは同じプロバイダーに固定されます。子の実行には選択した CLI のインストール・認証と、必要な git・gh・テストを実行できる権限が必要です。監督の環境には長時間のシェル処理を継続して待てる機能も必要です。

再開箇所に迷ったら `$hikyaku:navigator` を指定します。サイクルごとの状態と次の一手が提示され、選んだスキルが実行されます。選ぶ前にファイルやブランチを変更することはありません。

PR 作成後は共通の設定に従ってレビュアーを割り当てます。設定方法は [設定ファイル](configuration/config-file.md) を参照してください。

BP 基準表の確認・調整には `$hikyaku:bp-guide` を使います。`build-manager` と `retrospective` はフェーズの途中で呼ばれる内部手順です。

Hikyaku CLI の一部の案内には Claude Code の `/hikyaku:...` 表記が残っています。Codex のスキルは、その案内を対応する `$hikyaku:...` スキルとして解釈します。シェルから CLI を直接実行する場合は [実行方法](reference/cli.md#実行方法) を参照してください。
