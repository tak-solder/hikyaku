# Build 08: 差分の事実と、合意との突き合わせ（agreement-review） 申し送り

## 後続ビルドが前提にすること

- `diff facts` は作業ツリーまでを比べる（agreement-review は review のコミットより前に走るため）。未追跡のファイルは、テストに分類したものだけを読む
- G8 の承認より「後」は、日時ではなく履歴で決める。承認の記録（progress.jsonl の `at`）を初めて含んだコミット（`git log -S`）より後のコミットと、未コミットの変更を並べる。承認と同じコミットに入った書き換え（G8 の差し戻しで直したもの）は並べない。承認の記録がまだコミットされていなければ判定できないので、注意を出して `complete: false` にする。このため builder は、G8 の報告のあと progress.jsonl をコミットしてから agreement-review に入る必要がある（SKILL.md の「報告したらコミット & push」のとおり）
- `DiffFacts.complete` が false のときは、空の項目が「無かった」ではなく「調べられなかった」を意味する。PR の節は「該当なし」と書かない。PR のマージ先を決められないときも `diff facts` は終了コード 0 で、注意に理由を出す
- 新しく足したテストファイル（追加・未追跡）のアサーションは並べない（既存テストのアサーションの変更が、PR の節の1節20件の打ち切りに隠れないように）。スキップと宣言の削除は並べる
- `review action doc` は `--context agreement` でだけ受け付ける。doc の回数は設定（config.mts）が 1 に固定しているので、agreement は `confirm` を返さない
- `[diff]` の印のキーは既定に追加され、消せない。`exclude` / `tests` は従来どおり置き換え。`classifyPath` と `summarizeDiff` は `Pick<DiffPatterns, "exclude" | "tests">` を受ける（tokens history の呼び出しはそのまま）
- このビルドは、インストール済みの Hikyaku 3.0.0（キャッシュ）の手順で進めた。そこには agreement-review がまだ無いので、このビルド自身は agreement-review を通っていない（review の自己確認で代えた）。後続のビルドで新しい手順を使うときは、プラグインを入れ直すか、ローカルの `scripts/hikyaku.mts` で step を回す
- コードレビューの指摘の扱い: 1回目の10件は直した。2回目の10件は、監督の判断（questions.md の review-findings）で9件を直し、再レビューせずに進めた。セキュリティレビューは、変更が `[review.security] triggers`（個人情報・認証・決済）に当たらないので起動していない

## 残したこと

- `diff facts` は、変更したテストファイルのパスを1件ずつ `git diff` の引数に渡す。数千件を変えると、引数の長さの上限（E2BIG）に当たりうる。当たると行の事実を失うが、`complete: false` と注意に出るので、黙っては落ちない。コードレビュー2回目の指摘9で、監督の判断でこのビルドでは直さない（直すなら、パスをバッチに分けるか、テストの pathspec の glob で絞る）。インストール済みの CLI に `ledger` が無く、ローカルの CLI もこの環境では実行できなかったため、未決事項の記録（`ledger open`）にはできていない。close-cycle で `ledger open --type provisional --who user --when close` として記録し直す
- `docs/configuration/config-file.md` に `## [context]` の見出しが2つ続いている（このビルドより前からある重複。触っていない）

## 永続化すること

- `conventions` [中]: 「スクリプト」に、記録の前後（承認より後の書き換えなど）は日時ではなく履歴（記録を含んだコミットからの `A..HEAD`）で判定する、を足す（rebase でコミット日時が書き換わると、日時の比較は前のコミットを後と数える。コードレビュー1回目の指摘）
- `conventions` [中]: 「スクリプト」に、git の diff を解析するときは見出しの接頭辞を `--src-prefix=a/ --dst-prefix=b/` で固定し、外部の diff ツール（`--no-ext-diff`）と色を切る、を足す（利用者の `diff.mnemonicPrefix`・`diff.noprefix` で見出しのパスが変わり、事実が黙って落ちる。コードレビュー1回目の指摘）
