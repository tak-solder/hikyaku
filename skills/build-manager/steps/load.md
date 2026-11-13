# load: 読み込みと設定の解決

- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/templates.md`: 各種テンプレート（必須）
- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/estimate.md`: 予測ピークの見積もり手順（必須）
- [ ] 設定を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

`unsafeSplit`（安全でない分割を許すか）を取得する。予測ピークの判定の帯は `peakBands` にあり、
値 `mergeBelow` / `splitAbove` にも入っている（サイクル固有の `.hikyaku.config` の値を反映済み）。
HIKYAKU_ROOT は引数では受け取らない（設定から解決される）。

- [ ] 見積もりに使うガイドを確かめて読む

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tokens guide {cycle}
```

示されたパスのガイド（プロジェクトの `{HIKYAKU_ROOT}/token-guide/guide.md` があればそれ、無ければ標準）を読む。
成分ごとの見積もり方と、このリポジトリでの補正はガイドにしか無い。

- [ ] 対象サイクルの現状を取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist read {cycle}
```
