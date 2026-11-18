# Build 02: アプリケーションの状況の宣言と、AI に任せてよい害の上限の計算

## やること

- TOML パーサにテーブル配列（`[[a.b]]`）の対応を足す（`[[app.areas]]` のため）
- ルート設定限定の `[app]`（`exposure` / `data` / `impact`、マージがユーザーの関門である前提のキー `merge_gate = "user"`）、`[[app.areas]]`（`name`・`paths` と3軸）、`[boundaries]`（`external` / `internal`）を読み込む。サイクル設定にあればエラー。不正な値はエラー（黙って捨てない）。`hikyaku config` に表示する
- `scripts/lib/risk.mts` を新しく作る: パスごとの宣言の解決（重い領域で上書き、軸ごとの最大）、上限の表（3軸すべて最下段→高まで / どれかが中段→中まで / どれかが最上段→何も任せない）、重い領域の照合、宣言が無ければ上限なし
- 上限は、作業ツリーと、ベースブランチ（`resolvePrBase` の `defaultBase`）との merge-base にある宣言のうち厳しいほうで決める。PR のマージ先（`base`）は使わない。作業ツリーの `base_branch` はセッションが書き換えられるので、デフォルトブランチ（`origin/HEAD`）との merge-base の宣言も基準に足す（厳しくする向きだけ）。基準を読めなければ、読めた宣言で決めて理由を返す（notices に出すのは build-15）
- 2つの宣言の厳しいほう（`strictest`）: 軸ごとの最大、重い領域は和、`merge_gate` は両方が `"user"` のときだけ `"user"`
- design-delta.md と ADR が触れるパスを拾う関数（`touchedPaths`。バッククォートで囲んだパスと glob）、このサイクルの ADR（基準から変わった decisions のファイル）を特定する関数、パス（glob）どうしの重なりの判定（`overlaps`）を `risk.mts` に置く。build-15 の G3・G4、build-12 の G4 の照合がこれを使う
- `docs/configuration/config-file.md` に宣言の形の節を足し、「サイクル側で上書きできないキー」に `[app]`・`[boundaries]` を足す。CHANGELOG に追記する。どちらにも「この版では宣言は検査と表示だけで、ゲートの判定にはまだ使わない」と明記する（判定に使う経路は build-15・build-12 で入り、そこでこの一文を外す。build-02 だけがマージされた時点で、宣言が効いていると読まれないようにするため）

## やらないこと

- G3・G4 の `consent`、architect の options の `--harm` / `--paths`、directive の notices、options/G3/G4.md、profiles.md・workflow の docs（build-15）
- 事後同意（`deferred`）の扱い（build-06）
- 宣言の変更を拠り所にした受け入れの見直し（build-05）
- G4 の境界の照合（build-12。`[boundaries]` の読み込みだけをこの build で行う）
- 宣言が無いワークスペースに上限を設けること（スコープ外 Q3）

## 対応する受け入れ基準

- US-13.1, US-13.2

## 受け入れ基準

- [ ] 3軸と `merge_gate`、重い領域（名前つき）・境界のパスを、ルート設定で宣言できる。サイクル設定に書くとエラー。不正な値・知らないキー・重い領域の名前の重複はエラー
- [ ] 上限の表と重い領域の上書き、`strictest`（`merge_gate` の論理積を含む）、`overlaps`、`touchedPaths` が `risk.mts` の unit で確かめられる
- [ ] 作業中のブランチで宣言を緩めても、基準側の宣言が厳しければ上限は緩まない（一時リポジトリの結合テスト）
- [ ] スタックした前フェーズのブランチや conductor ブランチで宣言を緩めても、ベースブランチ側の宣言が厳しければ上限は緩まない。作業ツリーの `base_branch` を自分のブランチに書き換えても、デフォルトブランチ側の宣言で緩まない（一時リポジトリの結合テスト）
- [ ] 宣言が作業ツリーにも基準にも無ければ、宣言は未定義（上限を設けない）と解決される（上限の値「なし」＝何も任せない、とは区別する）
- [ ] config-file.md と CHANGELOG に、この版では宣言をゲートの判定にまだ使わないことが書かれている
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「1. 承認の種類と上限」（アプリケーションの状況・上限はユーザーがマージした宣言で決める の項）、「2. 未決事項と決定の記録」の前提の参照の書式（`area:<name>`）
- `decisions` の `20261116-risk-ceiling-table.md` — 上限の表と宣言の形がこの判断に従う

## 予測ピーク

builder 段階で見積もり直した（plan.md）。このセッションで plan と plan-review まで進めた分を含む。

読むファイル: `scripts/lib/toml.mts`・`config.mts`・`git.mts`・`stack.mts`・`rules.mts`・`docs.mts`、`scripts/commands/config.mts`、`tests/helpers.mts`・`config.test.mts`・`toml.test.mts`、`docs/configuration/config-file.md`、`CHANGELOG.md` の `[3.0.0]`
作成するファイル: `scripts/lib/risk.mts`、`tests/risk.test.mts`、上記の lib・commands・テスト・docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 100k | 開始時の実測 59k に、手順の進行分 40k（このセッションで続ける） |
| 読み込み | 190k | このセッションで読了済み約 145k（plan と plan-review のための engine/directive/architect/step.mts 等を含む）。残り約 45k: tests の helpers/config/toml、commands/config.mts、docs.mts、config-file.md、CHANGELOG [3.0.0] |
| 実装 | 50k | toml のテーブル配列、config の [app]（3軸・merge_gate）/[[app.areas]]（name 必須）/[boundaries] の読み込み・ルート限定・表示、risk.mts 新規（約300行: 表・パスの解決・厳しいほう・overlaps・touchedPaths・2つの基準の読み取り・ADR の特定）、git/stack の補助、config-file.md の節、CHANGELOG |
| テスト | 40k | risk の unit（表・上書き・厳しいほう・mergeGate・overlaps・touchedPaths）、2つの基準の一時リポジトリ（作業ブランチ・スタック・conductor ブランチ・base_branch の書き換え）、config のルート限定と不正値、toml のテーブル配列 |
| 未知の領域 | 40k | 同期の git での基準の読み取りと一時リポジトリの調整、glob の重なりの判定、ResolvedConfig の欄の追加と resolvePrBase の defaultBaseOf への寄せが既存テストに波及する修正 |
| **予測ピーク** | **420k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
