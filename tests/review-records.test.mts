import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, cycle, succeeds, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";
import { collectReviewRecords, heavyCountByCycle, parseReviewRecord, ruleHits, type ReviewRecord } from "../scripts/lib/review-records.mts";

const handoff = (lines: string[]): string => ["# 申し送り", "", "## レビューの記録", "", ...lines, "", "## 残したこと", "", "なし", ""].join("\n");

test("parseReviewRecord: 重さ・rule のパス・要約を読み、rule に当たらない指摘は rule を持たない", () => {
  assert.deepEqual(parseReviewRecord("[重] `rule:.claude/rules/api.md`: 冪等キーが無い"), {
    weight: "重", rule: ".claude/rules/api.md", text: "冪等キーが無い",
  });
  assert.deepEqual(parseReviewRecord("[軽] `-`: 変数名が分かりにくい"), { weight: "軽", rule: undefined, text: "変数名が分かりにくい" });
});

test("parseReviewRecord: 書式に合わない行は理由を返す", () => {
  for (const line of [
    "[中] `rule:.claude/rules/api.md`: 指摘",
    "`rule:.claude/rules/api.md`: 指摘",
    "[重] `constraints`: 指摘",
    "[重] `rule:`: 指摘",
  ]) {
    assert.equal(typeof parseReviewRecord(line), "string", line);
  }
});

test("collectReviewRecords: closed を含む複数サイクルの build-NN/handoff.md を集め、patch と他の節は読まない", (t) => {
  const root = temporaryDirectory(t);
  write(root, "cycles/001-a/build-01/handoff.md", handoff(["- [重] `rule:.claude/rules/api.md`: A", "- [軽] `-`: B"]));
  write(root, "cycles/002-b/build-01/handoff.md", handoff(["- [重] `rule:.claude/rules/api.md`: C"]));
  write(root, "cycles/002-b/build-02/handoff.md", handoff(["- [軽] `rule:.claude/rules/api.md`: D"]));
  write(root, "cycles/001-a/patches/202611/fix-x/handoff.md", handoff(["- [重] `rule:.claude/rules/api.md`: patch"]));
  write(root, "cycles/001-a/build-02/handoff.md", "## 残したこと\n\n- [重] `rule:.claude/rules/api.md`: 別の節\n");
  const cycles = [cycle("001", { slug: "a", status: "closed" }), cycle("002", { slug: "b" })];
  const { records, unparsed } = collectReviewRecords(root, cycles);
  assert.deepEqual(
    records.map((r) => [r.cycle, r.build, r.source, r.text]),
    [
      ["001-a", "build-01", "build-01/handoff.md", "A"],
      ["001-a", "build-01", "build-01/handoff.md", "B"],
      ["002-b", "build-01", "build-01/handoff.md", "C"],
      ["002-b", "build-02", "build-02/handoff.md", "D"],
    ],
  );
  assert.deepEqual(unparsed, []);
});

test("collectReviewRecords: 読めない行は unparsed、「なし」は捨てる", (t) => {
  const root = temporaryDirectory(t);
  write(root, "cycles/001-a/build-01/handoff.md", handoff(["- なし", "- [重] rule:.claude/rules/a.md 指摘"]));
  const { records, unparsed } = collectReviewRecords(root, [cycle("001", { slug: "a" })]);
  assert.deepEqual(records, []);
  assert.equal(unparsed.length, 1);
  assert.equal(unparsed[0]?.source, "001-a/build-01/handoff.md");
  assert.equal(unparsed[0]?.line, "[重] rule:.claude/rules/a.md 指摘");
});

const record = (cycleName: string, weight: "重" | "軽", rule: string | undefined): ReviewRecord => ({
  cycle: cycleName, build: "build-01", source: "build-01/handoff.md", weight, rule, text: "x",
});

test("ruleHits: rule ごとに回数・重い指摘・出どころを数え、rule の無い記録は数えない", () => {
  const hits = ruleHits([
    record("001-a", "重", ".claude/rules/api.md"),
    record("001-a", "軽", ".claude/rules/api.md"),
    record("002-b", "重", ".claude/rules/api.md"),
    record("002-b", "重", undefined),
  ]);
  assert.deepEqual([...hits.keys()], [".claude/rules/api.md"]);
  assert.equal(hits.get(".claude/rules/api.md")?.count, 3);
  assert.equal(hits.get(".claude/rules/api.md")?.heavy, 2);
  assert.equal(hits.get(".claude/rules/api.md")?.sources.length, 3);
});

test("heavyCountByCycle: サイクルごとの重い指摘の数（rule に当たらない重も含む）", () => {
  const counts = heavyCountByCycle([
    record("001-a", "重", ".claude/rules/api.md"),
    record("001-a", "重", undefined),
    record("001-a", "軽", undefined),
    record("002-b", "軽", ".claude/rules/api.md"),
  ]);
  assert.equal(counts.get("001-a"), 2);
  assert.equal(counts.get("002-b"), 0);
});

// ---------------------------------------------------------------------------
// hikyaku rules candidates（一時リポジトリ）

const DAY = 24 * 60 * 60 * 1000;

function git(directory: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: { ...testEnvironment(), ...env }, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

/** paths を、実行時刻の daysAgo 日前（正午）の日時でコミットする */
function commitAt(directory: string, paths: string[], daysAgo: number): void {
  const at = new Date(Date.now() - daysAgo * DAY - 60 * 60 * 1000).toISOString();
  git(directory, ["add", "--", ...paths]);
  git(directory, ["commit", "-q", "-m", `${daysAgo} days ago`], { GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at });
}

/** サイクル 001-test（closed）と 002-second を持つワークスペース */
function twoCycles(t: Parameters<typeof workspace>[0]): string {
  const directory = workspace(t, true);
  succeeds(directory, "cycle", "new", "second", "--profile", "standard");
  const cycles = "docs/hikyaku/cycles.md";
  write(directory, cycles, readFileSync(join(directory, cycles), "utf8").replace(/^(\| 001 \| test \| )active/m, "$1closed"));
  return directory;
}

const RULE_API = "---\npaths:\n  - \"src/api/**\"\nprevents: 二重課金\nbasis: 決済 API\nimportance: 高\n---\n\n# api\n\n- 冪等キーを付ける\n";

interface CandidatesOutput {
  threshold: number;
  candidates: { path: string; kind: string; hits?: number; heavy?: number; lastTouchedDays?: number; reasons: Record<string, string> }[];
}

test("rules candidates: サイクルをまたいで閾値に達した rule が移す候補に並び、1サイクルだけでは並ばない", (t) => {
  const directory = twoCycles(t);
  write(directory, ".claude/rules/api.md", RULE_API);
  write(directory, "src/api/x.ts", "export {};\n");
  write(directory, "docs/hikyaku/cycles/001-test/build-01/handoff.md", handoff([
    "- [重] `rule:.claude/rules/api.md`: 1", "- [重] `rule:.claude/rules/api.md`: 2",
  ]));
  commitAt(directory, ["."], 1);

  const one = JSON.parse(succeeds(directory, "rules", "candidates", "--json")) as CandidatesOutput;
  assert.equal(one.threshold, 3);
  assert.equal(one.candidates.filter((c) => c.kind === "move").length, 0);

  write(directory, "docs/hikyaku/cycles/002-second/build-01/handoff.md", handoff(["- [軽] `rule:.claude/rules/api.md`: 3"]));
  const both = JSON.parse(succeeds(directory, "rules", "candidates", "--json")) as CandidatesOutput;
  const move = both.candidates.find((c) => c.kind === "move");
  assert.equal(move?.path, ".claude/rules/api.md");
  assert.equal(move?.hits, 3);
  assert.equal(move?.heavy, 2);
});

test("rules candidates: 各行に最終変更からの日数と理由が出る。日数は paths に当たるファイルから、一致しない rule は rule 自身から", (t) => {
  const directory = twoCycles(t);
  write(directory, "src/api/x.ts", "export {};\n");
  commitAt(directory, ["src/api/x.ts"], 400);
  write(directory, ".claude/rules/old.md", "---\npaths: legacy/**\n---\n\n古い\n");
  commitAt(directory, [".claude/rules/old.md"], 250);
  write(directory, ".claude/rules/api.md", RULE_API);
  write(directory, "docs/hikyaku/cycles/002-second/build-01/handoff.md", handoff([1, 2, 3].map((n) => `- [軽] \`rule:.claude/rules/api.md\`: ${n}`)));
  commitAt(directory, ["."], 2);

  const output = JSON.parse(succeeds(directory, "rules", "candidates", "--json")) as CandidatesOutput;
  const api = output.candidates.find((c) => c.path === ".claude/rules/api.md");
  assert.equal(api?.lastTouchedDays, 400, "rule ファイル自身の 2 日ではない");
  assert.deepEqual(api?.reasons, { prevents: "二重課金", basis: "決済 API", importance: "高" });
  const old = output.candidates.find((c) => c.path === ".claude/rules/old.md");
  assert.equal(old?.kind, "stale");
  assert.equal(old?.lastTouchedDays, 250);

  const text = succeeds(directory, "rules", "candidates");
  assert.match(text, /api\.md.*400 日.*防ぐ: 二重課金 \/ 立つ: 決済 API \/ 重要度: 高/);
  assert.match(text, /old\.md.*一致しない.*250 日/);
});

test("rules candidates: 一致しない rule と存在しない rule を並べるだけで、ファイルを変えず終了コード 0", (t) => {
  const directory = twoCycles(t);
  write(directory, ".claude/rules/old.md", "---\npaths: legacy/**\n---\n\n古い\n");
  write(directory, "docs/hikyaku/cycles/001-test/build-01/handoff.md", handoff(["- [軽] `rule:.claude/rules/gone.md`: 消えた rule"]));
  commitAt(directory, ["."], 1);
  const before = readFileSync(join(directory, ".claude/rules/old.md"), "utf8");

  const result = cli(directory, "rules", "candidates");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /old\.md\s+一致しない/);
  assert.match(result.stdout, /gone\.md\s+記録にあるが無い/);
  assert.doesNotMatch(result.stdout, /移すべき|消してください|削除します/);
  assert.equal(cli(directory, "rules", "check").status, 2, "check なら一致しない rule で 2");
  assert.equal(git(directory, ["status", "--porcelain"]), "");
  assert.equal(readFileSync(join(directory, ".claude/rules/old.md"), "utf8"), before);
});
