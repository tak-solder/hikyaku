import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ProgressEvent } from "../scripts/lib/progress.mts";
import { currentRound, evaluate, type SkillSteps, type StepContext } from "../scripts/lib/steps/engine.mts";
import { cli, cliWith, succeeds, temporaryDirectory, workspace, write } from "./helpers.mts";

const BUILD = "docs/hikyaku/cycles/001-test/build-01";

/** サイクル 001 にビルド 1 を登録し、issue.md まで置いた状態 */
function built(t: TestContext): string {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--bp", "3");
  write(directory, `${BUILD}/issue.md`);
  return directory;
}

/** ルートの設定に、テーブルより前の最上位のキーを足す */
function configure(directory: string, line: string): void {
  const path = join(directory, ".hikyaku.config");
  writeFileSync(path, `${line}\n${readFileSync(path, "utf8")}`);
}

interface Directive {
  kind: string;
  step?: string;
  read?: string;
  report?: Record<string, string>;
  note?: string;
  revise?: string;
  binds?: string[];
  call?: string;
  context?: { tokens: number | null; budget: number; over: boolean; unavailable: string | null };
  overruns?: { checkpoint: string; tokens: number }[];
  message?: string;
}

function next(directory: string, env: NodeJS.ProcessEnv = {}): Directive {
  const result = cliWith(directory, env, "step", "next", "build-01", "001", "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function report(directory: string, step: string, ...extra: string[]): Directive {
  return reportWith(directory, {}, step, ...extra);
}

function reportWith(directory: string, env: NodeJS.ProcessEnv, step: string, ...extra: string[]): Directive {
  const result = cliWith(directory, env, "step", "report", "build-01", step, "001", ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function events(directory: string): Record<string, unknown>[] {
  const path = join(directory, BUILD, "progress.jsonl");
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** G8 の手前まで進める（standard: plan → plan-review → test-spec → test-spec-review） */
function upToG8(directory: string): void {
  write(directory, `${BUILD}/plan.md`, "# plan\n");
  report(directory, "plan", "--result", "done", "--bp", "3");
  report(directory, "plan-review", "--result", "done");
  write(directory, `${BUILD}/test-spec.md`, "# test-spec\n");
  report(directory, "test-spec", "--result", "done");
  report(directory, "test-spec-review", "--result", "done");
}

test("step next: 最初の1手は plan で、指示ファイルと報告のコマンドが返る", (t) => {
  const directory = built(t);
  const directive = next(directory);
  assert.equal(directive.kind, "run");
  assert.equal(directive.step, "plan");
  assert.ok(directive.read !== undefined && existsSync(directive.read), String(directive.read));
  assert.match(directive.report?.["done"] ?? "", /step report build-01 plan 001-test --result done/);
  assert.equal(directive.report?.["skipped"], undefined, "plan はスキップできない");
});

test("step report: 成果物が無ければ done を受け付けず、記録もしない", (t) => {
  const directory = built(t);
  const result = cli(directory, "step", "report", "build-01", "plan", "001", "--result", "done");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /成果物がまだありません/);
  assert.equal(existsSync(join(directory, BUILD, "progress.jsonl")), false);
});

test("step report: 記録して次の1手を返す。--dry-run では書かない", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  const dry = JSON.parse(succeeds(directory, "step", "report", "build-01", "plan", "001", "--result", "done", "--dry-run", "--json"));
  assert.equal(dry.dryRun, true);
  assert.equal(existsSync(join(directory, BUILD, "progress.jsonl")), false);

  const directive = report(directory, "plan", "--result", "done", "--bp", "3");
  assert.equal(directive.step, "plan-review");
  const [event] = events(directory);
  assert.equal(event?.["step"], "plan");
  assert.equal(event?.["result"], "done");
  assert.equal(event?.["bp"], 3);
  assert.equal(typeof event?.["hikyaku"], "string");
  assert.match(String(event?.["contextUnavailable"]), /CLAUDE_CODE_SESSION_ID/);
});

test("step report: 現在地以外のステップと、スキップできないステップは受け付けない", (t) => {
  const directory = built(t);
  const ahead = cli(directory, "step", "report", "build-01", "verify", "001", "--result", "done");
  assert.equal(ahead.status, 1);
  assert.match(ahead.stderr, /現在地のステップ（plan）か/);

  const skip = cli(directory, "step", "report", "build-01", "plan", "001", "--result", "skipped", "--reason", "小さいので");
  assert.equal(skip.status, 1);
  assert.match(skip.stderr, /スキップできません/);
});

test("step: 設定で無効なステップは返らない（plan_review = false）", (t) => {
  const directory = built(t);
  configure(directory, "plan_review = false");
  write(directory, `${BUILD}/plan.md`);
  assert.equal(report(directory, "plan", "--result", "done").step, "test-spec");
  const off = cli(directory, "step", "report", "build-01", "plan-review", "001", "--result", "done");
  assert.equal(off.status, 1);
  assert.match(off.stderr, /行わないステップ/);
});

test("step: test-spec のスキップは理由が必須で、スキップすると test-spec-review も行わない", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(directory, "plan", "--result", "done", "--bp", "2");
  report(directory, "plan-review", "--result", "done");
  const noReason = cli(directory, "step", "report", "build-01", "test-spec", "001", "--result", "skipped");
  assert.equal(noReason.status, 1);
  assert.match(noReason.stderr, /--reason/);
  const directive = report(directory, "test-spec", "--result", "skipped", "--reason", "ドキュメントのみ");
  assert.equal(directive.kind, "gate");
  assert.equal(directive.step, "G8");
  assert.deepEqual(directive.binds, ["plan.md"]);
});

test("step: 再算出した BP が bp_max − 2 以上なら build-manager を呼ぶ", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(directory, "plan", "--result", "done", "--bp", "5");
  const directive = report(directory, "plan-review", "--result", "done", "--bp", "6");
  assert.equal(directive.kind, "call");
  assert.equal(directive.step, "split");
  assert.equal(directive.call, "build-manager");
  assert.equal(report(directory, "split", "--result", "done").step, "test-spec");
});

test("step: G8 の承認はハッシュに結びつき、実装前に plan.md が変わると取り直しになる", (t) => {
  const directory = built(t);
  upToG8(directory);
  const rejected = cli(directory, "step", "report", "build-01", "G8", "001", "--result", "rejected");
  assert.equal(rejected.status, 1, "差し戻しには答えが要る");

  const revise = report(directory, "G8", "--result", "rejected", "--input", "異常系を足して");
  assert.equal(revise.step, "G8");
  assert.equal(revise.revise, "異常系を足して");

  const approved = report(directory, "G8", "--result", "approved", "--input", "OK");
  assert.equal(approved.step, "implement");
  assert.deepEqual(Object.keys(events(directory).at(-1)?.["hashes"] as object), ["plan.md", "test-spec.md"]);

  write(directory, `${BUILD}/plan.md`, "# plan（スコープ変更）\n");
  const again = next(directory);
  assert.equal(again.step, "G8");
  assert.match(again.note ?? "", /承認したあとに成果物が変わっています/);

  report(directory, "G8", "--result", "approved", "--input", "OK");
  report(directory, "implement", "--result", "done");
  // 実装が進んだあと（PR のレビュー対応など）の修正では巻き戻らない
  write(directory, `${BUILD}/plan.md`, "# plan（レビュー対応）\n");
  assert.equal(next(directory).step, "verify");
});

test("step: 前のステップをやり直すと、後ろのステップもやり直しになる", (t) => {
  const directory = built(t);
  upToG8(directory);
  report(directory, "G8", "--result", "approved");
  // 成果物が消えれば、記録があってもそのステップからやり直す
  rmSync(join(directory, BUILD, "test-spec.md"));
  const directive = next(directory);
  assert.equal(directive.step, "test-spec");
  assert.match(directive.note ?? "", /成果物がありません/);
  write(directory, `${BUILD}/test-spec.md`, "# test-spec v2\n");
  report(directory, "test-spec", "--result", "done");
  assert.equal(next(directory).step, "test-spec-review", "古い test-spec-review の完了は数えない");

  // 差し戻しで plan.md / test-spec.md が消され、作り直された
  rmSync(join(directory, BUILD, "plan.md"));
  rmSync(join(directory, BUILD, "test-spec.md"));
  assert.equal(next(directory).step, "plan");
  write(directory, `${BUILD}/plan.md`, "# plan v2\n");
  report(directory, "plan", "--result", "done");
  assert.equal(next(directory).step, "plan-review", "古い plan-review の完了は数えない");
});

test("step: 後ろのステップの成果物があるのに記録が無ければ止まる", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/handoff.md`);
  const directive = next(directory);
  assert.equal(directive.kind, "stop");
  assert.match(directive.message ?? "", /進捗の記録が欠けています/);
  assert.match(directive.message ?? "", /handoff/);
});

test("step: v2 で作成したサイクルは扱わない", (t) => {
  const directory = built(t);
  const path = join(directory, "docs/hikyaku/cycles.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(/\| \d+\.\d+\.\d+ +\|/, "| 2.9.2 |"));
  const directive = next(directory);
  assert.equal(directive.kind, "stop");
  assert.match(directive.message ?? "", /v2\.9\.2 で作成されています/);
  write(directory, `${BUILD}/plan.md`);
  const result = cli(directory, "step", "report", "build-01", "plan", "001", "--result", "done");
  assert.equal(result.status, 1);
});

test("step: 差し戻し中（return.md）なら止まる", (t) => {
  const directory = built(t);
  write(directory, "docs/hikyaku/cycles/001-test/return.md", "# 差し戻し: build-01\n");
  const directive = next(directory);
  assert.equal(directive.kind, "stop");
  assert.match(directive.message ?? "", /\/hikyaku:architect 001-test build-01/);
});

test("step: PR 列が埋まるまで pr は完了にならず、最後まで進むと done", (t) => {
  const directory = built(t);
  configure(directory, 'retrospective = "skip"');
  upToG8(directory);
  report(directory, "G8", "--result", "approved");
  report(directory, "implement", "--result", "done");
  report(directory, "verify", "--result", "done");
  report(directory, "review", "--result", "done");
  write(directory, `${BUILD}/handoff.md`);
  report(directory, "handoff", "--result", "done");
  const early = cli(directory, "step", "report", "build-01", "pr", "001", "--result", "done");
  assert.equal(early.status, 1);
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", "https://github.com/o/r/pull/1");
  assert.equal(report(directory, "pr", "--result", "done").kind, "done");
});

test("step: 区切りでは現在のセッションのコンテキストを目安と比べ、報告に記録する", (t) => {
  const directory = built(t);
  upToG8(directory);
  const home = temporaryDirectory(t);
  const transcript = join(home, "projects", "-repo", "s-1.jsonl");
  const line = (id: string, context: number) => JSON.stringify({
    type: "assistant", sessionId: "s-1", cwd: "/repo", isSidechain: false, timestamp: "2026-10-23T00:00:00Z",
    message: { id, model: "claude-opus-5-5", usage: { input_tokens: context, output_tokens: 10 } },
  });
  write(home, "projects/-repo/s-1.jsonl", `${line("a", 120_000)}\n${line("b", 320_000)}\n`);
  assert.ok(existsSync(transcript));
  const env = { CLAUDE_CONFIG_DIR: home, CLAUDE_CODE_SESSION_ID: "s-1" };

  const gate = next(directory, env);
  assert.equal(gate.step, "G8");
  assert.equal(gate.context?.tokens, 320_000);
  assert.equal(gate.context?.budget, 250_000);
  assert.equal(gate.context?.over, true);

  const implement = reportWith(directory, env, "G8", "--result", "approved", "--input", "OK");
  assert.equal(implement.step, "implement");
  assert.equal(implement.context?.budget, 300_000);
  const last = events(directory).at(-1);
  assert.equal(last?.["context"], 320_000);
  assert.equal(last?.["session"], "s-1");

  reportWith(directory, env, "implement", "--result", "done");
  const review = reportWith(directory, env, "verify", "--result", "done");
  assert.equal(review.step, "review");
  assert.deepEqual(review.overruns?.map((entry) => entry.checkpoint), ["approval", "implement"]);
});

test("step: 計測できないときは推測せず、理由を返す", (t) => {
  const directory = built(t);
  upToG8(directory);
  const gate = next(directory);
  assert.equal(gate.context?.tokens, null);
  assert.match(gate.context?.unavailable ?? "", /特定できません/);
});

test("step lint: 定義と指示ファイルが揃っている", (t) => {
  const directory = temporaryDirectory(t);
  assert.match(succeeds(directory, "step", "lint"), /指示ファイルが揃っています/);
});

test("step status: 手順の一覧と現在地を返す", (t) => {
  const directory = built(t);
  const status = JSON.parse(succeeds(directory, "step", "status", "build-01", "001", "--json"));
  assert.equal(status.current, "plan");
  const ids = (status.steps as { id: string; status: string }[]).map((step) => `${step.id}:${step.status}`);
  assert.ok(ids.includes("G7:off"), ids.join(", "));
  assert.ok(ids.includes("G8:pending"));
});

test("engine: 内部スキルは、呼び出し元が最後に報告したあとの記録だけを今回の分として数える", () => {
  const internal: SkillSteps = { skill: "helper", internal: true, steps: [{ id: "work", kind: "run", title: "作業" }] };
  const at = "2026-10-23T00:00:00Z";
  const ctx = (events: ProgressEvent[]): StepContext => ({
    config: {} as StepContext["config"], cycle: undefined, unit: "build-01", unitDirectory: "/nonexistent", events,
  });
  const first: ProgressEvent[] = [
    { at, skill: "builder", step: "plan", result: "done" },
    { at, skill: "helper", step: "work", result: "done" },
  ];
  assert.equal(evaluate(internal, ctx(first)).current, undefined, "1回目の呼び出しは終わっている");
  const second: ProgressEvent[] = [...first, { at, skill: "builder", step: "split", result: "done" }];
  assert.equal(evaluate(internal, ctx(second)).current?.definition.id, "work", "2回目の呼び出しは最初から");
});

test("step: 作業単位のディレクトリがまだ無くても進められ、最初の報告で作られる", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--bp", "3");
  assert.equal(existsSync(join(directory, BUILD)), false);
  assert.equal(next(directory).step, "plan");
  write(directory, `${BUILD}/plan.md`);
  report(directory, "plan", "--result", "done");
  assert.equal(existsSync(join(directory, BUILD, "progress.jsonl")), true);
});

test("step: 前のステップに戻っても、記録のある後ろのステップの成果物は記録の欠けにしない", (t) => {
  const directory = built(t);
  upToG8(directory);
  // plan を報告し直す（test-spec.md は残っている）
  const directive = report(directory, "plan", "--result", "done");
  assert.equal(directive.kind, "run");
  assert.equal(directive.step, "plan-review");
});

test("step restart: 区切りより前の記録を使わず、手順を最初から回し直す", (t) => {
  const directory = built(t);
  upToG8(directory);
  const result = cli(directory, "step", "restart", "build-01", "001", "--json");
  assert.equal(result.status, 1, "理由が要る");
  const restarted = JSON.parse(succeeds(directory, "step", "restart", "build-01", "001", "--reason", "回し直し", "--json"));
  assert.equal(restarted.directive.step, "plan", "plan.md があっても、区切りより後の記録が無ければ未完了");
  assert.equal(events(directory).at(-1)?.["result"], "restart");
});

test("engine: 内部スキルは step restart で、呼び出し元の報告を挟まずに呼び直せる", () => {
  const internal: SkillSteps = { skill: "helper", internal: true, steps: [{ id: "work", kind: "run", title: "作業" }] };
  const at = "2026-10-23T00:00:00Z";
  const ctx = (events: ProgressEvent[]): StepContext => ({
    config: {} as StepContext["config"], cycle: undefined, unit: "build-01", unitDirectory: "/nonexistent", events,
  });
  const done: ProgressEvent[] = [
    { at, skill: "builder", step: "implement", result: "failed", reason: "途中" },
    { at, skill: "helper", step: "work", result: "done" },
  ];
  assert.equal(evaluate(internal, ctx(done)).current, undefined);
  const again: ProgressEvent[] = [...done, { at, skill: "helper", step: "*", result: "restart", reason: "2回目" }];
  assert.equal(evaluate(internal, ctx(again)).current?.definition.id, "work");
});

test("engine: step restart --round の回の種類は、そのスキルが定義した値だけを受け付けて記録する", (t) => {
  const directory = built(t);
  const unknown = cli(directory, "step", "restart", "build-01", "001", "--round", "add", "--reason", "x");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /回の種類がありません/);
  const skill: SkillSteps = { skill: "helper", rounds: ["add"], steps: [] };
  const at = "2026-10-24T00:00:00Z";
  const events: ProgressEvent[] = [
    { at, skill: "helper", step: "*", result: "restart", reason: "x", round: "add" },
    { at, skill: "helper", step: "a", result: "done" },
  ];
  assert.equal(currentRound(skill, events), "add");
  assert.equal(currentRound(skill, [...events, { at, skill: "helper", step: "*", result: "restart", reason: "y" }]), undefined);
});

test("engine: requires は完了の条件にだけ使い、記録の欠けの判定には使わない", () => {
  let ready = false;
  const skill: SkillSteps = {
    skill: "helper",
    steps: [
      { id: "a", kind: "run", title: "前" },
      { id: "b", kind: "run", title: "後", requires: () => (ready ? undefined : "検証が通っていません") },
    ],
  };
  const at = "2026-10-24T00:00:00Z";
  const ctx = (events: ProgressEvent[]): StepContext => ({
    config: {} as StepContext["config"], cycle: undefined, unit: "init", unitDirectory: "/nonexistent", events,
  });
  // 前から条件を満たしていても、後ろのステップは記録の欠けにならない
  ready = true;
  assert.deepEqual(evaluate(skill, ctx([])).orphans, []);
  const events: ProgressEvent[] = [{ at, skill: "helper", step: "a", result: "done" }, { at, skill: "helper", step: "b", result: "done" }];
  assert.equal(evaluate(skill, ctx(events)).current, undefined);
  ready = false;
  assert.equal(evaluate(skill, ctx(events)).current?.definition.id, "b", "条件を満たさなくなれば未完了");
});
