# organize: 昇格候補の整理

抽出された候補を、昇格先ごとに整理する。

| 昇格先 | 何を昇格させるか | 主な素材 |
|---|---|---|
| overview | アーキテクチャに影響した変更。責務・境界・データフローの変化 | design-delta / handoff の「overview への影響」 |
| learnings | 再現条件が明確な落とし穴 | handoff の「踏んだ落とし穴」/ retrospective の L-N |
| constraints | 実装中に判明した新たな制約（数値で書けるもの） | handoff の「新たな制約」 |
| conventions ほか規約系 | 以後の書き方・進め方の取り決め | retrospective の `doc:` 分類 |
| `instructions.md` | このリポジトリで Hikyaku を回すときの手順・前提 | retrospective の `workflow` 分類 |
| ADR | `status: accepted` → `implemented` に更新。覆された判断は旧エントリを `superseded` にし、新エントリを起こす | design / handoff の「覆した設計判断」 |
| document-guide | このサイクルで新規作成したドキュメントの行を更新 | — |

`doc:` 分類の論理名は `document-guide.md` が正。**そこに無い論理名は昇格先にしない**
（勝手にドキュメントを作らない）。`未作成` で登録されている論理名へ昇格させる場合は、
新規作成することになるので G10 でその旨も承認を得る。

同じ提案が複数フェーズの retrospective.md に出ていたら、1件に束ねて出典を全部残す。
言われた回数は優先度そのものなので、束ねるときに落とさない。

昇格させないもの:

- `overview` にテーブル一覧・エンドポイント一覧・依存パッケージのバージョンを書かない。
  これらはコードが正で、書いた瞬間に腐り、しかも腐っていることに誰も気づけない。
  代わりに「正がどこにあるか」のポインタを書く（`スキーマの正は db/migrations/`）
- `learnings` に一般的なプログラミング知識や曖昧な注意（「気をつける」だけ）を書かない
- `learnings` に以後の取り決めを書かない（それは `conventions` か `instructions.md`）。
  `learnings` は踏んだ地雷の記録で、取り決めではない
- `constraints` に実現方法を書かない（それは ADR か overview）
- `instructions.md` にこのリポジトリに固有でないことを書かない。一般的な進め方は
  各スキルが既に持っている

`repo` 管理のドキュメントには形式を強制しない。既存形式に合わせて追記するだけで、
既存記述の削除・整理はしない。既存 ADR に status 欄が無くて実装状態が分からない
場合も、勝手に欄を足さずユーザーに提案して判断を仰ぐ（ask: adr-status）。

- [ ] 候補を昇格先ごとに整理し、昇格させないものと理由も控える
- [ ] `done` を報告する
