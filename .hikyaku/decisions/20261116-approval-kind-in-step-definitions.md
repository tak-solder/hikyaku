---
status: accepted
---

# 確認と同意の分類は、ステップ定義が回ごとに決める

- **決定**: ゲートの `StepDefinition` に `consent(ctx)`（`"now" | "deferred" | false`。同意なら理由とともに返す）と `enabled(ctx)`（プロファイルによる確認のオン・オフ）を持たせる。エンジンは `on = when(ctx) && (consent(ctx) || enabled(ctx) !== false)` で評価し、同意の回はどの設定でも外さない。conductor は子の手順の位置（`childStep`）からこの分類を受け取り、同意はユーザーに固定する（`delegate` でも上書きできない）。ASKS の静的な分類は既定の表示と lint に残す。G10 はゲート1つのまま、`promotions` が候補ごとに同意（`decisions`・`constraints`）と確認を区分する。このサイクルの ADR の `status` を `accepted` から `implemented` に変えるだけの書き換えは同意の対象から外し（設計の質問 Q11）、G10 の `consent` と `write` の `accepts` は同じ1つの関数で判定する。`write` が拒んだときは G10 へ戻す。G1 は `consent` 固定とし、`user_stories_gate` キーは廃止する。G4 は差し戻しからの再設計の回と、外との境界の変更を検出したときに同意（`now`）。design-delta.md と ADR が触れるパスが、G3 の申告に無い重い領域に当たったときも同意（事後同意が有効なら `deferred`）。`consent` が `deferred` を返した回は、同意の部分をマージの前の同意ゲートへ遅らせ、ゲート自体は確認として `enabled` で評価する。G3 の `--harm` / `--paths` は必須欄で、欠ければ同意に倒す。G3 の時点では design-delta.md と ADR がまだ無いので、申告の裏取りは G4 でスクリプトがかける（LLM の申告は上げる向きにしか効かない）
- **文脈**: 同意かどうかが、ゲートの番号ではなく中身（上限を超える害を受け入れる案があるか）と回の種類（差し戻しからの再設計）で変わる（US-10・US-11・US-14.4）。現状は G1 を設定で外せ、conductor は同意ゲートも既定で監督が答えており、原則11 と食い違っていた
- **外の前提**: なし（リポジトリの中で閉じる判断）
- **検討した案**:
  - Minimal: ASKS の静的な分類を残し、ステップ定義に `consent(ctx)` だけを足す
  - Clean: ステップ定義に `approval` / `waivable` を持たせ、G10 を G10（同意）と G11（確認）の2つに分ける。G3 の判定用に `design/options.md` を成果物にする
  - Pragmatic: 上記の決定（G10 は1つのまま、G3 は options の報告に添える `--harm` / `--paths` で判定）
- **推奨**: Pragmatic
- **採用理由**: 同意を外せないことをエンジンの不変条件として保証しつつ、ゲートの番号と ASK の ID を変えずに済む（AGENTS.md・concepts.md の「G10 のうち」を書き直さない）
- **受け入れたこと**:
  - G10 に同意が要る変更が1件でもあると、確認の候補も同じ提示でユーザーが見る
  - G3 の `--harm` と `--paths` は LLM の申告で、軽く書かれた場合は、G4 の裏取り（design-delta.md と ADR が触れるパスと重い領域の照合）に当たらない限り拾えない。裏取りで見つかるのは G4 なので、そこで退けられると ADR と design-delta.md の書き直しになる
  - このサイクルの ADR の `accepted → implemented` の書き換えは、ユーザーの同意なしに close-cycle が行う（設計の質問 Q11）
- **トレードオフ**: 分類の条件がステップ定義に、既定の表示が ASKS に分かれ、ASKS だけを見ても「G3 が同意になる条件」は分からない（`conductor asks` の表示で補う）
- **再評価条件**: 中身や回で分類が変わるゲートが G1・G3・G4・G10 以外にも増えたとき。G10 で確認の候補だけを省きたい要望が出たとき
- **退けた推奨で失う利点**: なし（推奨どおり採用）
- **影響範囲**: `scripts/lib/steps/engine.mts`、各 `steps/<skill>.mts`、`scripts/lib/conductor.mts`・`scripts/commands/conductor.mts`、`scripts/lib/config.mts`、`scripts/lib/promotions.mts`、`skills/conductor/SKILL.md`、`skills/close-cycle/steps/G10.md`、`docs/configuration/profiles.md`
