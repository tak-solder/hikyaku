# plan: 実装計画の作成と BP の再算出

- [ ] 不明点があれば `cycles/{cycle}/build-{NN}/questions.md` でユーザーに質問する（ask: questions）
- [ ] `cycles/{cycle}/build-{NN}/plan.md` を作成する
  - テンプレートは `${CLAUDE_PLUGIN_ROOT}/skills/builder/references/templates.md`（[templates.md](../references/templates.md)）を参照
  - 含めるもの: 依存パッケージの選定、クラス設計（メソッドシグネチャ）、非機能要件
  - 含めないもの: 詳細な実装コード、テストコードの実装方法
  - 非機能要件の「マージ時点のデータ安全」に、マージ直後の本番で既存データ・既存機能が壊れない
    根拠を書く。データに触れないビルドでは「該当なし」と一言書く（考えた跡を残すため）
- [ ] BP を再算出する（`${CLAUDE_PLUGIN_ROOT}/skills/build-manager/references/bp-guide.md` の手順に従う）
  - architect 段階の BP は issue.md のスコープ記述からの見積もり。plan.md ではクラス設計と
    実装ステップまで具体化しているので、入力値を見直して算出し直す
  - `{HIKYAKU_ROOT}/bp-guide/README.md` があれば、このリポジトリ固有の数え方の注意を先に読む
  - 作成するファイルを名前で列挙し、そこから新規ファイル数・実装行数を数える。列挙は plan.md に残す
  - 入力値を `bp estimate` に渡し、`--markdown` の内訳表をそのまま plan.md に貼る。
    表への当てはめはコマンドが行うので、自分で表を読んで BP にしない

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" bp estimate {cycle} \
  --new-files 7 --lines 900 --impact-files 9 --external-api --markdown
```

  - 加算要素を落とさない。過小見積もりの多くは、影響ファイル数・基盤セットアップ・
    外部API連携・大規模リファクタの取りこぼしから来る。使える入力は `bp guide {cycle}` の「入力」列
- [ ] `done` を報告する。**再算出した BP を `--bp` に添える**（分割の検討が要るかは step が判定する）
- [ ] コミット & push する（progress.jsonl も含める）
