/**
 * AI に任せてよい害の上限（risk.mts）— 上限の表・パスの解決・厳しいほう・パスの照合と、
 * ユーザーがマージした宣言（基準）の読み取り（ADR 20261116-risk-ceiling-table）
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { readAppDeclaration, readBoundaries, type AppAxes, type AppDeclaration, type ResolvedConfig } from "../scripts/lib/config.mts";
import {
  axesForPath,
  ceilingOf,
  cycleAdrs,
  effectiveBoundaries,
  effectiveDeclaration,
  exceeds,
  heavyAreasHit,
  overlaps,
  strictest,
  touchedPaths,
} from "../scripts/lib/risk.mts";
import { parseToml, type TomlTable } from "../scripts/lib/toml.mts";
import { repository, temporaryDirectory, testEnvironment } from "./helpers.mts";

const axes = (exposure: string, data: string, impact: string) => ({ exposure, data, impact }) as AppAxes;
const declaration = (value: AppAxes, overrides: Partial<AppDeclaration> = {}): AppDeclaration => ({
  axes: value, mergeGate: undefined, areas: [], ...overrides,
});

// ---------------------------------------------------------------------------
// 上限の表

test("ceilingOf: 3軸すべて最下段なら高、どれかが中段なら中、どれかが最上段ならなし", () => {
  assert.equal(ceilingOf(axes("personal", "none", "low")), "高");
  assert.equal(ceilingOf(axes("personal", "internal", "low")), "中");
  assert.equal(ceilingOf(axes("internal", "none", "high")), "なし", "中段が混ざっても最上段があればなし");
  assert.equal(ceilingOf(axes("public", "none", "low")), "なし");
  assert.equal(ceilingOf(axes("personal", "personal-or-secret", "low")), "なし");
});

test("exceeds: 害と上限の比較の境界", () => {
  assert.equal(exceeds("中", "中"), false);
  assert.equal(exceeds("高", "中"), true);
  assert.equal(exceeds("高", "高"), false);
  assert.equal(exceeds("中", "なし"), true);
});

test("axesForPath: 重い領域に当たるパスは軸ごとの最大で上書きし、省略した軸はアプリケーションの値", () => {
  const decl = declaration(axes("personal", "none", "low"), {
    areas: [{ name: "auth", paths: ["src/auth/**"], data: "personal-or-secret" }],
  });
  assert.deepEqual(axesForPath(decl, "src/auth/login.ts", []), axes("personal", "personal-or-secret", "low"));
});

test("axesForPath: 領域の軸が低くてもアプリケーションの軸を下げず、当たらないパスはそのまま", () => {
  const decl = declaration(axes("public", "internal", "medium"), {
    areas: [{ name: "docs", paths: ["docs/**"], exposure: "personal", impact: "low" }],
  });
  assert.deepEqual(axesForPath(decl, "docs/a.md", []), axes("public", "internal", "medium"));
  assert.deepEqual(axesForPath(decl, "src/x.ts", []), axes("public", "internal", "medium"));
});

test("heavyAreasHit: パターンに当たる重い領域だけを返す", () => {
  const decl = declaration(axes("personal", "none", "low"), {
    areas: [{ name: "auth", paths: ["src/auth/**"] }, { name: "billing", paths: ["src/billing/**"] }],
  });
  const files = ["src/auth/a.ts", "src/billing/b.ts", "src/ui/c.ts"];
  assert.deepEqual(heavyAreasHit(decl, ["src/auth/*.ts", "src/ui/**"], files).map((area) => area.name), ["auth"]);
});

// ---------------------------------------------------------------------------
// 厳しいほう

test("strictest: 軸は軸ごとの最大、片方が無ければもう片方、どちらも無ければ undefined", () => {
  const a = declaration(axes("public", "none", "low"));
  const b = declaration(axes("personal", "internal", "high"));
  assert.deepEqual(strictest(a, b)?.axes, axes("public", "internal", "high"));
  assert.deepEqual(strictest(a, undefined), a);
  assert.equal(strictest(undefined, undefined), undefined);
});

test("strictest: 重い領域は和で、同じ name はパスの和と軸の最大で1つにまとまる", () => {
  const a = declaration(axes("personal", "none", "low"), { areas: [{ name: "auth", paths: ["src/auth/**"], impact: "medium" }] });
  const b = declaration(axes("personal", "none", "low"), {
    areas: [{ name: "auth", paths: ["lib/auth/**"], impact: "high" }, { name: "billing", paths: ["src/billing/**"] }],
  });
  const areas = strictest(a, b)?.areas ?? [];
  assert.equal(areas.length, 2);
  const auth = areas.find((area) => area.name === "auth");
  assert.deepEqual([...(auth?.paths ?? [])].sort(), ["lib/auth/**", "src/auth/**"]);
  assert.equal(auth?.impact, "high");
  assert.deepEqual(areas.find((area) => area.name === "billing")?.paths, ["src/billing/**"]);
  assert.deepEqual(a.areas[0]?.paths, ["src/auth/**"], "元の宣言は書き換えない");
});

test("strictest: merge_gate は両方が user のときだけ user（緩める向きの値なので論理積）", () => {
  const user = declaration(axes("personal", "none", "low"), { mergeGate: "user" });
  const none = declaration(axes("personal", "none", "low"));
  assert.equal(strictest(user, user)?.mergeGate, "user");
  assert.equal(strictest(user, none)?.mergeGate, undefined);
  const alone = strictest(user, undefined);
  assert.equal(alone?.mergeGate, undefined, "片方に宣言が無ければ、作業ツリーで足した merge_gate は効かない");
  assert.deepEqual(alone?.axes, user.axes);
});

// ---------------------------------------------------------------------------
// パスの照合

test("overlaps: 字義どおりのパスはもう片方の glob で照合し、ディレクトリとして書けばその下も当たる", () => {
  const files = ["src/auth/login.ts", "src/ui/a.ts", "lib/login.ts"];
  assert.equal(overlaps("src/auth/login.ts", "src/auth/**", files), true);
  assert.equal(overlaps("src/ui/a.ts", "src/auth/**", files), false);
  assert.equal(overlaps("src/auth", "src/auth/*.ts", files), true);
  assert.equal(overlaps("src/auth/", "src/auth/login.ts", files), true);
  assert.equal(overlaps("src/new/file.ts", "src/new/**", []), true, "まだ無いファイルでも照合できる");
});

test("overlaps: / を含まない名前はどの階層のファイル名にも当たる glob として、ファイル一覧で照合する", () => {
  const files = ["src/auth/login.ts", "src/ui/a.ts", "lib/login.ts"];
  assert.equal(overlaps("login.ts", "src/auth/**", files), true);
  assert.equal(overlaps("login.ts", "src/ui/**", files), false);
  assert.equal(overlaps("config.mts", "src/payments/**", []), false, "一覧に無い素の名前を、すべての領域に当てない");
});

test("overlaps: glob どうしはファイル一覧・見本・接頭辞で判定し、迷う形は当たるに倒す", () => {
  const files = ["db/migrations/001.sql", "src/auth/a.ts", "src/billing/b.ts"];
  assert.equal(overlaps("**/*.sql", "db/migrations/*", files), true);
  assert.equal(overlaps("src/**", "src/auth/*.ts", files), true);
  assert.equal(overlaps("src/auth/**", "src/billing/*.ts", files), false);
  assert.equal(overlaps("src/**/*.ts", "src/auth/**", []), true, "一覧に無くても、ディレクトリが重なれば当たる");
  assert.equal(overlaps("src/{api,auth}/**", "src/auth/x.ts", []), true, "波括弧は展開して照合する");
});

test("overlaps: 拡張子の無い字義どおりのパスはディレクトリとしても照合する", () => {
  assert.equal(overlaps("db/migrations", "**/migrations/**", []), true);
  assert.equal(overlaps("src/db", "src/**/*.sql", []), true);
  assert.equal(overlaps("src/ui", "src/auth/**", []), false);
});

test("overlaps: まだ無いファイルでも、片方のディレクトリにもう片方のファイル名を置いた見本で重なりを見る", () => {
  assert.equal(overlaps("*.sql", "db/migrations/**", []), true, "/ を含まない glob の領域と、新しいディレクトリ");
  assert.equal(overlaps("src/**/schema.prisma", "src/db/**", []), true, "名前を決めた深い glob と、ディレクトリの glob");
  assert.equal(overlaps("src/**/schema.prisma", "lib/**", []), false);
});

test("touchedPaths: バッククォートで囲んだパスと glob を拾う", () => {
  const markdown = "`scripts/lib/risk.mts` を足し、`src/auth/**` と `package.json` を触る。`*.sql` も。`./docs/a.md` も";
  assert.deepEqual(touchedPaths(markdown), ["scripts/lib/risk.mts", "src/auth/**", "package.json", "*.sql", "docs/a.md"]);
});

test("touchedPaths: 空白・URL・オプション・プレースホルダを含む語は、パスの形でも拾わない", () => {
  const markdown = "`cat src/a.ts` `https://example.com/a/b.md` `--paths=src/a/**` `area:<name>` `merge_gate` `[app]` `3.0.0` `v1.2`";
  assert.deepEqual(touchedPaths(markdown), []);
});

// ---------------------------------------------------------------------------
// 基準の宣言（一時リポジトリ）

function git(directory: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function put(directory: string, path: string, content: string): void {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function appConfig(exposure: string, data: string, impact: string, extra = ""): string {
  return `hikyaku_root = "docs/hikyaku"\n${extra}[app]\nexposure = "${exposure}"\ndata = "${data}"\nimpact = "${impact}"\n`;
}

function commit(directory: string, message: string): void {
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "--allow-empty", "-m", message);
}

/** origin（bare）を作り、main を push して origin/HEAD → origin/main にする */
function withOrigin(t: TestContext, directory: string, ...branches: string[]): void {
  const remote = temporaryDirectory(t);
  git(remote, "init", "--quiet", "--bare");
  git(directory, "remote", "add", "origin", remote);
  for (const branch of ["main", ...branches]) git(directory, "push", "-q", "origin", branch);
  git(directory, "remote", "set-head", "origin", "main");
}

/** 作業ツリーの .hikyaku.config から、risk.mts に渡す設定を作る（step と同じ ResolvedConfig の欄だけ） */
function configOf(directory: string, source: string, baseBranch?: string): ResolvedConfig {
  const app = parseToml(source)["app"] as TomlTable | undefined;
  return {
    repoRoot: directory,
    hikyakuRoot: join(directory, "docs/hikyaku"),
    baseBranch,
    branch: { prefix: "hikyaku", separator: "/" },
    app: readAppDeclaration(app),
  } as unknown as ResolvedConfig;
}

/** main に宣言をコミットした一時リポジトリ */
function repoWith(t: TestContext, mainConfig: string | undefined): string {
  const directory = repository(t);
  if (mainConfig !== undefined) put(directory, ".hikyaku.config", mainConfig);
  put(directory, "README.md", "# x\n");
  commit(directory, "main");
  return directory;
}

/** 作業ブランチを切って宣言を書き換え、コミットする。返り値は作業ツリーの設定の本文 */
function loosen(directory: string, branch: string, source: string): string {
  git(directory, "checkout", "-q", "-b", branch);
  put(directory, ".hikyaku.config", source);
  commit(directory, `loosen on ${branch}`);
  return source;
}

test("effectiveDeclaration: 作業ブランチで宣言を緩めても、基準側の厳しい宣言で決まる", (t) => {
  const directory = repoWith(t, appConfig("personal", "none", "high"));
  withOrigin(t, directory);
  const source = loosen(directory, "feature-x", appConfig("personal", "none", "low"));
  const effective = effectiveDeclaration(configOf(directory, source));
  assert.equal(effective.declaration?.axes.impact, "high");
  assert.equal(ceilingOf(effective.declaration?.axes as AppAxes), "なし");
  assert.deepEqual(effective.baselines.map((baseline) => baseline.ref), ["origin/main", "main"], "デフォルトブランチと defaultBase がどちらも main で、origin とローカルの両方を読む");
  assert.deepEqual(effective.notices, []);
});

test("effectiveDeclaration: スタックした前フェーズのブランチで緩めても緩まない", (t) => {
  const directory = repoWith(t, appConfig("public", "none", "low"));
  withOrigin(t, directory);
  loosen(directory, "hikyaku/001-x/architect", appConfig("personal", "none", "low"));
  git(directory, "checkout", "-q", "-b", "hikyaku/001-x/build-01");
  const effective = effectiveDeclaration(configOf(directory, appConfig("personal", "none", "low")));
  assert.equal(effective.declaration?.axes.exposure, "public");
});

test("effectiveDeclaration: conductor ブランチで緩めても緩まない", (t) => {
  const directory = repoWith(t, appConfig("personal", "personal-or-secret", "low"));
  withOrigin(t, directory);
  loosen(directory, "hikyaku/001-x/conductor", appConfig("personal", "none", "low"));
  git(directory, "checkout", "-q", "-b", "hikyaku/001-x/build-02");
  const effective = effectiveDeclaration(configOf(directory, appConfig("personal", "none", "low")));
  assert.equal(effective.declaration?.axes.data, "personal-or-secret");
});

test("effectiveDeclaration: base_branch を自分のブランチに書き換えても、デフォルトブランチ側で緩まない", (t) => {
  const directory = repoWith(t, appConfig("personal", "none", "high"));
  withOrigin(t, directory);
  const branch = "hikyaku/001-x/build-01";
  const source = loosen(directory, branch, appConfig("personal", "none", "low", `base_branch = "${branch}"\n`));
  const effective = effectiveDeclaration(configOf(directory, source, branch));
  assert.equal(effective.declaration?.axes.impact, "high");
  assert.equal(effective.notices.length, 1);
  assert.match(effective.notices[0] ?? "", /Hikyaku のブランチ/);
});

test("effectiveDeclaration: origin/HEAD が Hikyaku のブランチを指すと、その基準は読めない扱い", (t) => {
  const directory = repoWith(t, appConfig("public", "none", "low"));
  const conductor = "hikyaku/001-x/conductor";
  git(directory, "checkout", "-q", "-b", conductor);
  put(directory, ".hikyaku.config", appConfig("personal", "none", "low"));
  commit(directory, "conductor");
  git(directory, "checkout", "-q", "main");
  withOrigin(t, directory, conductor);
  git(directory, "remote", "set-head", "origin", conductor);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-x/build-01", conductor);
  const effective = effectiveDeclaration(configOf(directory, appConfig("personal", "none", "low"), "main"));
  assert.equal(effective.declaration?.axes.exposure, "public");
  const fallback = effective.baselines.find((baseline) => baseline.branch === conductor);
  assert.ok(fallback?.unavailable !== undefined);
  assert.ok(effective.notices.some((notice) => notice.includes(conductor)));
});

test("effectiveDeclaration: 2つの基準が両方読めて食い違えば、作業ツリーを含めた軸ごとの最大になる", (t) => {
  const directory = repoWith(t, appConfig("public", "none", "low"));
  git(directory, "checkout", "-q", "-b", "develop");
  put(directory, ".hikyaku.config", appConfig("personal", "none", "high"));
  commit(directory, "develop");
  git(directory, "checkout", "-q", "main");
  withOrigin(t, directory, "develop");
  git(directory, "checkout", "-q", "-b", "feature-y", "develop");
  const effective = effectiveDeclaration(configOf(directory, appConfig("personal", "none", "low"), "develop"));
  assert.deepEqual(effective.declaration?.axes, axes("public", "none", "high"));
  assert.deepEqual([...new Set(effective.baselines.map((baseline) => baseline.branch))], ["main", "develop"]);
  assert.deepEqual(effective.notices, []);
});

test("effectiveDeclaration: remote が無ければローカルのブランチを ref にして読む", (t) => {
  const directory = repoWith(t, appConfig("personal", "none", "high"));
  const source = loosen(directory, "feature-z", appConfig("personal", "none", "low"));
  const effective = effectiveDeclaration(configOf(directory, source, "main"));
  assert.equal(effective.baselines[0]?.ref, "main");
  assert.equal(effective.declaration?.axes.impact, "high");
  assert.equal(effective.notices.length, 1);
  assert.match(effective.notices[0] ?? "", /origin\/HEAD/);
});

test("effectiveDeclaration: PR を経ないローカルのコミットで緩めても、origin の厳しい宣言で決まる", (t) => {
  const directory = repoWith(t, appConfig("personal", "none", "high"));
  withOrigin(t, directory);
  put(directory, ".hikyaku.config", appConfig("personal", "none", "low"));
  commit(directory, "local main loosened");
  git(directory, "checkout", "-q", "-b", "feature-w");
  const effective = effectiveDeclaration(configOf(directory, appConfig("personal", "none", "low")));
  assert.deepEqual(effective.baselines.map((baseline) => baseline.ref), ["origin/main", "main"]);
  assert.equal(effective.declaration?.axes.impact, "high");
});

test("effectiveDeclaration: fetch していない古い origin が緩くても、ローカルでマージ済みの厳しい宣言で決まる", (t) => {
  const directory = repoWith(t, appConfig("personal", "none", "low"));
  withOrigin(t, directory);
  put(directory, ".hikyaku.config", appConfig("personal", "none", "high"));
  commit(directory, "stricter declaration merged locally");
  git(directory, "checkout", "-q", "-b", "feature-s");
  const effective = effectiveDeclaration(configOf(directory, appConfig("personal", "none", "low")));
  assert.equal(effective.declaration?.axes.impact, "high");
  assert.deepEqual(effective.notices, []);
});

test("effectiveDeclaration: origin とローカルのどちらか一方だけ読めれば、それで決める", (t) => {
  const directory = repoWith(t, appConfig("personal", "none", "low"));
  withOrigin(t, directory);
  git(directory, "checkout", "-q", "-b", "feature-o");
  put(directory, ".hikyaku.config", appConfig("public", "none", "low"));
  commit(directory, "feature");
  git(directory, "branch", "-q", "-D", "main");
  const effective = effectiveDeclaration(configOf(directory, appConfig("personal", "none", "low")));
  assert.deepEqual(effective.baselines.map((baseline) => baseline.ref), ["origin/main"]);
  assert.equal(effective.declaration?.axes.exposure, "personal");
  assert.deepEqual(effective.notices, []);
});

test("effectiveDeclaration: 作業ツリーにも基準にも宣言が無ければ未定義（上限なしで、「なし」とは区別する）", (t) => {
  const directory = repoWith(t, 'hikyaku_root = "docs/hikyaku"\n');
  withOrigin(t, directory);
  const effective = effectiveDeclaration(configOf(directory, 'hikyaku_root = "docs/hikyaku"\n'));
  assert.equal(effective.declaration, undefined);
  assert.deepEqual(effective.notices, []);
});

test("effectiveDeclaration: 基準に .hikyaku.config が無ければ、宣言なしとして読めた扱い", (t) => {
  const directory = repoWith(t, undefined);
  withOrigin(t, directory);
  const source = loosen(directory, "feature-v", appConfig("internal", "none", "low"));
  const effective = effectiveDeclaration(configOf(directory, source));
  assert.deepEqual(effective.declaration?.axes, axes("internal", "none", "low"));
  assert.equal(effective.baselines[0]?.declaration, undefined);
  assert.equal(effective.baselines[0]?.unavailable, undefined);
  assert.deepEqual(effective.notices, []);
});

test("effectiveDeclaration: 基準の ref も origin/HEAD も無ければ、作業ツリーで決めて理由を返す", (t) => {
  const directory = repoWith(t, appConfig("personal", "none", "medium"));
  const effective = effectiveDeclaration(configOf(directory, appConfig("personal", "none", "medium"), "release"));
  assert.equal(effective.declaration?.axes.impact, "medium");
  assert.equal(effective.notices.length, 2);
  assert.ok(effective.notices.some((notice) => notice.includes("release")));
  assert.equal(effective.incomplete, true, "作業ツリーの宣言だけで決まったことを、判定が同意に倒せるように返す");
});

test("effectiveDeclaration: merge-base が無ければ、その基準は読めない扱い", (t) => {
  const directory = repoWith(t, appConfig("personal", "none", "low"));
  git(directory, "checkout", "-q", "--orphan", "unrelated");
  put(directory, ".hikyaku.config", appConfig("personal", "none", "high"));
  commit(directory, "unrelated history");
  const remote = temporaryDirectory(t);
  git(remote, "init", "--quiet", "--bare");
  git(directory, "remote", "add", "origin", remote);
  git(directory, "push", "-q", "origin", "unrelated:main");
  git(directory, "remote", "set-head", "origin", "main");
  git(directory, "checkout", "-q", "main");
  git(directory, "branch", "-q", "-D", "unrelated");
  git(directory, "branch", "-q", "-m", "main", "work");
  const effective = effectiveDeclaration(configOf(directory, appConfig("personal", "none", "low")));
  assert.equal(effective.declaration?.axes.impact, "low");
  assert.equal(effective.baselines[0]?.commit, undefined);
  assert.match(effective.baselines[0]?.unavailable ?? "", /共通の祖先/);
  assert.equal(effective.notices.length, 1);
});

test("effectiveDeclaration: 基準の TOML が壊れている・値が不正なら、その基準は読めない扱い", (t) => {
  for (const broken of ['hikyaku_root = "docs/hikyaku"\n[app\n', appConfig("world", "none", "low")]) {
    const directory = repoWith(t, broken);
    withOrigin(t, directory);
    git(directory, "checkout", "-q", "-b", "feature-u");
    const effective = effectiveDeclaration(configOf(directory, appConfig("internal", "none", "low")));
    assert.equal(effective.declaration?.axes.exposure, "internal");
    assert.ok(effective.baselines[0]?.unavailable !== undefined);
    assert.equal(effective.notices.length, 1);
    assert.equal(effective.incomplete, true, "厳しさの分からない基準があることを、判定が同意に倒せるように返す");
  }
});

test("effectiveDeclaration: 既定の命名規則の Hikyaku のブランチは、サイクルの規則が違っても基準にしない", (t) => {
  const directory = repoWith(t, appConfig("public", "none", "low"));
  withOrigin(t, directory);
  const other = "hikyaku/002-y/conductor";
  loosen(directory, other, appConfig("personal", "none", "low"));
  git(directory, "checkout", "-q", "-b", "feat/001-x/build-01");
  const config = { ...configOf(directory, appConfig("personal", "none", "low"), other), branch: { prefix: "feat", separator: "/" } } as ResolvedConfig;
  const effective = effectiveDeclaration(config);
  assert.equal(effective.declaration?.axes.exposure, "public");
  assert.ok(effective.notices.some((notice) => notice.includes(other)));
});

// ---------------------------------------------------------------------------
// このサイクルの ADR

const GUIDE = (row: string) =>
  `# ドキュメントガイド\n\n| 論理名 | 管理 | パス | 概要 |\n| --- | --- | --- | --- |\n${row}\n`;
const DECISIONS = "| decisions | hikyaku | `.hikyaku/decisions/` | 設計判断 |";

function adrRepo(t: TestContext, guideRow: string): string {
  const directory = repository(t);
  put(directory, "docs/hikyaku/document-guide.md", GUIDE(guideRow));
  put(directory, ".hikyaku/decisions/a.md", "# a\n");
  put(directory, ".hikyaku/decisions/b.md", "# b\n");
  commit(directory, "main");
  return directory;
}

test("cycleAdrs: 基準から変わった・足された decisions と、追跡外のファイルを返す", (t) => {
  const directory = adrRepo(t, DECISIONS);
  withOrigin(t, directory);
  git(directory, "checkout", "-q", "-b", "feature");
  put(directory, ".hikyaku/decisions/b.md", "# b changed\n");
  put(directory, ".hikyaku/decisions/c.md", "# c\n");
  commit(directory, "adrs");
  put(directory, ".hikyaku/decisions/d.md", "# d\n");
  assert.deepEqual(cycleAdrs(configOf(directory, "")), [".hikyaku/decisions/b.md", ".hikyaku/decisions/c.md", ".hikyaku/decisions/d.md"]);
});

test("cycleAdrs: 日本語のファイル名を、引用符やエスケープの無い実際のパスで返す", (t) => {
  const directory = adrRepo(t, DECISIONS);
  withOrigin(t, directory);
  git(directory, "checkout", "-q", "-b", "feature");
  put(directory, ".hikyaku/decisions/20261116-上限.md", "# 上限\n");
  commit(directory, "jp");
  put(directory, ".hikyaku/decisions/20261116-追跡外.md", "# x\n");
  assert.deepEqual(cycleAdrs(configOf(directory, "")), [".hikyaku/decisions/20261116-上限.md", ".hikyaku/decisions/20261116-追跡外.md"]);
});

test("cycleAdrs: 2つの基準それぞれからの差分の和を返す", (t) => {
  const directory = adrRepo(t, DECISIONS);
  git(directory, "checkout", "-q", "-b", "develop");
  put(directory, ".hikyaku/decisions/e.md", "# e\n");
  commit(directory, "develop");
  git(directory, "checkout", "-q", "main");
  withOrigin(t, directory, "develop");
  git(directory, "checkout", "-q", "-b", "feature", "develop");
  put(directory, ".hikyaku/decisions/f.md", "# f\n");
  commit(directory, "f");
  assert.deepEqual(cycleAdrs(configOf(directory, "", "develop")), [".hikyaku/decisions/e.md", ".hikyaku/decisions/f.md"]);
});

test("cycleAdrs: decisions の外のファイルは返さない", (t) => {
  const directory = adrRepo(t, DECISIONS);
  withOrigin(t, directory);
  git(directory, "checkout", "-q", "-b", "feature");
  put(directory, ".hikyaku/decisions/c.md", "# c\n");
  put(directory, "src/x.ts", "export {};\n");
  commit(directory, "c");
  assert.deepEqual(cycleAdrs(configOf(directory, "")), [".hikyaku/decisions/c.md"]);
});

test("cycleAdrs: decisions が対象外なら空", (t) => {
  const directory = adrRepo(t, "| decisions | 対象外 | — | 持たない |");
  withOrigin(t, directory);
  git(directory, "checkout", "-q", "-b", "feature");
  put(directory, ".hikyaku/decisions/c.md", "# c\n");
  commit(directory, "c");
  assert.deepEqual(cycleAdrs(configOf(directory, "")), []);
});

test("cycleAdrs: 基準を読めなければ decisions のファイルすべて", (t) => {
  const directory = adrRepo(t, DECISIONS);
  assert.deepEqual(cycleAdrs(configOf(directory, "", "release")), [".hikyaku/decisions/a.md", ".hikyaku/decisions/b.md"]);
});

// ---------------------------------------------------------------------------
// 境界（[boundaries]）の基準との和（build-12）

/** configOf に作業ツリーの [boundaries] を足したもの */
function boundaryConfigOf(directory: string, source: string): ResolvedConfig {
  const config = configOf(directory, source);
  return { ...config, boundaries: readBoundaries(parseToml(source)["boundaries"] as TomlTable | undefined) } as ResolvedConfig;
}

const ROOT_ONLY = `hikyaku_root = "docs/hikyaku"\n`;

test("effectiveBoundaries: 作業ツリーと基準の [boundaries] の和を返し、重複は1つにまとめる", (t) => {
  const directory = repoWith(t, `${ROOT_ONLY}[boundaries]\nexternal = ["api/public/**"]\n`);
  withOrigin(t, directory);
  const source = loosen(directory, "feature-x", `${ROOT_ONLY}[boundaries]\nexternal = ["api/public/**", "api/webhook/**"]\ninternal = ["src/core/**"]\n`);
  const boundaries = effectiveBoundaries(boundaryConfigOf(directory, source));
  assert.deepEqual(boundaries.external, ["api/public/**", "api/webhook/**"]);
  assert.deepEqual(boundaries.internal, ["src/core/**"]);
  assert.equal(boundaries.unverified, false);
});

test("effectiveBoundaries: 作業ツリーで境界を消しても、基準の境界は残る", (t) => {
  const directory = repoWith(t, `${ROOT_ONLY}[boundaries]\nexternal = ["api/public/**"]\n`);
  withOrigin(t, directory);
  const source = loosen(directory, "feature-x", ROOT_ONLY);
  const boundaries = effectiveBoundaries(boundaryConfigOf(directory, source));
  assert.deepEqual(boundaries.external, ["api/public/**"]);
  assert.equal(boundaries.unverified, false, "作業ツリーが宣言していないので unverified ではない");
});

test("effectiveBoundaries: 基準を読めなければ作業ツリーの境界だけを返し、unverified になる", (t) => {
  const directory = repoWith(t, undefined);
  const source = `${ROOT_ONLY}[boundaries]\nexternal = ["api/public/**"]\n`;
  const boundaries = effectiveBoundaries(boundaryConfigOf(directory, source));
  assert.deepEqual(boundaries.external, ["api/public/**"]);
  assert.deepEqual(boundaries.internal, []);
  assert.equal(boundaries.unverified, true);
});

test("effectiveBoundaries: 基準の [app] だけが壊れていても、基準の境界は効かせる", (t) => {
  const directory = repoWith(t, `${ROOT_ONLY}[app]\nexposure = "everyone"\n[boundaries]\nexternal = ["api/**"]\n`);
  withOrigin(t, directory);
  const source = loosen(directory, "feature-x", ROOT_ONLY);
  const boundaries = effectiveBoundaries(boundaryConfigOf(directory, source));
  assert.deepEqual(boundaries.external, ["api/**"]);
  assert.equal(boundaries.unverified, false);
});

test("effectiveBoundaries: どこにも宣言が無ければ空で、unverified ではない", (t) => {
  const directory = repoWith(t, undefined);
  const boundaries = effectiveBoundaries(boundaryConfigOf(directory, ROOT_ONLY));
  assert.deepEqual([boundaries.external, boundaries.internal, boundaries.unverified], [[], [], false]);
});
