# Codex 実行規約

このファイルは Codex 用入口から参照する。各入口の「元の手順」は Hikyaku のフェーズと成果物の正であり、この規約は実行環境の差だけを置き換える。元の手順に書かれた設定、承認ゲート、レビュー、ブランチ、コミット、PR、引き継ぎの順序は維持する。

1. 入口の `SKILL.md` の実パスからプラグインルートを求める。入口は `<plugin-root>/codex/skills/<name>/SKILL.md` にある。シンボリックリンクから読んだ場合は実パスを使う。`<plugin-root>/skills/<phase>/SKILL.md` を最後まで読み、相対リンクはその元ファイルのディレクトリを基準に開く。必要な `references/` と `agents/` も読む。
2. 元の手順の `${CLAUDE_PLUGIN_ROOT}` は `<plugin-root>` に読み替える。CLI は `node "<plugin-root>/scripts/hikyaku.mts" <command>` で呼ぶ。プラグインのインストール先を推測しない。
3. `$ARGUMENTS[0]` などは、Codex でのスキル選択に続く利用者の依頼文から対応する値を取る。値が無い場合は、元の手順に書かれた省略時の解決方法を使う。文字列 `$ARGUMENTS` をシェルに渡さない。
4. 元の手順や CLI の出力にある `/hikyaku:<name>` は Claude Code のコマンド表記である。Codex では `<plugin-root>/codex/skills/<name>/SKILL.md` を開き、その内部手順を現在のフェーズの文脈で実行する。次のセッションを案内するときは、そのスキル名を `$hikyaku:<name>` として伝える。
5. 元の手順にある `AskUserQuestion`、`Read`、`Bash` 等のツール名は、Codex で利用可能な同等の機能に読み替える。セッション名を変更する機能が無い場合は、元の手順どおりその操作を省く。
6. `agents/<name>.md` を使う箇所では、その本文を役割・判定基準・出力形式としてサブエージェントへ渡す。Claude 固有の `model`、`tools`、`color` は Codex の設定値として使わない。委任時は対象ファイル、担当範囲、必要な戻り値を明示し、元の手順が要求する複数案・独立レビュー・結果の統合を保つ。サブエージェントが使えない環境では同じ観点を順に自分で処理し、その制約を報告する。
7. 元のスキルの `user-invocable`、`disable-model-invocation`、`argument-hint` は Claude Code 固有の起動設定である。Codex では各入口の `description` と、このファイルの「内部手順は呼び出し元からのみ実行する」という条件を使う。利用者から依頼されていない次のフェーズを自動開始しない。

CLI が返す次の操作の案内も 4 の規則で読み替える。ワークスペース内に書き出すドキュメントや設定ファイルの形式はホストに依存しない。
