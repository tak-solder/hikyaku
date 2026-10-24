import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, succeeds, workspace, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const DESIGN = `${CYCLE}/design`;

/** ルートの設定に、テーブルより前の最上位のキーを足す */
function configure(directory: string, line: string): void {
  const path = join(directory, ".hikyaku.config");
  writeFileSync(path, `${line}\n${readFileSync(path, "utf8")}`);
}

interface Directive {
  kind: string;
  skill: string;
  step?: string;
  read?: string;
  report?: Record<string, string>;
  note?: string;
  revise?: string;
  binds?: string[];
  call?: string;
  callNext?: string;
  reason?: string;
  args?: Record<string, unknown>;
  message?: string;
}

function parse(stdout: string): Directive {
  return (JSON.parse(stdout) as { directive: Directive }).directive;
}

function next(directory: string, phase = "architect", ...extra: string[]): Directive {
  return parse(succeeds(directory, "step", "next", phase, "001", ...extra, "--json"));
}

function report(directory: string, step: string, ...extra: string[]): Directive {
  return parse(succeeds(directory, "step", "report", "architect", step, "001", ...extra, "--json"));
}

function manager(directory: string, step: string, phase = "architect", ...extra: string[]): Directive {
  return parse(succeeds(directory, "step", "report", phase, step, "001", "--skill", "build-manager", ...extra, "--json"));
}

function events(directory: string, unit = DESIGN): Record<string, unknown>[] {
  return readFileSync(join(directory, unit, "progress.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** standard で G4 の手前まで進める（survey → questions → options → G3 → adr → design-delta → review） */
function upToG4(directory: string): void {
  write(directory, `${DESIGN}/codebase-survey.md`);
  report(directory, "survey", "--result", "done");
  report(directory, "questions", "--result", "done");
  report(directory, "options", "--result", "done");
  report(directory, "G3", "--result", "approved", "--input", "Minimal 案で");
  report(directory, "adr", "--result", "done");
  write(directory, `${DESIGN}/design-delta.md`);
  report(directory, "design-delta", "--result", "done");
  report(directory, "architecture-review", "--result", "done");
}

/** build-manager を最初から書き込みまで進める（standard: tasklist-review あり、外部投影なし） */
function runManager(directory: string, phase = "architect"): Directive {
  manager(directory, "load", phase, "--result", "done");
  manager(directory, "scope", phase, "--result", "done");
  manager(directory, "estimate", phase, "--result", "done");
  manager(directory, "dry-run", phase, "--result", "done");
  manager(directory, "tasklist-review", phase, "--result", "done");
  manager(directory, "G6", phase, "--result", "approved", "--input", "OK");
  return manager(directory, "write", phase, "--result", "done");
}

test("architect: 最初の1手は既存コードの調査で、並行サイクルが無ければ cycle-scan は返らない", (t) => {
  const directory = workspace(t, true);
  const directive = next(directory);
  assert.equal(directive.kind, "run");
  assert.equal(directive.skill, "architect");
  assert.equal(directive.step, "survey");
  assert.ok(directive.read !== undefined && existsSync(directive.read), String(directive.read));
  assert.match(directive.report?.["skipped"] ?? "", /step report architect survey 001-test --result skipped/);

  const status = JSON.parse(succeeds(directory, "step", "status", "architect", "001", "--json"));
  const ids = (status.steps as { id: string; status: string }[]).map((step) => `${step.id}:${step.status}`);
  assert.ok(ids.includes("cycle-scan:off"), ids.join(", "));
  assert.ok(ids.includes("G2:off"), "standard では G2 を行わない");
});

test("architect: 他に進行中のサイクルがあれば、最初に並行サイクルを確認する", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "cycle", "new", "other", "--profile", "standard");
  assert.equal(next(directory).step, "cycle-scan");
  assert.equal(report(directory, "cycle-scan", "--result", "done").step, "survey");
});

test("architect: G2 は codebase_survey_gate が有効なときだけ返り、調査を省いたら返らない", (t) => {
  const directory = workspace(t, true);
  configure(directory, "codebase_survey_gate = true");
  write(directory, `${DESIGN}/codebase-survey.md`);
  const gate = report(directory, "survey", "--result", "done");
  assert.equal(gate.kind, "gate");
  assert.equal(gate.step, "G2");
  assert.deepEqual(gate.binds, ["codebase-survey.md"]);

  const fresh = workspace(t, true);
  configure(fresh, "codebase_survey_gate = true");
  assert.equal(report(fresh, "survey", "--result", "skipped", "--reason", "新規開発").step, "questions");
});

test("architect: 分岐する判断が無ければ G3 と ADR を行わない", (t) => {
  const directory = workspace(t, true);
  write(directory, `${DESIGN}/codebase-survey.md`);
  report(directory, "survey", "--result", "done");
  report(directory, "questions", "--result", "done");
  const directive = report(directory, "options", "--result", "skipped", "--reason", "分岐する判断なし");
  assert.equal(directive.step, "design-delta");
});

test("architect: G3 と G4 を外すと（express）、設計案の値で推奨案の採用を伝える", (t) => {
  const directory = workspace(t, true);
  configure(directory, "design_choice_gate = false");
  configure(directory, "architecture_gate = false");
  write(directory, `${DESIGN}/codebase-survey.md`);
  report(directory, "survey", "--result", "done");
  const options = report(directory, "questions", "--result", "done");
  assert.equal(options.step, "options");
  assert.equal(options.args?.["designChoiceGate"], false);
  assert.equal(report(directory, "options", "--result", "done").step, "adr");
  write(directory, `${DESIGN}/design-delta.md`);
  report(directory, "adr", "--result", "done");
  assert.equal(report(directory, "design-delta", "--result", "done").step, "architecture-review");
  assert.equal(report(directory, "architecture-review", "--result", "done").step, "build-split");
});

test("architect: G4 の差し戻しで design-delta を報告し直すと、レビューと G4 がやり直しになる", (t) => {
  const directory = workspace(t, true);
  upToG4(directory);
  const gate = next(directory);
  assert.equal(gate.step, "G4");
  assert.deepEqual(gate.binds, ["design-delta.md"]);
  const revise = report(directory, "G4", "--result", "rejected", "--input", "移行の段階を足して");
  assert.equal(revise.revise, "移行の段階を足して");

  write(directory, `${DESIGN}/design-delta.md`, "# design-delta（移行の段階を追加）\n");
  assert.equal(report(directory, "design-delta", "--result", "done").step, "architecture-review", "古いレビューの完了は数えない");
  assert.equal(report(directory, "architecture-review", "--result", "done").step, "G4");
  assert.equal(report(directory, "G4", "--result", "approved", "--input", "OK").step, "build-split");
});

test("architect: G4 の差し戻しで質問から報告し直すと、案の生成からやり直しになる", (t) => {
  const directory = workspace(t, true);
  upToG4(directory);
  report(directory, "G4", "--result", "rejected", "--input", "移行の段階を足して");
  const back = report(directory, "questions", "--result", "done");
  assert.equal(back.kind, "run", "design-delta.md が残っていても記録の欠けにしない");
  assert.equal(back.step, "options", "古い options の完了は数えない");
});

test("architect: ビルド分割で build-manager を呼び、同じ design/progress.jsonl に記録する", (t) => {
  const directory = workspace(t, true);
  upToG4(directory);
  const call = report(directory, "G4", "--result", "approved", "--input", "OK");
  assert.equal(call.kind, "call");
  assert.equal(call.step, "build-split");
  assert.equal(call.call, "build-manager");
  assert.match(call.callNext ?? "", /step next architect 001-test --skill build-manager/);

  const first = next(directory, "architect", "--skill", "build-manager");
  assert.equal(first.skill, "build-manager");
  assert.equal(first.step, "load");
  assert.equal(first.args?.["caller"], "architect");
  assert.match(first.report?.["done"] ?? "", /step report architect load 001-test --skill build-manager --result done/);

  // G6 の差し戻しは scope からやり直す
  manager(directory, "load", "architect", "--result", "done");
  manager(directory, "scope", "architect", "--result", "done");
  manager(directory, "estimate", "architect", "--result", "done");
  manager(directory, "dry-run", "architect", "--result", "done");
  assert.equal(manager(directory, "tasklist-review", "architect", "--result", "done").step, "G6");
  manager(directory, "G6", "architect", "--result", "rejected", "--input", "分け方を変えて");
  assert.equal(manager(directory, "scope", "architect", "--result", "done").step, "estimate");
  manager(directory, "estimate", "architect", "--result", "done");
  manager(directory, "dry-run", "architect", "--result", "done");
  manager(directory, "tasklist-review", "architect", "--result", "done");
  manager(directory, "G6", "architect", "--result", "approved", "--input", "OK");
  assert.equal(manager(directory, "write", "architect", "--result", "done").kind, "done");

  // build-manager の記録は architect の現在地を動かさない
  assert.equal(next(directory).step, "build-split");
  const early = cli(directory, "step", "report", "architect", "build-split", "001", "--result", "done");
  assert.equal(early.status, 1, "tasklist にビルドが無ければ完了にならない");
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--bp", "3");
  assert.equal(report(directory, "build-split", "--result", "done").step, "validate");
  assert.ok(events(directory).some((event) => event["skill"] === "build-manager" && event["step"] === "G6"));

  // 検証のあとに呼び直すと、build-manager は最初の手順から始まる
  assert.equal(next(directory, "architect", "--skill", "build-manager").step, "load");
});

test("architect: 振り返りと PR まで進むと done", (t) => {
  const directory = workspace(t, true);
  upToG4(directory);
  report(directory, "G4", "--result", "approved", "--input", "OK");
  runManager(directory);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--bp", "3");
  report(directory, "build-split", "--result", "done");
  const retrospective = report(directory, "validate", "--result", "done");
  assert.equal(retrospective.kind, "call");
  assert.equal(retrospective.call, "retrospective");
  assert.equal(report(directory, "retrospective", "--result", "done").step, "pr");
  assert.equal(report(directory, "pr", "--result", "done").kind, "done");
});

test("build-manager: 外部投影は [external] target が none 以外のときだけ返る", (t) => {
  const directory = workspace(t, true);
  const path = join(directory, ".hikyaku.config");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n[external]\ntarget = "github"\n`);
  upToG4(directory);
  report(directory, "G4", "--result", "approved", "--input", "OK");
  const after = runManager(directory);
  assert.equal(after.step, "external-sync");
  assert.equal(after.args?.["target"], "github");
});

test("build-manager: builder の分割の検討から呼ぶと、ビルドの progress.jsonl に記録する", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--bp", "3");
  const build = `${CYCLE}/build-01`;
  write(directory, `${build}/issue.md`);
  write(directory, `${build}/plan.md`);
  succeeds(directory, "step", "report", "build-01", "plan", "001", "--result", "done", "--bp", "5");
  const call = parse(succeeds(directory, "step", "report", "build-01", "plan-review", "001", "--result", "done", "--bp", "6", "--json"));
  assert.equal(call.step, "split");
  assert.match(call.callNext ?? "", /step next build-01 001-test --skill build-manager/);

  const first = next(directory, "build-01", "--skill", "build-manager");
  assert.equal(first.step, "load");
  assert.equal(first.args?.["caller"], "build-01");
  assert.equal(runManager(directory, "build-01").kind, "done");
  assert.ok(events(directory, build).some((event) => event["skill"] === "build-manager" && event["step"] === "write"));
  assert.equal(existsSync(join(directory, DESIGN, "progress.jsonl")), false, "architect の記録には書かない");
});

/** 通常の設計を PR まで終え、ビルド 1 を登録した状態 */
function designed(t: Parameters<typeof workspace>[0]): string {
  const directory = workspace(t, true);
  configure(directory, 'retrospective = "skip"');
  upToG4(directory);
  report(directory, "G4", "--result", "approved", "--input", "OK");
  runManager(directory);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--bp", "3");
  report(directory, "build-split", "--result", "done");
  report(directory, "validate", "--result", "done");
  assert.equal(report(directory, "pr", "--result", "done").kind, "done");
  return directory;
}

function restart(directory: string, round: string, reason: string): Directive {
  return parse(succeeds(directory, "step", "restart", "architect", "001", "--round", round, "--reason", reason, "--json"));
}

test("architect: 差し戻し中は、再設計の回を区切るまで止まる。区切れば build-manager も進められる", (t) => {
  const directory = designed(t);
  write(directory, `${CYCLE}/return.md`, "# 差し戻し: build-01\n");
  const stopped = next(directory);
  assert.equal(stopped.kind, "stop");
  assert.match(stopped.message ?? "", /step restart architect 001-test --round return/);

  const first = restart(directory, "return", "build-01 からの差し戻し");
  assert.equal(first.step, "survey", "通常の設計と同じく調査から");
  assert.equal(first.args?.["round"], "return");
  report(directory, "survey", "--result", "done");
  report(directory, "questions", "--result", "done");
  report(directory, "options", "--result", "skipped", "--reason", "分岐なし");
  report(directory, "design-delta", "--result", "done");
  report(directory, "architecture-review", "--result", "done");
  const call = report(directory, "G4", "--result", "approved", "--input", "OK");
  assert.equal(call.step, "build-split");
  assert.equal(call.args?.["round"], "return");
  assert.equal(next(directory, "architect", "--skill", "build-manager").step, "load", "差し戻し中でも build-manager は止まらない");
  runManager(directory);
  report(directory, "build-split", "--result", "done");

  const resolve = report(directory, "validate", "--result", "done");
  assert.equal(resolve.step, "resolve-return", "PR の代わりに差し戻しを解決する");
  const early = cli(directory, "step", "report", "architect", "resolve-return", "001", "--result", "done");
  assert.equal(early.status, 1, "return.md が残っていれば完了にならない");
  rmSync(join(directory, CYCLE, "return.md"));
  assert.equal(report(directory, "resolve-return", "--result", "done").kind, "done");
  const ids = (JSON.parse(succeeds(directory, "step", "status", "architect", "001", "--json")).steps as { id: string; status: string }[])
    .map((step) => `${step.id}:${step.status}`);
  assert.ok(ids.includes("pr:off"), ids.join(", "));
});

test("architect: 追加設計の回は調査を行わず、設計を変えなければビルドの追加へ進む", (t) => {
  const directory = designed(t);
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", "https://github.com/o/r/pull/1");
  const first = restart(directory, "add", "エラー表示の文言");
  assert.equal(first.step, "design-change");
  const call = report(directory, "design-change", "--result", "skipped", "--reason", "設計の変更は不要");
  assert.equal(call.step, "build-split", "質問・設計案・G4 を行わない");
  assert.equal(call.args?.["round"], "add");
  assert.match(call.reason ?? "", /完了済みのビルドは更新しない/);

  // 前回の build-manager の記録のあとに区切りがあるので、最初の手順から始まる
  assert.equal(next(directory, "architect", "--skill", "build-manager").step, "load");
  runManager(directory);
  const early = cli(directory, "step", "report", "architect", "build-split", "001", "--result", "done");
  assert.equal(early.status, 1, "未完了のビルドが足されるまで完了にならない");
  succeeds(directory, "tasklist", "add", "001", "--title", "指摘への対応", "--bp", "2");
  report(directory, "build-split", "--result", "done");
  assert.equal(report(directory, "validate", "--result", "done").step, "pr");

  const status = JSON.parse(succeeds(directory, "step", "status", "architect", "001", "--json"));
  const ids = (status.steps as { id: string; status: string }[]).map((step) => `${step.id}:${step.status}`);
  for (const id of ["cycle-scan", "survey", "G2", "questions", "G4"]) assert.ok(ids.includes(`${id}:off`), ids.join(", "));
});

test("architect: 追加設計で設計を変えるなら、質問から G4 まで通常どおり返る", (t) => {
  const directory = designed(t);
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", "https://github.com/o/r/pull/1");
  restart(directory, "add", "認可の抜け");
  assert.equal(report(directory, "design-change", "--result", "done").step, "questions");
});

test("build-manager: 呼び出し元の報告を挟まずに呼び直すときは、step restart で最初の手順から始める", (t) => {
  const directory = designed(t);
  runManager(directory);
  assert.equal(next(directory, "architect", "--skill", "build-manager").kind, "done", "呼び出し元が報告していないので、前回の分が完了のまま");
  const result = cli(directory, "step", "restart", "architect", "001", "--skill", "build-manager", "--reason", "受け入れ基準の割り当て");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(next(directory, "architect", "--skill", "build-manager").step, "load");
});

test("architect: --round は return / add だけを受け付け、付けずに区切った回は通常の設計になる", (t) => {
  const directory = designed(t);
  const wrong = cli(directory, "step", "restart", "architect", "001", "--round", "redo", "--reason", "x");
  assert.equal(wrong.status, 1);
  const plain = parse(succeeds(directory, "step", "restart", "architect", "001", "--reason", "最初から", "--json"));
  assert.equal(plain.step, "survey");
  assert.equal(plain.args?.["round"], "design");
});
