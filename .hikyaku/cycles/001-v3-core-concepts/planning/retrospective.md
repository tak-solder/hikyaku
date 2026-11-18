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

## ARCHITECT の途中で要件を足したときの振り返り（step restart）

### セッション中にスキル外で受けた指示

- ARCHITECT の G3 の途中で要件の追加が必要になり、決まった経路が無いため `step restart plan` で planner を回し直した（ユーザーの指示）
- 承認済みのストーリー（US-1〜US-18）は番号を振り直さずに残し、追加は US-19 以降と、既存ストーリーへの受け入れ基準の追記にする（ユーザーの指示）
- 「事後確認」は用語集の「確認」（省ける判断）とぶつかるため「事後同意」に改めた（doc-reviewer の指摘を G1 で採用）

### 永続化すること

- `upstream`: ARCHITECT（G3 などの途中）から PLAN に戻って要件を足す決まった経路が無く、`step restart plan` で planner を最初から回し直した。インプットの読み込みやスコープのすり合わせを、既存の承認済み部分を含めてやり直す形になる
- `upstream`: planner の手順に、承認済みの user-stories.md へ追記するときに既存の `US-N` / `US-N.M` の番号を保つ定めが無い。番号は後続フェーズが参照するので、振り直すと design や issue.md の参照が壊れる（今回はユーザーが指示した）
- `upstream`: Stop フックが、run の手順（scope）でユーザーへの問いを出して止まるターンでも引き止める。scope・user-stories の質問のように gate でない手順でも、ユーザーの答えを待つことがある（このセッションで2回）

### 役に立たなかった記述

なし
