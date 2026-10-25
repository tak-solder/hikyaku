import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { cliInput, cliWith, repository, succeeds, temporaryDirectory, workspace, write } from "./helpers.mts";

const BUILD = "docs/hikyaku/cycles/001-test/build-01";
const SESSION = "s-hook";

/** サイクル 001 にビルド 1 を登録し、issue.md まで置いた状態 */
function built(t: TestContext): string {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--bp", "3");
  write(directory, `${BUILD}/issue.md`);
  return directory;
}

/** セッション SESSION として報告する。記録を探しに行く先は空の一時ディレクトリにする */
function report(t: TestContext, directory: string, step: string, ...extra: string[]): void {
  const env = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CONFIG_DIR: temporaryDirectory(t) };
  const result = cliWith(directory, env, "step", "report", "build-01", step, "001", ...extra);
  assert.equal(result.status, 0, result.stderr);
}

function hook(directory: string, input: Record<string, unknown>): { decision?: string; reason?: string } | undefined {
  const result = cliInput(directory, JSON.stringify({ hook_event_name: "Stop", cwd: directory, ...input }), {}, "step", "hook", "stop");
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() === "" ? undefined : (JSON.parse(result.stdout) as { decision?: string; reason?: string });
}

test("step hook stop: 手順が run の途中なら、1回だけ止める", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--bp", "3");

  const blocked = hook(directory, { session_id: SESSION, stop_hook_active: false });
  assert.equal(blocked?.decision, "block");
  assert.match(blocked?.reason ?? "", /plan-review/);
  assert.match(blocked?.reason ?? "", /step next build-01 001-test/);

  assert.equal(hook(directory, { session_id: SESSION, stop_hook_active: true }), undefined, "同じターンの2回目は止めない");
});

test("step hook stop: 別のセッションと、Hikyaku を使っていないリポジトリでは止めない", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--bp", "3");
  assert.equal(hook(directory, { session_id: "other" }), undefined);

  const plain = repository(t);
  assert.equal(hook(plain, { session_id: SESSION }), undefined);
});

test("step hook stop: ゲートで止まるのと、非対話規約のブロックで終えるのは止めない", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--bp", "3");
  report(t, directory, "plan-review", "--result", "done");

  const message = 'test-spec を書く前に確認します。\n\n<hikyaku-gate id="questions">\n境界値はどれですか？\n</hikyaku-gate>';
  assert.equal(hook(directory, { session_id: SESSION, last_assistant_message: message }), undefined);
  assert.equal(hook(directory, { session_id: SESSION, last_assistant_message: "続けます" })?.decision, "block");

  write(directory, `${BUILD}/test-spec.md`);
  report(t, directory, "test-spec", "--result", "done");
  report(t, directory, "test-spec-review", "--result", "done");
  assert.equal(hook(directory, { session_id: SESSION }), undefined, "G8 は gate なので止まってよい");
});

test("step hook stop: 内部スキルを呼んでいる最中は、呼ばれたスキルの1手で判定する", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--bp", "5");
  report(t, directory, "plan-review", "--result", "done", "--bp", "6");

  const blocked = hook(directory, { session_id: SESSION });
  assert.equal(blocked?.decision, "block");
  assert.match(blocked?.reason ?? "", /--skill build-manager/);
});

test("step hook stop: 入力が壊れていても止めず、終了コードは 0", (t) => {
  const directory = built(t);
  const result = cliInput(directory, "{not json", {}, "step", "hook", "stop");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /hikyaku step hook stop/);
});

test("step where: 記録のある作業単位と、次の1手を並べる", (t) => {
  const directory = built(t);
  const empty = JSON.parse(succeeds(directory, "step", "where", "001", "--json"));
  assert.deepEqual(empty.units, []);

  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--bp", "3");
  const output = JSON.parse(succeeds(directory, "step", "where", "001", "--json"));
  assert.equal(output.legacy, null);
  assert.equal(output.units.length, 1);
  assert.equal(output.units[0].directive.unit, "build-01");
  assert.equal(output.units[0].directive.skill, "builder");
  assert.equal(output.units[0].directive.step, "plan-review");
  assert.match(output.units[0].next, /step next build-01 001-test$/);
});

test("step where: v2 で作成したサイクルは作業単位を読まずに案内する", (t) => {
  const directory = built(t);
  const path = join(directory, "docs/hikyaku/cycles.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(/\| \d+\.\d+\.\d+ +\|/, "| 2.9.2 |"));
  const output = JSON.parse(succeeds(directory, "step", "where", "001", "--json"));
  assert.match(output.legacy ?? "", /v2 のまま終えて/);
});

function parse(directory: string, text: string): { step: Record<string, unknown> | null; stepProblems: string[] } {
  write(directory, "r.json", JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: SESSION }));
  const digest = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json")).digest as string;
  return JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest, "--json"));
}

test("conductor parse: 子の手順の位置を返し、ブロックとの食い違いを挙げる", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--bp", "3");

  const done = parse(directory, "<hikyaku-done next=\"\">\nPR を作りました\n</hikyaku-done>");
  assert.equal(done.step?.["unit"], "build-01");
  assert.equal(done.step?.["step"], "plan-review");
  assert.match(done.stepProblems[0] ?? "", /手順は終わっていません/);

  const early = parse(directory, '<hikyaku-gate id="G8">\n承認しますか？\n</hikyaku-gate>');
  assert.match(early.stepProblems[0] ?? "", /G8 で止まりましたが/);

  report(t, directory, "plan-review", "--result", "done");
  write(directory, `${BUILD}/test-spec.md`);
  report(t, directory, "test-spec", "--result", "done");
  report(t, directory, "test-spec-review", "--result", "done");
  const gate = parse(directory, '<hikyaku-gate id="G8">\n承認しますか？\n</hikyaku-gate>');
  assert.deepEqual(gate.stepProblems, []);
  assert.equal(gate.step?.["ask"], "G8");
  assert.deepEqual(gate.step?.["binds"], ["plan.md", "test-spec.md"]);
});

test("conductor parse: 子の記録が無いまま done を出したら挙げる", (t) => {
  const directory = built(t);
  const done = parse(directory, "<hikyaku-done next=\"\">\n終えました\n</hikyaku-done>");
  assert.equal(done.step, null);
  assert.match(done.stepProblems[0] ?? "", /記録がありません/);
});
