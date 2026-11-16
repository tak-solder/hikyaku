# Build 13: 中身を含まないフィードバックと、document-guide のアンカー

## やること

- `hikyaku feedback export [--dry-run]`: `{HIKYAKU_ROOT}/feedback/{YYYYMMDD}.md` に書き出す。中身は、progress.jsonl の中身を含まない欄（`at` / `skill` / `step` / `result` / `round` / `hikyaku`）から導いた「止まった手順」（`failed`）と「ゲートにかかった時間」（ゲートの記録と直前の記録の `at` の差）、`upstream` の一覧、起票の下書き（issue の本文）。集計の単位はスキルとステップの ID だけで、サイクル名・ビルド番号・patch の slug・作業単位のパスを含めない。`input` / `reason` / `pr` / `session` は使わない。`upstream` の本文は自由文なので、下書きに「送る前に全文を読む」ことを示す。外部に送る処理は持たない
- `feedback/` が git の追跡対象外（`git check-ignore`）でなければ書き出さずに止める。init が `.gitignore` に `feedback/` を足す
- `DocEntry` に `anchor` を足し、`path` と分けて持つ。`validateGuide`・`context` の存在の検査・`isAutoLoaded`・`renderIndexBlock` はアンカーを除いたパスで比べる。`context` はアンカー付きで返す。見出しから GitHub 式のアンカーを作る関数を足し、`validate` がアンカーの節の消失を検出する
- `.hikyaku/document-guide.md` の glossary を `docs/concepts.md#用語` で登録し直す
- docs（`configuration/documents.md`・`reference/cli.md`）を直す。CHANGELOG に追記する

## やらないこと

- 起票（外部への送信）そのもの（スコープ外 Q4。ユーザーが行う）
- 中身を含みうる欄の要約や一般化を AI に頼ること

## 対応する受け入れ基準

- US-16.1, US-16.2, US-16.3, US-16.4, US-17.1, US-17.2, US-17.3

## 受け入れ基準

- [ ] 書き出しに、サイクル名・ビルド番号・patch の slug・ユーザーの答え・理由・PR の URL が含まれない（フィクスチャの記録で確かめる）
- [ ] `feedback/` が追跡対象なら書き出さずに止まる
- [ ] 下書きの書き出しまでで、外部に送る処理が無い
- [ ] アンカー付きのパスを登録でき、`context` がアンカー付きで返し、節が消えると `validate` が検出する
- [ ] `npx tsc --noEmit`・`npm test` が通る

## 参照する設計ドキュメント

- `design/design-delta.md` の「10. フィードバック」と「11. 文書の登録と `gh`」（アンカーの項）
- `conventions`（AGENTS.md）の「設計の原則（v3）」15

## 予測ピーク

読むファイル: `scripts/lib/progress.mts`、`scripts/lib/steps/index.mts`、`scripts/lib/promotions.mts`（upstream）、`scripts/lib/docs.mts`、`scripts/commands/context.mts`・`validate.mts`・`docs.mts`、`skills/init/steps/`（.gitignore を書く手順）、`docs/configuration/documents.md`
作成・変更するファイル: `scripts/lib/feedback.mts`、`scripts/commands/feedback.mts`、`tests/feedback.test.mts`、上記の lib・commands・手順・docs、`.hikyaku/document-guide.md`、`CHANGELOG.md`

| 成分 | 予測 | 根拠 |
|------|------|------|
| 固定費 | 90k | 実測なし。標準ガイドの出発点 80k〜100k の中央 |
| 読み込み | 80k | progress.mts・steps/index.mts（ゲートの判別）・promotions.mts（upstream）・docs.mts・commands/context.mts・commands/validate.mts・commands/docs.mts・init の手順（.gitignore）・docs/configuration/documents.md |
| 実装 | 60k | feedback export 新規（集計・下書き・check-ignore で止める）、DocEntry の path と anchor、GitHub 式アンカーの生成、validate の節の検査、context の返し方、init の .gitignore |
| テスト | 45k | 書き出しに中身が混ざらないこと、アンカーの検査、context の出力 |
| 未知の領域 | 20k | 日本語見出しのアンカー生成の規則 |
| **予測ピーク** | **295k** | 統合を検討（300k 未満。推奨のみ） |
| ガイド | 標準 v2 | 03897ac0 |

統合は見送る。依存の無い独立したビルドで、ほかのビルドとまとめると 450k を超えるため
