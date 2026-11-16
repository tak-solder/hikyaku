import assert from "node:assert/strict";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { cliWith, withoutGh, workspace, write } from "./helpers.mts";

function fakeGh(t: TestContext, extra: NodeJS.ProcessEnv = {}) {
  const directory = workspace(t, true);
  const bin = join(directory, "bin");
  write(directory, "bin/gh", `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.CALLS, process.argv.slice(2).join(' ') + '\\n');
if (process.argv[3] === 'view') process.stdout.write(process.env.VIEW);
else if (process.argv[3] === 'ready') process.exit(process.env.FAIL_READY === '1' ? 1 : 0);
else process.exit(1);
`);
  chmodSync(join(bin, "gh"), 0o755);
  const calls = join(directory, "calls");
  const env: NodeJS.ProcessEnv = { PATH: `${bin}:${process.env.PATH}`, CALLS: calls,
    VIEW: JSON.stringify({ number: 7, state: "OPEN", isDraft: true, baseRefName: "main" }), ...extra };
  return { directory, env, calls: () => readFileSync(calls, "utf8"),
    run: (...args: string[]) => cliWith(directory, env, "pr", "ready", ...args) };
}

test("pr ready: 設定で公開し、dry-run・設定オフ・子・Ready 済みは変更しない", (t) => {
  const gh = fakeGh(t);
  const check = (...args: string[]) => {
    const r = gh.run("build-01", "001", "--pr", "7", "--json", ...args);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.equal(check("--dry-run").ready, true);
  assert.doesNotMatch(gh.calls(), /pr ready/);
  write(gh.directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[pr]\nauto_ready = false\n');
  assert.equal(check().reason, "auto-ready-off");
  write(gh.directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n');
  gh.env.HIKYAKU_CONDUCTOR_CHILD = "1";
  assert.equal(check().reason, "conductor-child");
  delete gh.env.HIKYAKU_CONDUCTOR_CHILD;
  gh.env.VIEW = JSON.stringify({ number: 7, state: "OPEN", isDraft: false, baseRefName: "main" });
  assert.equal(check().reason, "already-ready");
  assert.doesNotMatch(gh.calls(), /pr ready/);
  gh.env.VIEW = JSON.stringify({ number: 7, state: "OPEN", isDraft: true, baseRefName: "main" });
  assert.equal(check().ready, true);
  assert.match(gh.calls(), /pr ready 7/);
});

test("pr ready: 監督は設定オフでも conductor 向け PR を公開し、別の向き先と子の上書きを拒否する", (t) => {
  const gh = fakeGh(t);
  write(gh.directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[pr]\nauto_ready = false\n');
  const args = ["build-01", "001", "--pr", "7", "--for-merge", "--json"];
  assert.equal(gh.run(...args).status, 1);
  gh.env.VIEW = JSON.stringify({ number: 7, state: "OPEN", isDraft: true, baseRefName: "hikyaku/001-test/conductor" });
  const r = gh.run(...args);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ready, true);
  gh.env.HIKYAKU_CONDUCTOR_CHILD = "1";
  assert.equal(gh.run(...args).status, 1);
});

test("pr ready: 不明な状態は成功扱いせず終了コード 1。公開の失敗は止めずに代わりに行うことを返す", (t) => {
  const gh = fakeGh(t);
  const args = ["plan", "001", "--pr", "7", "--json"];
  const valid = gh.env.VIEW;
  for (const view of ['{}', 'not json', '{"number":7,"state":"CLOSED","isDraft":true,"baseRefName":"main"}']) {
    gh.env.VIEW = view;
    assert.equal(gh.run(...args).status, 1);
  }
  gh.env.VIEW = valid;
  gh.env.FAIL_READY = "1";
  const failed = gh.run(...args);
  assert.equal(failed.status, 0, failed.stderr);
  const output = JSON.parse(failed.stdout);
  assert.deepEqual([output.ready, output.applied, output.reason, output.stage], [false, false, "gh-failed", "gh pr ready"]);
  assert.match(output.manual, /gh pr ready 7/);
  gh.env.FAIL_READY = "0";
  assert.equal(JSON.parse(gh.run(...args).stdout).applied, true);
});

test("pr ready: conductor の子は gh を呼ばずに Draft のまま返す", (t) => {
  const gh = fakeGh(t);
  gh.env.HIKYAKU_CONDUCTOR_CHILD = "1";
  gh.env.VIEW = "not json";
  const result = gh.run("build-01", "001", "--pr", "12", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([JSON.parse(result.stdout).reason, JSON.parse(result.stdout).pr], ["conductor-child", 12]);
  const url = gh.run("build-01", "001", "--pr", "https://github.com/o/r/pull/34", "--json");
  assert.equal(JSON.parse(url.stdout).pr, 34);
  assert.throws(() => gh.calls(), "gh を一度も呼ばない");
});

test("pr ready: gh が無い環境では止めず、--for-merge だけは終了コード 1", (t) => {
  const directory = workspace(t, true);
  const result = withoutGh(t, directory, "pr", "ready", "build-01", "001", "--pr", "7", "--json");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual([output.ready, output.applied, output.reason, output.stage], [false, false, "gh-unavailable", "gh pr view"]);
  assert.match(output.manual, /Draft のまま/);
  const forMerge = withoutGh(t, directory, "pr", "ready", "build-01", "001", "--pr", "7", "--for-merge");
  assert.equal(forMerge.status, 1);
  assert.match(forMerge.stderr, /取り込まずに止まってください/);
});

test("pr ready: URL先と既定リポジトリが異なっても、確認したPRのURLを公開に使う", (t) => {
  const gh = fakeGh(t, { GH_REPO: "fork/project" });
  const pr = "https://github.com/upstream/project/pull/7";
  for (const forMerge of [false, true]) {
    gh.env.VIEW = JSON.stringify({ number: 7, state: "OPEN", isDraft: true,
      baseRefName: forMerge ? "hikyaku/001-test/conductor" : "main" });
    const result = gh.run("build-01", "001", "--pr", pr, ...(forMerge ? ["--for-merge"] : []), "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.match(gh.calls(), /pr view https:\/\/github\.com\/upstream\/project\/pull\/7 --json/);
    assert.match(gh.calls(), /pr ready https:\/\/github\.com\/upstream\/project\/pull\/7/);
    assert.doesNotMatch(gh.calls(), /pr ready 7/);
  }
});

test("pr ready: 再実行と手動公開の案内も元のPRのURLを保持する", (t) => {
  const gh = fakeGh(t, { GH_REPO: "fork/project", FAIL_READY: "1" });
  const pr = "https://github.com/upstream/project/pull/7";
  gh.env.VIEW = JSON.stringify({ number: 7, state: "OPEN", isDraft: true, baseRefName: "hikyaku/001-test/conductor" });
  const failed = gh.run("build-01", "001", "--pr", pr, "--for-merge", "--json");
  assert.equal(failed.status, 1);
  assert.ok(failed.stderr.includes(`--pr ${pr} --for-merge`), failed.stderr);
  assert.doesNotMatch(failed.stderr, /--pr 7/);

  gh.env.FAIL_READY = "0";
  write(gh.directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[pr]\nauto_ready = false\n');
  const manual = gh.run("plan", "001", "--pr", pr);
  assert.equal(manual.status, 0, manual.stderr);
  assert.ok(manual.stdout.includes(`gh pr ready ${pr}`), manual.stdout);
  assert.doesNotMatch(manual.stdout, /gh pr ready 7/);
});
