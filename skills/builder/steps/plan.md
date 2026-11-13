# plan: 実装計画の作成と予測ピークの見積もり直し

- [ ] 不明点があれば `cycles/{cycle}/build-{NN}/questions.md` でユーザーに質問する（ask: questions）
- [ ] `cycles/{cycle}/build-{NN}/plan.md` を作成する
  - テンプレートは `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/templates.md`（[templates.md](../references/templates.md)）を参照
  - 含めるもの: 依存パッケージの選定、クラス設計（メソッドシグネチャ）、非機能要件
  - 含めないもの: 詳細な実装コード、テストコードの実装方法
  - 非機能要件の「マージ時点のデータ安全」に、マージ直後の本番で既存データ・既存機能が壊れない
    根拠を書く。データに触れないビルドでは「該当なし」と一言書く（考えた跡を残すため）
- [ ] 予測ピークを見積もり直す（`${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/estimate.md` の手順に従う）
  - architect 段階の予測は issue.md のスコープ記述からの見積もり。plan.md ではクラス設計と
    実装ステップまで具体化しているので、成分を見直して見積もり直す
  - `tokens guide {cycle}` が示すガイドを読み、成分ごとの見積もり方とこのリポジトリでの補正に従う
  - 読むファイル・作成するファイルを名前で列挙し、そこから読み込み・実装・テストを見積もる。列挙は plan.md に残す
  - このセッションでここまでに読んだ量は、もう載っている。今のコンテキストは `step next` の
    出力や `tokens session` で分かるので、固定費と読み込みの見積もりの参考にする
  - 成分と根拠を `tokens estimate` に渡し、`--markdown` の内訳表をそのまま plan.md に貼る。
    合計と判定はコマンドが行うので、自分で足さない

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" tokens estimate {cycle} \
  --fixed 90k --reading 130k --implementation 100k --tests 60k --unknown 30k \
  --reading-basis "..." --implementation-basis "..." --markdown
```

  - 未知の領域を落とさない。過小見積もりの多くは、検証と修正のループ・環境のデバッグ・
    外部ライブラリの調査の取りこぼしから来る
- [ ] 見積もり直した予測ピークを、報告の `--peak` に添える（例: `--peak 410k`）
