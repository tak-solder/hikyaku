# 企画フェーズ 振り返り

## セッション中にスキル外で受けた指示

- base を `feature/v3-core-concepts` にするサイクルでは、バージョンを PR ごとに上げず `3.0.0` に積む（Q2。AGENTS.md は `main` と `beta/v<N>` の運用しか定めていない）
- 既存のワークスペースとの互換は意識しなくてよい（G1 で Q5 に回答。v3 の前段なので互換を要件にしない）
- 合意に無い変更は、人間の判断を待って止めない。コードレビューの指摘と同じ扱いで builder が直すか理由を返し、理由を PR 本文に並べる（G1 で Q6 に回答）

## 永続化すること

- `conventions` [中]: `feature/v3-*` のように次のメジャーの前段を積むブランチ向けの PR も、`beta/v<N>` と同じく `version` を `<N>.0.0` に固定し、CHANGELOG は `[<N>.0.0]` の節に追記する（根拠: 企画の Q2。AGENTS.md の作業時の注意が `main` と `beta/v<N>` しか扱っておらず、企画で尋ねる必要があった）
- `upstream`: planner の scope で「（推測）」を付けた制約・要件を確かめる手順が無く、確かめないまま受け入れ基準の根拠になった（互換性の推測を doc-reviewer が指摘し、G1 で尋ねて削除した）
- `upstream`: `pr ready` が `gh pr view`（GraphQL）に頼っており、GraphQL が使えない環境（Claude Code のクラウドセッション。HTTP 403 で REST の `pulls/{n}/ccr/ready_for_review` を案内される）で公開に失敗する。`external sync` の `gh issue create` も同じ環境で失敗した
- `upstream`: Stop フックが、バックグラウンドで起動したサブエージェント（review の doc-reviewer）の完了を待っているターンでも引き止める

## 役に立たなかった記述

なし
