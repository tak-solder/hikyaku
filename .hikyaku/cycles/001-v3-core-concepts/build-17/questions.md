# Build 17: 質問と回答

## G8: plan.md と test-spec.md の承認

- 回答者: 監督（委任された判断）
- 回答: 承認（実装に進む）
- 根拠: issue.md の受け入れ基準（US-20.11）はすべて test-spec.md のシナリオに対応している。同じ作業単位の退けは作り直しの報告まで同意ゲートも pr / publish も完了にならず、作り直したあとも resolved まで「未解決の退け」が PR 本文と cycle status に出続けるのは、design-delta.md 3節と ADR deferred-consent どおり。前のフェーズの退けは resolved まで止まる。戻り先がどれにも当たらないときに最初の run ステップへ戻すのは安全側。consentDecided / undecidedConsentItems を変えないのは build-06 の申し送りどおり。builder が退けからの差し戻しで handoff.md を削除する扱いは、完了の印として読まれるのを防ぐためで、差し戻しの経路の中に閉じている。
