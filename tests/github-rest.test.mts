import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { cliWith, workspace, write } from "./helpers.mts";
import { execFileSync } from "node:child_process";

const CONDUCTOR = "hikyaku/001-test/conductor";
const SHA = "a".repeat(40);
const GRAPHQL_DENIED = "gh: GitHub GraphQL is not available from Claude Code sessions; use the REST API (gh api repos/{owner}/{repo}/...). (HTTP 403)";

interface Route {
  stdout?: unknown;
  stderr?: string;
  code?: number;
}

/**
 * GraphQL が拒まれる環境の gh。gh api の REST は routes（"METHOD パス" → 応答）で返し、それ以外
 * （gh pr view・gh pr ready・gh issue・gh api graphql）は Claude Code のセッションと同じ 403 で失敗する
 */
function cloudGh(t: TestContext, directory: string, routes: Record<string, Route | Route[]>) {
  const bin = join(directory, ".fake-bin");
  write(directory, ".fake-bin/routes.json", JSON.stringify(routes));
  write(directory, ".fake-bin/gh", `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = path.dirname(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify(args) + '\\n');
if (args[0] === '--version') { process.stdout.write('gh version 2.89.0\\n'); process.exit(0); }
if (args[0] !== 'api' || args[1] === 'graphql') { process.stderr.write(${JSON.stringify(GRAPHQL_DENIED)} + '\\n'); process.exit(1); }
const routes = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
const methodAt = args.indexOf('--method');
const method = methodAt === -1 ? 'GET' : args[methodAt + 1];
const key = method + ' ' + args[1];
let route = routes[key] ?? routes[method + ' ' + args[1].split('?')[0]];
if (Array.isArray(route)) {
  // 同じルートを呼ぶたびに次の応答を返す（最後の応答はくり返す）
  const counter = path.join(dir, 'count-' + Buffer.from(key).toString('hex').slice(0, 40));
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  fs.writeFileSync(counter, String(n + 1));
  route = route[Math.min(n, route.length - 1)];
}
if (route === undefined) { process.stderr.write('no route: ' + key + '\\n'); process.exit(1); }
if (route.stderr) process.stderr.write(route.stderr + '\\n');
if (route.stdout !== undefined) process.stdout.write(typeof route.stdout === 'string' ? route.stdout : JSON.stringify(route.stdout));
process.exit(route.code ?? 0);
`);
  chmodSync(join(bin, "gh"), 0o755);
  void t;
  const env = { PATH: `${bin}:${process.env["PATH"]}` };
  return {
    run: (...args: string[]) => cliWith(directory, env, ...args),
    routes: (next: Record<string, Route | Route[]>) => writeFileSync(join(bin, "routes.json"), JSON.stringify(next)),
    calls: (): string[][] => {
      try {
        return readFileSync(join(bin, "calls.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
  };
}

function pull(overrides: Record<string, unknown> = {}) {
  return {
    number: 7, state: "open", draft: false, merged: false,
    base: { ref: CONDUCTOR }, head: { ref: "hikyaku/001-test/build-01", sha: SHA },
    user: { login: "author" }, requested_reviewers: [], requested_teams: [],
    ...overrides,
  };
}

function checkPrRoutes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    "GET repos/{owner}/{repo}/pulls/7": { stdout: pull() },
    "GET repos/{owner}/{repo}/pulls/7/reviews": { stdout: [] },
    "GET repos/{owner}/{repo}/pulls/7/ccr/review_threads": { stdout: [] },
    [`GET repos/{owner}/{repo}/commits/${SHA}/check-runs`]: { stdout: { total_count: 1, check_runs: [{ name: "test", status: "completed", conclusion: "success" }] } },
    [`GET repos/{owner}/{repo}/commits/${SHA}/status`]: { stderr: "gh: Resource not accessible by integration (HTTP 403)", code: 1 },
    ...overrides,
  };
}

test("conductor check-pr: GraphQL が使えなければ REST と CCR のルートで判定し、読めないステータスは警告に残す", (t) => {
  const directory = workspace(t, true);
  const gh = cloudGh(t, directory, checkPrRoutes());
  const result = gh.run("conductor", "check-pr", "7", "001", "--json");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.source, "rest");
  assert.equal(output.headSha, SHA);
  assert.equal(output.warnings.length, 1);
  assert.match(output.warnings[0], /check-runs だけで判定/);
  assert.ok(gh.calls().some((args) => args[1]?.startsWith("repos/{owner}/{repo}/pulls/7/ccr/review_threads")));
});

test("conductor check-pr: REST の経路でも未解決のスレッド・Draft・CI の失敗は通さない", (t) => {
  const directory = workspace(t, true);
  const gh = cloudGh(t, directory, checkPrRoutes({
    "GET repos/{owner}/{repo}/pulls/7/ccr/review_threads": {
      stdout: [
        { is_resolved: true, path: "a.ts", comments: [{ user: { login: "bob" } }] },
        { is_resolved: false, path: "src/b.ts", line: 3, comments: [{ user: { login: "alice" }, html_url: "https://example.test/c/1" }] },
      ],
    },
  }));
  const threads = gh.run("conductor", "check-pr", "7", "001", "--json");
  assert.equal(threads.status, 2, threads.stderr);
  const output = JSON.parse(threads.stdout);
  assert.equal(output.threads.unresolved.length, 1);
  assert.deepEqual([output.threads.unresolved[0].path, output.threads.unresolved[0].line, output.threads.unresolved[0].author], ["src/b.ts", 3, "alice"]);

  gh.routes(checkPrRoutes({
    "GET repos/{owner}/{repo}/pulls/7": { stdout: pull({ draft: true }) },
    [`GET repos/{owner}/{repo}/commits/${SHA}/check-runs`]: { stdout: { total_count: 1, check_runs: [{ name: "test", status: "completed", conclusion: "failure" }] } },
  }));
  const failing = gh.run("conductor", "check-pr", "7", "001");
  assert.equal(failing.status, 2);
  assert.match(failing.stderr + failing.stdout, /Draft/);
  assert.match(failing.stderr + failing.stdout, /CI が失敗/);
});

test("conductor check-pr: スレッドの応答の形が分からなければ判定せずに終了コード 1", (t) => {
  const directory = workspace(t, true);
  const gh = cloudGh(t, directory, checkPrRoutes({
    "GET repos/{owner}/{repo}/pulls/7/ccr/review_threads": { stdout: [{ path: "a.ts" }] },
  }));
  const result = gh.run("conductor", "check-pr", "7", "001");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /解決済みかどうかの欄がありません/);
});

test("conductor check-pr: REST で見えない @copilot の依頼は、Bot のレビューが付くまで待つ", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[conductor]\nphase_reviewers = ["@copilot"]\n');
  const gh = cloudGh(t, directory, checkPrRoutes());
  const waiting = gh.run("conductor", "check-pr", "7", "001", "--json");
  assert.equal(waiting.status, 2, waiting.stderr);
  const output = JSON.parse(waiting.stdout);
  assert.equal(output.waiting, true);
  assert.ok(output.problems.some((problem: string) => /@copilot/.test(problem)));

  gh.routes(checkPrRoutes({
    "GET repos/{owner}/{repo}/pulls/7/reviews": { stdout: [{ user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" }, state: "COMMENTED" }] },
  }));
  const reviewed = gh.run("conductor", "check-pr", "7", "001", "--json");
  assert.equal(reviewed.status, 0, reviewed.stderr);
});

test("pr ready: GraphQL が使えなければ REST で読み、CCR のルートで Ready にする", (t) => {
  const directory = workspace(t, true);
  const gh = cloudGh(t, directory, {
    "GET repos/{owner}/{repo}/pulls/7": { stdout: pull({ draft: true, base: { ref: "main" } }) },
    "POST repos/{owner}/{repo}/pulls/7/ccr/ready_for_review": { stdout: {} },
  });
  const result = gh.run("pr", "ready", "plan", "001", "--pr", "7", "--json");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual([output.ready, output.applied, output.via], [true, true, "rest"]);
  assert.ok(gh.calls().some((args) => args[1] === "repos/{owner}/{repo}/pulls/7/ccr/ready_for_review" && args.includes("POST")));

  const dryRun = gh.run("pr", "ready", "plan", "001", "--pr", "7", "--dry-run", "--json");
  assert.equal(JSON.parse(dryRun.stdout).ready, true);
  assert.equal(gh.calls().filter((args) => args[1]?.endsWith("ready_for_review")).length, 1);
});

test("pr request-reviewers: GraphQL が使えなければ人は REST で依頼し、@copilot は manual で返す", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[conductor]\nphase_reviewers = ["alice", "org/team", "@copilot"]\n');
  const gh = cloudGh(t, directory, {
    "GET repos/{owner}/{repo}/pulls/7": { stdout: pull() },
    "GET repos/{owner}/{repo}/pulls/7/reviews": { stdout: [] },
    "POST repos/{owner}/{repo}/pulls/7/requested_reviewers": { stdout: {} },
  });
  const result = gh.run("pr", "request-reviewers", "build-01", "001", "--pr", "7", "--json");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual([output.applied, output.reason, output.requested], [false, "graphql-unavailable", true]);
  assert.match(output.manual, /@copilot/);
  const post = gh.calls().find((args) => args[1] === "repos/{owner}/{repo}/pulls/7/requested_reviewers");
  assert.ok(post !== undefined);
  assert.ok(post.includes("reviewers[]=alice"));
  assert.ok(post.includes("team_reviewers[]=team"));
  assert.ok(!post.some((arg) => /copilot/.test(arg)));
});

function onBranch(directory: string, branch: string): void {
  execFileSync("git", ["checkout", "-q", "-b", branch], { cwd: directory });
}

test("pr create: 開いている PR が無ければ Draft で作り、あれば作らずに返す", (t) => {
  const directory = workspace(t, true);
  onBranch(directory, "hikyaku/001-test/build-01");
  write(directory, "body.md", "本文\n");
  const created = { number: 12, html_url: "https://github.com/o/r/pull/12", title: "t", draft: true };
  const gh = cloudGh(t, directory, {
    "GET repos/{owner}/{repo}/pulls": { stdout: [] },
    "POST repos/{owner}/{repo}/pulls": { stdout: created },
  });
  const args = ["pr", "create", "build-01", "001", "--base", CONDUCTOR, "--body-file", "body.md", "--build-title", "題", "--json"];
  const result = gh.run(...args);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual([output.pr, output.url, output.created, output.draft, output.base, output.head], [12, created.html_url, true, true, CONDUCTOR, "hikyaku/001-test/build-01"]);
  const post = gh.calls().find((call) => call.includes("POST"));
  assert.ok(post?.includes("draft=true"));
  assert.ok(post?.includes("body=本文\n"));
  assert.ok(post?.some((arg) => arg.startsWith("title=") && arg.includes("題")));

  gh.routes({ "GET repos/{owner}/{repo}/pulls": { stdout: [{ number: 9, html_url: "https://github.com/o/r/pull/9", title: "既存", draft: true, head: { ref: "hikyaku/001-test/build-01" } }] } });
  const existing = JSON.parse(gh.run(...args).stdout);
  assert.deepEqual([existing.pr, existing.created], [9, false]);

  const dry = gh.run("pr", "create", "build-01", "001", "--base", CONDUCTOR, "--dry-run", "--json");
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).pr, 9);
});

test("pr create: Draft に対応していなければ Draft を外して作り直す。別のブランチでは作らない", (t) => {
  const directory = workspace(t, true);
  write(directory, "body.md", "本文\n");
  const gh = cloudGh(t, directory, { "GET repos/{owner}/{repo}/pulls": { stdout: [] } });
  const wrong = gh.run("pr", "create", "build-01", "001", "--base", CONDUCTOR, "--body-file", "body.md");
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /build-01 のブランチ/);

  onBranch(directory, "hikyaku/001-test/build-01");
  gh.routes({
    "GET repos/{owner}/{repo}/pulls": { stdout: [] },
    "POST repos/{owner}/{repo}/pulls": [
      { stderr: "gh: Draft pull requests are not supported in this repository. (HTTP 422)", code: 1 },
      { stdout: { number: 13, html_url: "https://github.com/o/r/pull/13", draft: false } },
    ],
  });
  const unsupported = gh.run("pr", "create", "build-01", "001", "--base", CONDUCTOR, "--body-file", "body.md", "--json");
  assert.equal(unsupported.status, 0, unsupported.stderr);
  assert.deepEqual([JSON.parse(unsupported.stdout).pr, JSON.parse(unsupported.stdout).draft], [13, false]);
  const posts = gh.calls().filter((call) => call.includes("POST"));
  assert.deepEqual(posts.map((call) => call.find((arg) => arg.startsWith("draft="))), ["draft=true", "draft=false"]);
});

test("pr update-body: REST で本文を差し替える", (t) => {
  const directory = workspace(t, true);
  write(directory, "body.md", "新しい本文\n");
  const gh = cloudGh(t, directory, { "PATCH repos/{owner}/{repo}/pulls/7": { stdout: {} } });
  const result = gh.run("pr", "update-body", "--pr", "7", "--body-file", "body.md", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).updated, true);
  assert.ok(gh.calls().some((call) => call.includes("PATCH") && call.includes("body=新しい本文\n")));
});

test("external sync: GraphQL が使えなければ REST で issue を作り、参照を記録する", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[external]\ntarget = "github"\n');
  const gh = cloudGh(t, directory, { "POST repos/{owner}/{repo}/issues": { stdout: { number: 5, html_url: "https://github.com/o/r/issues/5" } } });
  const result = gh.run("external", "sync", "001", "--json");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual([output.applied, output.action], [true, "created"]);
  assert.match(output.ref, /5/);
  assert.match(readFileSync(join(directory, "docs/hikyaku/cycles.md"), "utf8"), /issues\/5|#5/);
});
