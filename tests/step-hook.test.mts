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
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
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
  report(t, directory, "plan", "--result", "done", "--peak", "350k");

  const blocked = hook(directory, { session_id: SESSION, stop_hook_active: false });
  assert.equal(blocked?.decision, "block");
  assert.match(blocked?.reason ?? "", /plan-review/);
  assert.match(blocked?.reason ?? "", /step next build-01 001-test/);

  assert.equal(hook(directory, { session_id: SESSION, stop_hook_active: true }), undefined, "同じターンの2回目は止めない");
});

test("step hook stop: 別のセッションと、Hikyaku を使っていないリポジトリでは止めない", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--peak", "350k");
  assert.equal(hook(directory, { session_id: "other" }), undefined);

  const plain = repository(t);
  assert.equal(hook(plain, { session_id: SESSION }), undefined);
});

test("step hook stop: ゲートで止まるのと、非対話規約のブロックで終えるのは止めない", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--peak", "350k");
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
  report(t, directory, "plan", "--result", "done", "--peak", "400k");
  report(t, directory, "plan-review", "--result", "done", "--peak", "500k");

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
  report(t, directory, "plan", "--result", "done", "--peak", "350k");
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
  report(t, directory, "plan", "--result", "done", "--peak", "350k");

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
  assert.equal(gate.step?.["binds"], undefined);
});

test("conductor parse: 子の記録が無いまま done を出したら挙げる", (t) => {
  const directory = built(t);
  const done = parse(directory, "<hikyaku-done next=\"\">\n終えました\n</hikyaku-done>");
  assert.equal(done.step, null);
  assert.match(done.stepProblems[0] ?? "", /記録がありません/);
});

/** セッション SESSION として、任意のフェーズの手順を報告する */
function reportAs(t: TestContext, directory: string, phase: string, step: string, ...extra: string[]): void {
  const env = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CONFIG_DIR: temporaryDirectory(t) };
  const operands = phase === "token-guide" ? [phase, step] : [phase, step, "001"];
  const result = cliWith(directory, env, "step", "report", ...operands, ...extra);
  assert.equal(result.status, 0, result.stderr);
}

function restartAs(t: TestContext, directory: string, phase: string, ...extra: string[]): void {
  const env = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CONFIG_DIR: temporaryDirectory(t) };
  const result = cliWith(directory, env, "step", "restart", phase, "001", ...extra);
  assert.equal(result.status, 0, result.stderr);
}

/** ルートの設定に、テーブルより前の最上位のキーを足す */
function configure(directory: string, line: string): void {
  const path = join(directory, ".hikyaku.config");
  writeFileSync(path, `${line}\n${readFileSync(path, "utf8")}`);
}

const PR = ["--pr", "https://github.com/o/r/pull/1"];

test("conductor parse / step hook: cycle close のあとも CLOSE の手順を探し、正しく終えた子を誤判定しない", (t) => {
  const directory = workspace(t, true);
  reportAs(t, directory, "close", "collect", "--result", "done");
  reportAs(t, directory, "close", "G10", "--result", "approved", "--input", "OK");
  reportAs(t, directory, "close", "write", "--result", "done");
  succeeds(directory, "cycle", "close", "001", "--summary", "テスト");
  reportAs(t, directory, "close", "close", "--result", "done");

  // 終えたサイクルでも、pr が残っていれば Stop フックは止める
  const blocked = hook(directory, { session_id: SESSION });
  assert.equal(blocked?.decision, "block");
  assert.match(blocked?.reason ?? "", /close-cycle close/);

  reportAs(t, directory, "close", "pr", "--result", "done", ...PR);
  // PR のあとの followups が残っていれば、まだ止める
  assert.match(hook(directory, { session_id: SESSION })?.reason ?? "", /close-cycle close/);
  reportAs(t, directory, "close", "followups", "--result", "done");
  assert.equal(hook(directory, { session_id: SESSION }), undefined);
  const done = parse(directory, "<hikyaku-done next=\"\">\nPR を作りました\n</hikyaku-done>");
  assert.deepEqual(done.stepProblems, []);
  assert.equal(done.step?.["skill"], "close-cycle");
  assert.equal(done.step?.["kind"], "done");
});

test("conductor parse / step hook: run のステップの中から呼んだ build-manager の G6 を、呼ばれた側の位置で読む", (t) => {
  const directory = built(t);
  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--peak", "350k");
  report(t, directory, "plan-review", "--result", "done");
  write(directory, `${BUILD}/test-spec.md`);
  report(t, directory, "test-spec", "--result", "done");
  report(t, directory, "test-spec-review", "--result", "done");
  report(t, directory, "G8", "--result", "approved", "--input", "OK");
  // implement の途中で、想定外の依存が見つかって build-manager を呼んだ
  for (const step of ["load", "scope", "estimate", "dry-run", "tasklist-review"]) {
    report(t, directory, step, "--skill", "build-manager", "--result", "done");
  }
  assert.equal(hook(directory, { session_id: SESSION }), undefined, "G6 で止まるのは正しい");
  const gate = parse(directory, '<hikyaku-gate id="G6">\n承認しますか？\n</hikyaku-gate>');
  assert.deepEqual(gate.stepProblems, []);
  assert.equal(gate.step?.["skill"], "build-manager");
  assert.equal(gate.step?.["ask"], "G6");

  report(t, directory, "G6", "--skill", "build-manager", "--result", "approved", "--input", "OK");
  const blocked = hook(directory, { session_id: SESSION });
  assert.match(blocked?.reason ?? "", /build-manager .*write|write/, "書き込みの途中で止まろうとしたら引き止める");
  report(t, directory, "write", "--skill", "build-manager", "--result", "done");
  assert.match(hook(directory, { session_id: SESSION })?.reason ?? "", /run implement/, "build-manager を終えたら implement に戻る");
});

test("conductor parse: 記録の無い子がゲートの ID で止まったら挙げ、ステップの途中の問いは挙げない", (t) => {
  const directory = built(t);
  const early = parse(directory, '<hikyaku-gate id="G8">\n承認しますか？\n</hikyaku-gate>');
  assert.equal(early.step, null);
  assert.match(early.stepProblems[0] ?? "", /G8 で止まりましたが.*記録がありません/);
  const question = parse(directory, '<hikyaku-gate id="questions">\nどちらにしますか？\n</hikyaku-gate>');
  assert.deepEqual(question.stepProblems, []);
});

test("step where: 対象サイクルの作業単位だけを並べ、init と token-guide は混ぜない", (t) => {
  const directory = built(t);
  reportAs(t, directory, "token-guide", "start", "--result", "done");
  write(directory, `${BUILD}/plan.md`);
  report(t, directory, "plan", "--result", "done", "--peak", "350k");
  const output = JSON.parse(succeeds(directory, "step", "where", "001", "--json"));
  assert.deepEqual(output.units.map((unit: { directive: { skill: string } }) => unit.directive.skill), ["builder"]);
});

test("step hook stop: 手順を終えたあとに呼び直した振り返り（PR レビュー対応）の途中も引き止める", (t) => {
  const directory = workspace(t, true);
  configure(directory, 'retrospective = "skip"');
  write(directory, "docs/hikyaku/cycles/001-test/planning/user-stories.md");
  for (const step of ["inputs", "scope", "user-stories", "review"]) reportAs(t, directory, "plan", step, "--result", "done");
  reportAs(t, directory, "plan", "G1", "--result", "approved", "--input", "OK");
  reportAs(t, directory, "plan", "pr", "--result", "done", ...PR);
  assert.equal(hook(directory, { session_id: SESSION }), undefined, "planner は終えている");

  const config = join(directory, ".hikyaku.config");
  writeFileSync(config, readFileSync(config, "utf8").replace('retrospective = "skip"', 'retrospective = "auto"'));
  restartAs(t, directory, "plan", "--skill", "retrospective", "--reason", "PR レビュー対応");
  const blocked = hook(directory, { session_id: SESSION });
  assert.equal(blocked?.decision, "block");
  assert.match(blocked?.reason ?? "", /retrospective plan/);
});
