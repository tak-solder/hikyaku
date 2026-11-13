import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, succeeds, workspace, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const PLANNING = `${CYCLE}/planning`;

interface Directive {
  kind: string;
  skill: string;
  step?: string;
  read?: string;
  args?: Record<string, unknown>;
  report?: Record<string, string>;
  call?: string;
  callNext?: string;
  note?: string;
}

/** ルートの設定に、テーブルより前の最上位のキーを足す */
function configure(directory: string, line: string): void {
  const path = join(directory, ".hikyaku.config");
  writeFileSync(path, `${line}\n${readFileSync(path, "utf8")}`);
}

function next(directory: string, phase: string, ...extra: string[]): Directive {
  const result = cli(directory, "step", "next", phase, "001", ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function report(directory: string, phase: string, step: string, ...extra: string[]): Directive {
  const result = cli(directory, "step", "report", phase, step, "001", ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function events(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** 振り返り（auto、build 以外）を最後まで進める */
function retrospect(directory: string, phase: string): Directive {
  const first = next(directory, phase, "--skill", "retrospective");
  assert.equal(first.skill, "retrospective");
  assert.equal(first.step, "analyze", "auto では確認せず、build 以外では予測ピークの実測を集めない");
  const writing = report(directory, phase, "analyze", "--skill", "retrospective", "--result", "done");
  write(directory, String(writing.args?.["output"]), "# 振り返り\n");
  return report(directory, phase, "write", "--skill", "retrospective", "--result", "done");
}

// ---------------------------------------------------------------------------
// planner

test("planner: planning/ に記録し、user-stories → レビュー → G1 → 振り返り → PR の順に進む", (t) => {
  const directory = workspace(t, true);
  const first = next(directory, "plan");
  assert.equal(first.skill, "planner");
  assert.equal(first.step, "inputs");
  assert.ok(first.read !== undefined && existsSync(first.read), String(first.read));
  assert.match(first.report?.["done"] ?? "", /step report plan inputs 001-test --result done/);

  report(directory, "plan", "inputs", "--result", "done");
  assert.equal(report(directory, "plan", "scope", "--result", "done").step, "user-stories");

  const missing = cli(directory, "step", "report", "plan", "user-stories", "001", "--result", "done");
  assert.equal(missing.status, 1, "user-stories.md が無ければ受け付けない");
  assert.match(missing.stderr, /user-stories\.md/);

  write(directory, `${PLANNING}/user-stories.md`, "# stories\n");
  assert.equal(report(directory, "plan", "user-stories", "--result", "done").step, "review");
  const gate = report(directory, "plan", "review", "--result", "done");
  assert.equal(gate.kind, "gate");
  assert.equal(gate.step, "G1");

  const call = report(directory, "plan", "G1", "--result", "approved", "--input", "OK");
  assert.equal(call.kind, "call");
  assert.equal(call.call, "retrospective");
  assert.match(call.callNext ?? "", /step next plan 001-test --skill retrospective/);

  const back = retrospect(directory, "plan");
  assert.equal(back.kind, "done", "振り返りの手順を終えたら呼び出し元へ戻る");
  assert.equal(next(directory, "plan").step, "retrospective", "呼び出し元が報告するまで planner は進まない");

  assert.equal(report(directory, "plan", "retrospective", "--result", "done").step, "pr");
  const noPr = cli(directory, "step", "report", "plan", "pr", "001", "--result", "done");
  assert.equal(noPr.status, 1, "PR を添えない done は受け付けない");
  assert.equal(report(directory, "plan", "pr", "--result", "done", "--pr", "https://github.com/o/r/pull/1").kind, "done");

  const log = events(join(directory, PLANNING, "progress.jsonl"));
  assert.deepEqual(
    log.map((event) => `${String(event["skill"])}:${String(event["step"])}`),
    [
      "planner:inputs", "planner:scope", "planner:user-stories", "planner:review", "planner:G1",
      "retrospective:analyze", "retrospective:write", "planner:retrospective", "planner:pr",
    ],
  );
});

test("planner: G1 の承認は、承認後に user-stories.md を直しても自動では取り直しにならない", (t) => {
  const directory = workspace(t, true);
  configure(directory, 'retrospective = "skip"');
  report(directory, "plan", "inputs", "--result", "done");
  report(directory, "plan", "scope", "--result", "done");
  write(directory, `${PLANNING}/user-stories.md`, "# stories\n");
  report(directory, "plan", "user-stories", "--result", "done");
  report(directory, "plan", "review", "--result", "done");
  assert.equal(report(directory, "plan", "G1", "--result", "approved", "--input", "OK").step, "pr");

  // 変更は Git の履歴で追う。取り直すと決めたら user-stories を報告し直す
  write(directory, `${PLANNING}/user-stories.md`, "# stories（範囲を変更）\n");
  assert.equal(next(directory, "plan").step, "pr");
  assert.equal(report(directory, "plan", "user-stories", "--result", "done").step, "review");
});

test("planner: レビューと振り返りが無効なら、その手順は返らない", (t) => {
  const directory = workspace(t, true);
  configure(directory, "user_stories_review = false");
  configure(directory, 'retrospective = "skip"');
  report(directory, "plan", "inputs", "--result", "done");
  report(directory, "plan", "scope", "--result", "done");
  write(directory, `${PLANNING}/user-stories.md`);
  assert.equal(report(directory, "plan", "user-stories", "--result", "done").step, "G1");
  assert.equal(report(directory, "plan", "G1", "--result", "approved", "--input", "OK").step, "pr");
});

test("planner: planning/ が無くても（別のチェックアウトで create-cycle した）進み、最初の報告で作られる", (t) => {
  const directory = workspace(t, true);
  rmSync(join(directory, PLANNING), { recursive: true, force: true });
  assert.equal(next(directory, "plan").step, "inputs");
  report(directory, "plan", "inputs", "--result", "done");
  assert.ok(existsSync(join(directory, PLANNING, "progress.jsonl")));
});

test("planner: 後ろのステップの成果物があるのに記録が無ければ止まる", (t) => {
  const directory = workspace(t, true);
  write(directory, `${PLANNING}/user-stories.md`);
  const directive = next(directory, "plan");
  assert.equal(directive.kind, "stop");
  assert.match(String((directive as { message?: string }).message), /user-stories/);
});

// ---------------------------------------------------------------------------
// retrospective

test("retrospective: prompt で実施しないと答えたら、残りは対象外になり done が返る", (t) => {
  const directory = workspace(t, true);
  configure(directory, 'retrospective = "prompt"');
  const confirm = next(directory, "plan", "--skill", "retrospective");
  assert.equal(confirm.step, "confirm");
  assert.ok(confirm.report?.["skipped"] !== undefined, "確認はスキップで答えられる");
  assert.match(confirm.report?.["done"] ?? "", /--skill retrospective --result done/);
  const after = report(directory, "plan", "confirm", "--skill", "retrospective", "--result", "skipped", "--reason", "不要");
  assert.equal(after.kind, "done");
});

test("retrospective: build では予測ピークの実測の収集から始まり、書き込み先を返す", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
  write(directory, `${CYCLE}/build-01/issue.md`);
  const first = next(directory, "build-01", "--skill", "retrospective");
  assert.equal(first.step, "peak-actual");
  report(directory, "build-01", "peak-actual", "--skill", "retrospective", "--result", "done");
  const writing = report(directory, "build-01", "analyze", "--skill", "retrospective", "--result", "done");
  assert.equal(writing.step, "write");
  assert.equal(writing.args?.["output"], `${CYCLE}/build-01/retrospective.md`);
});

test("retrospective: retrospective.md が無ければ write の done を受け付けない", (t) => {
  const directory = workspace(t, true);
  report(directory, "plan", "inputs", "--result", "done");
  report(directory, "plan", "analyze", "--skill", "retrospective", "--result", "done");
  const missing = cli(directory, "step", "report", "plan", "write", "001", "--skill", "retrospective", "--result", "done");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /成果物がまだありません/);
});

test("retrospective: 呼び出し元が報告するまでは前回の分。restart で区切ると追記モードで最初から回る", (t) => {
  const directory = workspace(t, true);
  report(directory, "plan", "inputs", "--result", "done");
  assert.equal(retrospect(directory, "plan").kind, "done");
  assert.equal(next(directory, "plan", "--skill", "retrospective").kind, "done", "呼び出し元が報告するまでは前回の分");

  // PR レビュー対応: 呼び出し元は報告するものが無いので、restart で区切って呼び直す
  const result = cli(directory, "step", "restart", "plan", "001", "--skill", "retrospective", "--reason", "PR レビュー対応の振り返り", "--json");
  assert.equal(result.status, 0, result.stderr);
  const again = (JSON.parse(result.stdout) as { directive: Directive }).directive;
  assert.equal(again.kind, "run", "retrospective.md が既にあっても記録の欠けとして止まらない");
  assert.equal(again.step, "analyze");
  // 2回目も同じ手順で終えられる（write は既存の retrospective.md への追記で完了する）
  report(directory, "plan", "analyze", "--skill", "retrospective", "--result", "done");
  assert.equal(report(directory, "plan", "write", "--skill", "retrospective", "--result", "done").kind, "done");
});

test("retrospective: prompt で辞退したあとも、restart で区切れば確認から聞き直す", (t) => {
  const directory = workspace(t, true);
  configure(directory, 'retrospective = "prompt"');
  report(directory, "plan", "confirm", "--skill", "retrospective", "--result", "skipped", "--reason", "不要");
  succeeds(directory, "step", "restart", "plan", "001", "--skill", "retrospective", "--reason", "PR レビュー対応の振り返り");
  assert.equal(next(directory, "plan", "--skill", "retrospective").step, "confirm");
});

test("retrospective: 内部スキル以外は --skill に指定できない", (t) => {
  const directory = workspace(t, true);
  const result = cli(directory, "step", "next", "plan", "001", "--skill", "planner");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /retrospective/);
});

// ---------------------------------------------------------------------------
// close-cycle

test("close-cycle: サイクル直下に記録し、収集 → G10 → 書き込み → 終了 → PR → 別の PR にするもの の順に進む", (t) => {
  const directory = workspace(t, true);
  const first = next(directory, "close");
  assert.equal(first.skill, "close-cycle");
  assert.equal(first.kind, "run");
  assert.equal(first.step, "collect", "CLOSE 自身の振り返りは行わない");

  const gate = report(directory, "close", "collect", "--result", "done");
  assert.equal(gate.kind, "gate");
  assert.equal(gate.step, "G10");
  assert.equal(report(directory, "close", "G10", "--result", "approved", "--input", "OK").step, "write");
  assert.equal(report(directory, "close", "write", "--result", "done").step, "close");

  const early = cli(directory, "step", "report", "close", "close", "001", "--result", "done");
  assert.equal(early.status, 1, "cycle close の前は終了を受け付けない");
  succeeds(directory, "cycle", "close", "001", "--summary", "テスト");
  assert.equal(report(directory, "close", "close", "--result", "done").step, "pr");
  const followups = report(directory, "close", "pr", "--result", "done", "--pr", "https://github.com/o/r/pull/1");
  assert.equal(followups.step, "followups");
  assert.deepEqual(followups.args, { guideReview: false, guideReviewReason: "予測と実測の両方があるビルドがありません", hookCandidates: false });
  assert.equal(report(directory, "close", "followups", "--result", "done").kind, "done");

  assert.ok(existsSync(join(directory, CYCLE, "progress.jsonl")));
  assert.equal(existsSync(join(directory, CYCLE, "close", "progress.jsonl")), false);
});

test("close-cycle: G10 はどの profile でも返り、振り返りの設定に関わらず収集から始まる", (t) => {
  const directory = workspace(t, true);
  configure(directory, 'profile = "economy"');
  assert.equal(next(directory, "close").step, "collect");
  assert.equal(report(directory, "close", "collect", "--result", "done").step, "G10");
});

test("close-cycle: G10 で差し戻すと答えが返り、collect をやり直すと G10 もやり直しになる", (t) => {
  const directory = workspace(t, true);
  report(directory, "close", "collect", "--result", "done");
  const revise = report(directory, "close", "G10", "--result", "rejected", "--input", "conventions は不要");
  assert.equal(revise.step, "G10");
  assert.equal((revise as { revise?: string }).revise, "conventions は不要");
  report(directory, "close", "G10", "--result", "approved", "--input", "OK");
  assert.equal(report(directory, "close", "collect", "--result", "done").step, "G10");
});

test("close-cycle: followups の指示に、フックの候補の有無を添える", (t) => {
  const directory = workspace(t, true);
  write(directory, `${CYCLE}/build-01/handoff.md`, "# 申し送り\n\n## 永続化すること\n\n- `hook` [高]: .env の編集を止める（2回起きた）\n");
  report(directory, "close", "collect", "--result", "done");
  report(directory, "close", "G10", "--result", "approved", "--input", "OK");
  report(directory, "close", "write", "--result", "done");
  succeeds(directory, "cycle", "close", "001", "--summary", "テスト");
  report(directory, "close", "close", "--result", "done");
  const followups = report(directory, "close", "pr", "--result", "done", "--pr", "https://github.com/o/r/pull/1");
  assert.equal(followups.args?.["hookCandidates"], true);
});
