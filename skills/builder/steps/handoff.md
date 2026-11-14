# handoff: 申し送りの作成

- [ ] 実装で得た知見を、重要度と置き場で仕分ける
  - 基準は `${CLAUDE_PLUGIN_ROOT}/skills/close-cycle/references/persistence.md`（[persistence.md](../../close-cycle/references/persistence.md)）。
    まだ読んでいなければここで読む
  - パス指定の rule にするものは、ここで書いてこのビルドの PR に含める（handoff に預けない）。
    後続のビルドが同じものを踏まないようにするため
  - 機械で防ぐ対策（テスト・共通ヘルパー・設定）は、実装の中で済ませてあるはずのもの。ここで
    入れ忘れに気づいたら、コードレビューを通っていないコードを足さず、「残したこと」に書く
    （rule に仮置きする）
  - rule を書いたら広さと大きさを確かめる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" rules check
```

- [ ] `cycles/{cycle}/build-{NN}/handoff.md` を作成する
  - テンプレートは `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/templates.md`（[templates.md](../references/templates.md)）を参照
  - 後続ビルドが前提にすること: PR の diff を読んでも分からないことだけ
  - 残したこと: 先送りした作業、そのまま進めた指摘、入れられなかった機械的な対策
  - 永続化すること: close-cycle が反映する知見を、宛先と重要度を付けて1件1行で。書いた rule は `済` で控える
  - 書かない: 実装内容の要約（PR 本文が正）/ 公開インターフェースの一覧（コードが正）/
    環境変数やマイグレーションの一覧（diff が正）/ 重要度が低の知見

あなたが永続ドキュメント（overview / decisions / constraints / conventions）を直接書き換えることはない。
rule とコードは永続ドキュメントではなく、このビルドの成果物として PR に含める。
