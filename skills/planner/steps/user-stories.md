# user-stories: 質問ループと user-stories.md の作成

**インプットや scope のすり合わせで明記されている内容は質問しない。**

- [ ] 構造化に必要な情報を質問する
  - 1ラウンドの質問数に上限はない。聞くべきことは1回でまとめて聞く
  - 確認観点: 目的, 対象ユーザー, コア機能, スコープ境界, 優先度, 制約条件
  - 質問が発生した場合のみ `cycles/{cycle}/planning/questions.md` に記録する
  - 未回答の質問を放置しない。未回答なら明示的にそう記す
- [ ] `cycles/{cycle}/planning/user-stories.md` を作成する
  - フォーマットは `${CLAUDE_PLUGIN_ROOT}/skills/planner/references/templates.md`（[templates.md](../references/templates.md)）を参照
  - scope で合わせた4項目を冒頭の「概要」セクションに反映する
  - このサイクルのスコープに閉じる。将来やりたいことは書かない
  - やらないと決めたことは、理由とともに「スコープ外」に残す（ストーリーにはしない）
  - 受け入れ基準に `US-N.M` の番号を振る。後続フェーズはこの番号で受け入れ基準を参照する
- [ ] `done` を報告する。user-stories.md が無ければ受け付けられない
- [ ] コミット & push する（progress.jsonl も含める）
