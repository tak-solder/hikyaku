# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [2.0.0]

複数サイクルの並行実行、ファイル正への一本化、決定的な処理のスクリプト化を軸とした大規模改修。
設計の経緯と判断理由は [issue #26](https://github.com/tak-solder/hikyaku/issues/26) に記録している。

### Added

- **CLOSE フェーズ（`/hikyaku:close-cycle`）**: 実装済みの成果を永続ドキュメントへ昇格させ、サイクルを締める。永続ドキュメントを書けるのはこのスキルだけ（ADR の追記のみ architect が例外）
  - 永続ドキュメントは「実装済みの現実（as-is）」を、サイクルドキュメントは「これから作るもの（to-be）」を表す。この区別により、並行して走る別サイクルが未実装の設計を現実として読む事故を防ぐ
  - `completed`（全ビルド完了）と `closed`（昇格完了）の間には、実装は main に入っているのに overview が古いという危険な空白がある。`create-cycle` は `completed` のまま放置されたサイクルを検出して警告する
- **`/hikyaku:init`**: ワークスペースの初期化。リポジトリ既存の設計ドキュメントを検出して `document-guide.md` に登録する。v1 からの移行も対話的に行う
- **`/hikyaku:create-cycle`**: サイクルの作成。`--profile` を必須とし、config の値は推奨として提示するだけで無条件には採用しない
- **`document-guide.md`（必須）**: 永続ドキュメントの所在と管理主体を宣言する唯一の場所。存在しなければ Hikyaku は動作しない
  - 設定ファイルではなくドキュメントにしたのは、(1) 「意図的に持たない」を表現できる (2) 概要欄により必要なものだけ選んで読める (3) AGENTS.md から参照させれば Hikyaku 以外のセッションからも使える、の3点による
  - 管理列（`hikyaku` / `repo` / `未作成` / `対象外`）が「誰の持ち物か」を明示し、`repo` 管理のファイルに Hikyaku が形式を強制する越権を構造的に防ぐ
  - 管理列の不正値はエラーにする。黙って `対象外` に落とすと、タイプミスひとつで登録済みのドキュメントが索引からも昇格対象からも静かに消える
- **`cycles.md`（必須）**: サイクル索引。並行サイクル検出の起点。`hikyaku` 列に作成時のバージョンを記録し、ディレクトリ構造の解釈に使う
  - `status` の不正値もエラーにする。黙って `active` に落とすと次の書き込みでその値が永続化され、closed のサイクルが復活しうる
- **CLI（`scripts/hikyaku.mts`）**: 決定的な処理をすべてスクリプトへ移した
  - TypeScript を Node で直接実行する（ビルド済み JS は同梱しない）。ソースと dist の二重管理を避けるため。**Node v22.18.0 以上が必要**
  - 実行時依存ゼロ（TOML パーサも自前実装）。CI では clone するだけで動く
  - `tsconfig` の `erasableSyntaxOnly` で、型剥がしで動かない構文を CI が弾く
  - 書き込みコマンドはすべて `--dry-run` に対応。承認は常に呼び出し元のスキルが取り、スクリプトは「何が起きるか」を返す責務だけを持つ
  - 終了コード: `0` 成功 / `1` エラー / `2` 検証失敗。「実行できなかった」と「実行したが問題が見つかった」を区別できる
  - `hikyaku help` が使い方を持つため、SKILL.md から引数リファレンスを追い出せた
- **profile（express / economy / standard / thorough）**: サイクルの属性として `cycles.md` に記録する
  - **express** は人間の時間を節約（承認を減らすが AI には見させる）、**economy** は AI 実行コストを節約（サブエージェントを起動しないが人間は見る）という別の軸。品質の担保を AI に寄せるか人間に寄せるかの違いで、どちらも担保そのものは手放さない
  - **thorough** は判定基準が厳しくなるのではなく、チェックポイントが細かくなる。standard が完成した成果物の単位で必要なときに確認するのに対し、thorough は完成前の中間状態でも止まり、判断を挟まず常に実行する
  - 「承認少 + レビュー無」の組み合わせは意図的に用意していない
  - **G1（user-stories 承認）はどのプロファイルでも省略しない**。要件の合意は後段の承認では代替できない（設計も plan も「その要件で正しいか」を前提に置くため）
  - **G3（設計案の選択）は profile 管轄に移し、express でのみ外れる**（AI の推奨案をそのまま採用する）。要件を人間が握っているなら、その先の trade-off は推奨に委ねても引き返せるという判断による。省いた場合も採用理由と退けた案は ADR と PR 本文に残る。個別キーは `design_choice_gate`
  - **`security_review` はどのプロファイルでも `off` にしない**。既定は `recommended`（判定基準に該当したときだけ起動を確認）で、thorough だけが該当判定を挟まず `on`。承認や実行コストの削減で落としてよい観点ではないため。切りたい場合は個別キーで明示する
  - **`retrospective` は economy だけ `skip`**、他は `auto`。振り返りはサブエージェントの実行コストそのものなので、コスト節約軸の economy でのみ落とす。承認を省く express では逆に、改善の材料を自動で拾い上げる必要がある
- **`hikyaku context <phase> [<cycle>]`**: そのフェーズで読むべきドキュメントの候補を返す。フェーズごとの「何を読むか」を各 SKILL.md に書くと4箇所に同じ表が載って必ず食い違うため、フェーズ→論理名の対応はこのコマンドが唯一の正
  - **絞り込みはしない**。どれが今回のスコープに関係するかは概要欄を読んで判断することで、それはスキル（LLM）の仕事。必要度を機械が言い切ると、概要欄で絞る判断を放棄して全部読む方向に倒れる
  - **実在して読めるものだけを返す**。欠落の検出は `next`（中断点）と `validate` の担当で、兼ねると「読むもの」と「足りないもの」が同じ表に混ざる。ただし未作成の永続ドキュメントは1行だけ添える（`overview` が無いことは architect の調査方針を変えるため）
  - `build-NN` では `tasklist.md` の依存グラフから先行ビルドの `handoff.md` を辿る。手で辿ると漏れる。tasklist に無いビルド番号はエラーにする（タイプミスでそれらしい候補が返って成功するのを防ぐ）
  - 管理が `対象外` の論理名は候補にも未作成にも出さない（意図的に持たないため、探させるだけ無駄になる）
  - `--json` はサブエージェントへの委任プロンプトに流し込む用途。委任先では概要欄で絞る仕組みが使えないため、渡すものを呼び出し元が決める必要がある
- **`cycle-scanner` エージェント**: 走行中の他サイクルの `design-delta.md` を読み、重複を報告する（軽量モデル）
- **`[review.security].triggers`**: security_review を推奨する判定基準を自然言語で記述できる。機微情報の定義はプロダクトごとに異なり、Hikyaku 側で列挙できないため
- **ブランチ命名規則**: `{prefix}{separator}{cycle}{separator}{phase}`。着手状態の導出に解析するため構造は固定で、`prefix` と `separator` のみ設定可能
- **サイクル固有の設定（`{HIKYAKU_ROOT}/cycles/{NNN}-{slug}/.hikyaku.config`）**: そのサイクルだけキー単位で上書きする。`hikyaku_root` / `base_branch` / `[branch]` / `[pr]` / `[session]` / `[external]` はリポジトリ全体の性質なので上書きできず、`profile` は `cycles.md` が唯一の正なので指定できない（いずれも黙って無視せずエラーにする）
- **`hikyaku branch verify`**: 今いるブランチを命名規則と突き合わせる。一致で `0`、不一致で `2` を返し、**期待するブランチ名と切り替えコマンド**を提示する
  - 生成と検証を1コマンドに兼ねている。名前を生成するだけのコマンドを別に持つと、生成しただけで確認しないまま作業する余地が残るため（エージェントが用意した別ブランチの上で作業してしまう事故が実際に起きた）
  - 不一致のときの扱いはスキルが決める。**デフォルトブランチ上なら**期待する名前で作成し、**別の作業ブランチ上なら**ユーザーに尋ねる（Hikyaku の規則に従う / 現在のブランチで作業する / 別のブランチを指定する）。実行環境がブランチ名を決めている場合と、別の作業のブランチに紛れ込んでいる場合は外からは区別できないため、スクリプトは判断せず材料（`onBaseBranch`）だけを返す
  - デフォルトブランチは `base_branch` の設定が正で、未設定なら `origin/HEAD` から導出する。どちらも無ければ `null` を返す（`"main"` と推測しない）
- **`[session] title`**: セッション名のテンプレート。変数は `[pr]` と共通で、空文字なら変更しない。`hikyaku session title` が生成する
- **`.hikyaku.local`**: このチェックアウトで最後に作業したサイクルを記録する（git 管理対象外）。チーム開発では「最後にコミットされたサイクル」が他メンバーのものになるため、これだけはリポジトリから導出できない。読むのは対象サイクルの決定だけで、判断に使う処理からは参照しない。`hikyaku cycle use` で記録する
- **外部システムへの親 issue**: サイクルに1つの親（tasklist へのリンクとビルド一覧）と、各ビルドの子を投影する。親が無ければ先に作るのでどのフェーズから同期しても収束するが、既定の生成タイミングは PLAN の PR 作成直前
  - 参照は作成後に自動で記録する（親は `cycles.md` の外部列、子は `tasklist.md` の issue 列）。手で書き写す運用は必ず抜けるため
  - `cycles.md` に**外部列**を追加した。列は並びではなく見出し名で読むようにしたので、外部列が無い既存ファイルもそのまま読める
- **`hikyaku external ref`**: PR 本文へ入れる参照行を返す（build-NN と close は `Closes`、他フェーズは `Refs`。Asana はタスクの URL）。GitHub のクローズキーワードは `#12` か URL しか解釈しないため、Markdown リンクではなく素の番号で出す
- **`hikyaku cycle link` / `hikyaku tasklist link`**: 外部システムへ投影した参照を記録する。gh CLI が使えない環境で、スキルが MCP ツール経由で投影した場合に使う

### Changed

- **スキルは HIKYAKU_ROOT を引数に取らない**: `.hikyaku.config` から解決する。サイクルの指定も任意で、省略時は 現在のブランチ → `.hikyaku.local` → 唯一の進行中サイクル の順に決まる。決められないときは候補を挙げて**ユーザーに尋ねる**（推測して別サイクルへコミットする事故を避けるため）
  - slug は全履歴で一意ではない（closed になった slug を再利用できる）。明示指定でも複数一致したときは `active` を採り、決まらなければ同じく尋ねる
- **設定を置ける場所をリポジトリルートとサイクルディレクトリの2箇所にした**: リポジトリルートの `.hikyaku.config` を必須とし、`{HIKYAKU_ROOT}/.hikyaku.config` は生成も読み込みもしない。ドキュメントの所在が config から消えた時点で中間層の存在理由が無くなっていた。残っている場合は黙って無視せずエラーにして移行を促す
- **`create-cycle` から PLAN へそのまま続けられるようにした**: 既定は「続ける」。続ける場合は `create` ブランチを作らず PLAN のブランチで作業し、PR を1本に畳む（成果物が `cycles.md` の1行だけであり、planner が代行する場合の前例に揃えた）
- **gh CLI が無い場合も投影内容を返すようにした**: 警告して終わるのをやめ、`reason: "gh-not-found"` とともに投影内容を出す。スキル側が GitHub MCP ツールで適用し、`cycle link` / `tasklist link` で記録する。スクリプトから外部 API を呼ばない Asana 経路と同じ形に揃えた
- **`tasklist.md` の `PR` 列を issue 列と同じ `[#12](URL)` 形式に整えるようにした**: 生の URL のままだと表が横に伸びて読めなくなるため。完了判定は「非空かどうか」の一点なので、表記の変更が判定に影響することはない
- **`{HIKYAKU_ROOT}/.gitignore` は `.hikyaku.local` の1行だけになった**: 既にファイルがある場合も1行だけ追記する（v1 が生成した `.gitignore` があるとスキップされ、栞が永久に追跡対象のままになるため）。v1 の除外設定が残っていれば警告する。包括パターンは書かない（`retrospective.md` を巻き込むと close-cycle が読めなくなる）
- **サイクル構造**: `{HIKYAKU_ROOT}/cycles/{NNN}-{slug}/` にサイクル単位でまとめる。永続ドキュメントは HIKYAKU_ROOT の外に置き、`document-guide.md` から参照する
- **`DOC_ROOT` → `HIKYAKU_ROOT`**: 永続ドキュメントが外に出た以上、残りを DOC_ROOT と呼ぶのは実態と合わないため
- **振り返りの改善提案に行き先を与えた**: 分類を `doc:{論理名}` / `workflow` / `記録のみ` の3つにし、close-cycle が `conventions` などの永続ドキュメントか `instructions.md` へ反映する。従来は `skill:` / `repo:` / `workflow:` / `記録のみ` の4分類だったが、実際に適用するステップがどこにも無く、closed になったサイクルのディレクトリに沈んでいた
  - **`skill:`（Hikyaku スキル自体への改善提案）を廃止した**。Hikyaku の手順に穴があると思える場合も、このリポジトリで埋めるなら `workflow` に落とす。`instructions.md` はインストラクションの優先順位で SKILL.md より上位にあり、スキルを上書きするための正規の場所
  - **`repo:{ファイル名}` を `doc:{論理名}` にした**。パス直指定をやめ、`document-guide.md` が宣言する論理名で指す。`document-guide.md` に無い論理名は使わない（勝手にドキュメントを作らない）
  - **R-N と L-N の軸を「提案か、事実か」に整理した**。以後の取り決めは R-N、踏んだ地雷は L-N（`learnings` 行き）。`overview` / `constraints` に載る事実は従来どおり `handoff.md` が担い、昇格の経路を二重に持たない
  - **close-cycle が retrospective.md から拾う範囲を絞った**。サブエージェントに渡すのは L-N と `doc:` 分類だけで、`workflow` は本セッションが直接捌く。ビルドが10本あれば retrospective.md は12ファイルになり、絞らないと委任の意味が消える
  - **同じ提案が複数フェーズで出ていたら1件に束ね、出典を全部残す**。言われた回数は優先度そのものなので落とさない
- **`{HIKYAKU_ROOT}/instruction.md` → `instructions.md`**: 他のファイル名に合わせて複数形にした。中身の変換は不要で、`git mv` で改名するだけ。`/hikyaku:init` が移行時に案内し、`hikyaku validate` も旧名の残存を検出する（旧名のまま置くと読み込まれなくなるが、黙って無視すると気づけないため）
- **状態を保存せず導出する**: 保存するのは `cycles.md` の `status` 3値のみ。フェーズはファイルの存在から、着手中はブランチの存在から、完了は `tasklist.md` の `PR` 列から導出する
  - **ビルドに `status` 列を持たせない**。`PR` 列の更新は当該ビルドの PR に同梱されるため、デフォルトブランチ上で PR 列が埋まっていること自体がマージ済みを意味する。status 列を別に持つと「status は done だが PR 列が空」という嘘の状態が作れてしまう
  - **完了判定はデフォルトブランチの tree から読む**。作業ツリーを見ると、ビルドブランチ上では `tasklist done` した直後の自分の PR 列が見えてしまい、未マージのビルドを完了とみなして依存ビルドを着手可能にしてしまう（ビルドの一覧は作業ツリーのまま。まだマージされていない tasklist の追加分も候補に出すため）
  - **中断の検出**: ブランチ上の成果物の有無から再開点を割り出す。必須成果物と条件付き成果物を区別する
- **architect が永続ドキュメントを書かなくなった**: 作るのは `design-delta.md`（to-be）のみ。ADR だけが例外で `status: accepted` で追記する（決定した時点で記録するのが ADR 本来の思想）
  - `overview` が登録されている場合、既存コード調査は**差分だけ**を行う。overview に既にある内容を再調査すると、2周目以降も初回と同じコストがかかる
- **builder が永続ドキュメントを書かなくなった**: v1 Step 9 の「実装中に設計と異なる判断をした場合は該当する設計ドキュメントを直接更新する」を削除し、`handoff.md` への記録に置き換えた
- **全スキルが PR を作る**: デフォルトブランチに入っていない情報は他サイクルから見えないため。フェーズ PR（create / plan / architect / close）はドキュメントのみで、速やかにマージすることを想定する
- **成果物を1つ作るごとにコミット & push する**: コミットされていなければ中断検出が機能しない。コミットメッセージの形式はリポジトリ規約に従い、Hikyaku は関与しない
- **`<SKILL_ROOT>` → `${CLAUDE_PLUGIN_ROOT}`**: 前者は公式の置換変数ではなく、LLM の推測に依存して動いていた
- **G4 の承認観点を「反映の正しさ」に限定**: 技術選定は G3 で決着済みで、同じことを二度聞くのが承認ラウンドの冗長さの正体だった

### Removed

- **`issue_backend` の抽象化を廃止**: 真実の所在が分裂していた（依存関係=ファイル / 完了判定=GitHub のライブ照会 / issue本文=GitHub）。`github`/`asana` を選ぶと `build-*/` が丸ごと `.gitignore` され、リポジトリを見てもビルドの中身が分からなくなっていた
  - ファイルが常にマスターになり、外部システムへは `[external]` による冪等な片方向投影のみを行う。読み取りと完了判定は常にファイル
  - `skills/build-manager/references/backends.md`（78行）と、各スキルの3分岐が消えた
- **G5（ビルド分割ドラフト承認）を廃止**: 存在理由は「外部システムで issue の作成・削除が乱造されるのを防ぐ」ことだった。ファイル正に変えた時点で理由が消えた
- **`tech-stack` / `db-schema` / `interfaces` を Hikyaku が作らなくなった**: これらの正はコード側（lockfile / マイグレーション / OpenAPI）にあり、写すと必ず腐る。しかも腐っていることに誰も気づけない
  - 代わりに `overview` に「正がどこにあるか」のポインタを持つ。**ポインタは陳腐化を機械検出できる**（`hikyaku validate`）
  - リポジトリにこれらがあれば参考として読む。**コードと矛盾したら常にコードを正とする**
- **`test_spec_review` 設定を廃止**: G8（plan + test-spec の承認）として全プロファイルで常に有効になった

### Migration

**破壊的変更が多いため、進行中のサイクルがある場合はプラグインのバージョンを固定して完走してから移行してください。**

移行の中心は「ファイルを動かすこと」ではなく「**既存ドキュメントを `document-guide.md` に `repo` 管理として登録すること**」です。`repo` 管理なら Hikyaku は形式に手を出さないため、`AD-N` 形式の ADR もそのまま使い続けられ、形式変換は不要です。

`/hikyaku:init` が v1 構造を検出し、対話しながら移行します（v1 ユーザーの状態は多様で、一律のルールでは捌けないため）。

| 対応が必要なもの | 内容 |
|---|---|
| **Node.js** | v22.18.0 以上が必要になりました。`hikyaku doctor` で確認できます |
| **`doc_root`** | `hikyaku_root` へリネームしてください。当面は旧キーも読みます |
| **`issue_backend`** | **エラーになります。** `[external] target` へ移行してください。完了判定がライブ照会から `PR` 列に変わり挙動が変わるため、黙って読み替えることはしません |
| **`test_spec_review`** | 廃止されました。G8 として常に有効です |
| **ディレクトリ構造** | `planning/` `tasklist.md` `build-NN/` は `cycles/{NNN}-{slug}/` 配下へ移動します（`cycles/001-legacy/` へのアーカイブが第一候補） |
| **`architecture/` 配下** | 移動しません。`document-guide.md` に `repo` 管理として登録します |
| **`retrospective.md` 等** | コミット対象になります。v1 では `.gitignore` されていたため、サイクルをまたいで学びが蓄積しませんでした |
| **リポジトリルートの `.hikyaku.config`** | 必須になりました。`hikyaku_root` はここでのみ宣言できます |
| **`{HIKYAKU_ROOT}/.hikyaku.config`** | 読み込まれません。**残っているとエラーになります。** 内容をリポジトリルートへ移して削除してください（黙って無視すると、設定したつもりの値が効かない状態になるため） |
| **スキルの引数** | `{HIKYAKU_ROOT}` を渡さなくなりました。`/hikyaku:planner 002-billing` のようにサイクルだけを渡すか、省略します |

`overview` が空の状態から始まるため、**初回サイクルの architect は差分調査ができず全体調査になります**（v1 と同じコスト）。初回の close-cycle で `overview` が作られ、2周目から差分調査が効きます。これは設計通りの挙動です。

## [1.0.0]

### Added

- **issue保存先バックエンドの抽象化（`issue_backend`）**: `.hikyaku.config` に `issue_backend = "file" | "github" | "asana"` を設定することで、各ビルドの issue.md / plan.md / handoff.md の記録先を切り替えられるようになった
  - `file`（デフォルト）: 従来通りローカルファイルとして作成・コミットする
  - `github`: 対象リポジトリに tasklist 相当の親issueと各ビルドのsub-issueを作成し、plan.md/handoff.mdをコメントとして記録する。完了判定はsub-issueのopen/closeをライブ照会し、PRマージ時の `Closes #N` で自動close される
  - `asana`: `.hikyaku.config` の `asana.project_gid` で指定したプロジェクトに各ビルドをタスクとして作成する（ユーザー設定済みのAsana MCPツールを前提とする）
  - いずれのバックエンドでも `tasklist.md` の buildID/title/BP/dependencies はファイル管理のまま維持し、依存関係判定の唯一の真実とする。各ビルドの issue.md 相当を指す参照列（`issue`列/`asana`のみ`task`列）と `PR` 列も全バックエンド共通で存在し、値はすべてMarkdownリンク形式（`file`: `build-{NN}/issue.md`への相対リンク、`github`: issue URLへのリンク、`asana`: Asana task URLへのリンク）で統一する（詳細は `skills/build-manager/references/backends.md`）
  - `build-manager` がplan.md/handoff.mdの永続化も含む「ビルド記録I/O」全般の唯一の窓口になった（新操作: 記録の永続化）
  - architect のビルド分割は、ドラフト確定（書き込みなし）→ build-manager への一括委任（Step 5a/5b/5c）の2段階に変更し、外部システムでのissue/タスクの作成・削除の乱造を防ぐ
- **中間成果物レビュー（doc-reviewer）**: 新規エージェント `doc-reviewer` が、`user_stories_review` / `architecture_review` / `plan_review`（`.hikyaku.config`、デフォルトいずれも `true`）に応じて、承認前の user-stories.md / architecture配下ドキュメント / plan.md の整合性・網羅性を証拠ベースでレビューする
  - `architecture` / `plan` の2contextでは、設計・計画レベルでのセキュリティ考慮の欠落（セキュリティ設計漏れ / 非機能要件のセキュリティ未反映）も報告対象に含む。確定的な根拠までは無くても、高感度カテゴリに該当し具体箇所を指摘できる懸念は「確度: 要確認」ラベル付きで「確度が低い懸念」セクションに出す
- **DOC_ROOTレベルのconfig上書き**: `{DOC_ROOT}/.hikyaku.config` を配置すると、`doc_root` を除くキーをリポジトリルートの `.hikyaku.config` に対してキー単位で上書きできるようになった
- **プロジェクトディレクトリの自動初期化**: `/hikyaku:planner` の初回実行時、`{DOC_ROOT}/.gitignore`（`retrospective.md`/`test-spec.md`/`design-questions.md`/`build-{NN}/questions.md` を除外。`planning/questions.md`はarchitectが必須入力として読むため対象外）と `{DOC_ROOT}/.hikyaku.config` の雛形を冪等に自動生成するようになった
- **`issue_backend` が `file` 以外の場合の `build-{NN}/` 除外を明確化**: `issue.md`/`plan.md`/`handoff.md`は外部レコードが正、`test-spec.md`/`questions.md`/`retrospective.md`はbackendによらず常に除外のため、結果として`build-{NN}/`配下には残るファイルが無くなる。これを個別ファイルパターンではなく`build-*/`という単一の`.gitignore`パターンで明示するようにした（`tasklist.md`は`build-{NN}/`の外にあり、依存関係判定の唯一の真実として全backend共通で除外対象にしない）。各フェーズスキル（planner/architect/builder）のディレクトリ構造説明にもこの挙動を明記した
- **security-reviewerの確度が低い懸念の報告**: 認証・認可、暗号、外部入力等の高感度カテゴリに該当する変更については、確定的な根拠（データフロー等）を示せなくても、具体的な箇所を指摘できる懸念であれば「確度: 要確認」ラベル付きで「確度が低い懸念」セクションに報告するようになった（false negativeのコストがfalse positiveより大きいというセキュリティ特有の非対称性を踏まえた変更）

### Removed

- **security-reviewerのエスカレーション判定を廃止**: builder Step 8 で `security-reviewer` が `/security-review` へのエスカレーションを判定・提案する挙動を削除した。`security-reviewer` はOWASP系パターンの指摘に専念する（高感度カテゴリの確度が低い懸念は上記の通り別枠で報告する）。`/security-review` スキル自体はユーザーが任意のタイミングで実行可能なまま変更なし

### Migration

- **破壊的変更**: `retrospective.md` / `test-spec.md` / `design-questions.md` / `build-{NN}/questions.md` は `{DOC_ROOT}/.gitignore` の対象になり、以後コミットされなくなる（`planning/questions.md`はarchitectの必須入力のため対象外のまま）。既存ワークフローでこれらをコミット済みの場合、次回コミットからは追跡対象外になる（既存のコミット履歴には影響しない）
- `issue_backend` を設定しない場合は `file` がデフォルトとなり、既存ワークフローの動作に変更はない
- `user_stories_review` / `architecture_review` / `plan_review` を設定しない場合はいずれも `true` となり、新たにレビューステップが各承認前に挟まる（従来より承認ラウンドが増えることはないが、レビュー実行分のセッション消費が増える点に注意）
- builderからの `/security-review` への自動エスカレーション提案が無くなるため、セキュリティ感度の高い変更を扱うプロジェクトでは `/security-review` を明示的に実行するタイミングを別途運用で定める必要がある
- `security-reviewer` / `doc-reviewer`（architecture・planコンテキスト）は「確度が低い懸念」を新たに報告するようになるため、従来より指摘件数が増える場合がある。ただし重要度: 高/中/低の指摘とは別枠で提示されるため、確定的な指摘との混同はしない

## [0.8.1]

### Added

- **`test_spec_review` 設定オプション**: `.hikyaku.config` に `test_spec_review = false` を設定すると、builder Step 5 での test-spec.md 承認ゲートをスキップできるようになった。plan.md 承認後の test-spec.md 作成がスムーズになり、承認ループを減らしたいプロジェクト向けのオプション（デフォルト: `true`）

### Migration

- 既存ワークフローへの影響なし。`.hikyaku.config` に `test_spec_review` を設定しない場合はデフォルト `true` となり、従来の承認ゲートが維持される

## [0.8.0]

### Added

- **`.hikyaku.config` による設定ファイルのサポート**: リポジトリルートに `.hikyaku.config`（TOML形式）を配置することで、スキル呼び出し時の引数省略や動作カスタマイズが可能になった。フォーマットの詳細は README の「設定ファイル」セクションを参照
  - `doc_root` — DOC_ROOT パスを固定し、`/hikyaku:planner`, `/hikyaku:architect`, `/hikyaku:builder` の引数を省略可能にする
  - `base_branch` — PRのベースブランチを指定。未設定時は `git remote show origin` でデフォルトブランチを自動検出する
  - `retrospective` — 振り返りの動作を `prompt`（デフォルト・毎回確認）/ `auto`（確認なし自動実行）/ `skip`（スキップ）で制御する
  - `bp_max` — ビルド分割のBP上限を変更する（デフォルト: 8）
  - `code_review` — `false` にすると builder Step 8 のコードレビューをスキップする（デフォルト: true）
  - `security_review` — `false` にすると builder Step 8 のセキュリティレビューをスキップする（デフォルト: true）

### Migration

- 既存ワークフローへの影響なし。`.hikyaku.config` を作成しない場合はすべての設定がデフォルト値となり、従来の動作が維持される
- planner / architect / builder の `argument-hint` を `[{DOC_ROOT}]` に変更（引数がオプションであることを明示）。内部スキル（build-manager / retrospective）は対象外。スキルの動作に影響なし

## [0.7.0]

### Added

- **企画フェーズの4項目サマリを永続化**: planner Step 3 ですり合わせる「実現したいこと / 背景・目的 / 対象画面・対象データ / 制約・要件」の4項目を、`planning/user-stories.md` 冒頭の「## 概要」セクション（各項目 h3 見出し）として記録するようテンプレートを拡張。これまで会話表示のみで揮発していた Discovery の合意内容が後段フェーズで参照できるようになる
- **設計判断ログ（ADR）の新設**: `architecture/decisions.md` を新規追加。architect Step 4a で「分岐あり」と判定された判断について、Step 4b 末尾で **決定 / 文脈 / 検討した案 / 採用理由 / トレードオフ** を1エントリ（`AD-N`）として記録する。トレードオフ欄に「特になし」は禁止（書きたくなる場合は分岐判定を見直す）
- **builder の判断追従**: builder Step 2（コンテキスト復元）で `architecture/decisions.md` を読み込む手順を追加。後続ビルドが採用案を意図せず覆さないようにする。覆す必要が生じた場合は新しい AD エントリの追記と handoff.md への記録を義務化

### Migration

- 既存ワークフローの `planning/`, `architecture/`, `build-NN/` の中身は変更不要
- 過去に作成済みの `user-stories.md` への「## 概要」追記は任意（新規ワークフローのみ義務）
- 過去ワークフローの `decisions.md` は不要。新規ワークフローで分岐ありの判断が出た時点で作成される

## [0.6.0]

### Added

- **サブエージェント定義の新設**: `agents/` 配下に `code-explorer` / `code-architect` / `code-reviewer` / `security-reviewer` の4エージェントを追加。architect / builder スキルから委任されて起動される
  - `code-explorer`: architect Step 2 で起動。担当観点に沿った既存コード調査と **Key Files リスト** を返す
  - `code-architect`: architect Step 4 で起動。指定された観点（Minimal / Clean / Pragmatic 等）に基づく単一の設計案を返す
  - `code-reviewer`: builder Step 8 で `security-reviewer` と並列起動。スコープ準拠・規約準拠・バグ・冗長性を **証拠ベース判定** で報告する（セキュリティ観点は security-reviewer の領域なので扱わない）
  - `security-reviewer`: builder Step 8 で `code-reviewer` と並列起動。OWASP 系のセキュリティパターン違反を証拠ベースで報告し、必要に応じて `/security-review` へのエスカレーション判定も出す
- **planner Step 3「目的とスコープのすり合わせ」を新設**: 質問ループ前に「何を実現したいか / 背景・目的 / 対象画面・対象データ / 制約・要件」の4項目を要約してユーザーと認識合わせを行う Discovery 確認ゲートを追加（旧 Step 3 は Step 4 に、旧 Step 4 は Step 5 に繰り下げ）
- **architect Step 2 を並列調査+Key Files 一次読解に拡張**: user-stories の規模に応じて `code-explorer` を複数並列で起動し、各エージェントが返す Key Files をメインセッションが直接 Read することで設計判断の解像度を上げる
- **architect Step 4 に「主要設計判断の特定と分岐評価」サブステップを追加**: 妥当な代替案が複数ある判断について、`code-architect` を2〜3並列で起動して trade-off 比較・推奨案提示・ユーザー選択を行うパターンを導入。分岐がない判断は従来通り単一案で確定する
- **builder Step 8「コードレビュー」を新設**: ローカル検証（lint / test / build）と申し送り作成の間に `code-reviewer` と `security-reviewer` を **並列起動** するレビューステップを追加。指摘ごとに「今修正 / 新ビルド化 / そのまま進める」をユーザーが選択できる。`security-reviewer` がエスカレーションを推奨した場合は `/security-review` の実行をユーザーに案内する（旧 Step 8〜10 は Step 9〜11 に繰り下げ）
- **証拠ベースの判定ルール**: `code-reviewer` と `security-reviewer` の判定基準を「信頼度80以上」という数値しきい値から、**根拠の種類** で報告/非報告を決める方式に変更。各指摘には根拠ラベル（ドキュメント不整合 / バグ / Injection / 認可漏れ 等）を必須化し、再現性と説明可能性を向上

### Migration

- 既存ワークフローの `planning/`, `architecture/`, `build-NN/` の中身は変更不要
- ステップ番号の変更（planner Step 4-5、builder Step 9-11）はスキル内部の参照番号のため、ユーザー側の対応は不要

## [0.5.1]

### Changed

- **BP閾値の統一**: `build-manager/SKILL.md`・`build-manager/references/bp-guide.md`・`README.md` に分散していたBP閾値を統一（分割推奨: 合計BP 6以上、分割必須: 合計BP 9以上）。互換性への影響なし
- **設計フェーズの承認順序を変更**: `architect` Step 5 で「設計ドキュメント承認 → build-manager 呼び出し」の順に変更。設計を確認してからビルド分割を承認する自然な流れに整理
- **実装フェーズに後続セッション開始タイミングの注意書きを追加**: `builder` Step 9 に「後続ビルドのセッションは PR マージ後に開始すること」の注記を追加

### Fixed

- `planner` の description にあった typo を修正（「読み込み、にユーザー」→「読み込み、ユーザー」）
- 各スキルのディレクトリ構造例で `plan.md` 行のインデントが他行と揃っていなかった点を修正

### Added

- `.claude-plugin/plugin.json` に `license` フィールド（MIT）を追加

## [0.5.0]

### Changed

- **BREAKING**: Claude Code プラグイン形式に対応 — `.claude-plugin/plugin.json` と `.claude-plugin/marketplace.json` を追加し、`claude plugin install hikyaku@hikyaku` で導入できるようにした
- **BREAKING**: スキル名から `hikyaku-` プレフィックスを除去 — プラグインの名前空間機能（`/<plugin>:<skill>`）と統合
  - `/hikyaku-planner` → `/hikyaku:planner`
  - `/hikyaku-architect` → `/hikyaku:architect`
  - `/hikyaku-builder` → `/hikyaku:builder`
  - 内部スキル: `hikyaku-build-manager` → `build-manager`、`hikyaku-retrospective` → `retrospective`
- スキルディレクトリも対応してリネーム（`skills/hikyaku-*/` → `skills/*/`）
- README にプラグインインストール手順を追加

### Migration

- 旧バージョン（0.4.x）のスタンドアロン構成を使っているユーザーは、`.claude/skills/` から旧 `hikyaku-*` スキルを削除し、新しいプラグインを `claude plugin install hikyaku@hikyaku` で導入する必要がある
- 既存の `{DOC_ROOT}/` 配下のドキュメント（`tasklist.md`, `planning/`, `architecture/`, `build-NN/`）は変更不要

## [0.4.1]

### Changed
- リトライポリシーの判定基準を「根本原因ベース」から「同一ファイルへの修正回数ベース」に変更 — AIが根本原因の変化を自己判断してカウントをリセットし、コンテキストを浪費する問題を防止

## [0.4.0]

### Changed
- 全スキルの作業ステップをチェックボックス形式に再構成 — 完了条件を明確化し、手順スキップを防止 (#16)
- 全スキルに Step 0（ファイル読み込み）を追加 — テンプレートやリファレンスの読み込み漏れを防止
- 承認ステップを作成ステップに統合し、フィードバックループを明確化（planner, architect, builder）
- mermaid フローチャート・冗長なリスト（「やること」「成果物」）を削除し、全体で約185行削減
- `$ARGUMENTS[0]` 表記を全スキルで統一
- plan.md テンプレートに BP 見積もりセクションを追加
- tasklist.md テンプレートに builder 呼び出しコマンドを追加

## [0.3.0] - 2026-04-06

### Added
- `hikyaku-build-manager` スキルを追加 — ビルドの追加・更新・分割と依存グラフ管理を一元化 (#11)
- `hikyaku-retrospective` スキルを追加 — 各フェーズ末の振り返りを model-invocable スキルとして独立化 (#12)
- BP見積もりに影響ファイル数の加算要素を追加 (#11)
- README に「ビルドポイント（BP）」セクションを追加

### Changed
- builder の plan.md と test-spec.md の承認ステップを分離（個別承認に変更） (#13)
- builder テンプレートの issue.md 重複除去と handoff.md の棲み分けを明確化 (#13)
- bp-guide.md の構成を整理し、BP見積もり指標を改善 (#11)
- テンプレートのヘッダー例から `#` を除去し、二重見出しを防止 (#12)
- README のアウトライン構成を見直し

## [0.2.1] - 2026-03-28

### Changed
- ビルド分割時のリナンバリングを不要にする（末尾追加+依存グラフ方式） (#10)

## [0.2.0] - 2026-03-24

### Changed
- builder の承認ステップを統合（plan.md + test-spec.md 一括承認） (#9)

### Fixed
- `copilot-instruction.md` を `copilot-instructions.md` に修正 (#8)

## [0.1.2] - 2026-03-21

### Added
- スキルバージョン更新時にタグを自動作成する CI (#6, #7)
- スキルバージョンの統一性を検証する CI (#5)
- `copilot-instructions.md` を追加 (#6)

### Changed
- 用語統一: タスク→ビルド、プロジェクト→ワークフロー/リポジトリ、SP→BP に置き換え (#3)
- Agent Skills 仕様準拠: frontmatter 改善・references/ ディレクトリ整理 (#3, #4)
- SP見積もり精度を改善: API閾値調整・加算要素チェック必須化 (#2)
- builder の buildID 引数をオプション化（省略時は next） (#3)
- `instruction.md` によるワークフロー固有インストラクションをサポート
- retry-policy に同一原因の判定基準を追加 (#1)
- セッションの目安を明示

## [0.1.0] - 2026-03-18

### Added
- 初期リリース: `hikyaku-planner`, `hikyaku-architect`, `hikyaku-builder` の3スキル
- README.md を追加
