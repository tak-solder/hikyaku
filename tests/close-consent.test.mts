/**
 * G10 の同意と確認の区分（build-11）— 同意が要る変更の判定と、G10・write・conductor での扱い
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  candidateApproval,
  consentChanges,
  cycleAdrNames,
  isStatusOnlyChange,
  type Candidate,
  type DocChange,
} from "../scripts/lib/promotions.mts";
import { cli, repository, succeeds, testEnvironment, workspace, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const ADR = "docs/adr/20261101-cache-layer.md";
const ACCEPTED = "---\nstatus: accepted\n---\n\n# キャッシュ層を置く\n本文\n";
const IMPLEMENTED = "---\nstatus: implemented\n---\n\n# キャッシュ層を置く\n本文\n";

function candidate(target: string, kind: Candidate["kind"] = "doc"): Candidate {
  return { target, kind, importance: "中", written: false, text: `${target} の候補`, source: "build-01/handoff.md" };
}

// ---------------------------------------------------------------------------
// 判定の関数

test("candidateApproval: decisions・constraints 宛ては同意、それ以外は確認", () => {
  assert.equal(candidateApproval(candidate("decisions")), "consent");
  assert.equal(candidateApproval(candidate("constraints")), "consent");
  for (const target of ["overview", "conventions", "glossary"]) assert.equal(candidateApproval(candidate(target)), "confirm");
  assert.equal(candidateApproval(candidate("rule:.claude/rules/x.md", "rule")), "confirm");
});

test("isStatusOnlyChange: frontmatter の accepted → implemented だけなら true、ほかは false", () => {
  assert.equal(isStatusOnlyChange(ACCEPTED, IMPLEMENTED), true);
  assert.equal(isStatusOnlyChange(ACCEPTED, IMPLEMENTED.replace("本文", "本文を変えた")), false, "本文も変えた");
  assert.equal(isStatusOnlyChange(ACCEPTED, ACCEPTED.replace("accepted", "superseded")), false, "superseded への書き換え");
  assert.equal(isStatusOnlyChange(IMPLEMENTED, ACCEPTED), false, "逆向き");
  assert.equal(isStatusOnlyChange(ACCEPTED, ACCEPTED), false, "同一");
  const outside = "---\nid: 1\n---\n\nstatus: accepted\n";
  assert.equal(isStatusOnlyChange(outside, outside.replace("accepted", "implemented")), false, "frontmatter の外の行");
});

test("cycleAdrNames: サイクルの .md に名前が現れる ADR だけを返し、progress.jsonl だけに現れる名前は含めない", (t) => {
  const directory = workspace(t, true);
  write(directory, `${CYCLE}/design/design-delta.md`, "- ADR `20261101-cache-layer.md` に従う\n");
  write(directory, `${CYCLE}/build-01/progress.jsonl`, '{"note":"20260101-other"}\n');
  const names = cycleAdrNames(join(directory, CYCLE), ["20261101-cache-layer", "20260101-other", "20250301-old-auth"]);
  assert.deepEqual([...names], ["20261101-cache-layer"]);
});

test("consentChanges: 候補は decisions・constraints 宛てだけが同意、差分はこのサイクルの ADR の状態だけの書き換えを除いて同意", () => {
  const cycleAdrs = new Set(["20261101-cache-layer"]);
  const candidates = [candidate("decisions"), candidate("constraints"), candidate("conventions")];
  const fromCandidates = consentChanges({ candidates, changes: [], cycleAdrs });
  assert.deepEqual(fromCandidates.map((c) => [c.source, c.doc]), [["candidate", "decisions"], ["candidate", "constraints"]]);
  assert.deepEqual(consentChanges({ candidates: [candidate("overview")], changes: [], cycleAdrs }), []);

  const statusOnly: DocChange = { path: ADR, doc: "decisions", status: "M", before: ACCEPTED, after: IMPLEMENTED };
  assert.deepEqual(consentChanges({ candidates: [], changes: [statusOnly], cycleAdrs }), [], "このサイクルの ADR の状態だけ");

  const cases: [string, DocChange][] = [
    ["本文の変更", { ...statusOnly, after: IMPLEMENTED.replace("本文", "本文を変えた") }],
    ["新しい ADR", { path: "docs/adr/20261117-new-index.md", doc: "decisions", status: "A", after: IMPLEMENTED }],
    ["ADR の削除", { path: ADR, doc: "decisions", status: "D", before: ACCEPTED }],
    ["他サイクルの ADR の状態だけ", { ...statusOnly, path: "docs/adr/20250301-old-auth.md" }],
    ["constraints の状態の形の書き換え", { path: "docs/constraints.md", doc: "constraints", status: "M", before: ACCEPTED, after: IMPLEMENTED }],
  ];
  for (const [name, change] of cases) {
    const found = consentChanges({ candidates: [], changes: [change], cycleAdrs: new Set([...cycleAdrs, "constraints"]) });
    assert.equal(found.length, 1, name);
    assert.equal(found[0]?.source, "diff", name);
    assert.match(found[0]?.text ?? "", new RegExp(change.path.replace(/\./g, "\\.")), name);
  }
  const both = consentChanges({ candidates: [candidate("decisions")], changes: [cases[1]![1]], cycleAdrs });
  assert.deepEqual(both.map((c) => c.source), ["candidate", "diff"]);
});

// ---------------------------------------------------------------------------
// 一時リポジトリ

interface Directive {
  kind: string;
  step?: string;
  approval?: string;
  args?: Record<string, unknown>;
  note?: string;
}

function git(directory: string, ...args: string[]): string {
  return gitWith(directory, {}, ...args);
}

function gitWith(directory: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", env: { ...testEnvironment(), ...env } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

/** コミットする。date を渡すとその日時で（close-cycle の記録より前のコミットにするため） */
function commit(directory: string, message: string, date?: string): void {
  git(directory, "add", "-A");
  const env = date === undefined ? {} : { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
  gitWith(directory, env, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", message);
}

function next(directory: string): Directive {
  return (JSON.parse(succeeds(directory, "step", "next", "close", "001", "--json")) as { directive: Directive }).directive;
}

function report(directory: string, step: string, ...extra: string[]): Directive {
  const result = cli(directory, "step", "report", "close", step, "001", ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function events(directory: string): Record<string, unknown>[] {
  return readFileSync(join(directory, CYCLE, "progress.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

/** decisions を docs/adr/ に登録し、このサイクルの ADR（accepted）を足してコミットしたワークスペース */
function closeWorkspace(t: TestContext, profile = "standard"): string {
  const directory = repository(t);
  succeeds(directory, "init", "--root", "docs/hikyaku");
  succeeds(directory, "cycle", "new", "test", "--profile", profile);
  const guide = join(directory, "docs/hikyaku/document-guide.md");
  writeFileSync(guide, readFileSync(guide, "utf8").replace(/^\| *decisions *\|.*$/m, "| decisions | hikyaku | `docs/adr/` | ADR |"));
  write(directory, ADR, ACCEPTED);
  write(directory, `${CYCLE}/design/design-delta.md`, "# 設計差分\n\n- ADR `20261101-cache-layer.md`\n");
  // close-cycle の記録の基準は「最初の記録の1秒前までのコミット」なので、architect のコミットはそれより前にする
  commit(directory, "architect", new Date(Date.now() - 60_000).toISOString());
  return directory;
}

test("G10: 確認の候補だけなら確認、express では省けて write へ進み、ADR の状態だけの書き換えなら write が通る", (t) => {
  const directory = closeWorkspace(t, "express");
  const afterCollect = report(directory, "collect", "--result", "done");
  assert.equal(afterCollect.step, "write", "express で同意が要る変更が無ければ G10 を省く");
  assert.equal(afterCollect.args?.["promotionGate"], "skipped");
  commit(directory, "collect");

  write(directory, ADR, IMPLEMENTED);
  assert.equal(next(directory).step, "write", "このサイクルの ADR の状態だけなら G10 に戻らない");
  assert.equal(report(directory, "write", "--result", "done").step, "close");
});

test("G10: G10 を省いた回に ADR の本文を変えると G10 が同意として現在地になり、write は受け付けられない", (t) => {
  const directory = closeWorkspace(t, "express");
  report(directory, "collect", "--result", "done");
  commit(directory, "collect");

  write(directory, ADR, IMPLEMENTED.replace("本文", "本文を変えた"));
  const gate = next(directory);
  assert.deepEqual([gate.step, gate.approval], ["G10", "consent"]);
  assert.equal(gate.args?.["returned"], true);
  assert.match(String((gate.args?.["consentChanges"] as string[])[0]), /20261101-cache-layer\.md/);

  const refused = cli(directory, "step", "report", "close", "write", "001", "--result", "done");
  assert.equal(refused.status, 1);

  const approved = report(directory, "G10", "--result", "approved", "--input", "本文の変更に同意");
  assert.equal(approved.step, "write");
  assert.equal(events(directory).at(-1)?.["approval"], "consent");
  assert.equal(report(directory, "write", "--result", "done").step, "close");
});

test("G10: 新しい ADR（追跡外）を足しても同意になる", (t) => {
  const directory = closeWorkspace(t, "express");
  report(directory, "collect", "--result", "done");
  write(directory, "docs/adr/20261117-new-index.md", IMPLEMENTED);
  assert.deepEqual([next(directory).step, next(directory).approval], ["G10", "consent"]);
});

test("G10: standard で確認として承認したあとに同意が要る差分が出たら、承認を同意として取り直す", (t) => {
  const directory = closeWorkspace(t);
  const gate = report(directory, "collect", "--result", "done");
  assert.deepEqual([gate.step, gate.approval], ["G10", "confirm"]);
  assert.equal(report(directory, "G10", "--result", "approved", "--input", "OK").step, "write");
  assert.equal(events(directory).at(-1)?.["approval"], "confirm");

  write(directory, ADR, ACCEPTED.replace("accepted", "superseded"));
  const reopened = next(directory);
  assert.deepEqual([reopened.step, reopened.approval], ["G10", "consent"]);
  assert.match(reopened.note ?? "", /同意として提示し直して/);
  report(directory, "G10", "--result", "approved", "--input", "superseded に同意");
  assert.equal(next(directory).step, "write");
});

test("G10: decisions 宛ての候補があれば、express でも同意として返る", (t) => {
  const directory = closeWorkspace(t, "express");
  write(directory, `${CYCLE}/build-01/handoff.md`, "# 申し送り\n\n## 永続化すること\n\n- `decisions` [高]: ADR に再評価条件を足す\n");
  const gate = report(directory, "collect", "--result", "done");
  assert.deepEqual([gate.step, gate.approval], ["G10", "consent"]);
  assert.match(String((gate.args?.["consentChanges"] as string[])[0]), /^decisions: ADR に再評価条件を足す/);
  const json = JSON.parse(succeeds(directory, "promotions", "001", "--json"));
  assert.equal(json.candidates[0].approval, "consent");
  assert.equal(json.candidates[0].items[0].approval, "consent");
});

test("G10: 承認の種類の無い既存の記録は同意として扱い、閉じたサイクルの G10 は後の decisions の変更で戻らない", (t) => {
  const directory = closeWorkspace(t);
  report(directory, "collect", "--result", "done");
  // build-11 より前の記録（approval 欄が無い）
  const path = join(directory, CYCLE, "progress.jsonl");
  writeFileSync(path, `${readFileSync(path, "utf8")}${JSON.stringify({ at: new Date().toISOString(), skill: "close-cycle", step: "G10", result: "approved", input: "OK" })}\n`);
  write(directory, ADR, ACCEPTED.replace("本文", "本文を変えた"));
  assert.equal(next(directory).step, "write", "approval の無い承認は同意として扱う");
  assert.equal(report(directory, "write", "--result", "done").step, "close");
  succeeds(directory, "cycle", "close", "001", "--summary", "テスト");
  report(directory, "close", "--result", "done");
  commit(directory, "close");

  write(directory, "docs/adr/20261201-later.md", ACCEPTED);
  assert.equal(next(directory).step, "pr", "closed のサイクルは差分を見ない");
});

test("G10: 文書の変更を progress.jsonl より先に別のコミットにしても、同意が要る変更として数える", (t) => {
  const directory = closeWorkspace(t, "express");
  report(directory, "collect", "--result", "done");
  // collect の記録はまだコミットしない。ADR の本文の変更だけを先にコミットする
  spawnSync("sleep", ["1.1"]);
  write(directory, ADR, IMPLEMENTED.replace("本文", "本文を変えた"));
  git(directory, "add", ADR);
  git(directory, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "ADR だけ");
  commit(directory, "collect の記録");
  assert.deepEqual([next(directory).step, next(directory).approval], ["G10", "consent"]);
});

test("G10: 閉じて記録をコミットしたあとは差分を見ず、記録が未コミットのあいだに変えた decisions は数える", (t) => {
  const directory = closeWorkspace(t, "express");
  report(directory, "collect", "--result", "done");
  report(directory, "write", "--result", "done");
  succeeds(directory, "cycle", "close", "001", "--summary", "テスト");
  report(directory, "close", "--result", "done");
  commit(directory, "close");

  // 記録をコミットしたあとの decisions の変更（後続のサイクル・マージ後のベースブランチ）は数えない
  write(directory, "docs/adr/20261201-later.md", ACCEPTED);
  commit(directory, "後続のサイクル");
  assert.equal(next(directory).step, "pr");

  // pr のステップで ADR の本文を変えてコミットしても、報告で記録が未コミットになった時点で G10 に戻る
  write(directory, ADR, IMPLEMENTED.replace("本文", "pr で変えた"));
  commit(directory, "pr の前に ADR を変える");
  report(directory, "pr", "--result", "done", "--pr", "1");
  assert.deepEqual([next(directory).step, next(directory).approval], ["G10", "consent"]);
});

test("hooks: G10 を省いた回は、フックの候補があっても hooks を手順に入れない", (t) => {
  const directory = closeWorkspace(t, "express");
  write(directory, `${CYCLE}/build-01/handoff.md`, "# 申し送り\n\n## 永続化すること\n\n- `hook` [中]: .env の編集を止める\n");
  assert.equal(report(directory, "collect", "--result", "done").step, "write");
});

test("G10: decisions が対象外なら差分を見ない", (t) => {
  const directory = closeWorkspace(t, "express");
  const guide = join(directory, "docs/hikyaku/document-guide.md");
  writeFileSync(guide, readFileSync(guide, "utf8").replace(/^\| *decisions *\|.*$/m, "| decisions | 対象外 | — | 持たない |"));
  rmSync(join(directory, ADR));
  write(directory, "docs/adr/20261117-new-index.md", IMPLEMENTED);
  assert.equal(report(directory, "collect", "--result", "done").step, "write");
});

test("followups: --pr は任意で受け付け、G10 の答えと消す候補を args に載せる", (t) => {
  const directory = closeWorkspace(t);
  write(directory, ".claude/rules/legacy.md", "---\npaths: src/legacy/**\nprevents: 古い API を使う\nbasis: legacy の構成\nimportance: 中\n---\n\n古い\n");
  write(directory, ".claude/rules/kept.md", "---\npaths: src/gone/**\nimportance: 高\n---\n\n守る\n");
  commit(directory, "rules");
  report(directory, "collect", "--result", "done");
  report(directory, "G10", "--result", "approved", "--input", "legacy.md は試しに消す");
  report(directory, "write", "--result", "done");
  succeeds(directory, "cycle", "close", "001", "--summary", "テスト");
  report(directory, "close", "--result", "done");
  report(directory, "pr", "--result", "done", "--pr", "https://github.com/o/r/pull/1");
  const followups = report(directory, "publish", "--result", "done");
  assert.equal(followups.step, "followups");
  assert.equal(followups.args?.["g10Input"], "legacy.md は試しに消す");
  const text = succeeds(directory, "step", "next", "close", "001");
  assert.match(text, /ruleRemovals=\[\{"location":"\.claude\/rules\/legacy\.md"/, "テキストでも配列の中身を JSON で出す");
  assert.match(text, /--pr <基準を試しに消した PR の URL/);
  const removals = followups.args?.["ruleRemovals"] as { location: string; kinds: string[] }[];
  assert.deepEqual(removals.map((r) => [r.location, r.kinds]), [[".claude/rules/legacy.md", ["stale"]]], "重要度が高の rule は入らない");
  assert.deepEqual(followups.args?.["metricsComparison"], []);

  const bad = cli(directory, "step", "report", "close", "followups", "001", "--result", "done", "--pr", "abc");
  assert.equal(bad.status, 1);
  assert.equal(report(directory, "followups", "--result", "done", "--pr", "12").kind, "done");
  assert.equal(events(directory).at(-1)?.["pr"], "12");
});

test("followups: --pr 無しでも done を受け付ける", (t) => {
  const directory = closeWorkspace(t, "express");
  report(directory, "collect", "--result", "done");
  report(directory, "write", "--result", "done");
  succeeds(directory, "cycle", "close", "001", "--summary", "テスト");
  report(directory, "close", "--result", "done");
  report(directory, "pr", "--result", "done", "--pr", "1");
  const followups = report(directory, "publish", "--result", "done");
  assert.equal(followups.args?.["g10Input"], "", "G10 を省いた回は空");
  assert.equal(report(directory, "followups", "--result", "done").kind, "done");
});
