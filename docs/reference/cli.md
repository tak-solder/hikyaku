# CLI リファレンス

決定的な処理はすべてスクリプトが担います。スキルが自動的に呼ぶため手で実行する場面は限られますが、状態の確認と検証は直接呼ぶ価値があります。

各コマンドの引数と挙動は `hikyaku help <command>` が持ちます。ここには「いつ、なぜ使うか」だけを書きます。

## 実行方法

Claude Code のスキル内ではプラグインの位置が解決されます。Codex のスキルは読み込まれたスキルの実パスから解決します。自分のシェルから Claude Code のインストール済みプラグインを叩く場合はパスが必要です。次の関数を `~/.zshrc` や `~/.bashrc` に入れてください。

```bash
hikyaku() {
  local dir
  dir=$(claude plugin list --json |
    node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).find(p=>p.id.startsWith("hikyaku@"))?.installPath ?? ""')
  [ -n "$dir" ] || { echo "hikyaku プラグインが見つかりません" >&2; return 1; }
  node "$dir/scripts/hikyaku.mts" "$@"
}
```

以降、このドキュメントのコマンドはすべて `hikyaku <command>` の形で書きます。

**インストール先を推測せず、`claude plugin list --json` の `installPath` から引いてください。** プラグインは `~/.claude/plugins/cache/{marketplace}/{plugin}/{version}/` に展開されますが、更新しても古いバージョンのディレクトリは残り、ディレクトリ名はバージョン番号とは限りません（コミットハッシュや `unknown` になることがあります）。パスを固定で書いたり、最新らしきディレクトリを選んだりすると、実際に有効なものとは別のバージョンを叩くことになります。

リポジトリを clone して使うこともできます（[CI での検証](../operations/ci.md) はこの形です）。

```bash
node /path/to/hikyaku/scripts/hikyaku.mts <command>
```

**`${CLAUDE_PLUGIN_ROOT}` はシェルでは使えません。** これは Claude Code がスキルやフックを実行するときにだけ定義される変数で、SKILL.md の中でのみ有効です。

## グローバルオプション

| オプション | 意味 |
|---|---|
| `--root <path>` | HIKYAKU_ROOT を明示指定する |
| `--profile <name>` | profile を上書きする（what-if の確認用） |
| `--json` | 機械可読な JSON で出力する |
| `--dry-run` | 書き込みを行わず、何が起きるかだけを表示する |
| `--help` | ヘルプを表示する |

書き込みコマンドはすべて `--dry-run` に対応します。承認は常に呼び出し元のスキルが取り、スクリプトは「何が起きるか」を返す責務だけを持ちます。

## 終了コード

| コード | 意味 |
|---|---|
| `0` | 成功 |
| `1` | エラー（実行できなかった） |
| `2` | 検証失敗（実行したが問題が見つかった） |

## 状態を見る

| コマンド | いつ使うか |
|---|---|
| `next [<cycle>]` | 次に着手できるビルドを知りたいとき。複数返れば並行実行できる。判定は**いま居るブランチの `HEAD`** が基準 |
| `cycle list [--active]` | 走行中のサイクルを見渡したいとき。ビルド列は「マージ済み / 全体」で、手元で完了しマージ待ちのものは (+n) が付く |
| `cycle status <cycle>` | 中断からの再開点を知りたいとき。ブランチを切り替えてから実行する。中断点は `HEAD` 基準。作業ツリーに `return.md` があれば「差し戻し中」と表示し、architect を案内する |
| `tasklist read [<cycle>]` | ビルドの一覧と完了状況を見たいとき |
| `config [<cycle>]` | 設定のマージ結果とプロファイルの展開結果を確認したいとき。`--no-cycle` で、選択済みのサイクルを参照せずルート設定だけを返す（サイクルに属さない patch 用） |

## 検証する

| コマンド | いつ使うか |
|---|---|
| `doctor` | 環境が動く状態かを確認したいとき。導入直後と、動かないとき |
| `validate [<cycle>]` | ファイルの整合性を確認したいとき。[CI](../operations/ci.md) から呼ぶと効く。`token-guide/guide.md` の版の宣言と本文の食い違い、受け入れ基準の割り当て漏れ、「マージ時点で残る危険」の記録の不備も見る |
| `docs validate` | ドキュメントガイドのパスだけを確認したいとき |
| `rules check` | パス指定の rule（`.claude/rules/`）を足したり直したりしたあと。glob が広すぎて本文が長い rule と、どのファイルにも一致しなくなった rule を見つける |

## ドキュメント

| コマンド | いつ使うか |
|---|---|
| `docs list` | 登録されている永続ドキュメントの一覧と管理主体を見たいとき |
| `docs link` | ドキュメントを追加・移動したあと、AGENTS.md の索引を再生成するとき |
| `docs scaffold` | ガイドの雛形が欲しいとき（通常は `init` が呼ぶ） |
| `context <phase> [<cycle>]` | そのフェーズで読むべきドキュメントの候補を知りたいとき |

`context` はフェーズ→論理名の対応の唯一の正です。各 SKILL.md に「何を読むか」を書くと4箇所に同じ表が載って必ず食い違うため、ここに集約しています。返すのは候補と理由までで、絞り込みはしません。どれが今回のスコープに関係するかは概要欄を読んで判断することで、それはスキル（LLM）の仕事です。

`build-NN` では `overview` / `decisions` / `constraints` を候補に出しません。そのビルドに効く節は、全文を読んで設計した architect が `issue.md` の「参照する設計ドキュメント」で指すためです。`conventions` は、AGENTS.md や CLAUDE.md 以外のファイルに登録されているときだけ候補に出します。自動では読み込まれないためです。`tasklist.md` の依存グラフから先行ビルドの `handoff.md` は辿ります（手で辿ると漏れるため）。

| コマンド | いつ使うか |
|---|---|
| `promotions [<cycle>]` | サイクルを締めるとき。各ビルドの `handoff.md` と各フェーズの `retrospective.md` から、永続化の候補と「役に立たなかった記述」を集めて束ねる |

`promotions` は集めて束ねるだけで、取捨選択はしません。重複の判定、マージ済みのコードとの照合、重要度の見直しは close-cycle が行います。書式どおりに読めなかった行も捨てずに返すので、候補を落としたまま気づかないことはありません。考え方は [知見の置き場](../configuration/persistence.md) にあります。

## サイクル

| コマンド | いつ使うか |
|---|---|
| `cycle new <slug> --profile <name>` | サイクルを作るとき（通常は `create-cycle` が呼ぶ） |
| `cycle use <cycle>` | このチェックアウトの作業サイクルを記録するとき |
| `cycle close <cycle>` | サイクルを `closed` にするとき（通常は `close-cycle` が呼ぶ） |
| `cycle link <cycle> --external <url>` | 外部システムの親 issue の参照を手で記録するとき |

## ビルド

| コマンド | いつ使うか |
|---|---|
| `tasklist add` | ビルドを追加するとき（通常は `build-manager` が呼ぶ） |
| `tasklist update` | 既存ビルドのタイトル・予測ピーク・依存を変えるとき |
| `tasklist done --id <n> --pr <url>` | ビルドの完了を記録するとき。当該ビルドの PR に同梱する |
| `tasklist link --id <n> --issue <url>` | 子 issue の参照を手で記録するとき |

ビルドの分割に専用コマンドはありません。「元ビルドの `update` + 新ビルドの `add`」で表現します。

`tasklist` のコマンドは、受け付けないオプションと余分な位置引数をエラー（終了コード 1）にして書き込みません。シェルの関数から `--deps 1,2` が1つの引数で渡ったときや、オプション名のタイプミスで依存が黙って落ちると、依存グラフが壊れたまま着手可能なビルドが増えるためです。`add` と `update` は、追加・更新したビルドの予測ピークと依存を出力の見出しにも表示します。


## 手順

| コマンド | いつ使うか |
|---|---|
| `step next <phase> [<cycle>]` | フェーズの中の次の1手を知りたいとき（スキルの転送ループが呼ぶ） |
| `step report <phase> <step> [<cycle>] --result <結果>` | 1手の結果を記録するとき。記録したあと次の1手を返す |
| `step status <phase> [<cycle>]` | 手順の一覧と、それぞれが完了・スキップ・未完了・対象外のどれかを見たいとき |
| `step restart <phase> [<cycle>] [--round <回の種類>] --reason <理由>` | 同じ作業単位で手順を最初から回し直すとき（architect の再設計・追加設計、token-guide の新しい回、内部スキルの呼び直し） |
| `step where [<cycle>]` | このチェックアウトで、どの作業単位の手順が途中かを知りたいとき（navigator が呼ぶ） |
| `step hook stop` | Claude Code の Stop フックとして呼ばれる。手で実行するものではない |
| `step lint` | ステップの定義と指示ファイルの対応を確かめるとき（プラグイン自身の CI 用） |

`step next` は、作業単位のディレクトリの `progress.jsonl` と成果物から現在地を導き、次の1手を返します。返る1手は5種類です。`run` はステップを行うもので、読むべき指示ファイルと報告のコマンドが付きます。`gate` はユーザーに承認を求めるもの、`call` は build-manager などの内部スキルを呼ぶものです。`done` は手順をすべて終えたこと、`stop` は止まる理由を表します。止まるのは、v2 で作成したサイクル、builder で architect への差し戻し中のとき、記録が欠けている（成果物はあるのに一度も記録が無い）とき、それにスキルが定めた条件（init で初期化済みのときなど）です。何度呼んでも、同じ状態なら同じ1手が返ります。いま `step` に移っているのは init（`init`）・create-cycle（`create`）・planner（`plan`）・architect（`architect`）・builder（`build-NN`）・close-cycle（`close`）・token-guide（`token-guide`）・patch（`patch-YYYYMM-slug`）と、内部スキルの build-manager と retrospective です。navigator と conductor は手順を持たず、`step where` と `conductor parse` で手順の位置を読む側です。

作業単位のディレクトリはフェーズで決まります。PLAN は `planning/`、ARCHITECT は `design/`、ビルドは `build-NN/`、CLOSE と create-cycle はサイクルのディレクトリ自身、init は HIKYAKU_ROOT 自身、token-guide は `token-guide/` です。`step` は `.hikyaku.config` から HIKYAKU_ROOT を解決するので、init の雛形を生成する前は使えません。create-cycle も同じで、`cycle new` でサイクルを作るまでは使えません。

build-manager や retrospective のような内部スキルは、`--skill` を付けて呼び出し元のフェーズで進めます。architect から build-manager が呼ばれたら `step next architect --skill build-manager`、builder の振り返りなら `step next build-NN --skill retrospective` で、記録は呼び出し元と同じ `progress.jsonl` に入ります。呼び出し元が最後に報告したあとの記録だけがその呼び出しの分として数えられるので、呼ばれるたびに最初の手順から始まります。呼び出し元が報告しないまま呼び直すとき（builder の PR レビュー対応での振り返りなど）は、`step restart <phase> [<cycle>] --skill <内部スキル> --reason <理由>` で区切ってから始めます。`call` の1手には、呼ばれた側が最初に実行する `step next` のコマンドが添えられます。

同じ作業単位で手順を回し直すときも `step restart` を使います。token-guide は何度も回すので、前の回の記録が残っていると `step next` は `done` を返します。新しい回は `step restart token-guide --reason <理由>` で始めます。前の回の記録はそのまま残り、区切りより後の記録だけが今回の回として数えられます。`--round` は回の種類で、スキルが受け付ける値だけを指定できます。architect では `return` が差し戻しからの再設計、`add` が指摘からの追加設計で、それぞれ返る手順が変わります。`--reason` は自由な理由として記録に残るだけです。

`step report` が記録できるのは、現在地のステップと、完了したステップの報告し直しだけです。`step next` が `stop` を返す状態（差し戻し中など）では、前に受け取った報告のコマンドも受け付けません。成果物が要るステップは、成果物が無ければ `done` を受け付けません。`skipped` と `failed` には理由が、ゲートの `rejected` にはユーザーの答えが必須です。builder の `plan` の `done` には見積もり直した予測ピーク（`--peak`）が、PR を作るステップの `done` には PR の URL か番号（`--pr`）が必須です。報告には、その時点のコンテキスト・セッション ID・Hikyaku の版も入ります。

ゲートの承認は、差し戻すか、前のステップを報告し直すまで有効です。承認したあとに成果物を直しても、自動では無効になりません。変更は Git の履歴で追い、承認を取り直すかは変更の中身を見て決めます。取り直すときは、作り直したステップを `done` で報告し直すと、そこから後ろがやり直しになります。

`step where` は、作業ツリーにある `progress.jsonl` を読み、記録のある作業単位ごとに `step next` と同じ1手を返します。フェーズを指定しなくてよいので、どこから再開すればよいかが分からないときの手がかりになります。並ぶのは指定したサイクルの作業単位だけで、init と token-guide の記録は混ざりません。`cycle close` で終えたサイクルも読みます。内部スキル（build-manager / retrospective）を呼んでいる最中の作業単位は、呼ばれたスキルの1手を返します。記録は各フェーズのブランチにコミットされるため、別のブランチで進めた作業単位は見えません。v2 で作成したサイクルでは作業単位を読まず、v2 のまま終える案内を返します。

`step hook stop` は、プラグインが Claude Code の Stop フックとして登録しているコマンドです。スキルの転送ループの途中でセッションが止まろうとしたときに、1回だけ続きを促します。止めるのは、そのセッションが手順を進めていて（`progress.jsonl` にそのセッションの ID がある）、次の1手が `run` か `call` のときだけです。ゲートで承認を待つとき、手順を終えたとき、`stop` が返ったときは止めません。同じターンの2回目も止めないので、ステップの途中でユーザーに尋ねたり、ユーザーが中断を指示したりしたときは、そのまま終えられます。Hikyaku を使っていないリポジトリや、記録を読めないときも何もしません。

## patch

| コマンド | いつ使うか |
|---|---|
| `patch resolve [<slug>] [--cycle <cycle>]` | patch を始めるとき・再開するとき（patch が最初に呼ぶ）。作業単位の名前・ブランチ・切る元・記録の場所と、サイクルに属すなら PR 列が空のビルドを返す |
| `patch prune --before <YYYYMM>` | サイクルに属さない patch の、PR を作った古い月の記録をまとめて消すとき |

`patch resolve` はサイクルを推測しません。`--cycle` を渡したときだけそのサイクルに属し、現在のブランチや `.hikyaku.local` からは選びません。サイクルに属さない patch が、たまたま近くにあったサイクルの設定や統合ブランチで動くのを防ぐためです。現在のブランチが patch のブランチなら（ルートとサイクルのどちらの `[branch]` で名付けられていても）、その patch の再開として扱います。再開では記録の場所が正で、記録がまだ無ければ（記録を始める前に中断した）推測せずに `recordMissing` を返します。名前の重複は、記録・ローカルのブランチ・追跡参照・origin のブランチで確かめ、origin に届かなければそのことを返します。

`patch prune` が消すのは `{HIKYAKU_ROOT}/patches/` の下だけで、サイクルに属す patch の記録はサイクルと一緒に残ります。PR を作った記録が無いものと、いま居るブランチの patch は消さずに一覧に出します。消したあとのコミットと PR は自分で行います。

## 予測ピーク

| コマンド | いつ使うか |
|---|---|
| `tokens guide [<cycle>]` | 見積もりに使うガイド（プロジェクトか標準か）と、その版を確認したいとき |
| `tokens estimate [<cycle>] --fixed <n> --reading <n> ...` | 成分ごとに見積もったトークンを合計し、予測ピークと判定を出すとき（build-manager / builder / patch が呼ぶ）。サイクルに属さない patch は `--no-cycle` を付ける |
| `tokens stamp` | ガイドの本文を変えたあと、版を上げるとき。ガイドが無ければ標準から作る |
| `tokens session [<phase> [<cycle>]]` | 振り返りで、セッションのコンテキストのピークを実測するとき。過去のビルドのセッションを測るときも使う |
| `tokens history [<cycle>]` | ガイドを補正する前に、ビルドごとの予測・実測・乖離・区切りでのコンテキストを見渡したいとき。`--group-by` でモデル・版・ホスト・ガイドの版ごとに分ける |
| `tokens history build-NN [<cycle>]` | 振り返りで、そのビルドの差分（新規ファイル数・追加行数とその実装とテストの内訳）を数えるとき |

`tokens estimate` が返すのは、5つの成分（固定費・読み込み・実装・テスト・未知の領域）の合計と、`[context]` の帯に対する判定と、記録に貼る内訳表です。成分の値はガイドに沿って LLM が見積もり、コマンドは足し算と判定だけを行います。5つの成分はすべて必須で、該当しない成分は 0 を渡します。省いた成分を黙って 0 にすると、考えなかったのか無いと判断したのかが記録から分からなくなるためです。内訳表の最後の行には、見積もりに使ったガイドの版とハッシュが入ります。

`tokens history build-NN` は、PR の base からの差分を数えます。比較の起点は `pr base` と同じ導出なので、PR に含まれる差分と、測る差分が一致します。起点を別に持つと、先行ビルドの差分まで数えたり、逆に PR の一部を数え落としたりします。ワークスペース配下と、ロックファイル・スナップショット・生成コードは書いた量ではないので数えず、除いたファイルを一覧で出します。生成物とテストのパスは `[diff]` で変えられます（[設定](../configuration/config-file.md#diff)）。起点を解決できないときは、推測せず「計測不可」とその理由を返します。実測できなかったことを実測できたように記録させないためです。

`tokens session` は、ホストが残すセッションの記録からコンテキストの大きさを実測します。引数なしでは現在のセッションを測り、Claude Code では `CLAUDE_CODE_SESSION_ID`、Codex では `CODEX_THREAD_ID` で記録を特定します。`<phase> [<cycle>]` を渡すと、そのフェーズのブランチに対応付くセッションを集め、そのブランチでの API 呼び出しが最も多いものを本体として測ります。サブエージェントと Codex の guardian は対象外です。記録のファイルは `--transcript <path>` で直接指定することもできます。記録が見つからないとき、Codex のクラウドで rollout が無いときは、終了コード 0 で「計測不可」とその理由を返します。`--markdown` は `retrospective.md` に貼る表を出します。

ガイドの構成と補正の手順は [予測ピークと見積もりのガイド](../configuration/token-guide.md) にあります。

## 命名

| コマンド | いつ使うか |
|---|---|
| `branch verify <phase> [<cycle>]` | 今いるブランチが規則どおりか確認するとき。各フェーズの冒頭とコミット直前 |
| `pr title <phase> [<cycle>]` | PR タイトルを生成するとき |
| `pr base <phase> [<cycle>]` | PR のマージ先を決めるとき。PR を作る直前。`--ref` でローカルに解決できる ref（レビューの差分基準）を返す |
| `session title <phase> [<cycle>]` | セッション名を生成するとき |
| `pr ready` | 設定と実行元に従って Draft PR を公開するとき。conductor は取り込み前の公開にも使う |
| `pr request-reviewers <phase> [<cycle>] --pr <PR>` | PR を作った直後に、設定のレビュアーをアサインするとき（通常は各スキルが呼ぶ） |

`branch verify` は生成と検証を兼ねています。名前を生成するだけのコマンドを別に持つと、生成しただけで確認しないまま作業する余地が残るためです。

`pr base` は通常デフォルトブランチを返しますが、先行フェーズのブランチから積んでいる（スタックしている）場合はそのブランチを返します。[conductor](../workflow/conductor.md) の統合ブランチ（`{cycle}/conductor`）から切ったフェーズでは、conductor ブランチを返します。conductor ブランチはデフォルトブランチから切った直後だとデフォルトブランチの履歴に含まれますが、デフォルトブランチの `PR` 列にビルドが記録される（conductor ブランチの PR がマージされる）までは、取り込み済みとみなしません。conductor ブランチ自身の PR は常にデフォルトブランチへ向きます。スタックしているかどうかは状態として保存せず、同じサイクルの Hikyaku ブランチのうち「HEAD の履歴に含まれていて、まだデフォルトブランチに取り込まれていない、最も近いもの」として導出します。積んだままデフォルトブランチへ PR を作ると先行ビルドの差分まで含んだ PR になるため、PR の作成直前とレビューの差分基準にこの値を使います。

取り込み済みかどうかは、祖先関係とデフォルトブランチの `PR` 列の両方で判定します。squash merge や rebase merge ではマージ済みでもブランチの先端が祖先になりません。祖先関係だけに頼ると、マージ済みのブランチをスタック元と誤判定して、存在しないブランチへ PR を向けることになります。

patch（`patch-YYYYMM-slug`）は、サイクルに属さなければ `<cycle>` を省き、ルートの設定でテンプレートを展開します。サイクルを渡しても推測はせず、渡されなければ記録（`patches/{YYYYMM}/{slug}/`）のある進行中のサイクルに属すとみなします。ブランチは `{prefix}/patch/{YYYYMM}/{slug}` です。サイクルに属す patch を統合ブランチから切っていれば、`pr base` は conductor ブランチを返します。PR タイトルとセッション名の `{phase}` は `patch` になり、`--build-title` が `{title}` に入ります。

`branch verify` / `pr title` / `session title` は対象サイクルの設定でテンプレートを展開します。`[branch]` / `[pr]` / `[session]` は[サイクルごとに変えられる](../configuration/config-file.md#サイクルごとに変える)ため、サイクルに属さない `init` と `token-guide` を除いてサイクルの特定が必要です。ID や slug で渡してもディレクトリ名に解決されるので、`002` からも `hikyaku/002-billing/plan` が返ります。

## レビュー

| コマンド | いつ使うか |
|---|---|
| `review action` | コード・セキュリティの指摘の妥当性を判断したあと、対応確認と再レビューの要否を設定から決めるとき |
| `review resolve <kind> <phase> [<cycle>] --self <provider>` | レビューをどのプロバイダ・モデル・回数で、どう起動するか確かめるとき |
| `review run <kind> <phase> [<cycle>] --self <provider>` | コードやセキュリティのレビューを別プロセスで実行するとき（builder と patch が呼ぶ）。別プロバイダの doc-reviewer も同じ |

`<kind>` は `code` / `security` / `doc` です。`--self` にはメインのセッションのプロバイダ（`claude` / `codex`）を渡します。`[review]` の `provider = "auto"` と `provider_for` をこれで解決します（[.hikyaku.config](../configuration/config-file.md#review)）。

`review run` は `claude -p` や `codex exec` を起動し、生の出力を `.git` の中（`git rev-parse --git-path hikyaku/reviews` の下）に保存して返します。出力の解析や指摘の統合はしません。自由な文章なので、判断は呼び出したセッションが行います。空の結果、エラー、タイムアウトは終了コード 1 になります。origin/HEAD が無いときの `/security-review` のように、失敗が空の結果として返る場合があり、それを指摘0件と取り違えないためです。`max_rounds` を超える `--round` もエラーになります。

環境変数 `HIKYAKU_REVIEW_PROVIDER` を設定すると、設定ファイルの `provider` より優先されます。設定したプロバイダの CLI が使えない環境のためのものです。Claude Code と Codex のクラウド環境では、環境変数からそれを判定し、そこで動いているプロバイダに自動で固定します。詳しくは [.hikyaku.config](../configuration/config-file.md#review) を参照してください。

## 外部連携

| コマンド | いつ使うか |
|---|---|
| `external sync [<target>] [<cycle>]` | 投影が抜けたときに同期し直すとき |
| `external ref <phase> [<cycle>]` | PR 本文に入れる参照行を生成するとき |

## conductor

| コマンド | いつ使うか |
|---|---|
| `conductor asks [<cycle>]` | 子の問いのうち、どれを監督が答え、どれを人間に上げるかを確認するとき |
| `conductor launch <phase> [<cycle>] [<build>\|add]` | 子セッションの起動・再開コマンドを組み立てるとき（通常は `/hikyaku:conductor` が呼ぶ） |
| `conductor parse <result.json> [<cycle>]` | 子の結果から gate / done / blocked を取り出すとき（同上） |
| `conductor check-pr <pr> [<cycle>]` | フェーズの PR を conductor ブランチに取り込む前に、マージ先・Draft・レビューの依頼・未解決の指摘・CI（と、設定すれば承認）を確かめるとき。`--wait` で待てる問題が解消するまで確かめ直す（通常は `/hikyaku:conductor` が呼ぶ） |
| `conductor lint` | プラグイン本体の開発用。スキルに付けた問いの ID と、CLI の ID の表の食い違いを検出する |

`asks` は、子に許可するツールの一覧と、設定のダイジェスト（profile と `.hikyaku.config` の内容から作る）も返します。監督は起動時に人間と合意したときのダイジェストを、以後の `launch` / `parse` に渡します。設定が変わっていれば両者はエラーで止まります。子が `.hikyaku.config` を書き換えて、合意していない権限や振り分けが効くのを防ぐためです。

`launch` はコマンドを組み立てるだけで、自分では起動しません。起動を監督のセッションの Bash に置くことで、子に権限を渡す操作が人間の許可ルール（`Bash(claude -p:*)`）の下で起きるようにしています。`parse` を CLI に置くのは、監督が子の自由文から問いを読み違えると判断の前提が崩れるためです。規約どおりのブロックが無ければ `violation` を返し、監督は推測で進めません。`parse` は子の手順の位置も返します。子の `progress.jsonl` の記録をセッション ID で引き、子が最後に進めた作業単位の次の1手を出すので、監督はゲートで読むべき成果物を知り、子のブロックが手順と合っているかを確かめられます。done なのに手順が終わっていない、G8 で止まったのに手順がそのゲートに居ない、といった食い違いは `stepProblems` に入ります。

## セットアップ

| コマンド | いつ使うか |
|---|---|
| `init --root <path>` | 雛形を生成するとき（通常は `/hikyaku:init` が呼ぶ） |
| `version` | プラグインのバージョンを確認するとき |
| `help [<command>]` | 引数と挙動を調べるとき |
