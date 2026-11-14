import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { branchName, parseBranch } from "../scripts/lib/branch.mts";
import { currentMonth } from "../scripts/lib/patch.mts";
import { collectPromotions } from "../scripts/lib/promotions.mts";
import { skipTargetOf } from "../scripts/lib/reviewers.mts";
import { cli, cliInput, cliWith, succeeds, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";

const MONTH = currentMonth();
const PHASE = `patch-${MONTH}-list-sort`;
const ROOT_UNIT = `docs/hikyaku/patches/${MONTH}/list-sort`;
const CYCLE_UNIT = `docs/hikyaku/cycles/001-test/patches/${MONTH}/list-sort`;
const SESSION = "s-patch";

function git(directory: string, ...args: string[]): string {
  const run = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

/** base_branch を main にしてコミットしたワークスペース（サイクル 001-test あり） */
function committed(t: TestContext): string {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\nbase_branch = "main"\n');
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "init");
  return directory;
}

function json(directory: string, ...args: string[]): Record<string, any> {
  return JSON.parse(succeeds(directory, ...args, "--json"));
}

function report(t: TestContext, directory: string, step: string, ...extra: string[]): Record<string, any> {
  const env = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CONFIG_DIR: temporaryDirectory(t) };
  const result = cliWith(directory, env, "step", "report", PHASE, step, ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).directive;
}

test("patch: ブランチ名は区切りに関わらず patch/YYYYMM/slug で、末尾がフェーズ名の slug も取り違えない", () => {
  const slash = { prefix: "hikyaku", separator: "/" };
  const dash = { prefix: "hikyaku", separator: "-" };
  assert.equal(branchName(slash, "patch-202611-list-sort"), "hikyaku/patch/202611/list-sort");
  assert.equal(branchName(dash, "patch-202611-list-sort", "001-test"), "hikyaku-patch-202611-list-sort");
  assert.deepEqual(parseBranch(slash, "hikyaku/patch/202611/list-sort"), { cycle: undefined, phase: "patch-202611-list-sort" });
  assert.deepEqual(parseBranch(dash, "hikyaku-patch-202611-list-sort"), { cycle: undefined, phase: "patch-202611-list-sort" });
  assert.deepEqual(parseBranch(slash, "hikyaku/patch/202611/close"), { cycle: undefined, phase: "patch-202611-close" });
  assert.equal(parseBranch(slash, "hikyaku/patch/202613/x"), undefined, "月が不正");
  assert.equal(parseBranch(slash, "hikyaku/patch/202611/a/b"), undefined, "slug に区切りを含む");
  assert.deepEqual(parseBranch(slash, "hikyaku/001-test/build-01"), { cycle: "001-test", phase: "build-01" });
});

test("patch: reviewers_skip の単位は patch", () => {
  assert.equal(skipTargetOf("patch-202611-list-sort"), "patch");
  assert.equal(skipTargetOf("build-01"), "build");
});

test("CLI: patch resolve はサイクルを推測せず、--cycle を渡したときだけサイクルに属す", (t) => {
  const directory = committed(t);
  succeeds(directory, "cycle", "use", "001");

  const independent = json(directory, "patch", "resolve", "List Sort");
  assert.equal(independent["phase"], PHASE);
  assert.equal(independent["cycle"], null, ".hikyaku.local の栞からサイクルを選ばない");
  assert.equal(independent["branch"], `hikyaku/patch/${MONTH}/list-sort`);
  assert.equal(independent["startPoint"], "main");
  assert.equal(independent["unitDirectory"], ROOT_UNIT);
  assert.equal(independent["resume"], false);

  succeeds(directory, "tasklist", "add", "001", "--title", "export", "--peak", "350k");
  const related = json(directory, "patch", "resolve", "list-sort", "--cycle", "001");
  assert.equal(related["cycle"], "001-test");
  assert.equal(related["unitDirectory"], CYCLE_UNIT);
  assert.deepEqual(related["pendingBuilds"], ["build-01"]);
});

test("CLI: patch resolve は同じ月の同じ slug の記録があれば conflict を返し、patch のブランチでは再開として扱う", (t) => {
  const directory = committed(t);
  write(directory, `${ROOT_UNIT}/progress.jsonl`, "");
  assert.match(String(json(directory, "patch", "resolve", "list-sort")["conflict"]), /同じ名前の patch の記録/);

  git(directory, "switch", "-q", "-c", `hikyaku/patch/${MONTH}/list-sort`);
  const resumed = json(directory, "patch", "resolve", "other-name");
  assert.equal(resumed["resume"], true);
  assert.equal(resumed["phase"], PHASE);
  assert.equal(resumed["conflict"], null);
});

test("CLI: 統合ブランチ（未マージの conductor ブランチ）から切った patch は、そこへ PR を向ける", (t) => {
  const directory = committed(t);
  git(directory, "switch", "-q", "-c", "hikyaku/001-test/conductor");
  git(directory, "commit", "-q", "--allow-empty", "-m", "builds");
  git(directory, "switch", "-q", "main");

  assert.equal(json(directory, "patch", "resolve", "list-sort", "--cycle", "001")["startPoint"], "hikyaku/001-test/conductor");

  git(directory, "switch", "-q", "hikyaku/001-test/conductor");
  const verify = cli(directory, "branch", "verify", PHASE, "001", "--json");
  assert.equal(verify.status, 2);
  assert.equal(JSON.parse(verify.stdout).onBaseBranch, true, "統合ブランチに居るなら、まだ切っていないだけ");

  git(directory, "switch", "-q", "-c", `hikyaku/patch/${MONTH}/list-sort`);
  assert.equal(json(directory, "pr", "base", PHASE, "001", "--no-fetch")["base"], "hikyaku/001-test/conductor");
  // サイクルに属さない patch はデフォルトブランチへ向く
  assert.equal(json(directory, "pr", "base", PHASE, "--no-fetch")["base"], "main");
});

test("CLI: サイクルに属さない patch の手順は、合意・Draft PR・実装・公開まで進み、永続化が無ければ P2 を出さない", (t) => {
  const directory = committed(t);
  git(directory, "switch", "-q", "-c", `hikyaku/patch/${MONTH}/list-sort`);

  assert.equal(json(directory, "step", "next", PHASE)["directive"]["step"], "start");
  report(t, directory, "start", "--result", "done");
  assert.ok(existsSync(join(directory, ROOT_UNIT, "progress.jsonl")));
  report(t, directory, "survey", "--result", "done");
  const fit = report(t, directory, "scope", "--result", "done", "--peak", "200k");
  assert.equal(fit.step, "fit");
  assert.equal(fit.args.overSplit, false);
  assert.equal(report(t, directory, "fit", "--result", "done").step, "P1");
  assert.equal(report(t, directory, "P1", "--result", "approved", "--input", "OK").step, "pr");
  report(t, directory, "pr", "--result", "done", "--pr", "https://github.com/o/r/pull/1");
  report(t, directory, "implement", "--result", "done");
  report(t, directory, "verify", "--result", "done");
  const persist = report(t, directory, "review", "--result", "done");
  assert.equal(persist.step, "persist");
  assert.equal(persist.args.cycle, null);
  const publish = report(t, directory, "persist", "--result", "skipped", "--reason", "永続化するものなし");
  assert.equal(publish.step, "publish");
  assert.equal(publish.args.pr, "https://github.com/o/r/pull/1");
  assert.equal(report(t, directory, "publish", "--result", "done").kind, "done");
});

test("CLI: patch は予測ピークが split_above を超えると fit で知らせ、すべて引き継いだら止まる", (t) => {
  const directory = committed(t);
  git(directory, "switch", "-q", "-c", `hikyaku/patch/${MONTH}/list-sort`);
  report(t, directory, "start", "--result", "done");
  report(t, directory, "survey", "--result", "done");
  const fit = report(t, directory, "scope", "--result", "done", "--peak", "900k");
  assert.equal(fit.args.overSplit, true);
  const stopped = report(t, directory, "fit", "--result", "skipped", "--reason", "002-sort へ引き継いだ");
  assert.equal(stopped.kind, "stop");
  assert.match(stopped.message, /通常のサイクルへ引き継ぎました/);
});

test("CLI: サイクルに属さない patch で永続化するものがあれば、P2 の承認のあとに書き込む", (t) => {
  const directory = committed(t);
  git(directory, "switch", "-q", "-c", `hikyaku/patch/${MONTH}/list-sort`);
  for (const [step, ...extra] of [
    ["start"], ["survey"], ["scope", "--peak", "200k"], ["fit"],
  ]) report(t, directory, step as string, "--result", "done", ...extra);
  report(t, directory, "P1", "--result", "approved", "--input", "OK");
  report(t, directory, "pr", "--result", "done", "--pr", "1");
  for (const step of ["implement", "verify", "review"]) report(t, directory, step, "--result", "done");
  assert.equal(report(t, directory, "persist", "--result", "done").step, "P2");
  assert.equal(report(t, directory, "P2", "--result", "approved", "--input", "overview の置き換え").step, "write");
  assert.equal(report(t, directory, "write", "--result", "done").step, "publish");
});

test("CLI: サイクルに属す patch は handoff.md を書かないと persist を終えられず、close-cycle の候補に入る", (t) => {
  const directory = committed(t);
  git(directory, "switch", "-q", "-c", `hikyaku/patch/${MONTH}/list-sort`);
  const env = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CONFIG_DIR: temporaryDirectory(t) };
  const step = (name: string, ...extra: string[]) => cliWith(directory, env, "step", "report", PHASE, name, "001", ...extra);
  for (const [name, ...extra] of [["start"], ["survey"], ["scope", "--peak", "200k"], ["fit"]]) {
    assert.equal(step(name as string, "--result", "done", ...extra).status, 0);
  }
  assert.ok(existsSync(join(directory, CYCLE_UNIT, "progress.jsonl")));
  // 記録ができたあとは、サイクルを渡さなくても属すサイクルを導く
  assert.equal(json(directory, "step", "next", PHASE)["directive"]["cycle"], "001-test");

  assert.equal(step("P1", "--result", "approved", "--input", "OK").status, 0);
  assert.equal(step("pr", "--result", "done", "--pr", "1").status, 0);
  for (const name of ["implement", "verify", "review"]) assert.equal(step(name, "--result", "done").status, 0);
  const refused = step("persist", "--result", "done");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /handoff\.md/);

  write(directory, `${CYCLE_UNIT}/handoff.md`, "# patch\n\n## 永続化すること\n\n- `overview` [中]: 一覧は更新日の降順（patch で変更）\n");
  const next = JSON.parse(step("persist", "--result", "done", "--json").stdout).directive;
  assert.equal(next.step, "publish", "サイクルに属す patch は P2 を出さない");

  const promotions = collectPromotions(join(directory, "docs/hikyaku/cycles/001-test"));
  assert.ok(promotions.sources.includes(`patches/${MONTH}/list-sort/handoff.md`));
  assert.equal(promotions.candidates[0]?.target, "overview");
});

test("CLI: Stop フックは、現在のブランチの patch の手順が途中なら止め、別のブランチでは patch を見ない", (t) => {
  const directory = committed(t);
  git(directory, "switch", "-q", "-c", `hikyaku/patch/${MONTH}/list-sort`);
  report(t, directory, "start", "--result", "done");
  const hook = () => {
    const input = JSON.stringify({ hook_event_name: "Stop", cwd: directory, session_id: SESSION, stop_hook_active: false });
    const result = cliInput(directory, input, {}, "step", "hook", "stop");
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.match(hook(), /survey/);
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "start");
  git(directory, "switch", "-q", "main");
  git(directory, "merge", "-q", `hikyaku/patch/${MONTH}/list-sort`);
  assert.equal(hook(), "", "patch のブランチに居なければ、マージ済みの patch の記録は読まない");
});

test("CLI: patch prune は、手順を終えた古い月の記録だけを消す", (t) => {
  const directory = committed(t);
  const done = (step: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ at: "2026-01-01T00:00:00.000Z", skill: "patch", step, result: "done", ...extra });
  const finished = ["start", "survey", "scope", "fit", "P1", "pr", "implement", "verify", "review", "publish"].map((step) =>
    step === "scope" ? done(step, { peak: 1000 }) : step === "pr" ? done(step, { pr: "1" }) : step === "P1" ? done(step, { result: "approved" }) : done(step),
  );
  finished.splice(9, 0, JSON.stringify({ at: "2026-01-01T00:00:00.000Z", skill: "patch", step: "persist", result: "skipped", reason: "なし" }));
  write(directory, "docs/hikyaku/patches/202601/finished/progress.jsonl", `${finished.join("\n")}\n`);
  write(directory, "docs/hikyaku/patches/202601/halfway/progress.jsonl", `${done("start")}\n`);
  write(directory, "docs/hikyaku/patches/202605/recent/progress.jsonl", `${finished.join("\n")}\n`);

  const dry = json(directory, "patch", "prune", "--before", "202603", "--dry-run");
  assert.deepEqual(dry["removed"], ["docs/hikyaku/patches/202601/finished"]);
  assert.ok(existsSync(join(directory, "docs/hikyaku/patches/202601/finished")), "--dry-run は消さない");

  json(directory, "patch", "prune", "--before", "202603");
  assert.ok(!existsSync(join(directory, "docs/hikyaku/patches/202601/finished")));
  assert.ok(existsSync(join(directory, "docs/hikyaku/patches/202601/halfway")), "途中のものは残す");
  assert.ok(existsSync(join(directory, "docs/hikyaku/patches/202605/recent")), "--before より後の月は残す");
});

test("CLI: patch の context は永続ドキュメントを返し、サイクルに属すなら要件と設計も返す", (t) => {
  const directory = committed(t);
  write(directory, "docs/hikyaku/cycles/001-test/planning/user-stories.md");
  const independent = json(directory, "context", PHASE);
  assert.equal(independent["cycle"], null);
  assert.ok(!independent["suggestions"].some((s: { origin: string }) => s.origin === "cycle"));
  const related = json(directory, "context", PHASE, "001");
  assert.ok(related["suggestions"].some((s: { ref: string }) => s.ref === "planning/user-stories.md"));
});

test("CLI: review resolve code は patch でも差分の基準を返し、config --no-cycle はサイクルを選ばない", (t) => {
  const directory = committed(t);
  succeeds(directory, "cycle", "use", "001");
  git(directory, "switch", "-q", "-c", `hikyaku/patch/${MONTH}/list-sort`);
  const resolved = json(directory, "review", "resolve", "code", PHASE, "--self", "claude", "--no-fetch");
  assert.equal(resolved["base"]["name"], "main");
  assert.equal(json(directory, "config", "--no-cycle")["cycle"], undefined);
  assert.equal(json(directory, "config")["cycle"], "001-test");
  assert.match(readFileSync(join(directory, ".hikyaku.config"), "utf8"), /base_branch/);
});
