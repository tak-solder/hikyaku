import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { cli, succeeds, testEnvironment, workspace, write } from "./helpers.mts";
import { expandBraces, matchesRule, measureRules, parseRule, ruleCandidates, ruleTouchFiles } from "../scripts/lib/rules.mts";

test("expandBraces: 入れ子とカンマ無しを扱う", () => {
  assert.deepEqual(expandBraces("src/**/*.{ts,tsx}"), ["src/**/*.ts", "src/**/*.tsx"]);
  assert.deepEqual(expandBraces("{a,b{c,d}}/x"), ["a/x", "bc/x", "bd/x"]);
  assert.deepEqual(expandBraces("a{x}b"), ["a{x}b"]);
});

test("matchesRule: ** は階層をまたぎ、* はまたがず、/ の無いパターンはどの階層にも当たる", () => {
  assert.equal(matchesRule(["src/**/*.ts"], "src/a/b/c.ts"), true);
  assert.equal(matchesRule(["src/**/*.ts"], "src/c.ts"), true);
  assert.equal(matchesRule(["src/components/*.tsx"], "src/components/a/b.tsx"), false);
  assert.equal(matchesRule(["*.md"], "docs/a.md"), true);
  assert.equal(matchesRule(["/*.md"], "docs/a.md"), false);
  assert.equal(matchesRule(["/*.md"], "README.md"), true);
  assert.equal(matchesRule(["backend/**"], "backend/app/x.php"), true);
  assert.equal(matchesRule(["src/**/*.{ts,tsx}"], "src/x.tsx"), true);
  assert.equal(matchesRule(["src/a.ts"], "src/axts"), false);
});

test("parseRule: paths をブロックのリスト・インラインのリスト・カンマ区切りで読む", () => {
  assert.deepEqual(parseRule('---\npaths:\n  - "src/**/*.ts"\n  - tests/**\n---\n\n# 本文\n').paths, ["src/**/*.ts", "tests/**"]);
  assert.deepEqual(parseRule('---\npaths: ["a/**", "b/*.{ts,tsx}"]\n---\n本文').paths, ["a/**", "b/*.{ts,tsx}"]);
  assert.deepEqual(parseRule("---\npaths: a/**, b/**\n---\n本文").paths, ["a/**", "b/**"]);
  assert.equal(parseRule("# frontmatter なし\n").paths, undefined);
  // YAML のコメントは glob に含めない。引用符の中と、空白を挟まない # は値の一部
  assert.deepEqual(
    parseRule('---\npaths: # 対象\n  - "src/**" # source files\n  # テストも\n\n  - tests/** #x\n  - "docs/#a/**"\n  - lib/a#b.ts\n---\n本文').paths,
    ["src/**", "tests/**", "docs/#a/**", "lib/a#b.ts"],
  );
  assert.deepEqual(parseRule('---\npaths: ["a/**", "b/**"] # 2つ\n---\n本文').paths, ["a/**", "b/**"]);
  assert.deepEqual(parseRule("---\npaths: a/**, b/** # 2つ\n---\n本文").paths, ["a/**", "b/**"]);
  assert.equal(parseRule("---\npaths: a/**\n---\n本文").body, "本文");
});

test("parseRule: frontmatter の prevents / basis / importance を読み、不正な importance は problems に出す", () => {
  const parsed = parseRule('---\npaths: ["src/api/**"]\nprevents: 二重課金\nbasis: "決済 API の仕様" # 外の前提\nimportance: 高\n---\n本文');
  assert.deepEqual(parsed.paths, ["src/api/**"]);
  assert.deepEqual(parsed.reasons, { prevents: "二重課金", basis: "決済 API の仕様", importance: "高" });
  assert.deepEqual(parsed.problems, []);
  const bad = parseRule("---\npaths: a/**\nimportance: 低\n---\n本文");
  assert.equal(bad.reasons.importance, undefined);
  assert.equal(bad.problems.length, 1);
  assert.match(bad.problems[0] ?? "", /importance/);
});

const measured = (path: string, stale: boolean, reasons = {}) => ({
  path, paths: ["src/**"], characters: 10, reasons, matched: stale ? 0 : 1, share: 0, load: 0, stale, heavy: false,
});
const NOW = new Date("2026-11-16T00:00:00Z");
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

test("ruleCandidates: 回数が閾値と等しければ移す候補、1足りなければ並ばない", () => {
  const input = (count: number) => ({
    measures: [measured(".claude/rules/api.md", false)],
    hits: new Map([[".claude/rules/api.md", { count, heavy: 1, sources: [] }]]),
    threshold: 3,
    lastTouched: new Map([[".claude/rules/api.md", daysAgo(40)]]),
    now: NOW,
  });
  const [move] = ruleCandidates(input(3));
  assert.deepEqual([move?.path, move?.kind, move?.hits, move?.heavy, move?.lastTouchedDays], [".claude/rules/api.md", "move", 3, 1, 40]);
  assert.deepEqual(ruleCandidates(input(2)), []);
});

test("ruleCandidates: 一致しない rule は stale、記録に挙がったが無い rule は閾値に関わらず missing", () => {
  const candidates = ruleCandidates({
    measures: [measured(".claude/rules/old.md", true)],
    hits: new Map([["./.claude/rules/apii.md", { count: 1, heavy: 0, sources: ["001-a/build-01/handoff.md"] }]]),
    threshold: 3,
    lastTouched: new Map([[".claude/rules/old.md", daysAgo(300)]]),
    now: NOW,
  });
  assert.deepEqual(candidates.map((c) => [c.path, c.kind, c.hits, c.lastTouchedDays]), [
    [".claude/rules/old.md", "stale", undefined, 300],
    [".claude/rules/apii.md", "missing", 1, undefined],
  ]);
});

test("ruleCandidates: 最終変更日が分からなければ日数は undefined のまま候補を返す", () => {
  const [move] = ruleCandidates({
    measures: [measured(".claude/rules/api.md", false)],
    hits: new Map([[".claude/rules/api.md", { count: 5, heavy: 0, sources: [] }]]),
    threshold: 3,
    lastTouched: new Map([[".claude/rules/api.md", undefined]]),
    now: NOW,
  });
  assert.deepEqual([move?.kind, move?.lastTouchedDays], ["move", undefined]);
});

test("ruleTouchFiles: paths に当たる追跡ファイル。paths が無い・一致しない rule は rule ファイル自身", () => {
  const files = ["src/api/pay.ts", "src/ui/a.ts", ".claude/rules/api.md"];
  assert.deepEqual(ruleTouchFiles({ path: ".claude/rules/api.md", paths: ["src/api/**"], characters: 1 }, files), ["src/api/pay.ts"]);
  assert.deepEqual(ruleTouchFiles({ path: ".claude/rules/old.md", paths: ["legacy/**"], characters: 1 }, files), [".claude/rules/old.md"]);
  assert.deepEqual(ruleTouchFiles({ path: ".claude/rules/all.md", paths: undefined, characters: 1 }, files), [".claude/rules/all.md"]);
});

test("measureRules: 広さ × 大きさで測り、生成物を分母から除き、一致しない rule を見つける", () => {
  const files = ["src/a.ts", "src/b.ts", "tests/a.test.ts", "docs/x.md", "pnpm-lock.yaml"];
  const { measures, total } = measureRules(
    [
      { path: ".claude/rules/wide.md", paths: undefined, characters: 5000 },
      { path: ".claude/rules/tests.md", paths: ["tests/**"], characters: 5000 },
      { path: ".claude/rules/gone.md", paths: ["legacy/**"], characters: 100 },
    ],
    files,
    ["pnpm-lock.yaml"],
  );
  assert.equal(total, 4);
  assert.deepEqual(measures.map((m) => [m.matched, m.load, m.stale, m.heavy]), [
    [4, 5000, false, true],
    [1, 1250, false, false],
    [0, 0, true, false],
  ]);
});

test("rules check: rule を測り、一致しない rule があれば終了コード 2", (t) => {
  const directory = workspace(t, true);
  write(directory, "src/a.ts", "export {};\n");
  write(directory, ".claude/rules/src.md", '---\npaths:\n  - "src/**" # source files\n---\n\n# src\n\n- 注意\n');
  spawnSync("git", ["add", "-A"], { cwd: directory, env: testEnvironment() });
  const output = JSON.parse(succeeds(directory, "rules", "check", "--json")) as { rules: { path: string; matched: number; stale: boolean }[] };
  assert.equal(output.rules[0]?.path, ".claude/rules/src.md");
  assert.equal(output.rules[0]?.matched, 1);

  write(directory, ".claude/rules/gone.md", "---\npaths: legacy/**\n---\n\n古い\n");
  const failed = cli(directory, "rules", "check");
  assert.equal(failed.status, 2);
  assert.match(failed.stdout + failed.stderr, /gone\.md/);
});
