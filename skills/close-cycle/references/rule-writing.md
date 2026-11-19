# rule の書き方

パス指定の rule（`.claude/rules/`）を書くときの形。どの知見を rule にするか（重要度と置き場）は
[persistence.md](persistence.md) が正。

- **glob ごとにファイルを分ける。** 既存の広い rule（`backend/**` など）には追記しない。対象の glob に
  合うファイルがあればそこへ、無ければ新しく作る。広いファイルに足すと、関係ない作業でも毎回読み込まれる
- frontmatter は `paths` と、基準の理由（`prevents` / `basis` / `importance`）を書く。`paths` は YAML のリストで、
  ブレース展開が使える。理由は1行の文字列
  - `prevents`: 何を防ぐための rule か（実際に起きた失敗。どのビルドで踏んだか）
  - `basis`: 何に立っているか（モデルの振る舞い・いまのコードの形・外の前提）。これが崩れたら rule は要らなくなる
  - `importance`: `高`（害が成果物に残る）か `中`（セッションのコスト）。高は試しに消す候補にしない

```markdown
---
paths:
  - "backend/tests/**/*MigrationTest.php"
  - "backend/database/migrations/**"
prevents: 並列で実行した migration のテストが、別のテストのデータで通ってしまった（build-03）
basis: テストの DB を共有している、いまのテストの仕組み
importance: 高
---

# migration のテスト

- （再現条件。どうなるか。どう避けるか。を2〜3文で）
```

- **1件を2〜3文で書く。** 再現条件 → 起きること → 回避策。経緯や検証の手順は書かず、既存の文書が
  あればパスで指す
- glob は、その知見が効く範囲に合わせて狭く取る。内容で決まる条件（「モックを使うテスト」など）は
  glob で切れないので、広い glob に短く書くか、1 に倒す
- 書いたら `hikyaku rules check` で広さと大きさを確かめる。警告が出たら glob を狭めるか分ける
- 書いた rule は handoff の「永続化すること」に `済` を付けて1行で控える（close-cycle が束ねるため）
