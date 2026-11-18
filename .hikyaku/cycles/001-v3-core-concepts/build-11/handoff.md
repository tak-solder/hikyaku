# Build 11: G10 の同意と確認の区分、基準を消す経路と指標の比較 申し送り

## 後続ビルドが前提にすること

- G10 の同意が要る変更の判定は `promotions.mts` の `consentChanges` が唯一の判定。G10 の `consent`・`reopens`、write の `accepts` は `promotionConsent` を通してこれを呼ぶ。提示の区分（`promotions --json` の `approval`）は同じ表 `CONSENT_TARGETS` を使う。判定を足すときはここだけを直す
- 差分の基準は「サイクル直下の progress.jsonl の close-cycle の最初の記録の時刻の1秒前までの、HEAD から first-parent で辿った最後のコミット」（`git rev-list -1 --first-parent --before`）。記録を含むコミットで区切ると、文書の変更を先に別のコミットにしたときに見落とす（コードレビューの指摘）。コミットの日時は秒単位なので1秒前で区切り、同じ秒のコミットは同意の側に倒す。テストで close-cycle の前のコミットを作るときは日時を過去にする（`tests/close-consent.test.mts` の `closeWorkspace`）
- 差分は作業ツリーまで。サイクルが閉じて close-cycle の記録をコミットしたあとは見ない（マージ後のベースブランチや後続のサイクルの変更で、閉じたサイクルの G10 が戻らないように）。記録が未コミットのあいだ（報告の直後）は見るので、手順の途中で close のブランチにコミットした変更は次の報告で拾う
- 指標の比較のマージの判定は、件名が `Merge pull request #N ` か末尾が `(#N)` の、最も古いコミット（revert は除く）。`origin/<base>` を先に見る
- ゲートの承認の記録に `approval`（`consent` / `confirm`）が入る。無い記録は種類が分からない。G10 の `reopens` は、無い記録をこのビルドより前の同意の承認として扱う。ほかのゲートで `reopens` を使うときも、無い記録の扱いを決める
- `StepDefinition.reopens` はエンジンの汎用の欄（gate だけ。`step lint` が gate 以外を弾く）。承認があっても理由を返せば pending になり、後ろのステップはやり直しになる
- `recordsPr: "optional"` は `--pr` を受け付けるが必須にしない。close-cycle の followups だけが使い、基準を消す PR の番号が `quality-metrics.mts` の比較の起点になる（followups の done に添えるのは、消す PR だけ。フックの PR は添えない）
- build-06 の退けの `reworkFrom` とは名前をそろえていない。このビルドでは欄を足さず、G10 へ戻すのはエンジンの評価で行う（questions.md の Q1）
- conductor: ASKS の G10 は `confirm`（`enabledWhen: gates.promotion`）になり、`CONSENT_WHEN` に入った。`[conductor] delegate` に G10 を書けるようになったが、同意の回は `childStep` の `approval` でユーザーに固定される
- この環境では、リポジトリの CLI（`node scripts/hikyaku.mts …`）を直接実行できず、`conductor lint`・`step lint` を走らせていない。`（ask: …）` のタグは足していない。`step lint` の gate の検査は `tests/step-consent.test.mts` が同じ関数で確かめる

## 残したこと

- 確度: 要確認 — 消す候補の「理由の欠けた基準」を rule（frontmatter）に限った。文書（AGENTS.md など）の行は、「役に立たなかった記述」に挙がったものだけを候補にする。US-9.2 の「理由が消えた基準」の範囲を狭める解釈で、理由の欄の導入前の行が大半のため全行が候補になるのを避けた（G8 で監督が承認。questions.md の Q1）。文書の行も候補にするなら、`rules.mts` の `removalCandidates` に、登録された文書の箇条書きを読む経路を足す。いつ: 最後の PR、誰が: ユーザー
- patch の P2 は同意のまま残した（build-01 の handoff で「build-11 が決める」とされた件）。P2 はサイクルに属さない patch の永続ドキュメントの更新で、候補ごとの区分を足すにはサイクルの外の差分の基準が要る。いつ: 次に patch の承認を見直すとき、誰が: architect
- `args.reworkFrom`（issue.md）は足していない（解釈2。questions.md の Q1）
- コードレビュー（ラウンド 2）で「そのまま進める」とした指摘（監督の判断。questions.md の Q2）: G10 の consent は、位置だけを読む経路（Stop フック・step where）でも git を数回呼ぶ。1回の評価の中ではメモ化済み（`close-cycle.mts` の `consentCache`）。位置だけの経路で同意に倒すと、`step next` と現在地が食い違う（plan-review の指摘で決めたこと）。遅さが問題になったら、評価をまたいでキャッシュする手段を考える
- `conductor lint`・`step lint` は、このセッションの権限ではリポジトリのスクリプトを実行できず、回していない（`（ask: …）` のタグは足していない）
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない）

## レビューの記録

- [重] `-`: サイクルを閉じたあとは作業ツリーを見ず、close のあとで変えた decisions・constraints が同意なしに通る
- [重] `-`: 差分の基準を記録を含むコミットで区切り、先に別のコミットにした文書の変更を見落とす
- [重] `-`: 消す候補の文書の行を、引用を含む最初の行（見出しなど）で決め、違う行を消し、重要度を違う行で判定する
- [重] `-`: 消した PR を参照する後のコミット（revert）をマージの時点とみなす
- [重] `-`: 手元のベースブランチを先に見て、GitHub でマージした PR を未マージとし続ける
- [軽] `-`: G10 を省いた回のフックの扱いを手順の文章だけで止め、ステップ定義に条件を持たせていなかった
- [軽] `-`: 1回の評価で G10 の git の判定を何度も走らせる
- [軽] `-`: rules candidates が追跡ファイルと rule の測定を2回行う
- [軽] `-`: マージの日をコミットした人のタイムゾーンの日付で取り、cycles.md のローカルの日付とずれる
- [重] `-`: テキストの directive が配列の args を `[object Object]` で出し、followups の消す候補と指標の比較が読めない
- [重] `-`: 閉じたサイクルの差分が、マージ後のベースブランチで他の PR の decisions の変更まで拾う
- [重] `-`: 差分の基準を日時だけで選び、ベースブランチを取り込んだ側のコミットを選ぶ
- [重] `-`: followups の `--pr` に、ガイドの見直しやフックの PR も基準を消した PR として残りうる
- [重] `-`: 理由の欄が崩れた基準と importance が不正な rule を、重要度不明のまま試しに消す候補にする
- [軽] `-`: 書き換えただけの箇条書きを消した基準に数える
- [軽] `-`: PR 番号に触れただけのコミットをマージとみなす
- [軽] `-`: 指標の比較が、消した PR ごとにサイクルの指標を読み直す
- [軽] `-`: CHANGELOG の差分の基準と閉じたあとの記述が実装と食い違う
- [軽] `-`: 位置だけを読む経路でも G10 の consent が git を呼ぶ（そのまま進めた）

## 永続化すること

- `decisions` [高]: ADR 20261116-approval-kind-in-step-definitions の再評価条件「G10 で確認の候補だけを省きたい要望が出たとき」を直す。build-11 で `promotion_gate`（express だけ off）により確認の回の G10 を省けるようにしたので、この条件はもう前提と食い違う。影響範囲に `scripts/lib/quality-metrics.mts`（ADR review-records-and-criterion-reasons の影響範囲にも）を足す（防ぐ: ADR の再評価条件が実装と食い違ったまま、次の見直しの判断を誤る / 立つ: build-11 の G10 の区分と promotion_gate / 重要度: 高）
- `conventions` [中]: 「スクリプト」に、G10 の同意が要る変更の判定は `promotions.mts` の `consentChanges` だけに置き、G10 の consent・write の accepts・promotions の approval が同じ判定を使うことを足す（別の判定を書くと、提示と手順の位置が食い違う）（防ぐ: 同意の判定が複数の場所に分かれ、片方だけ直す / 立つ: いまの promotions.mts と close-cycle.mts の構成 / 重要度: 中）
