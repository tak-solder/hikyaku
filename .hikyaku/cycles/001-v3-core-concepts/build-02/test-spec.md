# Build 02: アプリケーションの状況の宣言と、AI に任せてよい害の上限の計算 テストシナリオ

## toml（scripts/lib/toml.mts）

### parseToml: テーブル配列の要素が順に積まれ、後続のキーは最後の要素に入る
- 対応: US-13.2
- Given: `[[app.areas]]\nname = "auth"\npaths = ["src/auth/**"]\n[[app.areas]]\nname = "billing"\npaths = ["src/billing/**"]`
- When: `parseToml` で読む
- Then: `app.areas` が長さ 2 の配列になり、`[0]` が `{ name: "auth", paths: ["src/auth/**"] }`、`[1]` が `{ name: "billing", paths: ["src/billing/**"] }` になる

### parseToml: テーブル配列の要素の下の [a.b] は最後の要素に降りる
- 対応: —
- Given: `[[a]]\nname = "x"\n[[a]]\nname = "y"\n[a.b]\nk = 1`
- When: `parseToml` で読む
- Then: `a[1]` が `{ name: "y", b: { k: 1 } }` になり、`a[0]` は `{ name: "x" }` のまま

### parseToml: 既存のテーブルを [[x]] で開くとエラー
- 対応: —
- Given: `[app]\nexposure = "public"\n[[app]]`
- When: `parseToml` で読む
- Then: `TomlError` が投げられる（`app` はテーブル配列ではない）

### parseToml: 既存の値を [[x]] で開くとエラー
- 対応: —
- Given: `x = 1\n[[x]]`
- When: `parseToml` で読む
- Then: `TomlError` が投げられる

### parseToml: テーブル配列をあとから [x] で開くとエラー
- 対応: —
- Given: `[[areas]]\nname = "a"\n[areas]\nname = "b"`
- When: `parseToml` で読む
- Then: `TomlError` が投げられる

## config（scripts/lib/config.mts / scripts/commands/config.mts）

### readConfig: ルート設定の [app] の3軸と merge_gate を読める
- 対応: US-13.1
- Given: ルートの `.hikyaku.config` に `[app]\nexposure = "internal"\ndata = "none"\nimpact = "low"\nmerge_gate = "user"`
- When: 設定を解決する
- Then: `app.axes` が `{ exposure: "internal", data: "none", impact: "low" }`、`app.mergeGate` が `"user"`、`app.areas` が `[]` になる

### readConfig: 重い領域（名前つき）と境界のパスを読める
- 対応: US-13.2
- Given: ルート設定に `[app]`（3軸 `personal` / `none` / `low`）、`[[app.areas]]\nname = "auth"\npaths = ["src/auth/**"]\nimpact = "high"`、`[boundaries]\nexternal = ["api/openapi.yaml"]\ninternal = ["src/lib/**"]`
- When: 設定を解決する
- Then: `app.areas` が `[{ name: "auth", paths: ["src/auth/**"], impact: "high" }]`（省略した `exposure` / `data` は undefined）、`boundaries` が `{ external: ["api/openapi.yaml"], internal: ["src/lib/**"] }` になる

### readConfig: 宣言が無いと app は undefined、boundaries は空
- 対応: US-13.1
- Given: ルート設定に `[app]` も `[boundaries]` も無い
- When: 設定を解決する
- Then: `app` が `undefined`、`boundaries` が `{ external: [], internal: [] }` になり、エラーにならない

### readConfig: [app] の軸が欠けるとエラー
- 対応: US-13.1
- Given: ルート設定に `[app]\nexposure = "public"\ndata = "none"`（`impact` なし）
- When: 設定を解決する
- Then: `HikyakuError` が投げられ、メッセージに `impact` が含まれる

### readConfig: [app] の軸・merge_gate の不正な値はエラー
- 対応: US-13.1
- Given: ルート設定に `[app]\nexposure = "world"\ndata = "none"\nimpact = "low"`、別ケースで3軸は正しく `merge_gate = "ci"`
- When: それぞれ設定を解決する
- Then: どちらも `HikyakuError` が投げられ、メッセージにそれぞれ `exposure` / `merge_gate` が含まれる

### readConfig: [[app.areas]] の軸の不正な値はエラー
- 対応: US-13.2
- Given: 有効な `[app]` と `[[app.areas]]\nname = "auth"\npaths = ["src/auth/**"]\ndata = "secret"`
- When: 設定を解決する
- Then: `HikyakuError` が投げられ、メッセージに `data` が含まれる

### readConfig: 重い領域の name の重複はエラー
- 対応: US-13.2
- Given: ルート設定の `[[app.areas]]` が2つあり、どちらも `name = "auth"`
- When: 設定を解決する
- Then: `HikyakuError` が投げられ、メッセージに `auth` が含まれる

### readConfig: 重い領域の paths が空・欠落ならエラー
- 対応: US-13.2
- Given: `[[app.areas]]\nname = "auth"\npaths = []`、別ケースで `paths` のキーが無い
- When: それぞれ設定を解決する
- Then: どちらも `HikyakuError` が投げられる

### readConfig: [boundaries] の値が文字列の配列でなければエラー
- 対応: US-13.2
- Given: `[boundaries]\nexternal = "api/**"`、別ケースで `internal = [1]`
- When: それぞれ設定を解決する
- Then: どちらも `HikyakuError` が投げられ、メッセージにそれぞれ `external` / `internal` が含まれる

### readConfig: [app]・[[app.areas]]・[boundaries] の知らないキーはエラー
- 対応: US-13.1
- Given: `[app]` に `ceiling = "高"`、別ケースで `[[app.areas]]` に `owner = "x"`、別ケースで `[boundaries]` に `public = ["a"]`
- When: それぞれ設定を解決する
- Then: いずれも `HikyakuError` が投げられ、黙って捨てられない

### readConfig: サイクル設定に [app] / [boundaries] があるとエラー
- 対応: US-13.1
- Given: ルート設定は有効な `[app]`、サイクルの設定に `[app]\nimpact = "low"`、別ケースでサイクルの設定に `[boundaries]\nexternal = ["x"]`
- When: そのサイクルの設定を解決する
- Then: どちらも `HikyakuError` が投げられ、メッセージにサイクル設定のパスと `app` / `boundaries` が含まれる

### hikyaku config: 宣言と作業ツリーの宣言での上限を表示する
- 対応: US-13.1
- Given: ルート設定に `[app]`（`internal` / `none` / `low`、`merge_gate = "user"`）、`[[app.areas]] name = "auth" paths = ["src/auth/**"]`、`[boundaries] external = ["api/**"]`
- When: `hikyaku config` を実行し、別に `hikyaku config --json` を実行する
- Then: テキストに3軸・`merge_gate`・上限「中」・`auth` と `src/auth/**`・`api/**` と、「この版では検査と表示だけ（ゲートの判定にはまだ使わない）」旨の1行が出る。JSON の `app.axes.exposure` が `"internal"`、`boundaries.external` が `["api/**"]`

### hikyaku config: 宣言が無ければ「宣言なし（上限を設けない）」と出す
- 対応: US-13.1
- Given: ルート設定に `[app]` が無い
- When: `hikyaku config` と `hikyaku config --json` を実行する
- Then: テキストに「宣言なし（上限を設けない）」が含まれ、JSON には `app` キーが無い

### 手動確認: config-file.md と CHANGELOG に「まだ判定に使わない」が書かれている
- 対応: —（issue の受け入れ基準「config-file.md と CHANGELOG に、この版では宣言をゲートの判定にまだ使わないことが書かれている」。自動テストにはせず、PR のセルフレビューで目視確認する）
- Given: このビルドの変更後の `docs/configuration/config-file.md` と `CHANGELOG.md` の `[3.0.0]`
- When: `## [app] と [boundaries]` の節と、`[3.0.0]` の Added の宣言の項を読む
- Then: どちらにも「この版では宣言は検査と表示だけで、ゲートの判定にはまだ使わない」旨の記述があり、config-file.md の「サイクル側で上書きできないキー」に `app`・`boundaries` が入っている

## risk（scripts/lib/risk.mts）

### ceilingOf: 3軸すべて最下段なら「高」
- 対応: US-13.1
- Given: `{ exposure: "personal", data: "none", impact: "low" }`
- When: `ceilingOf` を呼ぶ
- Then: `"高"` を返す

### ceilingOf: どれかが中段で最上段が無ければ「中」
- 対応: US-13.1
- Given: `{ exposure: "personal", data: "internal", impact: "low" }`
- When: `ceilingOf` を呼ぶ
- Then: `"中"` を返す

### ceilingOf: どれかが最上段なら「なし」（中段が混ざっても）
- 対応: US-13.1
- Given: `{ exposure: "internal", data: "none", impact: "high" }`
- When: `ceilingOf` を呼ぶ
- Then: `"なし"` を返す

### exceeds: 害と上限の比較の境界
- 対応: —
- Given: 組 (`"中"`, `"中"`)、(`"高"`, `"中"`)、(`"高"`, `"高"`)、(`"中"`, `"なし"`)
- When: それぞれ `exceeds(harm, ceiling)` を呼ぶ
- Then: 順に `false`、`true`、`false`、`true` を返す

### axesForPath: 重い領域に当たるパスは軸ごとの最大で上書きされる
- 対応: US-13.2
- Given: 宣言の軸 `{ personal, none, low }`、重い領域 `{ name: "auth", paths: ["src/auth/**"], data: "personal-or-secret" }`
- When: `axesForPath(decl, "src/auth/login.ts", files)` を呼ぶ
- Then: `{ exposure: "personal", data: "personal-or-secret", impact: "low" }` を返す（省略した軸はアプリケーションの値）

### axesForPath: 領域の軸が低くてもアプリケーションの軸を下げない／当たらないパスはそのまま
- 対応: US-13.2
- Given: 宣言の軸 `{ public, internal, medium }`、重い領域 `{ name: "docs", paths: ["docs/**"], exposure: "personal", impact: "low" }`
- When: `axesForPath` を `"docs/a.md"` と `"src/x.ts"` で呼ぶ
- Then: どちらも `{ exposure: "public", data: "internal", impact: "medium" }` を返す

### heavyAreasHit: パターンに当たる重い領域だけを返す
- 対応: US-13.2
- Given: 重い領域 `auth`（`src/auth/**`）と `billing`（`src/billing/**`）、`files = ["src/auth/a.ts", "src/billing/b.ts", "src/ui/c.ts"]`
- When: `heavyAreasHit(decl, ["src/auth/*.ts", "src/ui/**"], files)` を呼ぶ
- Then: `auth` の1件だけを返す

### strictest: 軸は軸ごとの最大、片方が無ければもう片方
- 対応: —
- Given: `a` の軸 `{ public, none, low }`・`a.mergeGate = undefined`、`b` の軸 `{ personal, internal, high }`・`b.mergeGate = undefined`
- When: `strictest(a, b)`、`strictest(a, undefined)`、`strictest(undefined, undefined)` を呼ぶ
- Then: 1つ目の軸は `{ public, internal, high }`、2つ目は `a` と同じ宣言、3つ目は `undefined`

### strictest: 重い領域は和で、同じ name は軸の最大とパスの和で1つにまとまる
- 対応: US-13.2
- Given: `a` の領域 `[{ name: "auth", paths: ["src/auth/**"], impact: "medium" }]`、`b` の領域 `[{ name: "auth", paths: ["lib/auth/**"], impact: "high" }, { name: "billing", paths: ["src/billing/**"] }]`
- When: `strictest(a, b)` を呼ぶ
- Then: 領域が2件になり、`auth` の `paths` が `["src/auth/**", "lib/auth/**"]`（順不同）、`impact` が `"high"`、`billing` がそのまま含まれる

### strictest: merge_gate は両方が "user" のときだけ "user"
- 対応: US-13.1
- Given: (`a.mergeGate = "user"`, `b.mergeGate = "user"`)、(`"user"`, `undefined`)、(`a.mergeGate = "user"`, `b` は宣言なし)
- When: それぞれ `strictest(a, b)` を呼ぶ
- Then: 順に `"user"`、`undefined`、`undefined`（3つ目は宣言自体は `a` の軸を持つ）

### overlaps: 字義どおりのパスはもう片方の glob で照合する
- 対応: —
- Given: `files = ["src/auth/login.ts", "src/ui/a.ts", "lib/login.ts"]`
- When: `overlaps("src/auth/login.ts", "src/auth/**", files)`、`overlaps("src/ui/a.ts", "src/auth/**", files)` を呼ぶ
- Then: 順に `true`、`false`

### overlaps: / を含まないパターンは glob としてどの階層のファイル名にも当たる
- 対応: —
- Given: `files = ["src/auth/login.ts", "src/ui/a.ts", "lib/login.ts"]`
- When: `overlaps("login.ts", "src/auth/**", files)`、`overlaps("login.ts", "src/ui/**", files)` を呼ぶ
- Then: 順に `true`、`false`（`src/ui/` の下に `login.ts` は無い）

### overlaps: glob どうしはファイル一覧・見本・接頭辞で重なりを判定する
- 対応: —
- Given: `files = ["db/migrations/001.sql", "src/auth/a.ts", "src/billing/b.ts"]`
- When: `overlaps("**/*.sql", "db/migrations/*", files)`、`overlaps("src/**", "src/auth/*.ts", files)`、`overlaps("src/auth/**", "src/billing/*.ts", files)` を呼ぶ
- Then: 順に `true`（一覧の `db/migrations/001.sql` に両方が当たる）、`true`（接頭辞 `src/` が `src/auth/` を含む）、`false`

### touchedPaths: バッククォートで囲んだパスと glob を拾う
- 対応: —
- Given: Markdown `` `scripts/lib/risk.mts` を足し、`src/auth/**` と `package.json` を触る。`*.sql` も ``
- When: `touchedPaths` を呼ぶ
- Then: `["scripts/lib/risk.mts", "src/auth/**", "package.json", "*.sql"]` を返す

### touchedPaths: 空白・URL・オプションを含む語は、パスの形でも拾わない
- 対応: —
- Given: Markdown `` `cat src/a.ts` `https://example.com/a/b.md` `--paths=src/a/**` ``
- When: `touchedPaths` を呼ぶ
- Then: `[]` を返す

### effectiveDeclaration: 作業ブランチで宣言を緩めても基準側の厳しい宣言で決まる
- 対応: US-13.1
- Given: 一時リポジトリ。`main` の `.hikyaku.config` が `impact = "high"`（他は最下段）で、`origin/main` と `origin/HEAD → origin/main` がある。作業ブランチ `feature-x` で `impact = "low"` に書き換えてコミット
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: `declaration.axes.impact` が `"high"`、`ceilingOf` が `"なし"`。デフォルトブランチと `defaultBase` がどちらも `main` なので `baselines` は1件で、`ref` が `origin/main`、`notices` は空

### effectiveDeclaration: スタックした前フェーズのブランチで緩めても緩まない
- 対応: US-13.1
- Given: 一時リポジトリ。`main` の宣言は `exposure = "public"` で、`origin/main` と `origin/HEAD → origin/main` がある。`hikyaku/001-x/architect` で `exposure = "personal"` に緩めてコミットし、そこから `hikyaku/001-x/build-01` を切って HEAD にする（`base_branch` は未指定）
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: `declaration.axes.exposure` が `"public"`（前フェーズのブランチは基準に使われない）

### effectiveDeclaration: conductor ブランチで緩めても緩まない
- 対応: US-13.1
- Given: 一時リポジトリ。`main` の宣言は `data = "personal-or-secret"` で、`origin/main` と `origin/HEAD → origin/main` がある。`hikyaku/001-x/conductor` で `data = "none"` に緩め、そこから切った build ブランチを HEAD にする
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: `declaration.axes.data` が `"personal-or-secret"`

### effectiveDeclaration: base_branch を自分のブランチに書き換えてもデフォルトブランチ側で緩まない
- 対応: US-13.1
- Given: 一時リポジトリ。`main` の宣言は `impact = "high"` で、`origin/main` と `origin/HEAD → origin/main` がある。作業ブランチ `hikyaku/001-x/build-01` で `.hikyaku.config` を `impact = "low"`、`base_branch = "hikyaku/001-x/build-01"` に書き換える
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: `declaration.axes.impact` が `"high"`。`base_branch` 側の基準は Hikyaku のブランチなので読めない扱いになり、`notices` に理由が1件入る

### effectiveDeclaration: origin/HEAD が Hikyaku のブランチを指すとその基準は読めない扱い
- 対応: US-13.1
- Given: 一時リポジトリ。`base_branch = "main"`、`main` の宣言は `exposure = "public"` で `origin/main` がある。`git remote set-head origin hikyaku/001-x/conductor` で、その conductor ブランチの宣言は `exposure = "personal"`
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: `declaration.axes.exposure` が `"public"`。デフォルトブランチの基準は `unavailable` が埋まり、`notices` にその理由が入る

### effectiveDeclaration: 2つの基準が両方読めて食い違えば、作業ツリーを含めた軸ごとの最大になる
- 対応: US-13.1
- Given: 一時リポジトリ。`origin/main`（`origin/HEAD → origin/main`）の宣言は `{ public, none, low }`、`origin/develop` の宣言は `{ personal, none, high }`。`develop` から切った作業ブランチで、作業ツリーの宣言は `{ personal, none, low }`、`base_branch = "develop"`
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: `declaration.axes` が `{ exposure: "public", data: "none", impact: "high" }`、`baselines` が2件（`branch` が `main` と `develop`）、`notices` は空

### effectiveDeclaration: remote が無ければローカルのブランチを ref にして読む
- 対応: US-13.1
- Given: 一時リポジトリ。remote は無く、ローカルの `main` の宣言は `impact = "high"`、`base_branch = "main"`。`main` から切った作業ブランチで `impact = "low"` に緩める
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: `main` の基準の `ref` が `"main"` で `declaration.axes.impact` が `"high"`。`notices` にはデフォルトブランチが分からないことだけが入る

### effectiveDeclaration: origin のブランチがあればローカルのブランチより先に読む
- 対応: US-13.1
- Given: 一時リポジトリ。`origin/main`（`origin/HEAD → origin/main`）の宣言は `impact = "high"`。ローカルの `main` に `impact = "low"` に緩めるコミットを PR を経ずに足し、作業ブランチはそのローカルの `main` から切る
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: 基準の `ref` が `"origin/main"` で、`declaration.axes.impact` が `"high"`

### effectiveDeclaration: 作業ツリーにも基準にも宣言が無ければ未定義（「なし」とは区別）
- 対応: US-13.1
- Given: 一時リポジトリ。`main` の `.hikyaku.config` に `[app]` が無く、`origin/main` と `origin/HEAD → origin/main` がある。作業ツリーにも `[app]` が無い
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: `declaration` が `undefined`（上限 `"なし"` を表す宣言ではない）、`notices` は空

### effectiveDeclaration: 基準に .hikyaku.config が無ければ宣言なしとして読めた扱い
- 対応: US-13.1
- Given: 一時リポジトリ。`main` には `.hikyaku.config` が無く、`origin/main` と `origin/HEAD → origin/main` がある。作業ブランチで `[app]`（`internal` / `none` / `low`）を足した
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: `declaration.axes` が作業ツリーの値、基準の `declaration` は `undefined` で `unavailable` も `undefined`、`notices` は空

### effectiveDeclaration: 基準の ref も origin/HEAD も無ければ作業ツリーで決めて理由を返す
- 対応: US-13.1
- Given: 一時リポジトリ。remote が無く、`base_branch = "release"`（ローカルにも無い）、作業ツリーの宣言は `impact = "medium"`
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: エラーにならず `declaration.axes.impact` が `"medium"`。`notices` にデフォルトブランチが分からないことと `release` を読めないことが入る

### effectiveDeclaration: merge-base が無ければその基準は読めない扱い
- 対応: US-13.1
- Given: 一時リポジトリ。`origin/main`（`origin/HEAD → origin/main`）が `git checkout --orphan` で作った、作業ブランチと共通の祖先を持たない履歴で、宣言は `impact = "high"`。作業ツリーの宣言は `impact = "low"`
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: 例外にならず、`declaration.axes.impact` が `"low"`、基準の `commit` が `undefined` で `unavailable` と `notices` に merge-base が無い旨の理由が入る

### effectiveDeclaration: 基準の TOML が壊れている・値が不正なら読めない扱い
- 対応: US-13.1
- Given: 一時リポジトリ。`origin/main`（`origin/HEAD → origin/main`）の `.hikyaku.config` が `[app` で壊れている（別ケースで `exposure = "world"`）、作業ツリーの宣言は `exposure = "internal"`
- When: `effectiveDeclaration(config)` を呼ぶ
- Then: 例外にならず、`declaration.axes.exposure` が `"internal"`、該当の基準の `unavailable` と `notices` に理由が入る

### cycleAdrs: 基準から変わった・追加した decisions と追跡外のファイルを返す
- 対応: —
- Given: 一時リポジトリ。document-guide.md の `decisions` が管理 `hikyaku`・パス `.hikyaku/decisions/`。`main` に `a.md` と `b.md` があり、`origin/main` と `origin/HEAD → origin/main` がある。作業ブランチで `b.md` を変更し `c.md` を追加してコミット、`d.md` を追跡外で置く
- When: `cycleAdrs(config)` を呼ぶ
- Then: `b.md`・`c.md`・`d.md` を返し、`a.md` は含まない

### cycleAdrs: 2つの基準それぞれからの差分の和を返す
- 対応: —
- Given: 一時リポジトリ。document-guide.md の `decisions` が `.hikyaku/decisions/`。`origin/main`（`origin/HEAD → origin/main`）に `a.md`、`origin/develop` は `main` に `e.md` を足したもの。`develop` から切った作業ブランチで `f.md` を足し、`base_branch = "develop"`
- When: `cycleAdrs(config)` を呼ぶ
- Then: `e.md`（main との差分）と `f.md`（両方との差分）を返し、`a.md` は含まない

### cycleAdrs: decisions の外のファイルは返さない
- 対応: —
- Given: 一時リポジトリ。document-guide.md の `decisions` が `.hikyaku/decisions/`、`origin/main` と `origin/HEAD → origin/main` がある。作業ブランチで `.hikyaku/decisions/c.md` と `src/x.ts` を追加してコミット
- When: `cycleAdrs(config)` を呼ぶ
- Then: `c.md` だけを返し、`src/x.ts` は含まない

### cycleAdrs: decisions が対象外なら空
- 対応: —
- Given: 一時リポジトリ。document-guide.md の `decisions` が管理 `対象外`・パス `—`、`origin/main` と `origin/HEAD → origin/main` がある。作業ブランチで `.hikyaku/decisions/c.md` を追加
- When: `cycleAdrs(config)` を呼ぶ
- Then: `[]` を返す

### cycleAdrs: 基準を読めなければ decisions のファイルすべて
- 対応: —
- Given: 一時リポジトリ。document-guide.md の `decisions` が `.hikyaku/decisions/`。remote も `base_branch` のブランチも無く、`.hikyaku/decisions/` に `a.md`・`b.md`
- When: `cycleAdrs(config)` を呼ぶ
- Then: `a.md`・`b.md` の両方を返す
