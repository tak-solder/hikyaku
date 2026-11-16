# Build 01: 承認の種類の基盤（エンジン・G1・conductor の同意） 申し送り

## 後続ビルドが前提にすること

- gate の定義は `consent` を必ず持つ（確認なら `consent: false`。`step lint` が検査）。`when` は構造の条件だけで、プロファイル・個別キーのオン・オフは `enabled` に書く。gate 以外のステップには `consent` / `enabled` を書かない（lint が弾く）
- `consent` は `{ timing: "now" | "deferred", reason }` か `false` を返す。`deferred` を返す定義はまだ無いが、`isOn` と directive は「`deferred` は `enabled` で決まり、directive では `approval: "confirm"`」として実装・テスト済み（build-06 はこの形に乗る）
- 回によって同意になるゲート（`consent` が関数で `enabled` も持つもの）を足したら、`scripts/lib/conductor.mts` の `CONSENT_WHEN` にも足す。`tests/step-consent.test.mts` が食い違いを検出する。`conductor parse` は、手順の位置を確かめられないとき `CONSENT_WHEN` のゲートを同意の側に倒す
- `resolveAsk(id, conductor, settings, approval?)` の `approval` は、子の手順がそのゲートで止まっているときの回ごとの種類。渡すと静的な ASKS の分類より優先する（中止・分類できない問いは変えない）
- G10 と patch の P2 は、build-11 が候補ごとの区分を足すまで常に同意（`now`）。build-11 は P2 も G10 と同じ判定に揃えるか決める。patch の P1 も同意（`questions.md` の Q1）
- architect の options・adr・pr の `designChoiceGate` は「その回に G3 をユーザーが行うか」（同意の回か、`gates.designChoice`）。options をスキップしたかのような構造の条件は見ない
- `[conductor] escalate` に同意ゲート（G10）を書くのは受け付ける（もとからユーザーに上がるので害が無い）。`delegate` だけを拒む

## 残したこと

- コードレビューの指摘「`deferred` を返す定義が無く、分岐が使われていない」は不採用。issue.md が「式と unit はこの形で入れ、build-06 が書き直さずに済むようにする」と求めており、合成した定義のテスト（`tests/step-consent.test.mts`）で分岐を確かめている
- コードレビュー（ラウンド 2）の不採用の指摘:
  - 「`deferred` の回が directive で確認になり、conductor で監督に振られる」— design-delta の「`deferred` の回のゲート自体は確認として `enabled` で評価する」どおり。同意の部分をマージの前へ積むのは build-06
  - 「`CONSENT_WHEN` をステップ定義から導く」「ASKS の `enabledWhen` がステップ定義の `enabled` と重複」— lib/conductor.mts からステップ定義を読み込む依存を足さず、`CONSENT_WHEN` はテストで一致を検査する。`enabledWhen` の重複は以前からのもので、このビルドのスコープ外（確度: 要確認。ゲートのオン・オフの規則を変えるビルドで、conductor asks の表示とずれないか確かめる）
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない。承認の振り分けはワークフローの手順で、アプリケーションのアクセス制御ではない）
- 文面の「人間」→「ユーザー」は、このビルドで触れた行だけ直した（残りは build-14）。conductor SKILL.md の回答の書式「回答（人間の判断）」も build-14 で扱う

## 永続化すること

- `conventions` [中]: ステップ定義の gate は承認の種類（`consent`。確認なら `false`）を持ち、プロファイル・個別キーのオン・オフは `enabled`、構造の条件は `when` に分けて書く。同意の回は `enabled` に関わらず手順に残る（step lint が consent の有無を検査するが、`when` に設定の条件を書いた誤りは検出できない。build-01 で when から enabled へ移した）
