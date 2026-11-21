# Build 17: 同意ゲートで退けた項目の作り直しの経路 申し送り

## 後続ビルドが前提にすること

- 退けた項目の分け方は `steps/consent.mts` の `consentRejections` が唯一の正。記録した作業単位（`open.unit`）が同意ゲートの単位と同じなら作り直し（`rework` / `reworked`）、別なら前のフェーズ（`returns`）。前のフェーズの項目のうち、退けの決定より後に今回の回でその単位の手順を報告しているもの（差し戻しの再設計を経て再開した）は `resumed` に入り、案内が「もう一度差し戻さず、作り直しが済んだかを尋ねる」に変わる。`consentDecided` / `undecidedConsentItems` は変えていない
- 作り直しの判定は、今回の回（`step restart` の後）の記録で、戻り先を退けの決定より後（同じ時刻は数えない）に `done` か `skipped` で報告し直したか
- ゲートの戻り先はステップ定義の `reworks`（gate だけ。`step lint` がそのゲートより前の run かを検査する）。G3・G4・G7・G8・P1 に付けた。ゲートを足したら、承認した成果物を作る run を `reworks` に書く（省けば、それより前で最も近い run へ戻る）
- 同意ゲート（無いスキルは pr / publish）から後ろで記録した事項は、ゲートより前で最も近い run へ戻す（決定が足りないあいだは報告し直せないため）
- build-07（conductor の走りきり）: conductor の子では同意ゲートが手順に入らないので、退けの案内は pr の `accepts` の文面だけで出る。最後のビルドの子にゲートを入れるときは、`args.reworkFrom` / `returns` / `resumed` を子の blocked の本文にどう載せるかを決める
- `steps/<skill>.mts` を最初に import すると、`steps/index.mts` との循環 import で未初期化の値を読んで落ちる（このビルドの前からある）。テストは `ledger.mts` を先に import する。`consentStep` の id は、consent.mts が先に読まれたときのためにリテラルで書いている
- このビルドは、実行中のプラグイン（インストール済みの 3.0.0）に ledger コマンドと同意ゲートが無いので、従来の手順で進めた。リポジトリの CLI は権限で直接実行できず、`conductor lint`・`step lint` は `npm test` の中で確かめた

## 残したこと

（インストール済みの 3.0.0 に `ledger open` が無く、リポジトリの CLI も権限で実行できないので、未決事項の記録に代えてここに書く）

- 確度: 要確認 — 前のフェーズで記録した同意の項目（planner や別のビルドで記録した `merge@build-NN` を含む）を退けると、builder はどれも return.md で architect へ差し戻す。architect の再設計では決め直せない判断かもしれない（コードレビュー1・2回目の指摘）。issue.md・design-delta 3節・ADR deferred-consent が定めた経路なので採らず、監督が最後の PR でユーザーに示す（questions.md の review-findings）
- コードレビューで採らなかった指摘（監督の判断。questions.md の review-findings）
  - consent.mts から `steps/index.mts` を import して循環 import になる: 循環は `ledger.mts` 経由でこのビルドの前からある。consent.mts を先に読んでも落ちないように対処した
  - 戻り先の判定が `isOn` を何度も評価する（性能）: 1回の判定の中ではキャッシュ済みで、退けた項目があるときだけ動く。振る舞いは変わらない
- security_review は起動しなかった（`recommended`。個人情報・認証認可・決済のどれにも当たらない）

## レビューの記録

- [重] `-`: pr・publish で記録した事項の戻り先が pr になり、同意ゲートが承認されるまで報告し直せず止まり続ける
- [中] `-`: build-manager と retrospective が同じステップ ID（write）を持ち、内部スキルの見分けを取り違える
- [中] `-`: step restart より前の報告し直しを作り直しに数える
- [中] `-`: return-draft がその単位の同意ゲートの項目でないものを受け付ける
- [軽] `-`: ゲートの戻り先の表がステップ定義と別の場所にあり、名前を変えたときに黙って古くなる
- [中] `-`: skippable な戻り先を skipped で終えた回を作り直しに数えない
- [中] `-`: 同意ゲートの無いスキル（planner・close-cycle）で pr で記録した事項の戻り先が pr になる
- [中] `-`: 差し戻しの再設計の前と後を見分けず、もう一度差し戻させる
- [軽] `-`: consent.md の resolved の問いに ask タグが無い
- [軽] `-`: return-draft の --items の重複

## 永続化すること

- `decisions` [高]: ADR 20261116-deferred-consent に、退けの作り直しを実装済みの現実として足す。同じ作業単位の事項は `args.reworkFrom`（ゲートの戻り先はステップ定義の `reworks`、内部スキルのステップは呼ぶ call、同意ゲートより後ろはゲートの前の run）を報告し直せば `resolved` の前でも承認と PR を受け付け、前のフェーズの事項は `resolved` まで受け付けない（builder は `ledger return-draft` の下書きで architect へ差し戻し、再開後は `args.resumed` で resolved を尋ねる）。どちらも `resolved` まで未解決の退けに出続ける（build-07 の結果に合わせて書く）
- `conventions` [中]: 「スクリプト」に、ゲートを足したら、そのゲートが承認する成果物を作る run を `reworks` に書くことを足す（省くと同意ゲートで退けたときにそれより前で最も近い run へ戻り、作り直しが広すぎるか狭すぎる。`step lint` は書いた値が前の run かだけを検査し、書き忘れは検出しない）（防ぐ: 退けの戻り先の取り違え / 立つ: steps/consent.mts の reworkStepOf / 重要度: 中）
- `conventions` [中]: 「スクリプト」に、`scripts/lib/steps/<skill>.mts` を最初に import するモジュール（テストを含む）は `steps/index.mts` との循環 import で未初期化の値を読んで落ちるので、`ledger.mts` か `steps/index.mts` を先に import することを足す（防ぐ: ReferenceError（TDZ）でテストが読み込めない / 立つ: ledger.mts → steps/index.mts → steps/<skill>.mts → consent.mts → ledger.mts の循環 / 重要度: 中）
