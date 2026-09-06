# CI での検証

実行時依存がゼロなので、clone するだけで動きます。

```yaml
- run: |
    git clone --depth 1 --branch v2.0.0 https://github.com/tak-solder/hikyaku /tmp/hikyaku
    node /tmp/hikyaku/scripts/hikyaku.mts validate
```

スキル内の `validate` は Hikyaku が書いたものしか見ませんが、CI から呼べば人間が手で編集した内容の不整合も拾えます。ドキュメントを移動してパス列を直し忘れた、`tasklist.md` の依存を手で書き換えて循環させた、といった変更が PR の時点で止まります。

`validate` が見るのは次の6点です。

- 読み込まれなくなった旧名のファイルが残っていないか
- `document-guide.md` のパスが実在するか
- `cycles.md` の依存先サイクルが存在するか、循環していないか
- 各サイクルのディレクトリが存在するか
- 各 `tasklist.md` の依存グラフに循環や存在しない依存が無いか
- `tasklist.md` に登録されたビルドの `issue.md` が存在するか

問題が見つかると終了コード 2 で終わるので、そのままジョブが落ちます。

## バージョンを固定する

`--branch` にタグを指定して固定してください。Hikyaku を更新するタイミングを CI 側で制御できます。進行中のサイクルがある状態でメジャーバージョンを跨ぐと、ディレクトリ構造の解釈が変わる可能性があります。

## 追加の設定は要らない

`validate` はリポジトリルートの `.hikyaku.config` から HIKYAKU_ROOT を解決するので、環境変数の設定は不要です。**リポジトリのルートで実行してください**（設定ファイルを起点に探すため）。

`.hikyaku.config` を置かない構成なら、`--root <HIKYAKU_ROOT>` で HIKYAKU_ROOT を直接渡せます。これは実行場所ではなくワークスペースの位置を指すオプションです。

```bash
node /tmp/hikyaku/scripts/hikyaku.mts validate --root docs/hikyaku
```

## 結果を機械的に扱う

```bash
node /tmp/hikyaku/scripts/hikyaku.mts validate --json
```

`--json` は他のコマンドでも使えます。PR コメントへの整形など、結果を加工したい場合に利用してください。
