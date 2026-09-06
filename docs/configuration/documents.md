# ドキュメントガイド

`{HIKYAKU_ROOT}/document-guide.md` は、どの永続ドキュメントが、どこに、誰の管理で存在するかを宣言する唯一の場所です。**存在しなければ Hikyaku は動作しません。**

設定ファイル（TOML）ではなくドキュメントにしているのは3つの理由からです。「意図的に持たない」を表現できること（キーの欠落では未設定と区別できません）、概要欄があることで必要なものだけを選んで読めること、AGENTS.md から参照させれば Hikyaku 以外のセッションからも使えることです。

## 形式

```markdown
| 論理名         | 管理   | パス              | 概要                                    |
| -------------- | ------ | ----------------- | --------------------------------------- |
| overview       | repo   | `docs/overview.md` | システムの責務・境界とデータフロー      |
| decisions      | repo   | `docs/adr/`        | AD-N 形式。既存の連番を継続する         |
| constraints    | 未作成 | —                  | 性能・可用性・セキュリティ・互換性の制約 |
| learnings      | 未作成 | —                  | 再現条件が明確な落とし穴と回避策         |
| conventions    | repo   | `AGENTS.md`        | コーディング規約                        |
| glossary       | 対象外 | —                  | ドメイン用語は overview 内で定義している |
```

見出しは `論理名 / 管理 / パス / 概要` の並びで固定です。パス列はリポジトリルートからの相対で、バッククォート囲みでも Markdown リンクでも素のパスでも読めます。

## 管理列

| 管理 | Hikyaku の振る舞い |
|---|---|
| `hikyaku` | テンプレートに従う。書く/書かない・振る舞い・形式のすべてを適用する |
| `repo` | 既存形式が正。追記のみで、形式には手を出さない。既存記述の削除・整理もしない |
| `未作成` | 次に必要になったとき Hikyaku が作成する |
| `対象外` | 意図的に持たない。理由を概要欄に書く |

`repo` を選べば、既存の ADR が `AD-N` 形式でもそのまま使い続けられます。形式変換は不要です。既存 ADR に status 欄が無くて実装状態が分からない場合も、Hikyaku が勝手に欄を足すことはなく、ユーザーに提案して判断を仰ぎます。

管理列に未知の値を書くとエラーになります。黙って `対象外` に落とすと、タイプミスひとつで登録済みのドキュメントが索引からも昇格対象からも静かに消えるためです。

## 論理名

必須の5つは、`未作成` や `対象外` であっても行が必要です。行が無いと `hikyaku validate` が検出します。

| 論理名 | 採用 | 内容 | 既定の作成先 |
|---|---|---|---|
| `overview` | 必須 | システムの責務・境界・データフローと、正がどこにあるかのポインタ | `docs/overview.md` |
| `decisions` | 必須 | 設計判断（ADR）。コードから復元できない唯一の情報 | `docs/adr/` |
| `constraints` | 必須 | 性能・可用性・セキュリティ・互換性などの制約 | `docs/constraints.md` |
| `learnings` | 必須 | 再現条件が明確な落とし穴と回避策 | `docs/learnings.md` |
| `conventions` | 必須 | コーディング規約 | `AGENTS.md` |
| `glossary` | 任意 | ドメイン用語集 | `docs/glossary.md` |
| `test-strategy` | 任意 | テスト方針。conventions に含めても成立する | `docs/test-strategy.md` |
| `security-model` | 任意 | 認証認可方式・信頼境界。原則は constraints に統合し、肥大化時のみ分離 | `docs/security-model.md` |
| `tech-stack` | 任意 | 参考。正は lockfile / マニフェスト | `docs/tech-stack.md` |
| `db-schema` | 任意 | 参考。正はマイグレーション | `docs/db-schema.md` |
| `interfaces` | 任意 | 参考。正は OpenAPI / 型定義 | `docs/interfaces.md` |

`tech-stack` / `db-schema` / `interfaces` を Hikyaku が作ることはありません。これらの正はコード側にあり、写せば必ず腐るためです。リポジトリにあれば俯瞰の手がかりとして読みますが、コードと矛盾したら常にコードを正とします。

論理名は増やせません。未知の論理名は `hikyaku validate` がエラーにします。振り返りの `doc:` 分類も、ここに無い論理名は昇格先にできません。

## 何を書き、何を書かないか

判断基準は復元コストと陳腐化速度の比です。詳細は [概念と設計思想](../concepts.md#コピーではなくポインタを持つ)。

`overview` にテーブル一覧やエンドポイント一覧を書くと、書いた瞬間から腐り始めます。代わりに「スキーマの正は `db/migrations/`」というポインタを書けば腐らず、パスが消えたときに `hikyaku validate` が検出できます。ポインタ形式にしている利点はここに出ます。

## 永続ドキュメントの置き場所

HIKYAKU_ROOT の外に置きます。HIKYAKU_ROOT にはサイクルの成果物だけを置き、永続ドキュメントはリポジトリ側の規約に従った場所（`docs/` など）に置いて、ガイドから参照します。

既に AGENTS.md や CLAUDE.md にドキュメント規約が書かれている場合は、それが最優先です。`/hikyaku:init` もその規約に従って登録します。

## AGENTS.md への索引

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs link --dry-run
```

AGENTS.md（無ければ CLAUDE.md）に、マーカーで囲んだ索引ブロックを冪等に書き込みます。

```
<!-- hikyaku:docs:begin -->
## 設計ドキュメント

- overview: `docs/overview.md` — システムの責務・境界とデータフロー
...
<!-- hikyaku:docs:end -->
```

**この索引が無いと、Hikyaku 以外のセッション（通常の Claude Code、Copilot、Cursor）は永続ドキュメントの存在に気づけません。** マーカー方式なので人間が書いた部分は保持されますが、リポジトリ全体の AI 設定を書き換えるため、実行前に承認を取ります。

編集は `document-guide.md` 側で行い、索引は再生成してください。

## 検証

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs validate
```

論理名が既知で重複していないか、`hikyaku` / `repo` の行のパスが実在するか、必要な行が揃っているか、`対象外` の行に理由が書かれているかを検証します。問題があれば終了コード 2 で終わります。
