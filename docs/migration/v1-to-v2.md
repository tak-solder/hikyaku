# v1 → v2 移行ガイド

**進行中のサイクルがある場合は、プラグインのバージョンを v1.0.0 に固定して完走してから移行してください。** 破壊的変更が多く、途中で切り替えると再開点を検出できなくなります。

移行の中心は「ファイルを動かすこと」ではなく、**既存ドキュメントを `document-guide.md` に `repo` 管理として登録すること**です。`repo` 管理なら Hikyaku は形式に手を出さないため、`AD-N` 形式の ADR もそのまま使い続けられ、形式変換は不要です。

## 手順

```
/hikyaku:init
```

v1 構造（HIKYAKU_ROOT 直下の `planning/` や `build-01/`）を検出すると、対話しながら移行します。一律のルールで捌かないのは、v1 ユーザーの状態が多様だからです。

| 状況 | 妥当な扱い |
|---|---|
| サイクル完走済み | `cycles/001-legacy/` へアーカイブ（第一候補） |
| ビルド途中 | v1.0.0 のまま完走してから移行する |
| planning だけやって放置 | 捨ててよいことが多い |
| 複数の DOC_ROOT を運用していた | 別サイクルか別ワークスペースか要判断 |

アーカイブする場合、`planning/` `tasklist.md` `build-NN/` は `git mv` で `cycles/001-{slug}/` へ移り、`cycles.md` に `hikyaku: 1.0.0` / `status: closed` で1行が足されます。この行があることで、`planning/` があるのに `design-delta.md` が無い理由が後から分かります。

`architecture/` 配下は移動しません。`document-guide.md` に `repo` 管理として登録します。

## 対応が必要なもの

| 項目 | 内容 |
|---|---|
| Node.js | v22.18.0 以上が必要になりました。`hikyaku doctor` で確認できます |
| `doc_root` | `hikyaku_root` へリネームしてください。当面は旧キーも読みます |
| `issue_backend` | **エラーになります。** `[external] target` へ移行してください |
| `test_spec_review` | 廃止されました。G8 として常に有効です |
| ディレクトリ構造 | `planning/` `tasklist.md` `build-NN/` は `cycles/{NNN}-{slug}/` 配下へ移動します |
| `architecture/` 配下 | 移動しません。`repo` 管理として登録します |
| `retrospective.md` 等 | コミット対象になります |
| リポジトリルートの `.hikyaku.config` | 必須になりました。`hikyaku_root` はここでのみ宣言できます |
| `{HIKYAKU_ROOT}/.hikyaku.config` | 読み込まれません。**残っているとエラーになります** |
| `{HIKYAKU_ROOT}/instruction.md` | `instructions.md` へ改名してください。中身の変換は不要です |
| スキルの引数 | `{HIKYAKU_ROOT}` を渡さなくなりました。サイクルだけを渡すか、省略します |

`issue_backend` を黙って読み替えないのは、完了判定がライブ照会から `tasklist.md` の `PR` 列に変わり、挙動が変わるためです。

`instruction.md` を旧名のまま残すと読み込まれなくなりますが、黙って無視すると気づけません。`hikyaku validate` が残存を検出します。

## v1 の .gitignore

v1 は `{DOC_ROOT}/.gitignore` を生成し、`retrospective.md` などを除外していました。v2 では `.hikyaku.local` の1行だけを除外します。v1 の除外設定が残っていると警告が出るので、削除してください。

サイクル文書をまとめて除外すると、close-cycle が別セッションで `retrospective.md` を昇格素材として読めなくなります。v1 で学びがサイクルをまたいで蓄積しなかったのはこれが原因です。

## 初回サイクルのコスト

`overview` が空の状態から始まるため、**初回サイクルの architect は差分調査ができず全体調査になります**（v1 と同じコスト）。初回の close-cycle で `overview` が作られ、2周目から差分調査が効きます。設計どおりの挙動です。

## 主な変更点

破壊的変更の全一覧は [CHANGELOG.md](../../CHANGELOG.md) にあります。使い勝手に効くのは次の5点です。

CLOSE フェーズが増えました。永続ドキュメントを書けるのは close-cycle だけになり、architect と builder は読むだけになりました。builder が設計ドキュメントを直接更新していた v1 の手順は、`handoff.md` への記録に置き換わっています。

`document-guide.md` が必須になりました。永続ドキュメントの所在を宣言する唯一の場所で、存在しなければ動作しません。

`issue_backend` の抽象化が消えました。ファイルが常にマスターになり、外部システムへは冪等な片方向投影だけを行います。v1 では `github` を選ぶと `build-*/` が丸ごと `.gitignore` され、リポジトリを見てもビルドの中身が分からなくなっていました。

プロファイルが増えました。承認とレビューの量をサイクルごとに選べます。[プロファイル](../configuration/profiles.md) を参照してください。

振り返りの改善提案に行き先ができました。分類が `doc:{論理名}` / `workflow` / `記録のみ` の3つになり、close-cycle が永続ドキュメントか `instructions.md` へ反映します。v1 では分類しても適用するステップが無く、closed になったサイクルのディレクトリに沈んでいました。
