import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fillPrColumn, parseTasklist, recordedPr, renderTasklistFile, withRecordedPrs } from "../scripts/lib/tasklist.mts";
import type { ProgressEvent } from "../scripts/lib/progress.mts";
import { build, cli, recordBuildPr, snapshot, succeeds, testEnvironment, workspace } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const TASKLIST = `${CYCLE}/tasklist.md`;
const PR = (n: number) => `https://github.com/o/r/pull/${n}`;

function git(directory: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
}

function gitOk(directory: string, ...args: string[]): void {
  const result = git(directory, ...args);
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${String(result.stderr)}`);
}

function commit(directory: string, message: string): void {
  gitOk(directory, "add", "-A");
  gitOk(directory, "commit", "-q", "--allow-empty", "-m", message);
}

function event(overrides: Partial<ProgressEvent>): ProgressEvent {
  return { at: "2026-11-20T00:00:00.000Z", skill: "builder", step: "pr", result: "done", ...overrides };
}

function tableRow(directory: string, id: number): string {
  const line = readFileSync(join(directory, TASKLIST), "utf8").split("\n").find((row) => row.startsWith(`| ${id} `));
  assert.ok(line !== undefined, `build-${id} の行がありません`);
  return line;
}

test("recordedPr: builder の pr の done のうち --pr を添えた最後のものを、step restart の前も含めて読む", () => {
  assert.equal(recordedPr([]), undefined);
  assert.equal(recordedPr([event({ pr: undefined })]), undefined, "--pr の無い done は完了にしない");
  assert.equal(recordedPr([event({ skill: "architect", pr: PR(1) })]), undefined, "builder の記録だけを読む");
  assert.equal(recordedPr([event({ result: "failed", pr: PR(1) })]), undefined);
  assert.equal(
    recordedPr([event({ pr: PR(1) }), event({ step: "*", result: "restart" }), event({ pr: PR(2) })]),
    `[#2](${PR(2)})`,
  );
  assert.equal(recordedPr([event({ pr: PR(1) }), event({ step: "*", result: "restart" })]), `[#1](${PR(1)})`);
  assert.equal(recordedPr([event({ pr: "12" })]), "12", "番号だけの記録もそのまま完了");
});

test("withRecordedPrs: PR 列が空のビルドだけ記録で補い、表には書かず、fillPrColumn で表に書く形になる", () => {
  const builds = [build("1"), build("2", { pr: "[#5](https://example.com/pull/5)" }), build("3")];
  const read: string[] = [];
  const merged = withRecordedPrs(builds, (id) => {
    read.push(id);
    return id === "1" ? [event({ pr: PR(11) })] : [];
  });
  assert.deepEqual(read, ["1", "3"], "PR 列が埋まったビルドの記録は読まない");
  assert.equal(merged[0]?.pr, `[#11](${PR(11)})`);
  assert.equal(merged[0]?.prSource, "record");
  assert.equal(merged[1]?.prSource, undefined);
  assert.equal(merged[2]?.pr, "");

  const rendered = renderTasklistFile("001-test", merged);
  const [first] = parseTasklist(rendered);
  assert.equal(first?.pr, "", "記録から読んだ PR は PR 列に書かない");
  assert.match(rendered, /b01\["build-01: ビルド 1"\]:::merged/, "依存グラフは記録から描く");
  assert.equal(parseTasklist(renderTasklistFile("001-test", fillPrColumn(merged)))[0]?.pr, `[#11](${PR(11)})`);
});

test("CLI: tasklist done は --pr を拒み、完了の記録が無ければ書かず、あれば依存グラフだけを描き直す", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤");
  succeeds(directory, "tasklist", "add", "001", "--title", "API", "--deps", "1");
  commit(directory, "architect");
  const before = snapshot(directory);

  const legacy = cli(directory, "tasklist", "done", "001", "--id", "1", "--pr", PR(42));
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /--pr は廃止/);
  const missing = cli(directory, "tasklist", "done", "001", "--id", "1");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /step report build-01 pr --result done --pr/);
  assert.deepEqual(snapshot(directory), before);

  recordBuildPr(directory, 1, PR(42));
  const recorded = snapshot(directory);
  succeeds(directory, "tasklist", "done", "001", "--id", "build-01", "--dry-run");
  assert.deepEqual(snapshot(directory), recorded);
  succeeds(directory, "tasklist", "done", "001", "--id", "1");

  assert.match(tableRow(directory, 1), /\| — \|$/, "PR 列は書かない");
  const source = readFileSync(join(directory, TASKLIST), "utf8");
  assert.match(source, /b01\["build-01: 基盤"\]:::merged\n {2}b01 --> b02/);
  const output = JSON.parse(succeeds(directory, "tasklist", "read", "001", "--json"));
  assert.equal(output.builds[0].pr, `[#42](${PR(42)})`);
  assert.deepEqual(JSON.parse(succeeds(directory, "next", "001", "--no-fetch", "--json")).available, ["1"], "記録は未コミットなので HEAD では未完了");

  const completed = snapshot(directory);
  assert.equal(cli(directory, "tasklist", "update", "001", "--id", "1", "--title", "変更").status, 1, "完了済みは更新できない");
  assert.deepEqual(snapshot(directory), completed);
});

test("CLI: 隣り合うビルドを並行して完了させても、tasklist.md はコンフリクトせずにマージでき、両方が完了になる", (t) => {
  const directory = workspace(t, true);
  for (const title of ["基盤", "API", "画面"]) succeeds(directory, "tasklist", "add", "001", "--title", title);
  succeeds(directory, "tasklist", "update", "001", "--id", "3", "--deps", "1,2");
  commit(directory, "architect");

  for (const id of [1, 2]) {
    gitOk(directory, "switch", "-q", "-c", `build-${id}`, "main");
    recordBuildPr(directory, id, PR(10 + id));
    succeeds(directory, "tasklist", "done", "001", "--id", String(id));
    commit(directory, `build-${id}`);
  }

  gitOk(directory, "switch", "-q", "main");
  gitOk(directory, "merge", "-q", "--no-edit", "build-1");
  const merged = git(directory, "merge", "--no-edit", "build-2");
  assert.equal(merged.status, 0, `コンフリクトした: ${String(merged.stdout)}${String(merged.stderr)}`);

  const builds = JSON.parse(succeeds(directory, "next", "001", "--no-fetch", "--json"));
  assert.deepEqual(builds.available, ["3"], "HEAD の完了の記録で build-03 が着手可能になる");
  const source = readFileSync(join(directory, TASKLIST), "utf8");
  assert.match(source, /b01\["build-01: 基盤"\]:::merged/);
  assert.match(source, /b02\["build-02: API"\]:::merged/);
});

test("CLI: cycle close は完了の記録から PR 列をまとめて埋め、--dry-run では書かない", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤");
  succeeds(directory, "tasklist", "add", "001", "--title", "API");
  recordBuildPr(directory, 1, PR(11));
  recordBuildPr(directory, 2, PR(12));

  const before = snapshot(directory);
  const dryRun = succeeds(directory, "cycle", "close", "001", "--dry-run");
  assert.match(dryRun, /PR 列 {3}build-01, build-02 を完了の記録から埋めます/);
  assert.deepEqual(snapshot(directory), before);

  const output = JSON.parse(succeeds(directory, "cycle", "close", "001", "--json"));
  assert.deepEqual(output.prColumn, ["1", "2"]);
  assert.match(tableRow(directory, 1), new RegExp(`\\| \\[#11\\]\\(${PR(11).replace(/[./]/g, "\\$&")}\\) \\|$`));
  assert.match(tableRow(directory, 2), /\[#12\]/);
});
