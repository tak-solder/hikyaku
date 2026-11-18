# Build 14: 操作する人を「ユーザー」と書く用語の統一 申し送り

## 後続ビルドが前提にすること

- 「人間」を残したのは、操作する人を指さない次の4つの用法だけ（plan.md の「置き換えの判別」）: Bot と対比するレビュアー（`phase_reviewers` の説明）、Hikyaku が書いた部分と対比する手で書いた部分、AI と対比する人が定めた定義（`lib/docs.mts` の glossary の purpose）、人間可読。これから文を足すときも、操作する人は「ユーザー」と書く
- 最後の PR（conductor ブランチ → デフォルトブランチ）は「ユーザーがレビューする PR」と書いた（`docs/concepts.md` の「ユーザーがレビューする最後の PR」に合わせた）。フェーズの PR の `phase_reviewers` の説明の「人間のレビュアー」は、Bot と対比するので残した
- 見出し「確度が低い懸念（要人間判断）」は「（要ユーザー判断）」にした。スクリプトはこの見出しを読まない（「確度が低い懸念」の前方一致だけを使う）

## 残したこと

- 「ユーザー」と「あなた」の混在（`docs/workflow/conductor.md`・`docs/configuration/config-file.md` で、読み手に呼びかける「あなた」と三人称の「ユーザー」が同じ段落に並ぶ）は直していない。issue.md の「文の書き換えを超えた説明の変更」はスコープ外のため（コードレビュー1回目の指摘。不採用）
- 「人間」を CLI の出力に戻さない機械的な検査（テストや lint）は入れていない。既存の `doesNotMatch(/人間/)` は `conductor parse` の出力と `conductor asks` だけを見る。help やエラーの文面まで広げるのは issue.md のスコープを超えるため（コードレビュー2回目の指摘。不採用）
- `node scripts/hikyaku.mts conductor lint` は、このセッションでは実行の許可が無く実行できなかった。差分のうち `（ask:` を含む行は、questions.md の追加分だけで、skills・scripts のタグの行は変えていない（`git diff -G "ask:"` で確かめた）。`npx tsc --noEmit` と `npm test`（963件）は通った（コードレビュー2回目の指摘への対応）
- コードレビュー2回目の「conductor の SKILL.md の『ユーザーがレビューする PR』は『人間』のままにすべき」という指摘は不採用。最後の PR はユーザーがレビューしてマージするもので、`docs/concepts.md` もそう書いている
- security_review は起動しなかった（`recommended`。用語の置き換えだけで、個人情報・認証認可・決済のどれにも当たらない）

## 永続化すること

なし
