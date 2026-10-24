# cleanup: 雛形の警告と旧名ファイルの後始末

雛形を生成したときの警告を確かめ、片付ける。警告は何度でも同じものが出るので、
中断から再開したときは次で見直す。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" init --root {HIKYAKU_ROOT} --dry-run
```

- [ ] v1 の除外設定（`retrospective.md` など）が `{HIKYAKU_ROOT}/.gitignore` に残っていると警告されたら、
  ユーザーに削除を提案する
  - `.gitignore` が除外するのは `.hikyaku.local`（最後に作業したサイクルを記録するローカル専用ファイル）だけ。
    包括パターンは書かない。close-cycle は別セッションで `retrospective.md` を昇格素材として読むため、
    まとめて除外すると読めなくなる
- [ ] `{HIKYAKU_ROOT}/.hikyaku.config` があると警告されたら（v2.0 の初期実装が生成していた）、
  内容をリポジトリルートの `.hikyaku.config` へ移して削除するよう案内する
  - 設定を置ける場所はリポジトリルートとサイクルディレクトリの2箇所だけで、中間層は読み込まれない
- [ ] 改名されたファイルが旧名のまま残っていないか確認する

| 旧名 | 新名 |
|---|---|
| `{HIKYAKU_ROOT}/instruction.md` | `{HIKYAKU_ROOT}/instructions.md` |

旧名が残っていれば `git mv` で改名する。中身の変換は不要で、そのまま使える。v2 以降は新しい名前しか
読まないので、旧名のまま残すと読み込まれていないことに誰も気づけない。`hikyaku validate` も残存を検出する。

- [ ] `done` を報告する。旧名のファイルが残っていれば、step が受け付けない
