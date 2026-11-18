---
paths:
  - "scripts/lib/git.mts"
  - "scripts/lib/diff-facts.mts"
  - "scripts/lib/steps/**"
---

# git の履歴と diff を読む処理

- 記録の前後（承認より後の書き換えなど）は日時ではなく履歴で判定する。rebase でコミット日時が書き換わると、日時の比較は前のコミットを後と数える。
- 「フェーズが書く前の状態」を履歴から導くときは、記録を含むコミットではなく記録の時刻で区切り、`--first-parent` で辿り、閉じたあとはマージ後のベースブランチの変更を拾わないよう打ち切る。ブランチはスタック・取り込み・squash merge されうるので、基準コミットを誤ると先にコミットした変更を見落とすか、他の PR の変更を取り込む。
- diff を解析するときは `git.mts` の `nameStatus` / `unifiedDiff` を使う。自前で呼ぶなら `--src-prefix=a/ --dst-prefix=b/`・`--no-ext-diff`・`--no-color` を付ける。利用者の `diff.mnemonicPrefix`・`diff.noprefix` で見出しのパスが変わり、事実が黙って落ちる。
