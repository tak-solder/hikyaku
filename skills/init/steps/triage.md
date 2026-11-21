# triage: 既存文書の振り分け

v3 で廃止した論理名の文書（`learnings` など）の中身を、項目ごとに重要度と置き場へ振り分ける。
判定は `doc-triager` エージェントに委任する。文書とコードを突き合わせる作業で、本セッションの
コンテキストを使わないため。

- [ ] 対象を決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs validate
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs list
```

  - 必ず対象にする: `docs validate` が「v3 で廃止した論理名」と報告した行の文書
    （`learnings` / `test-strategy` / `security-model` / `tech-stack` / `db-schema` / `interfaces`）
  - 任意: 常時読み込まれる文書（AGENTS.md / CLAUDE.md）と、既存の rule（`.claude/rules/`）。
    リポジトリが自分で管理している文書なので、対象に含めるかをユーザーに尋ねる。既存の rule を
    含めるなら、広さと大きさを先に測って結果を渡す

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" rules check
```

- [ ] `doc-triager` を起動する（文書が大きければ、文書ごとに分けて並行で起動する）
  - 渡す情報: 対象の文書のパス、`document-guide.md` のパス、判定の基準
    `${CLAUDE_PLUGIN_ROOT}/skills/close-cycle/references/persistence.md` のパス、既存の rule を対象にする
    場合は `rules check` の出力
  - エージェントは読み取りだけを行い、項目ごとの判定を表で返す
- [ ] 返った判定を束ねる。同じ項目への判定が食い違っていれば、根拠を読んで決める
  - 「消すと失うもの」（どこにも書かれていない、重要度が高・中の項目）を取りこぼしていないか確かめる
  - 機械で防げるのに未対応のものは、ここでは直さない。rule に仮置きする案にし、何を入れれば防げるかを
    PR の本文に並べる（この PR は文書の移動だけにする）
