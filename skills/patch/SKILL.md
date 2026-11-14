---
name: patch
description: "Hikyaku の小さな変更: サイクルを作らずに、バグ修正・軽い仕様変更・使い勝手の改善を、依頼のすり合わせから実装・検証・コードレビュー・PR まで1セッションで進める。QA のフィードバックを複数件まとめて受け取れる。明示的に起動したときだけ動く。"
user-invocable: true
disable-model-invocation: true
argument-hint: "[--cycle {cycle}] {依頼}"
---

# Hikyaku Patch

サイクル（PLAN → ARCHITECT → BUILD → CLOSE）を作らずに、小さな変更を1セッションで PR まで進める。

```
/hikyaku:patch 一覧の並び順を変更したい
/hikyaku:patch --cycle 002-billing この QA の FB をまとめて対応して
```

1セッションで進めることは、対話や確認を省くことではない。現状を確かめ、期待する挙動と対応範囲を
ユーザーと合意してから作る。

## 原則

- **記録は PR に集める。** 依頼・合意した挙動・検証結果は PR の本文に書く。plan.md や issue.md のような
  作業管理の文書は作らない。手順の記録（progress.jsonl）だけを `patches/{YYYYMM}/{slug}/` に置く
- **マージした時点で本番データを壊さない。** 安全でない分割の緩和は patch には無い。既存機能と
  既存データが壊れない形でしか作らない
- **大きければ patch で進めない。** 予測ピーク・データの形の変更・設計判断・要件の不在・検証できなさの
  どれかに当たれば、通常のサイクルへ引き継ぐかをユーザーに尋ねる（fit）
- **実装で得た知見は builder と同じ基準で片づける。** 基準は
  `${CLAUDE_PLUGIN_ROOT}/skills/close-cycle/references/persistence.md`（[persistence.md](../close-cycle/references/persistence.md)）。
  機械で防げるものとパス指定の rule は、この PR の実装に含める
- **永続ドキュメントの扱いは、サイクルに属すかで決まる。**

| patch | PR の向き先 | 永続ドキュメント（overview / decisions / constraints / conventions / glossary）・`instructions.md`・スキル |
|---|---|---|
| サイクルに属さない | `base_branch` | P2 で承認を得て、**この PR で直す**。コードと一緒にマージされるので、マージ時点で as-is が保たれる |
| 進行中のサイクルに属す（統合ブランチ宛て、またはマージ後・CLOSE 前） | 統合ブランチ（未マージの conductor ブランチ）か `base_branch` | **書かない。** `handoff.md` の「永続化すること」に残し、そのサイクルの close-cycle が昇格させる |

閉じたサイクルの後の変更は、サイクルに属さない patch として扱う（閉じたサイクルは再開しない）。

## 作業ステップ

コマンドの `{cycle}` は、サイクルに属す patch のときだけ付ける。属さないときは省く。

### Step 0: 対象とブランチ

- [ ] 前提を確かめる

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" config --no-cycle --json
```

未初期化（`.hikyaku.config` か `document-guide.md` が無い）なら `/hikyaku:init` を案内して終了する。

- [ ] 関連するサイクルを決める
  - `$ARGUMENTS` に `--cycle {cycle}` があればそのサイクルに属す
  - 無ければ推測しない。依頼が進行中のサイクルの QA（統合 PR のマージ前、または全ビルドのマージ後・
    CLOSE 前）だと読める場合だけ、`cycle list --active` の候補を添えて、サイクルに属すかを尋ねる
- [ ] 依頼の内容から slug（英小文字・数字・ハイフン。例: `list-sort-order`）を決め、対象を解決する

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" patch resolve {slug} [--cycle {cycle}] --json
```

  - `resume: true` なら、現在のブランチの patch の再開。slug は無視される。属すサイクルは記録の場所が正で、
    `--cycle` を渡さなければ記録から決まる（渡して食い違えばエラー）
  - `recordMissing: true` なら、記録を始める前に中断している。サイクルに属すかは記録から分からないので、
    推測せずユーザーに確かめ、属すなら `--cycle {cycle}` を付けて解決し直す
  - `conflict` があれば別の slug で解決し直す。`remoteUnavailable` があれば、origin のブランチとの重複を
    確かめられなかったことを伝える
  - `pendingBuilds` が空でなければ、PR 列が空のビルドが残っていることを伝え、patch で進めるかを確かめる。
    残りのビルドで扱うべき内容なら `/hikyaku:builder {cycle}` を案内して終える
  - 出力の `phase`（`patch-YYYYMM-slug`）を以降の `{phase}` に使う

- [ ] ブランチを決める

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" branch verify {phase} {cycle} --json
```

| 状況 | 対応 |
|---|---|
| `ok: true` | そのまま続ける |
| `ok: false` かつ `onBaseBranch: true`（切る元の `startPoint` に居る） | `expected` の名前でブランチを作成して続ける（`git switch -c {expected} {startPointRef}`） |
| `ok: false` かつ `onBaseBranch` が `false` / `null` | ユーザーに尋ねる（下記） |

3つ目は、現在のブランチが実行環境に割り当てられたものだと分かっていても、**自分で決めずに
必ず尋ねる。** 次の3つを、どれが妥当かの示唆を添えずに提示する。

1. Hikyaku の規則に従う — `startPoint` から `expected` の名前でブランチを作成する（`git switch -c {expected} {startPointRef}`。
   `startPointRef` は追跡参照しか無いときに `origin/...` になる。現在の HEAD から切らない）
2. 現在のブランチで作業する
3. 別のブランチを指定する

2 か 3 を選んだら、PR の向き先の導出（統合ブランチの検出）と、Stop フックでの手順の引き止めが
効かなくなることを伝える（どちらもブランチ名から導出しているため）。

- [ ] セッション名を設定する（設定する手段が無い環境と、「変更しません」と返った場合はスキップする）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" session title {phase} {cycle} --build-title "{依頼の要約}"
```

→ Step 1 へ。

### Step 1 以降: step に従って進める

ここから先の手順（記録の開始 → 調査 → 方針 → 判定 → 合意 → Draft PR → 実装 → 検証 → レビュー →
知見の仕分け →（永続ドキュメントの承認と書き込み）→ 公開）は、`step next` が1手ずつ返す。
**手順を自分で組み立てない。**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" step next {phase} {cycle}
```

| 種類 | すること |
|---|---|
| `run` | 「指示」のファイルを読み、そのとおりに行う。終えたら `done` を報告する |
| `gate` | 「指示」のファイルを読み、ユーザーに提示して承認を求める。承認されたら `approved`、フィードバックなら `rejected` を報告する。どちらも `--input` にユーザーの答えを添える。`rejected` のあとは答えを反映し、`step next` に従って提示し直す |
| `done` | 手順をすべて終えた。下の「完了の案内」へ |
| `stop` | メッセージをユーザーに伝えて終了する |

- `step report` は記録したあと、次の1手を返す。それに従って続ける
- 成果物や完了の条件、報告に添える値（`--peak` / `--pr`）は CLI が確かめ、足りなければ報告を
  受け付けない。メッセージに従って直す
- `skipped` は、指示ファイルがスキップを指示する場合だけ。理由を `--reason` に書く
- 合意の範囲を変えることになったら（実装中に依頼が広がった、レビューで方針が変わった）、`scope` を
  `done` で報告し直す。そこから後ろはやり直しになり、P1 の合意も取り直す
- 報告したら、progress.jsonl（`patch resolve` の `unitDirectory`）をコミット & push する。
  指示ファイルにコミット・push の時機の定めがあれば（implement / verify / review）、そちらに従う
- 再開したとき、前のステップで会話の中に作った成果（方針の案・指摘の統合など）が手元に無ければ、
  PR の本文と差分から復元する。復元できなければ、そのステップを `done` で報告し直してやり直す
- 迷ったら `step next` を呼び直す。同じ状態なら同じ1手が返る

### 完了の案内

```
patch {phase} の PR を公開しました: {PR の URL}

（サイクルに属す場合）
永続化することは {unitDirectory}/handoff.md に残しました。{cycle} の close-cycle が昇格させます。
```

「確度: 要確認」の懸念、意図的に残したこと、通常のサイクルへ引き継いだ項目があれば、一緒に伝える。

## PR レビュー指摘への対応

PR を公開したあとに指摘への対応を頼まれたら、patch のブランチで次を行う。手順の記録は使わない
（step は `done` を返す）。

- [ ] PR の本文（合意した挙動）とレビューコメントを読み、指摘が合意の範囲内かを判断する。範囲を
  広げる指摘は、ユーザーに確かめてから扱う（広げるなら本文の合意を更新する）
- [ ] 修正し、`steps/verify.md` と同じ検証を通す
- [ ] 永続ドキュメントに効く変更なら、サイクルに属さない patch は直す内容を示して承認を得てから、
  この PR で直す。サイクルに属す patch は `handoff.md` の「永続化すること」に追記する
- [ ] PR の本文の検証結果を更新し、まとめてコミット & push する
