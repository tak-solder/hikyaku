# write: 承認された内容の書き込みと検証

G10 で承認された内容だけを書く。承認されていない候補を足さない。フックはここでは書かない
（followups で別の PR にする）。

- [ ] 永続ドキュメントへ、追加・置き換え・削除を反映する
  - `repo` 管理の文書は既存の形式に合わせる。ADR の本文は書き換えない
  - 置き換えと削除は、承認された記述だけに行う。周りの記述を整理しない
- [ ] `workflow` が承認されていれば `{HIKYAKU_ROOT}/instructions.md` を更新する（無ければ新規作成する）
- [ ] rule の整理（束ねる・分ける・glob を狭める・削除）が承認されていれば反映し、確かめる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" rules check
```

  - rule は glob ごとにファイルを分け、frontmatter には `paths` だけを書く
    （書き方は `${CLAUDE_PLUGIN_ROOT}/skills/close-cycle/references/persistence.md` の「rule の書き方」）
- [ ] スキルが承認されていれば `.claude/skills/{名前}/SKILL.md` を作る
  - frontmatter に `name` と `description` を書く。`description` には、何をするスキルかと、いつ使うかを書く
    （常時読み込まれるのは `description` だけなので、ここで起動が決まる）
  - 特定のファイルを触るときだけ要る手順なら、`paths` で有効な範囲を絞る
  - 本文は手順だけを書く。経緯は書かない。長い参照は同じディレクトリの別ファイルに分ける
  - 既存の手順書（`docs/` の runbook など）が受け皿になっているリポジトリでは、スキルを作らず、
    その手順書に追記する
- [ ] `document-guide.md` を更新する（新規作成したドキュメントの管理列とパス列）
- [ ] AGENTS.md の索引を更新する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" docs link --dry-run
```

新しいドキュメントを追加した場合のみ差分が出る。承認を得てから実行する（ask: docs-link）。

- [ ] 検証する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" validate {cycle}
```
