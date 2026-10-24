# propose: 変更案の作成

素材が無い（ビルドの振り返りがまだ無い）場合は、ユーザーが変更内容を指定している場合だけ
変更案を作る。実績無しにしきい値を動かすのは推測なので、こちらから提案はしない。
作らないなら `skipped` を報告する（`--reason` に理由）。承認と再生成は行わず、PR へ進む。

- [ ] 素材から変更案を作り、根拠を添えてユーザーと決める

変更の種類ごとに書く場所が違う。

| 変更 | 書く場所 | 例 |
|---|---|---|
| しきい値の変更 | `rules.toml` の `metrics.*.upper` / `levels` | 実装行数の BP3 上限を 1000 → 700 に下げる |
| 加算要素の追加 | `rules.toml` の `[additions.*]` | `[additions.payment_api] label = "決済APIを叩く" bp = 2` |
| 指標の追加 | `rules.toml` の `[metrics.*]` | `[metrics.migrations]` |
| 数え方の注意 | `README.md` の文章部分 | 「マイグレーション1本は新規ファイル2つと数える」 |

加算要素の書き方は3種類（`hikyaku help bp guide` と `rules.toml` のコメントを参照）。

```toml
[additions.payment_api]        # flag: 該当すれば +2
label = "決済APIを叩く"
bp = 2

[additions.entity_design]      # per: 指標の値を共有し、1つにつき +1（上限 +4）
label = "Entity 設計"
input = "db_entities"
per = 1
cap = 4

[additions.impact_files]       # tiered: 段階で加算
label = "影響ファイル数"
upper = [3, 6, 10]
bp = [0, 1, 3, 4]
```

- [ ] 変更ごとに、それを確かめる期待値ケースを `cases.toml` に足す
  - 動かしたしきい値の境界の両側、追加した加算要素が効く入力と効かない入力
  - 既存のケースが変更で壊れるなら、期待値を直すのではなく、なぜ変わってよいかを
    ユーザーに確認する（既存ケースは過去の判断の記録）
- [ ] 変更案を `rules.toml` / `cases.toml` に書く（コミットはしない）。次の承認で `bp test` が
  書き込み済みのファイルを読むため
- [ ] `done` を報告する
