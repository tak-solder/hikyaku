# Build 02: アプリケーションの状況の宣言と、AI に任せてよい害の上限の計算 申し送り

## 後続ビルドが前提にすること

- G6 で分割した。G3・G4 の `consent`、options の `--harm` / `--paths`、directive の notices、architect の手順と profiles・workflow の docs は build-15 が行う。config-file.md と CHANGELOG の「この版では宣言は検査と表示だけで、ゲートの判定にはまだ使わない」は、build-15 が G3・G4 に効くことに改め、`[boundaries]` の分の断りは build-12 が外す
- 上限の判定には `config.app`（作業ツリーの宣言）ではなく `effectiveDeclaration(config).declaration` を使う。基準は2つ（デフォルトブランチと、base_branch か デフォルトブランチ）で、それぞれ `origin/<branch>` とローカルの `<branch>` の両方を読めるだけ読み、作業ツリーと合わせて最も厳しい宣言になる。Hikyaku のブランチ（そのサイクルの規則と既定の規則の両方で判定）は基準にしない
- `effectiveDeclaration(config).incomplete` が true のときは、厳しさの分からない基準がある（設定ファイルがあるのに宣言を読めない、または作業ツリーが宣言しているのに基準を1つも読めない）。build-15 の G3・G4 はこのとき同意に倒す前提で作ってある
- `effectiveDeclaration(config).notices` は、読めなかった基準の説明。build-15 が G3・G4 の directive の notices に出す
- `strictest` の `mergeGate` は論理積（両方が `"user"` のときだけ）。片方に宣言が無ければ undefined になるので、作業ツリーだけで足した `merge_gate` は効かない。build-06 の事後同意の判定はこの値を使う
- `overlaps` の向き: 字義どおりのパス・見本・ファイル一覧のどれかで両方に当たれば当たる。迷う形（どちらもファイル名を決めておらず、ディレクトリが重なる）は当たるに倒す。素の名前（`config.mts`）はファイル一覧だけで照合する（すべての領域に当てないため）。「申告が領域を覆っているか」を見るときは、G3 と同じ `heavyAreasHit` を同じ入力で使う（当たる側に倒すと上げない向きに効くため）
- `effectiveDeclaration`・`repositoryFiles` は `ResolvedConfig` を鍵にキャッシュする。同じ config で作業ツリーを変えて呼び直すテストでは、config を作り直す
- `cycleAdrs` は document-guide.md を読めなければエラーを投げる（空を返さない）

## 残したこと

- 確度: 要確認 — 基準を merge-base で読み、ベースブランチの先端では読まない。分岐したあとにユーザーが main の宣言を厳しくしても、作業ブランチの上限には効かない。ADR risk-ceiling-table と design-delta.md 1節の定めのままにした（コードレビューの指摘。questions.md の Q3）。ユーザーが最後の PR で、この定めのままでよいかを判断する
- 確度: 要確認 — `origin/HEAD` が無く、base_branch が Hikyaku のブランチではない任意のブランチを指す場合、その基準の宣言はセッションが用意できる（そのブランチに緩めた宣言をコミットすればよい）。基準を1つも読めない場合は `incomplete` で上げる向きに倒すが、この場合は塞いでいない。`git remote set-head origin --auto` で `origin/HEAD` を設定すれば、デフォルトブランチの基準で防げる
- `repositoryFiles`（risk.mts）と `trackedFiles`（rules.mts）がどちらも `git ls-files` の同期の包みで、git が使えないときの返り方が違う（空と undefined）。build-15 で使い方が決まってから揃える（コードレビューの指摘。questions.md の Q3）
- `risk.mts` の `overlaps`・`heavyAreasHit`・`axesForPath`・`touchedPaths`・`cycleAdrs` には、この版では本番の呼び出し元が無い（build-15・build-12 が使う。G6 で決めた分担）
- `step lint`・`conductor lint` は、このセッションの権限ではリポジトリのスクリプトを実行できず、回していない。このビルドはステップ定義も `（ask: …）` のタグも変えていない
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない）

## 永続化すること

- `decisions` [高]: ADR 20261116-risk-ceiling-table の「上限は、作業ツリーと、ベースブランチ（defaultBase）との merge-base の宣言のうち厳しいほう」を補強した。デフォルトブランチ（origin/HEAD）との merge-base の宣言も基準に足し、基準ごとに origin/<branch> とローカルの <branch> の両方を読み、Hikyaku のブランチは基準にしない。厳しくする向きだけ（base_branch は作業ツリーの設定でセッションが向け直せる、origin/HEAD も set-head で向け直せる、ローカルのブランチには PR を経ないコミットが載り、origin/ は fetch していなければ古い。plan-review とコードレビューの指摘、questions.md の Q1・Q3）
