# Build 13: 中身を含まないフィードバックと、document-guide のアンカー 申し送り

## 後続ビルドが前提にすること

- `DocEntry.path` はアンカーを除いたパスになった。ファイルを開く・差分を取るときは `path`、読む節を示すときは `docRef(entry)`（`scripts/lib/docs.mts`）を使う。`hikyaku context --json` の `path` は、節を指して登録した文書ではアンカー付き（`docs/concepts.md#用語`）で、ファイルを開くときは `#` より前を使う（導けるので別の欄は持たせていない。原則 7）
- validate の節の検査は、登録のアンカーを `githubAnchor` に通してから見出しのアンカーと比べる。見出しをそのまま書いても（`#用語`）、GitHub のアンカーで書いても（`#設計の原則v3`）通る
- `feedback export` は、HIKYAKU_ROOT 直下の `patches/`（サイクルに属さない patch）を読まない（AGENTS.md の規約）。サイクルの中の patch は読む
- ゲートにかかった時間は、直前の記録が同じスキルで、restart でも同じゲートの rejected でもないときだけ数える（内部スキルの作業と、差し戻しからの手直しの時間を待ちに数えないため）
- このリポジトリの AGENTS.md の索引ブロックは、document-guide.md と一致していない（glossary がアンカー付きになったため。init の索引の検査が報告する）。この PR では書き換えていない（原則 6）

## 残したこと

- コードレビュー（ラウンド 2）で採らなかった指摘（委任された判断。`questions.md`）
  - AGENTS.md の索引の再生成: AGENTS.md（conventions）を書けるのは close-cycle だけなので、「永続化すること」に回した
  - サイクルに属さない patch の upstream を読まない: その候補はファイルに残らず、patch の PR 本文にだけ載るので、読む元が無い
- コードレビュー（ラウンド 1）で採らなかった指摘
  - ファイル名に `#` を含むパスがアンカーとして読まれる: Markdown のリンクと同じく `#` を節の区切りとして読む。必要になったら `%23` でのエスケープを足す
  - `--dry-run` でも `feedback/` が追跡対象なら止まる: plan.md で決めたとおり（G8 で承認済み）。書き出しの前に除外を整えさせるため
  - 日付の整形が `quality-metrics.mts` などと重複する: 書式が違う（YYYYMMDD）ので共通化しなかった
- セキュリティレビューは起動していない（`recommended`。個人情報・認証・決済の基準に当たらない）

## 永続化すること

- `conventions` [中]: document-guide.md を変えたら `hikyaku docs link` で AGENTS.md の索引を再生成する。build-13 で glossary を `docs/concepts.md#用語` にしたので、close-cycle で再生成する（防ぐ: 索引が document-guide.md と食い違い、Hikyaku 以外のセッションが節ではなくファイル全体を読む / 立つ: 索引は renderIndexBlock の生成物で、AGENTS.md を書けるのは close-cycle だけ）

## レビューの記録

- [軽] `-`: 見出しのアンカーが setext と字下げした ATX を読まず、囲みの閉じが文字と長さを見ていなかった
- [重] `-`: feedback export が同じ日の書き出しを上書きし、ユーザーが送る前に削った内容を元に戻しうる
- [軽] `-`: ゲートにかかった時間に、内部スキルの作業と差し戻しからの手直しの時間が混ざる
- [軽] `-`: init が `.hikyaku.local/`（ディレクトリだけに当たる行）をファイルの除外とみなしていた
- [重] `-`: feedback export がサイクルに属さない patch の記録を全件走査していた（AGENTS.md の規約違反）
- [軽] `-`: 作業ツリーの外で「追跡対象」と誤って案内していた
- [軽] `-`: setext の複数行の段落と frontmatter の閉じを誤読していた
- [重] `-`: init が `.gitignore` の否定（`!feedback/`）の後ろに `feedback/` を足し、ユーザーの規則を覆していた
- [軽] `-`: 不要になった `#` の分割、導ける `file` 欄、使わない `round` の写しが残っていた
