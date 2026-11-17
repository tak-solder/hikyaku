# Build 16: 事後同意の有効の判定と、上限を超える受け入れの積み上げ 質問

## G8: plan.md と test-spec.md の承認

- **回答（委任された判断。監督）**: 承認（実装に進む）
- **根拠**: issue.md の受け入れ基準（US-10.5・20.1〜20.4）は、すべて test-spec.md のシナリオに対応している。事後同意が意図せず有効にならないこと（G1 の後に足した値、スタック、conductor ブランチ、base_branch の向け直し、作業ツリーだけの merge_gate、incomplete、conductor の子、ルートに書いた [consent]）と、有効でも G1・G10 の decisions/constraints・外との境界・差し戻しの回は now のままであることを、陽性の対照つきで確かめる構成で、design-delta.md 3節と ADR deferred-consent どおり。すべての基準の merge-base に値があることを求めるのは、基準を1つに限るより厳しい側。範囲外（build-18 の異議の上限の比較、--defer、ゲートの範囲の拡張）のシナリオは入っていない
