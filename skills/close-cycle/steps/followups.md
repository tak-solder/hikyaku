# followups: 別の PR にするもの

close の PR に混ぜると採否を分けて判断できなくなるものを、別のブランチの PR にする。
どちらも採否は人間がマージで決めるので、ここでは承認を求めない。該当するかは directive の「値」にある。

| 値 | 意味 |
|---|---|
| `guideReview` | このサイクルの予測と実測から、見積もりのガイドの見直しを勧めるか（理由は `guideReviewReason`） |
| `hookCandidates` | サイクルの記録に、フックにする候補があるか |

どちらも該当しなければ、何もせず `done` を報告する。

close の PR は作成済みで、サイクルは closed になっている。ここで失敗しても close には影響しない。
失敗したら、内容を完了の案内と一緒にユーザーに伝えて `done` を報告する。

**どちらの作業も別のブランチで行う。始める前に close のブランチの名前を控え、作業を終えたら
（PR を作った場合も、作らずに終えた場合も、失敗した場合も）必ず close のブランチへ戻る。**
このステップの報告は close のブランチで行う。CLOSE の進捗（`cycles/{cycle}/progress.jsonl`）は
close のブランチにしか無いので、別のブランチに居るまま報告すると受け付けられない。

```bash
git branch --show-current
```

## 見積もりのガイドの見直し（`guideReview` が true のとき）

- [ ] 未マージの token-guide の PR が無いか確かめる（token-guide のブランチ名は固定なので、
  開いている PR があると衝突する）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify token-guide
```

  `expected` の名前のブランチがリモートに残っていれば見送る。完了の案内で「未マージの PR があるので見送った」と伝える
- [ ] close のブランチの変更をすべてコミット & push してから、ベースブランチを最新にして切り替える
- [ ] token-guide の回を `auto` で区切り、`/hikyaku:token-guide tune` を呼び出す

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step restart token-guide --round auto --reason "{cycle} の close: {guideReviewReason}"
```

  - `auto` の回では、token-guide は承認のゲートを置かない。変更案の根拠（どのビルドがどちらへ
    外れたか、どの成分を直すか）を PR の本文に載せ、採否はマージで決める
  - token-guide が「補正するほどの偏りは無い」と判断して PR を作らずに終えたら、その旨を完了の案内で伝える
- [ ] token-guide が終わったら（PR を作った場合も、作らずに終えた場合も）、close のブランチへ戻る

```bash
git switch {close のブランチ}
```

## フックの提案（`hookCandidates` が true で、G10 で採ると決まったとき）

G10 でフックにしないと決まっていれば、何もしない。

フックは、設定を誤ると全セッション（conductor の子セッションも含む）を止める。そのため close の PR に
混ぜず、動作を確かめたうえで別の PR にする。**フックの設定はファイルを書き換えた時点でこのセッションにも
効く**ので、書くのはこの手順の最後にし、書いたブランチでほかの作業を続けない。

- [ ] ベースブランチを最新にして、フック用のブランチを作る。名前は close のブランチ名に `-hooks` を付ける
  （例: `hikyaku/002-billing/close-hooks`）
- [ ] フックのスクリプトを `.claude/hooks/` に置き、`.claude/settings.json` の `hooks` に登録する
  - 既存の `settings.json` があれば、ほかの設定を変えずに足す
  - コマンドは `"$CLAUDE_PROJECT_DIR"/.claude/hooks/{名前}` の形で参照する
  - 止めるときは終了コード 2 で終え、標準エラーに「何が止められ、代わりにどうするか」を書く
  - 対象のツールとファイルを matcher と入力の検査でできるだけ絞る。広く止めるフックは作らない
- [ ] 登録する前に、スクリプト単体にサンプルの入力（標準入力の JSON）を与えて確かめる。
  止めるべき入力で終了コード 2、通すべき入力で 0 になること
- [ ] コミットして PR を作る。本文に次を書く
  - 何を防ぐフックか、根拠（どのビルドで何回起きたか）
  - 確かめた入力と結果
  - マージすると、このリポジトリで動く全セッションに効くこと
  - 重要度が高の知見で、close の PR が同じ内容を rule や `conventions` にも書いている場合は、
    この PR でその記述を消す（フックが防ぐので、読ませる必要がなくなる）
- [ ] close のブランチに戻る

## 報告

- [ ] close のブランチに居ることを確かめる。違っていれば戻る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify close {cycle}
```

- [ ] `done` を報告し、close のブランチで `cycles/{cycle}/progress.jsonl` をコミット & push する
