import assert from "node:assert/strict";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { cliWith, workspace, write } from "./helpers.mts";

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

test("pr ready: 不明な状態と公開失敗は成功扱いせず、再試行できる", (t) => {
  const gh = fakeGh(t);
  const args = ["plan", "001", "--pr", "7", "--json"];
  const valid = gh.env.VIEW;
  for (const view of ['{}', '{"number":7,"state":"CLOSED","isDraft":true,"baseRefName":"main"}']) {
    gh.env.VIEW = view;
    assert.equal(gh.run(...args).status, 1);
  }
  gh.env.VIEW = valid;
  gh.env.FAIL_READY = "1";
  const failed = gh.run(...args);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /再実行/);
  gh.env.FAIL_READY = "0";
  assert.equal(gh.run(...args).status, 0);
});
