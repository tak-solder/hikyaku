# Build 10: 知見の置き場の「なくす」と、rule を移すきっかけ・領域の開発頻度 テストシナリオ

## config（`scripts/lib/config.mts`）

### readRulesConfig: 指定が無ければ閾値は既定の 3
- 対応: US-4.2
- Given: `.hikyaku.config` に `[rules]` テーブルが無い
- When: `loadConfig` で設定を読む
- Then: `rules.hitThreshold` が `3` になる

### readRulesConfig / readAreasConfig: 正の整数でない値はエラー
- 対応: —
- Given: `.hikyaku.config` に `[rules] hit_threshold = 0`（別ケースで `[areas] dormant_days = "180"` の文字列、`-1`、`1.5`）がある
- When: `loadConfig` で設定を読む
- Then: `HikyakuError` が投げられ、メッセージに該当するキー名（`hit_threshold` / `dormant_days`）が含まれる

### readAreasConfig: 指定が無ければ休眠の期間は既定の 180 日、指定すればその値
- 対応: US-5.1
- Given: ケース1は `[areas]` が無い。ケース2はルート設定に `[areas] dormant_days = 90` がある
- When: `loadConfig` で設定を読む
- Then: ケース1は `areas.dormantDays` が `180`、ケース2は `90` になる

### readRulesConfig / readAreasConfig: サイクル設定で上書きできる
- 対応: —
- Given: ルート設定に `[rules] hit_threshold = 3`・`[areas] dormant_days = 180`、サイクル `001-x` の設定に `[rules] hit_threshold = 5`・`[areas] dormant_days = 30` がある
- When: サイクル `001-x` を指定して `loadConfig` で設定を読む
- Then: `rules.hitThreshold` が `5`、`areas.dormantDays` が `30` になる

## promotions（`scripts/lib/promotions.mts`）

### parseCandidate: 宛先 `refactor` を「なくす」の候補として読む
- 対応: US-4.1
- Given: 「永続化すること」の行 `` `refactor` [中]: 日付の書式を1つの関数に寄せれば規約が要らなくなる ``
- When: `parseCandidate` に渡す
- Then: `target` が `refactor`、`kind` が `"refactor"`、`importance` が `中` の候補が返る

### parseCandidate: `refactor` でも重要度が無ければ読めない行になる
- 対応: US-4.1
- Given: 行 `` `refactor`: 日付の書式を寄せる `` （重要度なし）
- When: `parseCandidate` に渡す
- Then: 文字列（「重要度（[高] か [中]）がありません」）が返り、候補にならない。宛先が不明というエラーではない

### parseCriterionReasons: 行末の理由から防ぐ・立つ・重要度を読む
- 対応: US-9.1
- Given: 文字列 `日付は ISO 8601 で書く（防ぐ: build-03 で表示が崩れた / 立つ: いまの formatDate の形 / 重要度: 高）`
- When: `parseCriterionReasons` に渡す
- Then: `text` が `日付は ISO 8601 で書く`、`reasons` が `{ prevents: "build-03 で表示が崩れた", basis: "いまの formatDate の形", importance: "高" }` になる

### parseCriterionReasons: 重要度を省いた理由も読める
- 対応: US-9.1
- Given: 文字列 `X を使う（防ぐ: 二重送信 / 立つ: API の冪等性の仮定）`
- When: `parseCriterionReasons` に渡す
- Then: `reasons.prevents` が `二重送信`、`reasons.basis` が `API の冪等性の仮定`、`reasons.importance` が `undefined` になる

### parseCriterionReasons: 理由の欄が無ければ reasons は undefined
- 対応: —
- Given: 文字列 `日付は ISO 8601 で書く`（括弧なし）と、`(ベータ版)` のように理由の書式でない括弧で終わる文字列
- When: それぞれ `parseCriterionReasons` に渡す
- Then: どちらも `text` が元の文字列のまま、`reasons` が `undefined` で返る（エラーにしない）

### parseCriterionReasons: 理由の欄が崩れていれば問題を返す
- 対応: —
- Given: 文字列 `X を使う（防ぐ: 二重送信 / 重要度: 低）`（`立つ` が無く、重要度が `低`）
- When: `parseCriterionReasons` に渡す
- Then: 問題を説明する文字列が返る

### collectPromotions: 行の `[高]` と理由の重要度が食い違えば unparsed
- 対応: US-9.1
- Given: `build-01/handoff.md` の「永続化すること」に `` `conventions` [高]: X を使う（防ぐ: 二重送信 / 立つ: 冪等性 / 重要度: 中） ``
- When: `collectPromotions` を呼ぶ
- Then: `candidates` は空、`unparsed` に1件入り、`problem` が重要度の食い違いを示す

### collectPromotions: 理由つきの行は Candidate.reasons に入り、本文から理由が外れる
- 対応: US-9.1
- Given: 「永続化すること」に `` `rule:.claude/rules/api.md` [高]: 冪等キーを付ける（防ぐ: 二重課金 / 立つ: 決済 API の仕様 / 重要度: 高） ``
- When: `collectPromotions` を呼ぶ
- Then: 候補の `text` が `冪等キーを付ける`、`reasons` が `{ prevents: "二重課金", basis: "決済 API の仕様", importance: "高" }` になる

### collectPromotions: 理由の無い既存の行も今までどおり候補になる
- 対応: —
- Given: 既存書式の行 `` `constraints` [中]: 外部 API は 5 秒で打ち切る `` だけを持つ handoff.md
- When: `collectPromotions` を呼ぶ
- Then: 候補が1件返り、`reasons` が `undefined`、`unparsed` は空

### REVIEW_RECORD_HEADING: 見出しの語がテンプレートと persistence.md にそろっている
- 対応: US-4.2
- Given: 定数 `REVIEW_RECORD_HEADING`、`skills/builder/references/templates.md`、`skills/close-cycle/references/persistence.md`
- When: 定数の値と、2つのファイルの見出し・宛先の語を突き合わせる
- Then: 定数が `レビューの記録` で、両ファイルにその見出しがあり、persistence.md の宛先の一覧に `refactor` がある

## review-records（`scripts/lib/review-records.mts`）

### parseReviewRecord: 重い指摘と rule のパスを読む
- 対応: US-4.2
- Given: 行 `` [重] `rule:.claude/rules/api.md`: 冪等キーが無い ``
- When: `parseReviewRecord` に渡す
- Then: `{ weight: "重", rule: ".claude/rules/api.md", text: "冪等キーが無い" }` が返る

### parseReviewRecord: rule に当たらない指摘は rule が undefined
- 対応: US-4.2
- Given: 行 `` [軽] `-`: 変数名が分かりにくい ``
- When: `parseReviewRecord` に渡す
- Then: `{ weight: "軽", rule: undefined, text: "変数名が分かりにくい" }` が返る

### parseReviewRecord: 書式に合わない行は問題を返す
- 対応: —
- Given: 重さが不正な `` [中] `rule:.claude/rules/api.md`: 指摘 ``、重さを欠いた `` `rule:.claude/rules/api.md`: 指摘 ``、宛先が不正な `` [重] `constraints`: 指摘 ``、パスが空の `` [重] `rule:`: 指摘 ``
- When: それぞれ `parseReviewRecord` に渡す
- Then: どれも文字列（書式の説明）が返り、ReviewRecordLine にならない

### collectReviewRecords: closed を含む複数サイクルの build-NN/handoff.md を集める
- 対応: US-4.2
- Given: サイクル `001-a`（status: closed）の `build-01/handoff.md` に記録2行、サイクル `002-b`（active）の `build-01/handoff.md` と `build-02/handoff.md` に1行ずつ
- When: `collectReviewRecords(hikyakuRoot, cycles)` を呼ぶ
- Then: `records` が4件で、各件の `cycle`（`001-a` / `002-b`）・`build`（`build-01` など）・`source` が正しい

### collectReviewRecords: patch の handoff.md と他の見出しは読まない
- 対応: —
- Given: サイクル `001-a` の `patches/202611/fix-x/handoff.md` に「レビューの記録」の行、`build-01/handoff.md` の「残したこと」に同じ書式の行がある
- When: `collectReviewRecords` を呼ぶ
- Then: `records` は空

### collectReviewRecords: 読めない行は unparsed、「なし」は捨てる
- 対応: —
- Given: `build-01/handoff.md` の「レビューの記録」に `なし` と `[重] rule:.claude/rules/a.md 指摘`（バッククォートなし）がある
- When: `collectReviewRecords` を呼ぶ
- Then: `records` は空、`unparsed` に後者だけが1件入り、`source` が `build-01/handoff.md` を指す

### ruleHits: rule ごとに回数・重い指摘・出どころを数え、rule の無い記録は数えない
- 対応: US-4.2
- Given: `rule:.claude/rules/api.md` の重2・軽1（2サイクルにまたがる）、`-` の重1の記録
- When: `ruleHits` を呼ぶ
- Then: キーは `.claude/rules/api.md` の1つだけで、`{ count: 3, heavy: 2 }`、`sources` が3件

### heavyCountByCycle: サイクルごとの重い指摘の数
- 対応: —
- Given: `001-a` に重2・軽1、`002-b` に軽1だけの記録（`-` の重も重として含む）
- When: `heavyCountByCycle` を呼ぶ
- Then: `001-a` が 2、`002-b` が 0 になる

## rules（`scripts/lib/rules.mts`）

### parseRule: frontmatter の prevents / basis / importance を読む
- 対応: US-9.1
- Given: frontmatter に `paths: ["src/api/**"]`、`prevents: 二重課金`、`basis: 決済 API の仕様`、`importance: 高`
- When: `parseRule`（`listRuleFiles` 経由）で読む
- Then: `reasons` が `{ prevents: "二重課金", basis: "決済 API の仕様", importance: "高" }`、`problems` が空、`paths` は従来どおり読める

### parseRule: 不正な importance は reasons に入れず problems に出す
- 対応: —
- Given: frontmatter に `importance: 低`
- When: `parseRule` で読む
- Then: `reasons.importance` が `undefined` で、`problems` に importance が不正である旨が1件入る

### ruleCandidates: 引かれた回数が閾値と等しければ移す候補
- 対応: US-4.2
- Given: 閾値 3、`.claude/rules/api.md` の `ruleHits` が `{ count: 3, heavy: 1 }`、rule は一致するファイルがある
- When: `ruleCandidates` を呼ぶ
- Then: `{ path: ".claude/rules/api.md", kind: "move", hits: 3, heavy: 1 }` の候補が1件出る

### ruleCandidates: 閾値に1足りなければ並ばない
- 対応: US-4.2
- Given: 閾値 3、`ruleHits` が `{ count: 2 }`、rule は一致するファイルがある
- When: `ruleCandidates` を呼ぶ
- Then: 候補は空

### ruleCandidates: どのファイルにも一致しない rule を stale として並べる
- 対応: US-4.3
- Given: `paths: ["old/**"]` で `measureRules` の `stale` が true の rule、記録には挙がっていない
- When: `ruleCandidates` を呼ぶ
- Then: `kind: "stale"` の候補が1件出て、`hits` は無い

### ruleCandidates: 記録に挙がったが存在しない rule を missing として並べる
- 対応: US-4.3
- Given: `ruleHits` に `.claude/rules/apii.md`（存在しない）が count 1 で挙がっている。閾値は 3
- When: `ruleCandidates` を呼ぶ
- Then: 閾値に関わらず `kind: "missing"`、`path: ".claude/rules/apii.md"`、`hits: 1` の候補が出る

### ruleCandidates: 日数は rule の paths に当たる追跡ファイルの最終変更から
- 対応: US-5.3
- Given: rule の最終変更日の入力に、`paths` に当たる `src/api/pay.ts` の最終変更から求めた日数 40（rule ファイル自身は 2 日前に変更）
- When: `ruleCandidates` を呼ぶ
- Then: 候補の `lastTouchedDays` が `40` になる

### ruleCandidates: 一致しない rule・paths の無い rule の日数は rule ファイル自身から
- 対応: US-5.4
- Given: `stale` の rule ファイルが 300 日前に最後に変更されている
- When: 一時リポジトリで rule ごとの最終変更日を求め、`ruleCandidates` を呼ぶ
- Then: 候補の `lastTouchedDays` が `300` になる

### ruleCandidates: 最終変更日が分からなければ日数は undefined のまま候補を返す
- 対応: —
- Given: 移す候補の条件を満たす rule で、最終変更日の入力が `undefined`（git の失敗）
- When: `ruleCandidates` を呼ぶ
- Then: `kind: "move"` の候補が出て、`lastTouchedDays` が `undefined`

## git（`scripts/lib/git.mts`）

### lastTouched: 渡したファイルのうち最も新しいコミット日時を返す
- 対応: US-5.1
- Given: 一時リポジトリで `a.ts` を `GIT_COMMITTER_DATE=2025-01-01T00:00:00Z`、`b.ts` を `2026-03-01T00:00:00Z` でコミット
- When: `lastTouched(repo, ["a.ts", "b.ts"])` を呼ぶ
- Then: `2026-03-01T00:00:00Z` の `Date` が返る

### lastTouched: 引数が多いときは分けて呼んでも最も新しい日時を取る
- 対応: —
- Given: 一時リポジトリで 3000 ファイルをコミットし、最後の1ファイルだけを後の日時（`2026-06-01`）でコミット
- When: 3000 ファイルすべてを渡して `lastTouched` を呼ぶ
- Then: エラーにならず `2026-06-01` の日時が返る

### lastTouched: ファイルが空・履歴が無ければ null、git が失敗すれば undefined
- 対応: —
- Given: ケース1は空の配列、ケース2は未コミットのファイル `new.ts`、ケース3は Git リポジトリでないディレクトリ
- When: それぞれ `lastTouched` を呼ぶ
- Then: ケース1・2は `null`、ケース3は `undefined`

## areas（`scripts/lib/areas.mts`）

### parseAreaLine: build-05 の書式の「領域」行から glob を読む
- 対応: US-5.5
- Given: 行 `` - **領域**: `src/billing/**`, `*.sql` ``
- When: `parseAreaLine` に渡す
- Then: `["src/billing/**", "*.sql"]` が返る。「領域」行でない行には undefined が返る

### linkedCriteria: rule・ADR・constraints の項目を領域と結び付けて集める
- 対応: US-5.5
- Given: `.claude/rules/billing.md`（`paths: ["src/billing/**"]`）、ADR `20260101-billing.md`（「領域」行 `` `src/billing/**` ``）、constraints の `## 外部決済` 項目の「領域」行
- When: `linkedCriteria(config)` を呼ぶ
- Then: `kind` が `rule` / `adr` / `constraints` の3件が返り、constraints の `title` が `外部決済`、各 `globs` が `["src/billing/**"]`

### linkedCriteria: superseded の ADR とコードブロックの中の「領域」行は読まない
- 対応: —
- Given: frontmatter `status: superseded` の ADR に「領域」行、constraints のコードブロックの中に「領域」行がある
- When: `linkedCriteria` を呼ぶ
- Then: どちらも結果に含まれない

### dormantAreas: 期間を超えて触られていない領域を休眠と判定する
- 対応: US-5.1
- Given: `dormant_days = 180`、`src/billing/pay.ts` の最終コミットが `now` の 181 日前
- When: `dormantAreas(config, ["src/billing/**"], now)` を呼ぶ
- Then: `areas[0]` が `{ glob: "src/billing/**", days: 181, dormant: true }`、`dormantDays` が `180`

### dormantAreas: ちょうど期間の日数なら休眠ではない
- 対応: US-5.1
- Given: `dormant_days = 180`、最終コミットが `now` のちょうど 180 日前
- When: `dormantAreas` を呼ぶ
- Then: `days` が `180`、`dormant` が `false`

### dormantAreas: 休眠した領域に重なる基準だけを示す
- 対応: US-5.2
- Given: 休眠した `src/billing/**`、`paths: ["src/billing/**"]` の rule と `paths: ["src/ui/**"]` の rule、constraints の項目（領域 `` `**/*.ts` ``）
- When: `dormantAreas(config, ["src/billing/**"], now)` を呼ぶ
- Then: `linked` に billing の rule と constraints の項目が入り、ui の rule は入らない

### dormantAreas: 履歴の無いパスは休眠とみなさない
- 対応: —
- Given: 追跡ファイルが1つも当たらない glob `src/newfeature/**`
- When: `dormantAreas` を呼ぶ
- Then: `lastTouched` が `null`、`days` が `null`、`dormant` が `false`

### dormantAreas: git が使えなければ日数を不明にして notices に出す
- 対応: —
- Given: Git リポジトリでないディレクトリをルートにした設定
- When: `dormantAreas(config, ["src/**"], now)` を呼ぶ
- Then: 例外にならず、`days` が `null`・`dormant` が `false`、`notices` に git を使えない旨が1件入る

## CLI: rules candidates（`scripts/commands/rules.mts`）

### rules candidates: サイクルをまたいで閾値に達した rule が移す候補に並ぶ
- 対応: US-4.2
- Given: 一時 Git リポジトリに `.claude/rules/api.md`（`paths: ["src/api/**"]`）と `src/api/x.ts`、サイクル `001-a`（closed）の `build-01/handoff.md` に `` [重] `rule:.claude/rules/api.md` `` が2行、サイクル `002-b` の `build-01/handoff.md` に `` [軽] `rule:.claude/rules/api.md` `` が1行、`[rules] hit_threshold` は既定
- When: `hikyaku rules candidates --json` を実行する
- Then: 出力に `path: ".claude/rules/api.md"`、`kind: "move"`、`hits: 3`、`heavy: 2` の候補がある

### rules candidates: 1サイクルだけでは閾値に届かない回数は並ばない
- 対応: US-4.2
- Given: 前シナリオと同じリポジトリから `002-b` の handoff.md を除いたもの（回数 2）
- When: `hikyaku rules candidates --json` を実行する
- Then: `kind: "move"` の候補が無い

### rules candidates: 一致しない rule と存在しない rule が並ぶ
- 対応: US-4.3
- Given: `.claude/rules/old.md`（`paths: ["legacy/**"]`、該当ファイルなし）と、handoff に `` [軽] `rule:.claude/rules/gone.md` `` の記録
- When: `hikyaku rules candidates` を実行する
- Then: 出力に `old.md` が一致しない rule として、`gone.md` が記録に挙がったが無い rule として並ぶ

### rules candidates: 各行に最終変更からの日数と理由が出る
- 対応: US-5.3, US-5.4, US-9.1
- Given: `.claude/rules/api.md`（`prevents: 二重課金`・`basis: 決済 API`・`importance: 高`）が移す候補で、`src/api/x.ts` を実行時刻の 400 日前の `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE` でコミット。`old.md`（一致なし）を 250 日前にコミット
- When: `hikyaku rules candidates` を実行する
- Then: api.md の行に `400` 日、`二重課金`・`決済 API`・`高` が、old.md の行に `250` 日が出る

### rules candidates: 候補を並べるだけで、ファイルを変えず終了コード 0
- 対応: US-4.4
- Given: 移す候補・一致しない rule・存在しない rule が1件ずつある一時リポジトリ（作業ツリーはクリーン）
- When: `hikyaku rules candidates` を実行する
- Then: 終了コードが 0（`rules check` なら 2 になる状況でも）、実行後の `git status --porcelain` が空で `.claude/rules/` の内容も変わらず、出力に「移す」「消す」の決定や推奨の文言が無い

## CLI: areas dormant（`scripts/commands/areas.mts`）

### areas dormant: 休眠した領域と結び付いた rule・ADR・constraints を示す
- 対応: US-5.2, US-5.5
- Given: 一時 Git リポジトリで `src/billing/pay.ts` を実行時刻の 200 日前の `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE` でコミットし、`src/ui/a.ts` を当日にコミット。billing に結び付いた rule・ADR・constraints の項目がある
- When: `hikyaku areas dormant --paths 'src/billing/**,src/ui/**' --json` を実行する
- Then: `src/billing/**` が `dormant: true`・`days: 200` で、`linked` に3種の基準（rule のパス・ADR のファイル名・constraints の見出し）が入り、`src/ui/**` は `dormant: false`

### areas dormant: 設定の期間で判定が変わる
- 対応: US-5.1
- Given: 前シナリオのリポジトリで `.hikyaku.config` に `[areas] dormant_days = 365`
- When: `hikyaku areas dormant --paths 'src/billing/**' --json` を実行する
- Then: `dormantDays` が `365`、`src/billing/**` が `dormant: false`

### areas dormant: --paths が無ければ使い方のエラー
- 対応: —
- Given: 一時リポジトリ
- When: `hikyaku areas dormant` を `--paths` なしで実行する
- Then: 終了コードが 0 以外で、`--paths` が必要である旨が出る
