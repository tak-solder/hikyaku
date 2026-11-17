# ビルド一覧 — 001-v3-core-concepts

ビルドの完了判定は `PR` 列が非空かどうかで行います。
`PR` 列の更新は当該ビルドの PR に同梱されるため、デフォルトブランチ上で
`PR` 列が埋まっていること自体がマージ済みを意味します。

依存関係のあるビルドは、先行ビルドがデフォルトブランチにマージ済みであることが必須です。
依存関係がないビルドは並行実行できます。

| buildID | title                                                           | 予測ピーク | dependencies                                              | PR                                                     |
| ------- | --------------------------------------------------------------- | ---------- | --------------------------------------------------------- | ------------------------------------------------------ |
| 1       | 承認の種類の基盤（エンジン・G1・conductor の同意）              | 360k       | —                                                         | [#109](https://github.com/tak-solder/hikyaku/pull/109) |
| 2       | アプリケーションの状況の宣言と、AI に任せてよい害の上限の計算   | 420k       | 1                                                         | [#110](https://github.com/tak-solder/hikyaku/pull/110) |
| 3       | 未決事項と決定の記録（ledger の中核）                           | 355k       | —                                                         | [#111](https://github.com/tak-solder/hikyaku/pull/111) |
| 4       | 異議と、各フェーズが未決事項を記録する手順                      | 365k       | 1, 3                                                      | [#112](https://github.com/tak-solder/hikyaku/pull/112) |
| 5       | 宣言の変更の見直し・記録のテンプレート・ポインタの検査          | 330k       | 2, 3                                                      | [#113](https://github.com/tak-solder/hikyaku/pull/113) |
| 6       | 事後同意（PR を作る直前の同意ゲート）                           | 435k       | 2, 4, 9, 15                                               | [#121](https://github.com/tak-solder/hikyaku/pull/121) |
| 7       | conductor の走りきりと、監督は安全側にだけ倒すこと              | 435k       | 6, 9, 16, 17, 18                                          | —                                                      |
| 8       | 差分の事実と、合意との突き合わせ（agreement-review）            | 360k       | —                                                         | [#114](https://github.com/tak-solder/hikyaku/pull/114) |
| 9       | 行き詰まりの報告の検査と、gh が使えないときの扱い               | 305k       | —                                                         | [#115](https://github.com/tak-solder/hikyaku/pull/115) |
| 10      | 知見の置き場の「なくす」と、rule を移すきっかけ・領域の開発頻度 | 345k       | 5                                                         | [#116](https://github.com/tak-solder/hikyaku/pull/116) |
| 11      | G10 の同意と確認の区分、基準を消す経路と指標の比較              | 340k       | 1, 3, 10                                                  | [#117](https://github.com/tak-solder/hikyaku/pull/117) |
| 12      | G4 と G8 の提示（gate brief）                                   | 280k       | 2, 15                                                     | [#122](https://github.com/tak-solder/hikyaku/pull/122) |
| 13      | 中身を含まないフィードバックと、document-guide のアンカー       | 295k       | —                                                         | [#118](https://github.com/tak-solder/hikyaku/pull/118) |
| 14      | 操作する人を「ユーザー」と書く用語の統一                        | 275k       | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18 | —                                                      |
| 15      | G3・G4 を宣言の上限で同意にする（害とパスの申告と裏取り）       | 350k       | 2                                                         | [#119](https://github.com/tak-solder/hikyaku/pull/119) |
| 16      | 事後同意の有効の判定と、上限を超える受け入れの積み上げ          | 435k       | 2, 6, 12, 15                                              | [#123](https://github.com/tak-solder/hikyaku/pull/123) |
| 17      | 同意ゲートで退けた項目の作り直しの経路                          | 320k       | 6, 9                                                      | [#124](https://github.com/tak-solder/hikyaku/pull/124) |
| 18      | 上限を超える異議と、事後同意の同意ゲートの範囲                  | 395k       | 16                                                        | [#125](https://github.com/tak-solder/hikyaku/pull/125) |

## 依存グラフ

```mermaid
graph TD
  b01["build-01: 承認の種類の基盤（エンジン・G1・conductor の同意）"]
  b02["build-02: アプリケーションの状況の宣言と、AI に任せてよい害の上限の計算"]
  b03["build-03: 未決事項と決定の記録（ledger の中核）"]
  b04["build-04: 異議と、各フェーズが未決事項を記録する手順"]
  b05["build-05: 宣言の変更の見直し・記録のテンプレート・ポインタの検査"]
  b06["build-06: 事後同意（PR を作る直前の同意ゲート）"]
  b07["build-07: conductor の走りきりと、監督は安全側にだけ倒すこと"]
  b08["build-08: 差分の事実と、合意との突き合わせ（agreement-review）"]
  b09["build-09: 行き詰まりの報告の検査と、gh が使えないときの扱い"]
  b10["build-10: 知見の置き場の「なくす」と、rule を移すきっかけ・領域の開発頻度"]
  b11["build-11: G10 の同意と確認の区分、基準を消す経路と指標の比較"]
  b12["build-12: G4 と G8 の提示（gate brief）"]
  b13["build-13: 中身を含まないフィードバックと、document-guide のアンカー"]
  b14["build-14: 操作する人を「ユーザー」と書く用語の統一"]
  b15["build-15: G3・G4 を宣言の上限で同意にする（害とパスの申告と裏取り）"]
  b16["build-16: 事後同意の有効の判定と、上限を超える受け入れの積み上げ"]
  b17["build-17: 同意ゲートで退けた項目の作り直しの経路"]
  b18["build-18: 上限を超える異議と、事後同意の同意ゲートの範囲"]
  b01 --> b02
  b01 --> b04
  b03 --> b04
  b02 --> b05
  b03 --> b05
  b04 --> b06
  b09 --> b06
  b15 --> b06
  b17 --> b07
  b18 --> b07
  b05 --> b10
  b10 --> b11
  b15 --> b12
  b07 -.-> b14
  b08 --> b14
  b11 --> b14
  b13 --> b14
  b02 --> b15
  b06 --> b16
  b12 --> b16
  b06 --> b17
  b16 --> b18
  classDef merged fill:#fbefff,stroke:#8250df,color:#6639ba
  classDef ready fill:#dafbe1,stroke:#1a7f37,color:#116329
  classDef blocked fill:#f6f8fa,stroke:#8c959f,color:#57606a
  class b01,b02,b03,b04,b05,b06,b08,b09,b10,b11,b12,b13,b15,b16,b17,b18 merged
  class b07 ready
  class b14 blocked
  linkStyle 13 stroke:#8c959f,stroke-dasharray:5 5
```

紫: 完了（merged） / 緑: 着手可能（ready） / グレー: 待機中（blocked）。点線は先行ビルドが未完了の依存
