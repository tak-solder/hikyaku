import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: testEnvironment(), timeout: 20_000 });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** origin のデフォルトブランチが trunk で、ローカルに origin/HEAD の参照が無いクローン（push しただけの状態） */
function withOriginWithoutHead(directory: string, bare: string): void {
  git(bare, "init", "--quiet", "--bare", "--initial-branch=trunk");
  git(directory, "add", "-A");
  git(directory, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "init");
  git(directory, "remote", "add", "origin", bare);
  git(directory, "push", "--quiet", "origin", "HEAD:trunk");
  git(directory, "fetch", "--quiet", "origin");
  // git 2.48 以降の fetch は origin/HEAD を作る（remote.<name>.followRemoteHEAD）。参照が無いクローンを作るため消す
  git(directory, "config", "remote.origin.followRemoteHEAD", "never");
  git(directory, "update-ref", "-d", "refs/remotes/origin/HEAD");
}

test("branch verify: origin/HEAD の参照が無ければ origin に問い合わせてデフォルトブランチを決め、参照は書かない", (t) => {
  const directory = workspace(t, true);
  withOriginWithoutHead(directory, temporaryDirectory(t));
  const head = join(directory, ".git", "refs", "remotes", "origin", "HEAD");
  assert.equal(existsSync(head), false);
  git(directory, "switch", "--quiet", "-c", "hikyaku/001-test/build-01");

  const result = cli(directory, "branch", "verify", "build-01", "001", "--json");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual([output.ok, output.baseBranch, output.prBase, output.baseResolved], [true, "trunk", "trunk", true]);
  assert.equal(existsSync(head), false, "git remote set-head 相当の書き込みをしない");
});

test("branch verify: デフォルトブランチを決められなければ、ブランチ名が合っていても終了コード 2", (t) => {
  const directory = workspace(t, true);
  git(directory, "switch", "--quiet", "-c", "hikyaku/001-test/build-01");
  const result = cli(directory, "branch", "verify", "build-01", "001", "--json");
  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual([output.ok, output.prBase, output.baseResolved], [true, null, false]);
  assert.match(result.stderr, /base_branch|set-head/);

  // base_branch を設定すれば決まる
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\nbase_branch = "main"\n');
  const configured = cli(directory, "branch", "verify", "build-01", "001", "--json");
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(JSON.parse(configured.stdout).baseResolved, true);
});

test("branch verify: サイクルに属さないフェーズは、デフォルトブランチが分からなくても止めない", (t) => {
  const directory = workspace(t, false);
  const result = cli(directory, "branch", "verify", "init", "--json");
  // ブランチ名の食い違いでは止まりうるが、デフォルトブランチが分からないことでは止めない
  const output = JSON.parse(result.stdout);
  assert.equal(output.baseResolved, true);
  assert.doesNotMatch(result.stderr, /デフォルトブランチを決められない/);
});
