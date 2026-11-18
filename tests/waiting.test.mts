/**
 * 待っている問いとビルドの導出（build-07。ADR conductor-runs-to-end）。
 * conductor waiting と next --json の waiting は同じ deriveWaiting を使う
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import { snapshot, succeeds, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";

function git(directory: string, ...args: string[]): string {
  const run = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(run.status, 0, `git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

/** builds の依存（[id, deps]）を tasklist に登録したワークスペース */
function cycleWith(t: TestContext, builds: [string, string?][]): string {
  const directory = workspace(t, true);
  for (const [, deps] of builds) {
    succeeds(directory, "tasklist", "add", "001", "--title", "ビルド", "--peak", "350k", ...(deps === undefined ? [] : ["--deps", deps]));
  }
  for (const [id] of builds) write(directory, `${CYCLE}/build-${id.padStart(2, "0")}/issue.md`);
  return directory;
}

function openQuestion(directory: string, unit: string, summary = "既存の API を残すか", who = "user"): string {
  return JSON.parse(succeeds(
    directory, "ledger", "open", unit, "001", "--type", "question", "--who", who, "--when", "now", "--summary", summary, "--json",
  )).record.id;
}

interface WaitingJson {
  items: { id: string; source: string; summary: string }[];
  builds: { id: string; waitingFor: string[] }[];
  unavailable: string[];
}

function waiting(directory: string): WaitingJson {
  return JSON.parse(succeeds(directory, "conductor", "waiting", "001", "--json"));
}

function builds(output: WaitingJson): [string, string[]][] {
  return output.builds.map((build) => [build.id, build.waitingFor]);
}

/** main をコミットして origin（bare）へ push する */
function withOrigin(t: TestContext, directory: string): void {
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "main");
  const remote = temporaryDirectory(t);
  git(remote, "init", "--quiet", "--bare");
  git(directory, "remote", "add", "origin", remote);
  git(directory, "push", "-q", "origin", "main");
}

/** ブランチを切って edit を行い、コミットして origin へ push し、main に戻る */
function onBranch(directory: string, branch: string, edit: () => void): void {
  git(directory, "switch", "-q", "-c", branch);
  edit();
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", branch);
  git(directory, "push", "-q", "origin", branch);
  git(directory, "switch", "-q", "main");
}

test("deriveWaiting: 依存しないビルドは待たず、問いを出したビルドと推移的に依存するビルドが待つ", (t) => {
  const directory = cycleWith(t, [["1"], ["2", "1"], ["3"]]);
  const q1 = openQuestion(directory, "build-01");
  assert.deepEqual(builds(waiting(directory)), [["1", [q1]], ["2", [q1]]]);

  const chain = cycleWith(t, [["1"], ["2", "1"], ["3", "2"]]);
  const c1 = openQuestion(chain, "build-01");
  assert.deepEqual(builds(waiting(chain)), [["1", [c1]], ["2", [c1]], ["3", [c1]]]);
});

test("deriveWaiting: architect・plan の問いは全ビルドが待ち、close の問いはどのビルドも待たない", (t) => {
  const directory = cycleWith(t, [["1"], ["2"]]);
  const architect = openQuestion(directory, "architect");
  const close = openQuestion(directory, "close");
  const output = waiting(directory);
  assert.deepEqual(output.items.map((item) => item.id).sort(), [architect, close].sort());
  assert.deepEqual(builds(output), [["1", [architect]], ["2", [architect]]]);

  const planned = cycleWith(t, [["1"], ["2"]]);
  const plan = openQuestion(planned, "plan");
  assert.deepEqual(builds(waiting(planned)), [["1", [plan]], ["2", [plan]]]);
});

test("deriveWaiting: who が user でない・決定済みの question は待ちにしない", (t) => {
  const directory = cycleWith(t, [["1"]]);
  openQuestion(directory, "build-01", "AI が決める", "ai:build-01");
  const decided = openQuestion(directory, "build-01");
  succeeds(directory, "ledger", "decide", "build-01", decided, "001", "--decision", "decided", "--by", "user", "--input", "残す");
  assert.deepEqual(waiting(directory).items, []);
});

test("deriveWaiting: origin のブランチにだけある待ちを読み、同じ ID は1つに重ね、どれかの断面の決定で待ちにしない", (t) => {
  const directory = cycleWith(t, [["1"], ["2"]]);
  withOrigin(t, directory);
  let architect = "";
  onBranch(directory, "hikyaku/001-test/architect", () => {
    architect = openQuestion(directory, "architect", "設計の前提");
  });
  let q1 = "";
  onBranch(directory, "hikyaku/001-test/build-01", () => {
    q1 = openQuestion(directory, "build-01");
  });
  const output = waiting(directory);
  assert.deepEqual(output.items.find((item) => item.id === architect)?.source, "origin/hikyaku/001-test/architect");
  assert.deepEqual(output.items.find((item) => item.id === q1)?.source, "origin/hikyaku/001-test/build-01");
  assert.deepEqual(builds(output), [["1", [architect, q1]], ["2", [architect]]]);

  // 作業ツリーにも同じ事項がある（conductor ブランチを取り込んだ）ときは1つに重ねる
  const record = git(directory, "show", `origin/hikyaku/001-test/build-01:${CYCLE}/build-01/decisions.jsonl`);
  write(directory, `${CYCLE}/build-01/decisions.jsonl`, `${record}\n`);
  assert.equal(waiting(directory).items.filter((item) => item.id === q1).length, 1);

  // origin のブランチに決定があれば待ちにしない
  onBranch(directory, "hikyaku/001-test/build-02", () => undefined);
  git(directory, "switch", "-q", "hikyaku/001-test/build-01");
  succeeds(directory, "ledger", "decide", "build-01", q1, "001", "--decision", "decided", "--by", "user", "--input", "残す");
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "decide");
  git(directory, "push", "-q", "origin", "hikyaku/001-test/build-01");
  git(directory, "switch", "-q", "main");
  assert.equal(waiting(directory).items.some((item) => item.id === q1), false);
});

test("deriveWaiting: 読めない断面は unavailable に入れて判定を続け、origin に無いブランチは入れない", (t) => {
  const directory = cycleWith(t, [["1"], ["2"], ["3"]]);
  withOrigin(t, directory);
  onBranch(directory, "hikyaku/001-test/build-02", () => {
    write(directory, `${CYCLE}/build-02/decisions.jsonl`, "{壊れた行\n");
  });
  const q1 = openQuestion(directory, "build-01");
  const output = waiting(directory);
  assert.equal(output.unavailable.length, 1);
  assert.match(output.unavailable[0] ?? "", /build-02/);
  assert.deepEqual(builds(output), [["1", [q1]]]);
});

test("next --json: 依存しないビルドが available に残り、waiting に待つビルドと事項が出る（conductor waiting も同じ）", (t) => {
  const directory = cycleWith(t, [["1"], ["2", "1"], ["3"]]);
  withOrigin(t, directory);
  let q1 = "";
  onBranch(directory, "hikyaku/001-test/build-01", () => {
    q1 = openQuestion(directory, "build-01");
  });
  const before = snapshot(directory);
  const json = JSON.parse(succeeds(directory, "next", "001", "--no-fetch", "--json"));
  assert.ok(json.available.includes("3"));
  assert.deepEqual(json.waiting.items.map((item: { id: string }) => item.id), [q1]);
  assert.deepEqual(json.waiting.builds, [{ id: "1", waitingFor: [q1] }, { id: "2", waitingFor: [q1] }]);
  const text = succeeds(directory, "next", "001", "--no-fetch");
  assert.match(text, /答えを待っているビルド:/);
  assert.match(text, new RegExp(`build-02 .*${q1.replace(".", "\\.")}（既存の API を残すか）`));

  const conductor = JSON.parse(succeeds(directory, "conductor", "waiting", "001", "--json"));
  assert.deepEqual(Object.keys(conductor).filter((key) => ["items", "builds", "unavailable"].includes(key)).sort(), ["builds", "items", "unavailable"]);
  assert.match(succeeds(directory, "conductor", "waiting", "001"), new RegExp(`build-02 .*${q1.replace(".", "\\.")}（既存の API を残すか）`));
  assert.deepEqual(snapshot(directory), before);
});

test("next: 待ちが無ければ waiting は空で、テキストに待ちの節を出さない", (t) => {
  const directory = cycleWith(t, [["1"]]);
  const json = JSON.parse(succeeds(directory, "next", "001", "--no-fetch", "--json"));
  assert.deepEqual(json.waiting, { items: [], builds: [] });
  assert.doesNotMatch(succeeds(directory, "next", "001", "--no-fetch"), /答えを待っているビルド/);
});
