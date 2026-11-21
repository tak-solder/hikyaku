# Build 17: 質問と回答

## review-findings: コードレビュー（上限の2ラウンド）で直していない3件

- 回答者: 監督（委任された判断）
- 回答: A. そのまま進める（3件とも採らず、理由を handoff の「残したこと」に書く。1 は「確度: 要確認」とする）
- 根拠: 1 は issue.md・design-delta.md 3節・ADR deferred-consent が定めた経路（前のフェーズの事項は return.md で差し戻す）そのもので、変えるなら設計の変更になり、監督は選ばない。差し戻した先で何を決め直すかは architect とユーザーが決める。監督は 1 を最後の PR でユーザーに示す。2・3 は振る舞いを変えない指摘。新ビルド化はスコープを広げるので選ばない。

## G8: plan.md と test-spec.md の承認

- 回答者: 監督（委任された判断）
- 回答: 承認（実装に進む）
- 根拠: issue.md の受け入れ基準（US-20.11）はすべて test-spec.md のシナリオに対応している。同じ作業単位の退けは作り直しの報告まで同意ゲートも pr / publish も完了にならず、作り直したあとも resolved まで「未解決の退け」が PR 本文と cycle status に出続けるのは、design-delta.md 3節と ADR deferred-consent どおり。前のフェーズの退けは resolved まで止まる。戻り先がどれにも当たらないときに最初の run ステップへ戻すのは安全側。consentDecided / undecidedConsentItems を変えないのは build-06 の申し送りどおり。builder が退けからの差し戻しで handoff.md を削除する扱いは、完了の印として読まれるのを防ぐためで、差し戻しの経路の中に閉じている。
