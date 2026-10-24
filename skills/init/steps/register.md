# register: 既存ドキュメントの検出と登録

ここが init の本体。リポジトリを調べて既存の設計ドキュメントを見つけ、ユーザーと相談して
`{HIKYAKU_ROOT}/document-guide.md` に当てはめる。

## 判断基準

永続ドキュメントに何を持つかは、次の基準で決まっている。

> 復元コスト ÷ 陳腐化速度

- `db-schema` の全テーブル定義 — 復元コスト低（マイグレーションを読めばよい）／陳腐化速い → Hikyaku は作らない
- `overview` の責務・境界・データフロー — 復元コスト極高（全ファイルを読んで構造を推論）／陳腐化遅い → 作る価値がある

コピーではなくポインタを持つ。「スキーマの正は `db/migrations/`」は腐らないが、
「主要テーブル: users, orders」は腐り、しかも腐っていることに誰も気づけない。

## 手順

- [ ] リポジトリを走査して既存の設計ドキュメントを探す
  - `docs/` `doc/` `adr/` `architecture/` `AGENTS.md` `CLAUDE.md` `CONTRIBUTING.md`
  - v1 から移行した場合は `{HIKYAKU_ROOT}/architecture/` も対象
  - AGENTS.md / CLAUDE.md にドキュメント規約が書かれていれば最優先で従う
- [ ] 見つけたものを論理名に割り当て、ユーザーに提示して確認を得る

```
既存の設計ドキュメントを検出しました。document-guide に登録しますか？

  decisions   → docs/adr/                 (repo 管理・既存ADR形式)
  conventions → AGENTS.md                 (repo 管理)
  db-schema   → docs/db.md                (repo 管理・参考資料)
  overview    → 該当なし。未作成として登録し、初回の close-cycle で作成します
```

- [ ] `{HIKYAKU_ROOT}/document-guide.md` の管理列とパス列を埋める

管理列の意味を守ること:

| 管理 | Hikyaku の振る舞い |
|---|---|
| `hikyaku` | テンプレートに従う。書く/書かない・振る舞い・形式のすべてを適用する |
| `repo` | **既存形式が正。追記のみで、形式には手を出さない**。既存記述の削除・整理もしない |
| `未作成` | 次に必要になったとき Hikyaku が作成する |
| `対象外` | 意図的に持たない。理由を概要欄に書く |

既存 ADR が `AD-N` 形式でも、`repo` 管理として登録すればそのまま使い続けられる。
形式変換は不要。

- [ ] `done` を報告する。document-guide.md が検証（`docs validate` と同じ）を通らなければ、step が
  理由を添えて受け付けないので、直してから報告し直す
