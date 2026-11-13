import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { cli, succeeds, testEnvironment, workspace, write } from "./helpers.mts";
import { expandBraces, matchesRule, measureRules, parseRule } from "../scripts/lib/rules.mts";

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
  assert.equal(parseRule("---\npaths: a/**\n---\n本文").body, "本文");
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
  write(directory, ".claude/rules/src.md", '---\npaths:\n  - "src/**"\n---\n\n# src\n\n- 注意\n');
  spawnSync("git", ["add", "-A"], { cwd: directory, env: testEnvironment() });
  const output = JSON.parse(succeeds(directory, "rules", "check", "--json")) as { rules: { path: string; matched: number; stale: boolean }[] };
  assert.equal(output.rules[0]?.path, ".claude/rules/src.md");
  assert.equal(output.rules[0]?.matched, 1);

  write(directory, ".claude/rules/gone.md", "---\npaths: legacy/**\n---\n\n古い\n");
  const failed = cli(directory, "rules", "check");
  assert.equal(failed.status, 2);
  assert.match(failed.stdout + failed.stderr, /gone\.md/);
});
