# Build 04: 異議と、各フェーズが未決事項を記録する手順 申し送り

## 後続ビルドが前提にすること

- 高の異議が片づいたかは `ledger.mts` の `unacceptedObjections` が唯一の正。ユーザー（`by: user`）の、`accepts` 付き `consented` か `decided` で片づく。拠り所の前提は記録時（`ledger open --type objection --harm 高`・`ledger object` の consented）に求め、片づきの判定では見ない。`step report` はすべての gate の approved でこれを呼ぶ。サイクルの記録が読めなければその作業単位の記録だけで確かめ（`readUnitLedger`）、それも読めなければ拒否する。build-06 が事後同意に回す異議を足すときも、この関数で判定する
- ステップの定義に `interrupt`（割り込みのゲート）がある。きっかけの時刻を返す回だけ手順に入り、その時刻より後の承認（step restart より前のものも数える）が無ければ現在地を奪う。floor を動かさないので、承認しても後ろはやり直しにならない。割り込みの間は報告し直しも受け付けない。期限の判定・記録の欠けは `Evaluation.sequential`（並びの現在地）で行う。期限や位置を見る新しい処理は `current` ではなく `sequential` を使う
- builder の `delegation` のきっかけは、そのビルドの `decisions.jsonl` の `type: question` かつ `ask: design-conflict` の事項。監督の答え（provisional）や異議に同じ ask を付けても出ない。builder は自分の `decisions.jsonl` を読めなければ `stop` で止まる
- gate の directive の `objection`（guide・pointers・command）は、サイクルに属す作業単位の gate で、`notices` を読む経路（step next / report）にだけ載る。build-12（gate brief）が提示を組み立てるときも、この欄はスクリプトが固定する
- ASKS の `delegation` は consent の種別（ユーザー固定）。ステップ定義では `consent` が常に now で `enabled` を持たないので、`CONSENT_WHEN` には入らない
- 各スキルの指示文（このリポジトリの skills/）は、`ledger open` で残したことを記録し、handoff の「残したこと」に ID だけを書く形に改めた。このビルド自身は、実行中のプラグイン（インストール済みの 3.0.0）に `ledger` が無く、リポジトリの CLI も権限で実行できなかったので、従来どおり下に文章で書いた

## 残したこと

- 確度: 要確認 — 手順の位置だけを読む経路（Stop フック・step where・conductor parse）が、builder の delegation のきっかけを見るために、そのビルドの `decisions.jsonl` を1つ読む。design-delta 2節（その経路では読まない）からの逸脱で、G8 で監督が受け入れた（questions.md の Q1）。読めないときは builder が止まる（コードレビュー1回目の指摘で、「ゲートが出る側に倒す」から「止まる」に改めた。以前の承認が新しい衝突のゲートを隠すため）。最後の PR でユーザーが判断する
- 確度: 要確認（AI の解釈） — 害が高の異議で、ユーザーが選択を改めた（`decided`）ときは `--accepts` を求めず、ゲートも止めない（`--input` は必須。G8 の条件1）。issue.md・design-delta の文言は「高なら `--accepts` 必須」
- 確度: 要確認（AI の解釈） — design-conflict から差し戻すと、delegation を builder（記録の直後）と architect（再設計の回の先頭）の2回尋ねる（US-14.2 が2つの出来事を挙げているため）
- AI の解釈 — サイクルに属さない patch の P1・P2 には異議の指示を載せない（未決事項の記録がサイクルの中だけのため。G8 で監督が受け入れ）
- コードレビューで採らなかった指摘（questions.md の Q2 で監督が「修正して再レビューせずに進める」と決定）
  - `ledger open` と `ledger object` の検証（`--ask`・高の異議の前提）の共通化: 振る舞いを変えない重複のため
  - 異議の指示を全ゲートに載せることのトークンの増加: design-delta 2節が全ゲートを指定しているため
  - delegation を rejected にすると提示し直しが続く: 指示文で、委任をやめる答えも approved の `--input` に残すと明確にした
  - `ledger open` は高の異議に常に `--premises` を求め、`ledger object --decision decided` は求めない: 記録時に前提を求めるほうが安全側のため
  - builder の評価ごとに `decisions.jsonl` を2回解析する: 性能の指摘で、振る舞いを変えないため
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない）
- 異議の指示を「ユーザーに選ばせる問い」（`（ask: …）` の問い）に載せる経路は無い。gate の directive にだけ載る。問いは step を通らないため

## 永続化すること

- `conventions` [中]: 「スクリプト」に、どのステップの最中にも起きる出来事のあとに尋ねるゲートは `interrupt` で定義し、並びに置かないことを足す（並びに置くと、承認が後ろのステップをやり直しにする。plan-review とコードレビューの指摘）。期限や位置を見る処理は `Evaluation.sequential` を使う
- `conventions` [中]: build-03 が候補にした「手順の位置だけを読む経路は未決事項の記録を読まない」に、割り込みのゲートのきっかけ（その作業単位の decisions.jsonl 1つ）は例外で、読めなければそのスキルが止まることを添える
- `conventions` [中]: 「スクリプト」の ask タグの規約に、`（ask: delegation）` は consent の種別（ユーザー固定）で足したことを、`（ask: deferred-consent）`（build-06）と合わせて書く（design-delta の永続ドキュメントの更新予定）
- `decisions` [高]: ADR 20261116-pending-items-ledger に、高の異議の受け入れには `accepts`（ユーザーの言葉）と記録時の `premises` が要り、ユーザーが選択を改めた `decided` では `accepts` を求めないこと（G8 で監督が受け入れた解釈。ユーザーが最後の PR で判断した結果に合わせて書く）を足す
