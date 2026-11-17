# Build 18: 質問と回答

## G8: plan.md と test-spec.md の承認

- 回答（監督の委任された判断）: 承認（実装に進む）
- 根拠: issue.md の受け入れ基準（US-13.3）はすべて test-spec.md のシナリオに対応している。上限を超える異議に、害が中でも事後同意が無効でも `--accepts` と `--premises` を求めるのと、基準の宣言を読めない回を超えるとみなすのは安全側。ADR deferred-consent と design-delta.md 3節との差（異議の受け入れを risk ではなく objection のまま積む）は、ADR 自体を書き換えず handoff の「永続化すること」に decisions 宛てで残す。そうすれば close-cycle の G10 で decisions の変更としてユーザーの同意を経る（原則6・11）。要確認の2点（異議の重い領域は AI が `area:` を挙げたときだけ効く、承認後にほかの作業単位で足された事項でゲートが開き直さない）は、前者は上げる向きにしか効かず、後者は pr の accepts の検査で止まるので、handoff の「残したこと」に残して進めてよい。test-spec の解釈3件も受け入れる
