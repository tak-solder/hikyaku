# Build 13: 質問と回答

## review-findings: コードレビュー（ラウンド 2、上限）の未解決の指摘

- 回答（委任された判断。監督）: A。1〜8（ゲートの時間の rejected 後の扱い・patches/ の全件走査をやめる・作業ツリーの外の案内・setext と frontmatter・`!feedback/` の否定・premises の不要な分割・context の `file` 欄・`round` の写し）を修正し、9（AGENTS.md の索引）・10（サイクルに属さない patch の upstream）は理由を handoff に残して進める。修正のあと `npx tsc --noEmit`・`npm test` で確かめ、再レビューはしない（ラウンドの上限）
- 根拠: 1〜8 は issue.md の範囲内の小さな修正。2 は AGENTS.md の規約（patch の記録を全件走査する処理を足さない）への違反なので必ず直す。5 はユーザーが .gitignore に書いた方針を覆さない側の修正で、原則 2 に沿う。9 は原則 6 どおりで G8 で承認済み。10 は読む元が無い。新ビルド化はスコープを広げるので選ばない

## G8: plan.md と test-spec.md の承認

- 回答（委任された判断。監督）: 承認（実装に進む）
- 根拠: issue.md の受け入れ基準（US-16.1〜16.4・17.1〜17.3）はすべて test-spec.md のシナリオに対応している。`.hikyaku/document-guide.md` の glossary の登録し直しは issue.md の「やること」に明記された範囲。AGENTS.md の索引を書き換えずに handoff の「永続化すること」へ回すのは原則 6 どおり。progress.jsonl の件数とゲート時間の最大値を出さない判断は、中身を外に出しうる手がかりを減らす安全側で原則 15 と矛盾しない。起票の下書きの文面をスクリプトに作らせず固定の枠だけにする解釈は、原則 1（文面の作成をスクリプトに持たせない）どおり
