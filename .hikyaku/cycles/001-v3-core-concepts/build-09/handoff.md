# Build 09: 行き詰まりの報告の検査と、gh が使えないときの扱い 申し送り

## 後続ビルドが前提にすること

- **すべての `<hikyaku-blocked>` が検査の対象。** blocked の種類（差し戻し・PR 作成の代行の依頼・権限不足・ユーザーに上げる問いの待ち）を区別しないので、blocked で終えるときは必ず「試したこと」「問題を変える選択肢」（各項目に `失うもの:`）「推奨」を書く（G8 で監督が承認した解釈）。build-07（conductor の走りきり）で、ユーザーに上げる問いを blocked で終えさせる手順を足すときは、この3つの節を含む書式にする。監督が環境ごとに補足する blocked の書式（この環境の「PR 作成の代行を依頼します」など）も、取り込み後はこの形に合わせないと violation になる
- **欠けのある差し戻しの blocked は、conductor では architect へ進まずユーザーに上がる。** conductor/SKILL.md は violation を `returned` の判定より先に扱うため（安全側なので変えていない）
- `checkEscalation` は見出しと行頭のラベルのどちらでも読む。見出しは節の名前で**終わる**ものだけを節と読み（`## 問題を変える選択肢` は選択肢、`## 推奨しない理由` は読まない）、リストの項目の `- 推奨: …` は節を切り替えない。テンプレートの `（…）` と項目のラベル `A:` だけの行は中身に数えない
- `gh` が使えないときの出力の欄（`applied` / `reason` / `stage` / `error` / `manual`）は `scripts/lib/gh-failure.mts` の `ghFailure` が作る。PR の後に付随する処理で gh を呼ぶコマンドを足すなら、これを使って `external sync`・`pr request-reviewers`・`pr ready` とそろえる
- `pr ready --for-merge`（監督が取り込む直前）と、`gh pr view` の応答の形が想定外のときだけは、従来どおり終了コード 1。conductor/SKILL.md の `--for-merge` の「失敗したら取り込まない」は終了コードで判定したままでよい

## 残したこと

- コードレビュー（ラウンド 2）の指摘のうち、そのまま進めたもの（監督の判断。`questions.md` の review-findings）
  - すべての blocked を検査するので、手順の都合で止まるときも3つの節が要る — 不採用（G8 で承認した設計どおり。欠ければ violation を経てユーザーに上がる）
  - conductor の子の `pr ready` は `--pr` の実在と状態を確かめない — 不採用（子では Ready にしないので gh を呼ばない意図した変更。監督の `--for-merge` と `check-pr` で確かめる）
  - gh が無いことの判定が、`fetchPrGraphql` が包んだエラーの文面（`spawn gh ENOENT`）に頼っている — 後で直す。`fetchPrGraphql` が元のエラーを `cause` で渡し、`ghFailure` が `cause.code === "ENOENT"` を見る形にする。取り違えても `reason` の表示が変わるだけで手順は止まらない
  - return.md の欠けのメッセージが builder の stop・architect の stop・`step restart` の3か所に分かれている — 後で直す（`describeReturnProblems(record)` のような1つの関数にまとめる）
- ラウンド 2 の修正（小見出しの扱い・`A:` の除外・stderr からの理由・graphql 失敗時の一覧・`pr` の番号化・Stop フックの書き足しの促し）は、レビューの上限に達したため再レビューしていない。テストは通っている

## 永続化すること

- `conventions` [中]: 行き詰まりの報告の3つの節（試したこと / 問題を変える選択肢と `失うもの:` / 推奨）の名前を変えるときは、`scripts/lib/escalation.mts` と、テンプレート（`skills/builder/references/templates.md` の return.md・`skills/builder/references/retry-policy.md`・`skills/conductor/references/headless-protocol.md`）を同じ PR で直す（検査とテンプレートが食い違うと、すべての差し戻し・retry-limit・blocked が受け付けられなくなる。ADR escalation-report-check のトレードオフ）
- `conventions` [中]: PR を作ったあとに付随する処理で `gh` を呼ぶコマンドは、`gh` の失敗で終了コード 1 にせず、`scripts/lib/gh-failure.mts` の `ghFailure` で `applied: false`・`reason`・`stage`・`manual` を返す（US-18。build-09 で `pr request-reviewers`・`pr ready` をそろえた。取り込みの判定に使う `--for-merge` は例外）
