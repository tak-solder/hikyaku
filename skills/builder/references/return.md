# architect への差し戻し（設計の前提が崩れたとき）

設計（design-delta.md / ADR / issue.md）どおりに作ると要件（user-stories.md の受け入れ基準）を
満たせない、あるいは設計が前提にしている事実が実際のコードと食い違っていて設計の判断が
変わる、と分かった場合の手順。issue.md のスコープどおりに作るとマージ時点で本番データの安全を
保てない（「マージ時点で残る危険」に書かれていない危険が残る）と分かった場合も、これに従う。ビルドの分割や追加で済むスコープの問題は上の「ビルド管理」で扱う。

- [ ] **自分で設計を変えずに、ユーザーに提示して方針を確認する（ask: design-conflict）。** 次の選択肢を、何と何が
  矛盾しているかの説明とともに示す
  1. 設計に合わせる（要件のほうを改める）
  2. 要件に合わせて、このビルドの中で設計を改める
  3. architect に差し戻す
- [ ] 確認のやりとりは `cycles/{cycle}/build-{NN}/questions.md` に残す
- [ ] 3 を選んだ場合、`cycles/{cycle}/return.md` を書く（サイクル直下。テンプレートは
  [templates.md](templates.md)。1行目の見出しの書式を変えない）
- [ ] コミット & push する
- [ ] `/hikyaku:architect {cycle} build-{NN}` を案内して終了する

差し戻すときは、handoff.md・retrospective・PR・`tasklist done` のどれも行わない。
handoff.md はビルドの完了の印として読まれ、`tasklist done` は完了の記録そのものだからだ。

再設計はこのビルドのブランチ上で行われる。 architect は別のブランチを切らず、設計の変更は
このビルドの PR に入る。積んでいる場合も連鎖が一直線のまま保てる。architect は再設計の最後に
`return.md` と、古い設計の上で書かれた plan.md / test-spec.md を削除する。そのあと builder を
起動し直せば、`cycle status` が plan.md からの再開を返すので、Step 3 からやり直す。

`return.md` を他のブランチやセッションから検出する仕組みは無い。差し戻しに気づくのは、
差し戻しを受けたユーザーと、このブランチで動くスキルだけでよい。
