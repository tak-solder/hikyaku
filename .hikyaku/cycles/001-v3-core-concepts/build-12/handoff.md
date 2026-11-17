# Build 12: G4 と G8 の提示（gate brief） 申し送り

## 後続ビルドが前提にすること

- G4 の外との境界による同意は、事後同意（`deferred`）に回さない（常に `now`）。build-16 が事後同意の積み上げを足すときも、`boundaryConsent`（`steps/architect.mts`）の判定は `deferred` にしない
- G4 の判定の順: 差し戻しの回 → design-delta の done の前 → 通り過ぎた（`passedOver`）→ 境界（`boundaryConsent`）→ 基準の宣言を読めない（`incomplete`）→ `[app]` の宣言なし → 重い領域の裏取り。境界は `[app]` の宣言の有無より先に見る（`[boundaries]` だけのワークスペースでも効く）
- 境界は `effectiveBoundaries`（`risk.mts`）で、作業ツリーと読めた基準の `[boundaries]` の和。基準の `[boundaries]` だけが壊れていても `[app]` の上限は読めたまま（`incomplete` にしない）で、境界だけを確かめられない（`unverified`）扱いにして G4 を同意にする。基準の `[app]` だけが壊れていても、その基準の境界は効かせる
- `boundaryChanges`（`gate-brief.mts`）は `ResolvedConfig` と設計のディレクトリを鍵にキャッシュする。同じ config で design-delta.md を書き換えて呼び直すテストでは、config を作り直す
- design-delta.md とこのサイクルの ADR から触れるパスを集める処理は `designTouchedPaths`（`gate-brief.mts`）1つで、G4 の境界の照合と G3 の申告の裏取りが同じ文書の集合を見る
- test-spec.md の「（解釈）」の印は、見出しの末尾の全角・半角の括弧の両方を読む。シナリオの区切りは `###` 以上の見出しで、`####` は本文に入る
- G8 の brief は、user-stories.md に番号付きの基準が無い・issue.md に「対応する受け入れ基準」の節が無いか節に番号が無い・test-spec.md が無い、のどれかなら追跡できない扱いにし、issue.md の「受け入れ基準」の節をそのまま示す

## 残したこと

- AI の解釈（G8 で監督が受け入れた、issue.md に無い追加。最後の PR でユーザーに示す）:
  - 外との境界の照合に、作業ツリーと、基準のブランチ（merge-base）の `[boundaries]` の和を使う。作業中のブランチで境界を消しても、同意は外れない（questions.md の G8）
  - 作業ツリーだけが `[boundaries]` を宣言していて基準を1つも読めないときと、基準の `[boundaries]` を読めないときは、G4 を同意に倒す（`unverified`）。`effectiveDeclaration` の `incomplete` は G3 にも効くので広げず、境界の分だけで持つ（questions.md の G8）
- AI の解釈（test-spec の「（解釈）」2件）: 境界より広い glob（`api/**`）を設計が書いたときは、`overlaps` の「迷う形は当たるに倒す」に従い、外との境界の変更（同意側）に数える。test-spec.md が無いビルドでは、受け入れ基準をすべて「未対応」としては出さず、受け入れ基準の節を残して plan.md の提示に回す
- 確度: 要確認 — 作業ツリーから `[boundaries]` を消していて、しかも基準のブランチを1つも読めない（`origin/HEAD` も `base_branch` も無い、または Hikyaku のブランチを指している）と、`unverified` にならず G4 は確認に戻る。main で宣言した外との境界があっても同意にならない。build-02 で要確認として残した `[app]` の基準の制約（`incomplete` は作業ツリーに宣言があるときだけ）と同じ種類。`git remote set-head origin --auto` で `origin/HEAD` を設定すれば、デフォルトブランチの基準で防げる（コードレビュー2回目の指摘。questions.md の review-findings で、そのまま進めると監督が判断）
- test-spec の「事後同意が有効でも外との境界は deferred に回さない」は、テストを書いていない。事後同意の有効の判定（build-16）がまだ無く、`boundaryConsent` は常に `now` を返すので、build-16 で `deferred` を足すときに併せて確かめる
- `step lint`・`conductor lint` は、このセッションの権限ではリポジトリのスクリプトを実行できず、回していない。`（ask: …）` のタグは足していない（ステップ定義は G4 の consent・args・notices の中身だけを変えた）
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない。変更はワークフローの承認ゲートで、アプリケーションのアクセス制御ではない）

## 永続化すること

- `decisions` [高]: ADR 20261116-approval-kind-in-step-definitions に補う。G4 の外との境界による同意は、作業ツリーと基準のブランチ（merge-base）の `[boundaries]` の和で照合し、基準の境界を確かめられないとき（作業ツリーだけが宣言して基準を1つも読めない、基準の `[boundaries]` が壊れている）も同意に倒す。事後同意には回さない。基準の `[app]` と `[boundaries]` は別に読み、片方が壊れていてももう片方は効かせる（作業中のブランチで境界を緩めさせないため。G8 とコードレビューの指摘、questions.md の G8・review-findings）
