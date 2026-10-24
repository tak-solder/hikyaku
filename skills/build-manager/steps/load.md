# load: 読み込みと設定の解決

- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/templates.md`: 各種テンプレート（必須）
- [ ] `${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/bp-guide.md`: BP見積もりガイド（必須）
- [ ] `{HIKYAKU_ROOT}/bp-guide/README.md`: このリポジトリの BP 基準表と数え方の注意（存在する場合）
- [ ] 設定を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config {cycle} --json
```

`unsafeSplit`（安全でない分割を許すか）を取得する。`bp_max` は値 `bpMax` にも入っている
（サイクル固有の `.hikyaku.config` の値を反映済み）。HIKYAKU_ROOT は引数では受け取らない（設定から解決される）。

- [ ] 現在有効な BP の基準表を確認する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp guide {cycle}
```

「入力」列が `bp estimate` に渡すフラグ。基準表はワークスペースの持ち物
（`{HIKYAKU_ROOT}/bp-guide/rules.toml`）で、無ければ既定値が出る。

- [ ] 対象サイクルの現状を取得する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tasklist read {cycle}
```

- [ ] `done` を報告する
