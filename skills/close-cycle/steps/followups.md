# followups: 別の PR にするもの

close の PR に混ぜると採否を分けて判断できなくなるものを、別のブランチの PR にする。
どれも採否はユーザーがマージで決めるので、ここでは承認を求めない。該当するかは directive の「値」にある。

| 値 | 意味 |
|---|---|
| `guideReview` | このサイクルの予測と実測から、見積もりのガイドの見直しを勧めるか（理由は `guideReviewReason`） |
| `hooks` | G10 でフックを採ると決まったか（hooks ステップの記録から） |
| `ruleRemovals` | 試しに消す候補（`rules candidates` の消す候補と同じ。重要度が高の基準は入らない） |
| `g10Input` | G10 の承認の答え。試しに消すと決まった基準の範囲をここから読む（G10 を省いた回は空） |
| `metricsComparison` | 過去に基準を消した PR ごとの、マージ前後の指標の比較 |

どれも該当しなければ、何もせず `done` を報告する。

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

## フックの提案（`hooks` が true のとき）

G10 で採ると決まったフックだけを書く。却下された候補は書かない。

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

## 基準を試しに消す（`g10Input` に試しに消すと決まった基準があるとき）

`ruleRemovals` のうち、G10 の答え（`g10Input`）で試しに消すと決まったものだけを消す。G10 を省いた回
（`g10Input` が空）は、決まっていないので消さない。採否はユーザーがマージで決めるので、承認は求めない。

- [ ] ベースブランチを最新にして、ブランチを作る。名前は close のブランチ名に `-criteria` を付ける
  （例: `hikyaku/002-billing/close-criteria`）
- [ ] rule のファイルを消す。文書の基準は、その行（箇条書きの1行）だけを消す。周りの記述は整理しない
- [ ] コミットして PR を作る。本文に次を書く
  - 消した基準ごとに、何を防ぐためのものだったか（理由の欄）と、消す根拠（`ruleRemovals` の理由と出どころ）
  - マージすると、後続のサイクルの close-cycle がマージ前後の指標（差し戻し・rejected・重要度が高の落とし穴・
    重い指摘）を比べて示すこと。悪くなっていれば、この PR を戻す判断の材料になること
- [ ] close のブランチに戻る。報告の `--pr` に、この PR の URL を添える（指標の比較の起点になる）

## 指標の比較（`metricsComparison` が空でないとき）

- [ ] 比較ごとに、消した PR・消した基準・マージの日時と、前後のサイクルの指標の合計を完了の案内で示す
  - `comparable` が false なら「比較できない」と理由を示す
  - `worse` に指標があれば、悪くなった指標と、PR を戻す（revert する）かはユーザーが決めることを伝える。
    戻すかどうかを自分で決めない

## 報告

- [ ] close のブランチに居ることを確かめる。違っていれば戻る

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify close {cycle}
```

- [ ] `done` を報告し、close のブランチで `cycles/{cycle}/progress.jsonl` をコミット & push する。
  基準を消す PR を作ったら `--pr` にその URL を添える（作らなかったら添えない。見積もりのガイドの見直しや
  フックの PR は添えない。添えると後続のサイクルが基準を消した PR として指標を比べる）
