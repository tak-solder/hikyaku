---
status: implemented
---

# conductor は、ユーザーに上げる問いを記録に積み、依存しないビルドを先に進める

- **決定**: 子の問いの handler がユーザーのとき、監督は `AskUserQuestion` を出さず、固定文で子を再開して、問いを `question` の事項（`who=user`、`when=now`）として記録させ、コミット・push して blocked で終えさせる。待っているビルドの判定は `next` の既存の性質（待っているビルドは origin にブランチがあるので `inProgress`、それに依存するビルドは PR 列が空なので `blocked`）を使い、`conductor waiting` と `next --json` の `waiting` で何の答えを待っているかを示す。ARCHITECT の問いは全ビルドが待つ。`available` が空になったら、待っている問いをまとめてユーザーに尋ねる。再開の前に conductor ブランチを待っているビルドのブランチへ取り込む。session-id はファイルに保存せず、会話に残っていれば `--resume`、無ければ新しく起動する。Step 0 に事後同意と、問いを積む方針の行を足す。実行は逐次のまま
- **文脈**: US-21 で、1つの問いの答えを待つ間にサイクル全体が止まらないようにする。監督が上げるべき問いに自分で答えることはしない（US-21.4）
- **外の前提**:
  - Claude Code の `AskUserQuestion` は、答えが返るまで監督のセッションを止める（事実。`skills/conductor/SKILL.md` の現在の手順、2026-11-16 確認）
- **検討した案**:
  - Minimal: `next` の判定をそのまま使い、`waiting` を足す
  - Clean: `waiting.mts` で待つビルドを導き、`next` から外す
  - Pragmatic: 上記の決定（Minimal に、再開前の取り込みを足す）
- **推奨**: Pragmatic
- **採用理由**: 依存の判定に新しい処理がほぼ要らず、状態も session-id も保存しない原則のまま、監督が落ちても origin のブランチから待ちを導き直せる
- **受け入れたこと**:
  - 答えが、進められるビルドが尽きるまで遅れる（Q8 で受け入れ）
  - 問いのたびに、記録のためだけに子を1回再開する
  - 新しく起動して再開すると、子は問いの直前の文脈を失う
  - conductor の外で手で作ったブランチが残っていると、待ちと区別できない
- **トレードオフ**: 並行は増えないので、待ちの間に進むのは逐次の1件ずつ
- **再評価条件**: `AskUserQuestion` がセッションを止めずに答えを受けられるようになったとき。待ちとそれ以外のブランチの取り違えが起きたとき
- **退けた推奨で失う利点**: なし（推奨どおり採用）
- **影響範囲**: `scripts/commands/next.mts`、`scripts/commands/conductor.mts`・`scripts/lib/conductor.mts`、`scripts/lib/ledger.mts`、`skills/conductor/SKILL.md`・`references/headless-protocol.md`、`docs/workflow/conductor.md`
- **実装で確定したこと（001-v3-core-concepts）**:
  - 最後の PR の本文の「監督が答えた問い」は `ledger answers --format pr` の出力を貼る。リスクなしと申告した答え（`--no-risk`）もスクリプトが記録から示し、監督は書き写さない（build-07）
  - 監督の上限を超える答えは、事後同意が有効で、子に同意ゲートの置き場があり、前提が宣言の参照だけのときだけ受け付ける。その受け入れは、子の `ledger decide --by supervisor` が `risk` の事項（`who=user`・`when=merge@<unit>`）としてスクリプトで書く。最後の PR の本文には `ledger pr-section --all` と `ledger premises --changed-from <ベースブランチ>` の出力も貼る（build-19）
