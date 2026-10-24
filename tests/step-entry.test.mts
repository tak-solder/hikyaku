import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, repository, succeeds, workspace, write } from "./helpers.mts";

// ワークフローの外の入口（init / create-cycle / bp-guide）の step。手本は step.test.mts

interface Directive {
  kind: string;
  step?: string;
  read?: string;
  report?: Record<string, string>;
  note?: string;
  binds?: string[];
  progress?: { complete: number; total: number };
}

function next(directory: string, ...operands: string[]): Directive {
  const result = cli(directory, "step", "next", ...operands, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

/** step report <phase> <step> [<cycle>] ... の結果の次の1手 */
function report(directory: string, phase: string, step: string, ...extra: string[]): Directive {
  const result = cli(directory, "step", "report", phase, step, ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function events(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// init

test("step init: 雛形を生成する前は設定が無いので進めない", (t) => {
  const directory = repository(t);
  const result = cli(directory, "step", "next", "init");
  assert.equal(result.status, 1);
});

test("step init: 雛形のあとは cleanup から始まり、記録はワークスペース直下に置く", (t) => {
  const directory = workspace(t);
  const directive = next(directory, "init");
  assert.equal(directive.kind, "run");
  assert.equal(directive.step, "cleanup");
  assert.ok(directive.read !== undefined && existsSync(directive.read), String(directive.read));
  assert.match(directive.report?.["done"] ?? "", /step report init cleanup --result done$/);

  // 記録が1つも無いうちは、v2 までに初期化されたワークスペースと区別しない（SKILL.md の Step 0）
  const status = JSON.parse(succeeds(directory, "step", "status", "init", "--json"));
  assert.equal(status.current, "cleanup");
  assert.ok((status.steps as { at: string | null }[]).every((step) => step.at === null));

  assert.equal(report(directory, "init", "cleanup", "--result", "done").step, "register");
  assert.equal(events(join(directory, "docs/hikyaku/progress.jsonl"))[0]?.["step"], "cleanup");
});

test("step init: 索引の承認は document-guide.md に結びつき、書き込む前に直すと取り直しになる", (t) => {
  const directory = workspace(t);
  report(directory, "init", "cleanup", "--result", "done");
  const gate = report(directory, "init", "register", "--result", "done");
  assert.equal(gate.kind, "gate");
  assert.equal(gate.step, "link-approval");
  assert.deepEqual(gate.binds, ["document-guide.md"]);

  assert.equal(report(directory, "init", "link-approval", "--result", "approved", "--input", "OK").step, "link");
  const guide = join(directory, "docs/hikyaku/document-guide.md");
  write(directory, "docs/hikyaku/document-guide.md", `${readFileSync(guide, "utf8")}\n<!-- 追記 -->\n`);
  const again = next(directory, "init");
  assert.equal(again.step, "link-approval");
  assert.match(again.note ?? "", /承認したあとに成果物が変わっています/);

  report(directory, "init", "link-approval", "--result", "approved", "--input", "OK");
  assert.equal(report(directory, "init", "link", "--result", "done").step, "pr");
  const done = report(directory, "init", "pr", "--result", "done");
  assert.equal(done.kind, "done");
  assert.equal(JSON.parse(succeeds(directory, "step", "status", "init", "--json")).current, null);
});

// ---------------------------------------------------------------------------
// create-cycle

test("step create: サイクルを作ったあとは to-plan から始まり、記録はサイクル直下に置く", (t) => {
  const directory = workspace(t, true);
  const directive = next(directory, "create", "001");
  assert.equal(directive.step, "to-plan");
  assert.match(directive.report?.["skipped"] ?? "", /step report create to-plan 001-test --result skipped --reason/);
  assert.deepEqual(directive.progress, { complete: 0, total: 1 }, "単独の PR は、PLAN へ進まないときだけ手順に入る");

  // PLAN へ続けるなら、そのまま終わる
  assert.equal(report(directory, "create", "to-plan", "001", "--result", "done").kind, "done");
  assert.equal(events(join(directory, "docs/hikyaku/cycles/001-test/progress.jsonl"))[0]?.["step"], "to-plan");
});

test("step create: 単独で終えるなら理由付きでスキップし、PR が手順に入る", (t) => {
  const directory = workspace(t, true);
  const noReason = cli(directory, "step", "report", "create", "to-plan", "001", "--result", "skipped");
  assert.equal(noReason.status, 1);
  assert.match(noReason.stderr, /--reason/);

  const pr = report(directory, "create", "to-plan", "001", "--result", "skipped", "--reason", "単独で終える");
  assert.equal(pr.step, "pr");
  assert.deepEqual(pr.progress, { complete: 1, total: 2 });
  assert.equal(report(directory, "create", "pr", "001", "--result", "done").kind, "done");
});

test("step create: サイクルが無ければ進めない", (t) => {
  const directory = workspace(t);
  const result = cli(directory, "step", "next", "create", "001");
  assert.equal(result.status, 1);
});

// ---------------------------------------------------------------------------
// bp-guide

const GUIDE = "docs/hikyaku/bp-guide";

test("step bp-guide: 基準表が無くても進め、最初の報告で記録の置き場ができる", (t) => {
  const directory = workspace(t);
  rmSync(join(directory, GUIDE), { recursive: true });
  assert.equal(next(directory, "bp-guide").step, "start");
  assert.equal(report(directory, "bp-guide", "start", "--result", "done").step, "generate");
  assert.ok(existsSync(join(directory, GUIDE, "progress.jsonl")));

  succeeds(directory, "init", "--root", "docs/hikyaku");
  assert.equal(next(directory, "bp-guide").step, "generate", "生成したあとも、生成の報告を受け付ける");
  assert.equal(report(directory, "bp-guide", "generate", "--result", "done").step, "collect");
});

/** start と generate（基準表は init が作り済み）を終えた状態 */
function started(directory: string): void {
  report(directory, "bp-guide", "start", "--result", "done");
  assert.equal(report(directory, "bp-guide", "generate", "--result", "done").step, "collect");
}

test("step bp-guide: 変更の承認は rules.toml と cases.toml に結びつく", (t) => {
  const directory = workspace(t);
  started(directory);
  report(directory, "bp-guide", "collect", "--result", "done");
  const gate = report(directory, "bp-guide", "propose", "--result", "done");
  assert.equal(gate.kind, "gate");
  assert.equal(gate.step, "approve");
  assert.deepEqual(gate.binds, ["rules.toml", "cases.toml"]);

  const rejected = report(directory, "bp-guide", "approve", "--result", "rejected", "--input", "境界のケースを足して");
  assert.equal(rejected.step, "approve");
  assert.equal(report(directory, "bp-guide", "approve", "--result", "approved", "--input", "OK").step, "render");
  // 検証が通らずに変更案へ戻ると、承認は取り直しになる
  assert.equal(report(directory, "bp-guide", "propose", "--result", "done").step, "approve");
  report(directory, "bp-guide", "approve", "--result", "approved", "--input", "OK");
  report(directory, "bp-guide", "render", "--result", "done");
  assert.equal(report(directory, "bp-guide", "pr", "--result", "done").kind, "done");
});

test("step bp-guide: 収集や変更案を省くと、承認と再生成を行わずに PR へ進む", (t) => {
  const directory = workspace(t);
  started(directory);
  assert.equal(report(directory, "bp-guide", "collect", "--result", "skipped", "--reason", "既定値の固定だけ").step, "pr");

  const other = workspace(t);
  started(other);
  report(other, "bp-guide", "collect", "--result", "done");
  assert.equal(report(other, "bp-guide", "propose", "--result", "skipped", "--reason", "素材が無い").step, "pr");
});

test("step bp-guide: 前の回を終えていれば done が返り、step restart で新しい回になる", (t) => {
  const directory = workspace(t);
  started(directory);
  report(directory, "bp-guide", "collect", "--result", "skipped", "--reason", "既定値の固定だけ");
  report(directory, "bp-guide", "pr", "--result", "done");
  assert.equal(next(directory, "bp-guide").kind, "done");

  const restarted = cli(directory, "step", "restart", "bp-guide", "--reason", "新しい回", "--json");
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.equal((JSON.parse(restarted.stdout) as { directive: Directive }).directive.step, "start");
  const fresh = report(directory, "bp-guide", "start", "--result", "done");
  assert.equal(fresh.step, "generate");
  assert.equal(report(directory, "bp-guide", "generate", "--result", "done").step, "collect", "前の回の収集の省略は数えない");
  assert.deepEqual(next(directory, "bp-guide").progress, { complete: 2, total: 7 });
});
