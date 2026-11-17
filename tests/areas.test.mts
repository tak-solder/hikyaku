import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { cli, repository, succeeds, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";
import { areaLines, dormantAreas, linkedCriteria, parseAreaLine } from "../scripts/lib/areas.mts";
import type { ResolvedConfig } from "../scripts/lib/config.mts";
import { lastTouched } from "../scripts/lib/git.mts";

const DAY = 24 * 60 * 60 * 1000;

function git(directory: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: { ...testEnvironment(), ...env }, timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function commitAt(directory: string, paths: string[], at: Date): void {
  git(directory, ["add", "--", ...paths]);
  git(directory, ["commit", "-q", "-m", at.toISOString()], { GIT_COMMITTER_DATE: at.toISOString(), GIT_AUTHOR_DATE: at.toISOString() });
}

// ---------------------------------------------------------------------------
// git の lastTouched

test("lastTouched: 渡したファイルのうち最も新しいコミット日時を返す", async (t) => {
  const directory = repository(t);
  write(directory, "a.ts", "a\n");
  commitAt(directory, ["a.ts"], new Date("2025-01-01T00:00:00Z"));
  write(directory, "b.ts", "b\n");
  commitAt(directory, ["b.ts"], new Date("2026-03-01T00:00:00Z"));
  assert.equal((await lastTouched(directory, ["a.ts", "b.ts"]))?.toISOString(), "2026-03-01T00:00:00.000Z");
  assert.equal((await lastTouched(directory, ["a.ts"]))?.toISOString(), "2025-01-01T00:00:00.000Z");
});

test("lastTouched: 引数が多いときは分けて呼んでも最も新しい日時を取る", async (t) => {
  const directory = repository(t);
  const files = Array.from({ length: 3000 }, (_, i) => `f/${String(i).padStart(4, "0")}.txt`);
  mkdirSync(join(directory, "f"));
  for (const file of files) writeFileSync(join(directory, file), "x\n");
  commitAt(directory, ["f"], new Date("2025-01-01T00:00:00Z"));
  writeFileSync(join(directory, files[2999] as string), "y\n");
  commitAt(directory, [files[2999] as string], new Date("2026-06-01T00:00:00Z"));
  assert.equal((await lastTouched(directory, files))?.toISOString(), "2026-06-01T00:00:00.000Z");
});

test("lastTouched: ファイルが空・履歴が無ければ null、git が失敗すれば undefined", async (t) => {
  const directory = repository(t);
  write(directory, "a.ts", "a\n");
  commitAt(directory, ["a.ts"], new Date("2025-01-01T00:00:00Z"));
  write(directory, "new.ts", "n\n");
  assert.equal(await lastTouched(directory, []), null);
  assert.equal(await lastTouched(directory, ["new.ts"]), null);
  assert.equal(await lastTouched(temporaryDirectory(t), ["a.ts"]), undefined);
});

// ---------------------------------------------------------------------------
// 「領域」の行

test("parseAreaLine: build-05 の書式の「領域」行から glob を読み、それ以外の行は undefined", () => {
  assert.deepEqual(parseAreaLine("- **領域**: `src/billing/**`, `*.sql`"), ["src/billing/**", "*.sql"]);
  assert.equal(parseAreaLine("- **影響範囲**: `src/billing/**`"), undefined);
  assert.equal(parseAreaLine("領域: `src/**`"), undefined);
});

test("areaLines: コードブロックの中の「領域」行は読まず、直前の見出しを添える", () => {
  const lines = areaLines([
    "# 制約", "", "## 外部決済", "", "### 背景", "", "- **領域**: `src/billing/**`", "", "```markdown", "- **領域**: `example/**`", "```",
  ].join("\n"));
  assert.deepEqual(lines, [{ heading: "外部決済", level: 2, globs: ["src/billing/**"] }], "### の小見出しは項目に数えない");
});

// ---------------------------------------------------------------------------
// 結び付いた基準と休眠

/** decisions と constraints を登録したワークスペース */
function documented(t: TestContext): string {
  const directory = workspace(t);
  const guide = join(directory, "docs/hikyaku/document-guide.md");
  const source = readFileSync(guide, "utf8");
  const replaced = source
    .replace(/^\| decisions\s+\|[^\n]*$/m, "| decisions | hikyaku | docs/decisions/ | 設計判断 |")
    .replace(/^\| constraints\s+\|[^\n]*$/m, "| constraints | hikyaku | docs/constraints.md | 制約 |");
  assert.notEqual(replaced, source);
  writeFileSync(guide, replaced);
  write(directory, ".claude/rules/billing.md", "---\npaths:\n  - \"src/billing/**\"\n---\n\n- 請求\n");
  write(directory, ".claude/rules/ui.md", "---\npaths:\n  - \"src/ui/**\"\n---\n\n- 画面\n");
  write(directory, "docs/decisions/20260101-billing.md", "---\nstatus: accepted\n---\n\n# 請求は外部決済に任せる\n\n- **決定**: 外部\n- **領域**: `src/billing/**`\n");
  write(directory, "docs/decisions/20250101-old.md", "---\nstatus: superseded\n---\n\n# 古い判断\n\n- **領域**: `src/billing/**`\n");
  write(directory, "docs/constraints.md", [
    "# 制約", "", "## 外部決済", "", "- **制約**: 100 件/分", "- **領域**: `src/billing/**`", "",
    "## 型", "", "- **領域**: `**/*.ts`", "", "```markdown", "- **領域**: `src/billing/**`", "```", "",
  ].join("\n"));
  return directory;
}

function configOf(directory: string): ResolvedConfig {
  return JSON.parse(succeeds(directory, "config", "--json")) as ResolvedConfig;
}

test("linkedCriteria: rule・ADR・constraints の項目を領域と結び付けて集め、superseded の ADR とコードブロックは読まない", (t) => {
  const directory = documented(t);
  const { criteria, problems } = linkedCriteria(configOf(directory));
  assert.deepEqual(problems, []);
  assert.deepEqual(
    criteria.map((c) => [c.kind, c.source, c.title, c.globs]),
    [
      ["rule", ".claude/rules/billing.md", ".claude/rules/billing.md", ["src/billing/**"]],
      ["rule", ".claude/rules/ui.md", ".claude/rules/ui.md", ["src/ui/**"]],
      ["adr", "docs/decisions/20260101-billing.md", "請求は外部決済に任せる", ["src/billing/**"]],
      ["constraints", "docs/constraints.md#外部決済", "外部決済", ["src/billing/**"]],
      ["constraints", "docs/constraints.md#型", "型", ["**/*.ts"]],
    ],
  );
});

test("dormantAreas: 期間を超えた領域は休眠で、重なる基準だけを示す。ちょうどの日数・履歴の無いパスは休眠ではない", async (t) => {
  const directory = documented(t);
  const now = new Date("2026-11-16T12:00:00Z");
  write(directory, "src/billing/pay.ts", "export {};\n");
  commitAt(directory, ["."], new Date(now.getTime() - 181 * DAY));
  write(directory, "src/ui/a.ts", "export {};\n");
  commitAt(directory, ["src/ui/a.ts"], new Date(now.getTime() - 180 * DAY));

  const result = await dormantAreas(configOf(directory), ["src/billing/**", "src/ui/**", "src/newfeature/**"], now);
  assert.equal(result.dormantDays, 180);
  const [billing, ui, fresh] = result.areas;
  assert.deepEqual([billing?.days, billing?.dormant], [181, true]);
  assert.deepEqual(
    billing?.linked.map((c) => c.source),
    [".claude/rules/billing.md", "docs/decisions/20260101-billing.md", "docs/constraints.md#外部決済", "docs/constraints.md#型"],
  );
  assert.deepEqual([ui?.days, ui?.dormant, ui?.linked], [180, false, []]);
  assert.deepEqual([fresh?.lastTouched, fresh?.days, fresh?.dormant], [null, null, false]);
  assert.deepEqual(result.notices, []);
});

test("linkedCriteria: glob をバッククォートで囲んでいない「領域」行は、黙って落とさず problems に出す", (t) => {
  const directory = documented(t);
  write(directory, "docs/decisions/20260201-plain.md", "---\nstatus: accepted\n---\n\n# 囲み忘れ\n\n- **領域**: src/billing/**\n");
  const { criteria, problems } = linkedCriteria(configOf(directory));
  assert.equal(criteria.some((c) => c.source.endsWith("20260201-plain.md")), false);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /20260201-plain\.md/);
});

test("dormantAreas: git が使えなければ日数を不明にして notices に出す", async (t) => {
  const directory = temporaryDirectory(t);
  const config = { repoRoot: directory, hikyakuRoot: join(directory, "docs/hikyaku"), areas: { dormantDays: 180 } } as ResolvedConfig;
  const result = await dormantAreas(config, ["src/**"], new Date());
  assert.deepEqual([result.areas[0]?.days, result.areas[0]?.dormant], [null, false]);
  assert.equal(result.notices.length, 1);
  assert.match(result.notices[0] ?? "", /git/);
});

// ---------------------------------------------------------------------------
// hikyaku areas dormant

interface DormantOutput {
  dormantDays: number;
  areas: { glob: string; days: number | null; dormant: boolean; linked: { kind: string; source: string }[] }[];
}

test("areas dormant: 休眠した領域と結び付いた基準を示し、設定の期間で判定が変わる", (t) => {
  const directory = documented(t);
  write(directory, "src/billing/pay.ts", "export {};\n");
  commitAt(directory, ["."], new Date(Date.now() - 200 * DAY - 60 * 60 * 1000));
  write(directory, "src/ui/a.ts", "export {};\n");
  commitAt(directory, ["src/ui/a.ts"], new Date());

  const output = JSON.parse(succeeds(directory, "areas", "dormant", "--paths", "src/billing/**,src/ui/**", "--json")) as DormantOutput;
  const [billing, ui] = output.areas;
  assert.deepEqual([billing?.days, billing?.dormant], [200, true]);
  assert.deepEqual(new Set(billing?.linked.map((c) => c.kind)), new Set(["rule", "adr", "constraints"]));
  assert.equal(ui?.dormant, false);

  // {a,b} の中のカンマでは切らない
  const braces = JSON.parse(succeeds(directory, "areas", "dormant", "--paths", "src/{billing,invoice}/**", "--json")) as DormantOutput;
  assert.deepEqual(braces.areas.map((a) => [a.glob, a.dormant]), [["src/{billing,invoice}/**", true]]);

  const config = join(directory, ".hikyaku.config");
  writeFileSync(config, `${readFileSync(config, "utf8")}\n[areas]\ndormant_days = 365\n`);
  const longer = JSON.parse(succeeds(directory, "areas", "dormant", "--paths", "src/billing/**", "--json")) as DormantOutput;
  assert.equal(longer.dormantDays, 365);
  assert.equal(longer.areas[0]?.dormant, false);
});

test("areas dormant: --paths が無ければ使い方のエラー", (t) => {
  const directory = workspace(t);
  const result = cli(directory, "areas", "dormant");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--paths/);
});
