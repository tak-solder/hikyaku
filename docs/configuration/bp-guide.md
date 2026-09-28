# BP の基準表（bp-guide/）

BP（ビルドポイント）は、1セッションで実装が完了するかを判断する定量指標です（[BUILD](../workflow/build.md#ビルドポイントbp)）。その基準表は `{HIKYAKU_ROOT}/bp-guide/` に置き、ワークスペースの持ち物として扱います。

同じ規模の実装でも、フレームワークの定型量や既存コードの結合度によって、1セッションに収まる量は変わります。だから Hikyaku は統一の基準を固定しません。`bp-guide/` が無ければ組み込みの既定値で動き、置けばそのリポジトリの基準が正になります。

## 構成

```
{HIKYAKU_ROOT}/bp-guide/
├── rules.toml    # 正本。スクリプトが読むのはこれだけ
├── README.md     # 人間向けの説明。表の部分は rules.toml から生成される
└── cases.toml    # 期待値テスト。入力 → 期待 BP
```

正本と説明を分けているのは、説明を直したつもりで基準を壊す事故を防ぐためです。`README.md` の表はマーカー（`<!-- hikyaku:bp-guide:begin -->` 〜 `end`）で囲まれた部分だけが `hikyaku bp render` で生成され、外側の文章は自由に書けます。ここに「マイグレーション1本は新規ファイル2つと数える」のようなリポジトリ固有の数え方を書いておくと、見積もりのたびに builder と build-manager が読みます。

`cases.toml` は基準表の回帰テストです。`rules.toml` を変えたら、その変更を確かめるケースを足して `hikyaku bp test` を通します。`hikyaku validate` は、`rules.toml` の構文、`README.md` の表の古さ、期待値の不一致をまとめて検出します。

## 算出のモデル

`rules.toml` は指標と加算要素を宣言します。

```toml
levels = [1, 2, 3, 5, 8, 13]      # 段階に対応する BP

[metrics.new_files]               # ベースBP の指標
label = "新規ファイル数"
upper = [2, 5, 15, 20, 30]        # 値 <= upper[i] なら levels[i]。全部超えたら最後

[additions.setup]                 # flag: 該当すれば +1
label = "基盤セットアップを含む"
bp = 1

[additions.entity_design]         # per: 1つにつき +1。指標の値を共有する
label = "Entity 設計"
input = "db_entities"
per = 1
cap = 4

[additions.impact_files]          # tiered: 段階で加算
label = "影響ファイル数"
upper = [3, 6, 10]
bp = [0, 1, 3, 4]
```

ベースBPは各指標の BP の最大値、加算BPは加算要素の合計で、その和が BP です。加算要素の書き方は `flag`（該当すれば定数）、`per`（1単位につき。`free` で無料分、`cap` で上限）、`tiered`（段階表）の3種類です。`input` に指標のキーを書くと、その指標の値をそのまま使います。同じ値を二度渡させないためです。

指標のキーはそのまま `hikyaku bp estimate` のオプションになります（`new_files` → `--new-files`）。基準表に無いオプションはエラーです。タイプミスで加算要素が黙って落ちると、そのまま過小見積もりになるためです。

`new_files` と `lines` は `hikyaku bp actual` が差分から測る指標なので、キーを変えないでください。

## 誰が、いつ

| 状況 | 誰が | 何が起きるか |
|---|---|---|
| 新規ワークスペース | `/hikyaku:init` | 既定値から3ファイルを生成する |
| v2.0 で初期化済み | `hikyaku init --root <path>` の再実行 | 無いファイルだけ生成する。再実行するまでは既定値で動く |
| 調整 | `/hikyaku:bp-guide` | 振り返りの実績（`hikyaku bp history`）を素材に `rules.toml` を直し、期待値を足し、README を再生成する |

ワークフローの各フェーズ（build-manager / builder / retrospective）は `bp-guide/` を作りも変えもしません。基準表はワークスペース全体に効くので、走行中のサイクルの途中で動かすと、そのサイクルの中で見積もりの比較が成立しなくなるためです。

`rules.toml` の先頭には生成時の Hikyaku バージョンが残ります。プラグインを更新しても既定値の変化はワークスペースの正本に波及しないので、「いつの既定から派生したか」が追えるようにしています。

## 既定値と、旧ガイドからの違い

既定値は v2.0 まで `bp-guide.md` に載っていた表と同じしきい値です。ただし旧表には「DB テーブル数 1 が BP1 と BP2 の両方に載る」といった境界の重なりがあり、どちらを採るかは LLM が選んでいました。既定値では決定的に当てられるよう片方に寄せています。

| 指標 | 旧表で曖昧だった値 | 既定値での扱い |
|---|---|---|
| DBテーブル/エンティティ数 | 1 → BP1 or BP2、3 → BP3 or BP5、6 → BP8 or BP13 | 1 → BP2、3 → BP3、6 → BP8 |
| 画面/ページ数 | 5 → BP8 or BP13 | 5 → BP8 |
| 新規ファイル数 | 30 → BP8 or BP13、0 は表に無い | 30 → BP8、0 → BP1 |

現在有効な表は `hikyaku bp guide` で確認できます。
