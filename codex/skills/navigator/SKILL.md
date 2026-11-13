---
name: navigator
description: "利用者が Hikyaku navigator を明示的に指定したときに使う。進行中サイクルの状態を読み、次の一手を提案し、利用者が選んだスキルを実行する。"
---

# Hikyaku navigator (Codex)

[Codex 実行規約](../../compatibility.md)を読んでから、[navigator の元の手順](../../../skills/navigator/SKILL.md)を最後まで読み、この依頼に適用する。

状態は元の手順どおり CLI の結果から導く。候補の提示まではファイルの書き込み・コミット・ブランチの切り替え・`cycle use` を行わない。

`AskUserQuestion` は利用可能なユーザー入力機能に読み替える。入力ツールが無ければ、通常のメッセージで選択肢を示して返答を待つ。候補が1つでも、選択前にスキルを起動しない。

元の手順の `Skill` ツールによる起動は、選ばれた `<plugin-root>/codex/skills/<name>/SKILL.md` を読んで、その引数とともに現在の依頼として実行することに読み替える。引数にサイクルや再開するビルドがあれば保持する。conductor も Codex 用入口を案内できるが、元の手順どおり利用者が選んでから実行する。
