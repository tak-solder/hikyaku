# Build 03: 未決事項と決定の記録（ledger の中核） 質問

## Q1: G8 — plan.md と test-spec.md の承認（コンテキストの目安 250k を超えての継続を含む）

**委任された判断（監督）**: 承認（実装に進む）

**根拠**: issue.md の受け入れ基準はすべて test-spec.md のシナリオに対応している（語彙・参照先・前提の書式の拒否、who=user の付け替え拒否、2ブランチの決定が衝突しない結合テスト、step hook stop / step where が記録を読まない、cycle status --json の ledger の節）。plan.md は issue.md の「やらないこと」に踏み込んでいない。AI が解釈で決めた振る舞いは、どれも事項を示し続ける側か、ユーザーに決める権限を残す側で、US-19.6・19.7 と矛盾しない。コンテキストの目安を超えての継続は、示された方針（約 400k を超えたら review の前に build-manager で cycle status・docs を切り出す）で受け入れる。
