# Build 02: アプリケーションの状況の宣言と、AI に任せてよい害の上限

## やること

- ルート設定限定の `[app]`（`exposure` / `data` / `impact`、マージがユーザーの関門である前提のキー）、`[[app.areas]]`（`paths` と3軸）、`[boundaries]`（`external` / `internal`）を読み込む。サイクル設定にあればエラー。不正な値はエラー（黙って捨てない）。`hikyaku config` に表示する
- `scripts/lib/risk.mts` を新しく作る: パスごとの宣言の解決（重い領域で上書き、軸ごとの最大）、上限の表（3軸すべて最下段→高まで / どれかが中段→中まで / どれかが最上段→何も任せない）、重い領域の照合、宣言が無ければ上限なし
- 上限は、作業ツリーと PR の基準（`resolvePrBase` の merge-base）にある宣言のうち厳しいほうで決める。基準を読めなければ作業ツリーの宣言を使い、そのことを `notices` に出す
- architect の options の done に `--harm 高|中` と `--paths <glob,...>` を必須で受け付ける（欠ければ G3 を同意に倒す）。`progress.jsonl` の任意欄に残す（中身を含まない値）
- design-delta.md と ADR が触れるパスを拾う関数（`touchedPaths`。バッククォートで囲んだパスと glob を拾う）を `risk.mts` に置く。build-12 の G4 の照合もこれを使う
- G3 の `consent`: 申告を `risk.mts` で上限と比べて超えれば `now`。`touchedPaths` が重い領域に当たれば、申告に関わらず `now`
- `skills/architect/steps/options.md`・`G3.md` に、申告の付け方と G3 が同意になったときの提示を足す
- `docs/configuration/config-file.md` に新しい節を足す。CHANGELOG に追記する

## やらないこと

- 事後同意（`deferred`）の扱い（build-06）
- 宣言の変更を拠り所にした受け入れの見直し（build-05）
- G4 の境界の照合（build-12。`[boundaries]` の読み込みだけをこの build で行う）
- 宣言が無いワークスペースに上限を設けること（スコープ外 Q3）

## 対応する受け入れ基準

- US-10.3, US-13.1, US-13.2, US-13.3, US-13.4

## 受け入れ基準

- [ ] 3軸と重い領域・境界のパスを、ルート設定で宣言できる。サイクル設定に書くとエラー
- [ ] 上限の表と重い領域の上書きが `risk.mts` の unit で確かめられる
- [ ] 作業中のブランチで宣言を緩めても、基準側の宣言が厳しければ上限は緩まない（一時リポジトリの結合テスト）
- [ ] G3 は、上限を超える案が無ければ確認として省け、あれば（申告の欠け・重い領域を含む）ユーザーに上がる
- [ ] 宣言が無いワークスペースでは、従来どおり G3 はプロファイルで決まる
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「1. 承認の種類と上限」（G3・アプリケーションの状況・上限はマージ済みの宣言で決める の項）
- `decisions` の `20261116-risk-ceiling-table.md` — 上限の表と宣言の形がこの判断に従う
- `decisions` の `20261116-approval-kind-in-step-definitions.md` — G3 の `consent` と申告の必須がこの判断に従う

## 予測ピーク

読むファイル: `scripts/lib/config.mts`、`scripts/lib/integrity.mts`、`scripts/lib/stack.mts`、`scripts/lib/git.mts`、`scripts/lib/steps/architect.mts`、`skills/architect/steps/options.md`・`G3.md`、`scripts/commands/step.mts`、`scripts/commands/config.mts`、`docs/configuration/config-file.md`
作成・変更するファイル: `scripts/lib/risk.mts`、`tests/risk.test.mts`、上記の lib・commands・テスト・手順・docs、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 90k | config.mts（data_integrity の先例・assertCycleOverridable・finalize）・integrity.mts（glob）・stack.mts resolvePrBase・git.mts・steps/architect.mts・architect の options.md と G3.md・commands/step.mts・commands/config.mts・config-file.md・ADR risk-ceiling と approval-kind |
| 実装 | 65k | risk.mts 新規（約300行: 宣言の型・パスの解決・上限の表・重い領域・基準側との厳しいほう・touchedPaths）、[app]・[[app.areas]]・[boundaries] の読み込みと表示、options の --harm/--paths 必須、G3 の consent |
| テスト | 50k | risk.mts の unit、config の結合（ルート限定・不正値）、G3 の同意化、基準側の宣言の読み取り（一時リポジトリ） |
| 未知の領域 | 45k | merge-base 側の設定の読み取り（git show）と基準の解決、design-delta と ADR からパスを拾う規則 |
| **予測ピーク** | **340k** | 狙いの帯（300k〜450k） |
| ガイド | 標準 v2 | 03897ac0 |
