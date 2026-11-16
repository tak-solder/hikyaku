# CI での検証

実行時依存がゼロなので、clone するだけで動きます。

```yaml
- run: |
    git clone --depth 1 --branch v2.0.0 https://github.com/tak-solder/hikyaku /tmp/hikyaku
    node /tmp/hikyaku/scripts/hikyaku.mts validate
```

スキル内の `validate` は Hikyaku が書いたものしか見ませんが、CI から呼べば人間が手で編集した内容の不整合も拾えます。ドキュメントを移動してパス列を直し忘れた、`tasklist.md` の依存を手で書き換えて循環させた、といった変更が PR の時点で止まります。

`validate` が見るのは次の点です。

- 読み込まれなくなった旧名のファイルが残っていないか
- `document-guide.md` のパスが実在するか
- `cycles.md` の依存先サイクルが存在するか、循環していないか
- 各サイクルのディレクトリが存在するか
- 各 `tasklist.md` の依存グラフに循環や存在しない依存が無いか
- `tasklist.md` に登録されたビルドの `issue.md` が存在するか
- `token-guide/guide.md` があれば、先頭の版の宣言があり、ハッシュが本文と合っているか（本文を変えたのに `hikyaku tokens stamp` で版を上げていない状態を止める）
- `user-stories.md` の受け入れ基準に番号（`US-N.M`）があれば、番号が重複していないか、`issue.md` が存在しない番号を参照していないか、どのビルドにも割り当てられていない受け入れ基準が無いか

問題が見つかると終了コード 2 で終わるので、そのままジョブが落ちます。

これとは別に、ジョブを落とさない警告も出します（終了コードは変わらず、`--json` では `warnings` に入ります）。永続ドキュメントと進行中のサイクルの文書で、ポインタに ID の範囲（`AD-1〜AD-5` のような形）が添えられているところと、ADR・`constraints` の「受け入れたこと」の節にあって読めない行（箇条書きでない行や、`（拠り所: …）` の中身が参照の書式に合わない行）です。範囲は、指す先が増えたり減ったりしても書き直されないまま残りやすいので、ID を個別に書くか、正の所在だけを指すように直します。

## 宣言の変更を PR で知らせる

`.hikyaku.config` の `[app]` や `[[app.areas]]`（アプリケーションの状況の宣言）を変える PR では、その宣言を拠り所にして受け入れたリスクを見直す必要があります。`--base` に PR のマージ先を渡すと、そこから変わった宣言と、それを拠り所にした受け入れ（サイクルの未決事項の記録と、ADR・`constraints` の「受け入れたこと」の行）を警告として並べます。

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: |
    git clone --depth 1 --branch v3.0.0 https://github.com/tak-solder/hikyaku /tmp/hikyaku
    node /tmp/hikyaku/scripts/hikyaku.mts validate --base origin/${{ github.base_ref }}
```

マージ先との共通の祖先を求めるので、履歴を取得してください（`fetch-depth: 0`）。浅い clone で共通の祖先が見つからないときは、比べられなかったことを示したうえで、宣言されているすべての項目を変わったものとして扱います（見直しの対象を落とさないためです）。同じ一覧は `hikyaku ledger premises --changed-from <ref>` でも見られます。

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
