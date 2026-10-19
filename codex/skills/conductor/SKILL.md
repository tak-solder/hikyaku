---
name: conductor
description: "Hikyaku の監督として、PLAN 済みのサイクルを ARCHITECT から BUILD、統合 PR まで子セッションで進める。利用者が conductor による進行を依頼したときに使う。"
---

# Hikyaku conductor (Codex)

[Codex 実行規約](../../compatibility.md)を読んでから、[conductor の元の手順](../../../skills/conductor/SKILL.md)を最後まで読み、この依頼に適用する。

あなたは監督であり、フェーズの実装・成果物の修正・コミットは子セッションが担当する。委任の合意、digest、成果物の検証、PR の取り込み条件と終了条件を維持する。デフォルトブランチへはマージしない。

## 子セッションと完了待ち

- `conductor asks` の `provider` と `providerSource` を確認する。監督が Codex でも子の CLI はこの出力で決まる。クラウドでは同じプロバイダーに固定され、ローカルでは設定、未指定なら Claude を使う。Codex CLI だけを使うローカル環境では、開始前に `[conductor] provider = "codex"` の設定を案内する。
- 子は `conductor launch` が返した `command` を Codex のシェル実行機能で起動する。監督の会話内でフェーズを実行したり、Codex のサブエージェントに置き換えたりしない。指定された CLI が利用できなければ、その制約を示して終了する。
- 元の手順の `Bash` / `run_in_background` は、長時間のコマンドを継続できる Codex の実行機能に読み替える。実行ツールがプロセスのセッション ID を返したら、同じプロセスの継続・待機機能で終了まで待つ。完了通知があれば使い、通知がなければ継続機能で待つ。短い間隔で結果ファイルを読み直さない。長時間待つ場合も進捗を伝える。
- ツールのプロセス ID と、子の会話の `sessionId` は別物である。`--resume` には `conductor parse` の `sessionId` を渡す。Codex の初回 `launch.sessionId` は null で、結果の `thread_id` を parse が返す。
- プロセス終了後に `conductor parse` で結果を判定する。結果ファイルが存在するだけで完了と判断しない。起動失敗、結果の欠落、非ゼロの終了コードは成功扱いせず、エラーと parse の結果を人間に示す。再開可能な ID が無いときは `--resume null` や `--last` を使わず、新規起動してよいか人間に尋ねる。
- `conductor check-pr --wait` にも同じ待機方法を使う。終了コード 1 / 2 や `ok: false` では取り込まない。必要なシェル・継続機能が無ければ、制約を示して終了する。

## 人間への問い

元の手順の `AskUserQuestion` は、利用可能なユーザー入力機能に読み替える。入力ツールが無ければ、通常のメッセージで問いと選択肢を示して返答を待つ。返答を待たずに同意を仮定しない。非対話規約は子だけに適用し、監督は人間への問いを gate ブロックに置き換えない。

利用者が conductor の実行を依頼し、元の Step 0 で範囲を委任した場合、その範囲内で次の子フェーズを起動できる。最終 PR の作成後は止まり、マージ後に再度依頼されたときだけ CLOSE から再開する。
