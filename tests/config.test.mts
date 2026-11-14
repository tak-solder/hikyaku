import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { cli, snapshot, succeeds, workspace, write } from "./helpers.mts";

test("設定: ルート・サイクル・profile の優先順でマージし、未上書きキーを保持する", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"
profile = "economy"
ask = ["branch.prefix", "pr.title"]
[context]
merge_below = "250k"
split_above = 500000
[branch]
prefix = "root"
separator = "/"
[external]
target = "github"
github_repo = "example/repo"
`);
  const cycleConfig = "docs/hikyaku/cycles/001-test/.hikyaku.config";
  write(directory, cycleConfig, `[branch]\nprefix = "cycle"\n[external]\ntarget = "none"\n`);
  const config = JSON.parse(succeeds(directory, "config", "001", "--json"));
  assert.equal(config.profile, "standard");
  assert.deepEqual(config.peakBands, { mergeBelow: 250_000, splitAbove: 500_000 });
  assert.deepEqual(config.branch, { prefix: "cycle", separator: "/" });
  assert.deepEqual(config.external, { target: "none", githubRepo: "example/repo" });
  assert.deepEqual(config.askAtCreate, ["pr.title"]);
  assert.deepEqual(config.sources, [join(directory, ".hikyaku.config"), join(directory, cycleConfig)]);
});

test("設定: --profile の what-if は保存された profile を書き換えない", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\ncode_review = true\n');
  const before = snapshot(directory);
  const config = JSON.parse(succeeds(directory, "config", "001", "--profile", "economy", "--json"));
  assert.equal(config.profile, "economy");
  assert.equal(config.reviews.code, true);
  assert.equal(config.reviews.plan, false);
  assert.deepEqual(snapshot(directory), before);
});

test("設定: 作成前の profile 確認は既存サイクルを参照せず、通常の作業選択は厳密に解決する", (t) => {
  const empty = workspace(t);
  assert.equal(JSON.parse(succeeds(empty, "config", "--json")).cycle, undefined);
  const missing = cli(empty, "config", "--require-cycle", "--json");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /サイクルがまだありません/);
  const directory = workspace(t, true);
  const config = (...args: string[]) => JSON.parse(succeeds(directory, "config", ...args, "--json"));
  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", "[review]\nmax_rounds = 5\n");
  assert.equal(config().cycle, undefined, "1件だけでも設定表示はサイクルを選ばない");
  assert.equal(config("--profile", "express").review.code.maxRounds, 1);
  assert.equal(config("--require-cycle").cycleSource, "single-active");
  assert.equal(config("--require-cycle", "--profile", "express").review.code.maxRounds, 5);
  assert.equal(JSON.parse(succeeds(directory, "tasklist", "read", "--json")).cycle, "001-test", "作業では唯一の active を引き続き使う");

  succeeds(directory, "cycle", "new", "other", "--profile", "standard");
  write(directory, "docs/hikyaku/cycles/002-other/.hikyaku.config", "[review]\nmax_rounds = 9\n");
  assert.equal(config().cycle, undefined, "複数 active でも設定表示は止まらない");
  const ambiguous = cli(directory, "config", "--require-cycle", "--json");
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /対象サイクルを決められません/);
  assert.equal(cli(directory, "tasklist", "read").status, 1, "作業で曖昧なサイクルは推測しない");
  succeeds(directory, "cycle", "use", "002");
  assert.equal(config().review.code.maxRounds, 9, "通常表示は栞のサイクルを使う");
  const preview = config("--profile", "express");
  assert.equal(preview.cycle, undefined);
  assert.equal(preview.review.code.maxRounds, 1);
  assert.deepEqual(preview.sources, [join(directory, ".hikyaku.config")]);
  assert.equal(config("--require-cycle", "002").cycleSource, "explicit", "真偽値フラグは後続サイクルを消費しない");
  assert.equal(config("002", "--profile", "express").review.code.maxRounds, 9, "明示したサイクルの上書きは保持する");
  assert.equal(cli(directory, "config", "missing", "--profile", "express").status, 1);
});

test("設定: ブランチを栞より優先し、profile 単独の確認は両方を参照しない", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "cycle", "new", "other", "--profile", "standard");
  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", "[review]\nmax_rounds = 5\n[context]\nsplit_above = '600k'\n");
  succeeds(directory, "cycle", "use", "002");
  write(directory, ".git/HEAD", "ref: refs/heads/hikyaku/001-test/plan\n");
  const config = JSON.parse(succeeds(directory, "config", "--json"));
  assert.equal(config.cycle, "001-test");
  assert.equal(config.cycleSource, "branch");
  assert.equal(config.review.code.maxRounds, 5);
  assert.equal(JSON.parse(succeeds(directory, "config", "--profile", "express", "--json")).review.code.maxRounds, 1);
  assert.equal(JSON.parse(succeeds(directory, "tokens", "guide", "--json")).bands.splitAbove, 600_000);
  assert.equal(JSON.parse(succeeds(directory, "tokens", "guide", "--profile", "express", "--json")).bands.splitAbove, 450_000);

  write(directory, ".git/HEAD", "ref: refs/heads/main\n");
  succeeds(directory, "cycle", "close", "002", "--summary", "test");
  assert.equal(JSON.parse(succeeds(directory, "config", "--json")).cycle, undefined, "closed の栞は参照しない");
});

for (const content of [
  'hikyaku_root = "other"',
  'profile = "economy"',
  'ask = ["pr.title"]',
  '[data_integrity]\nrelease_branches = ["feature/*"]',
]) {
  test(`設定: サイクル側の禁止キー ${content.split(" =")[0]} を拒否する`, (t) => {
    const directory = workspace(t, true);
    write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", content);
    const result = cli(directory, "config", "001", "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /サイクル設定/);
  });
}

test("設定: ワークスペース直下に残った旧配置の設定を黙って無視しない", (t) => {
  const directory = workspace(t);
  write(directory, "docs/hikyaku/.hikyaku.config", "profile = \"economy\"\n");
  const result = cli(directory, "config", "--json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /読み込まれません/);
});

test("設定: 不正な型・profile を既定値に落とさずエラーにする", (t) => {
  const directory = workspace(t);
  for (const content of ['profile = "typo"', 'plan_gate = "false"', '[context]\nsplit_above = "big"', '[context]\nmerge_below = "500k"\nsplit_above = "450k"']) {
    write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"\n${content}\n`);
    const result = cli(directory, "config", "--json");
    assert.equal(result.status, 1, content);
    assert.match(result.stderr, /error:/);
  }
});

/** origin/HEAD を置く（defaultBranch は refs/remotes/origin/HEAD を読む） */
function setOriginHead(directory: string, branch: string): void {
  write(directory, ".git/refs/remotes/origin/HEAD", `ref: refs/remotes/origin/${branch}\n`);
}

test("設定: 安全でない分割はサイクルの宣言と、リリースされないブランチ向きの両方が揃ったときだけ許す", (t) => {
  const directory = workspace(t, true);
  setOriginHead(directory, "main");
  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"
[data_integrity]
release_branches = ["release/*"]
`);
  const cycleConfig = "docs/hikyaku/cycles/001-test/.hikyaku.config";
  const unsafeSplit = (): { allowed: boolean; reason: string } =>
    JSON.parse(succeeds(directory, "config", "001", "--json")).unsafeSplit;

  // 既定はフラグ off
  assert.equal(unsafeSplit().reason, "flag-off");

  write(directory, cycleConfig, `base_branch = "feature/x"\n[data_integrity]\nallow_unsafe_split = true\n`);
  assert.deepEqual([unsafeSplit().allowed, unsafeSplit().reason], [true, "allowed"]);

  write(directory, cycleConfig, `base_branch = "release/2.x"\n[data_integrity]\nallow_unsafe_split = true\n`);
  assert.deepEqual([unsafeSplit().allowed, unsafeSplit().reason], [false, "release-branch"]);

  // base_branch 未設定はデフォルトブランチ向き
  write(directory, cycleConfig, `[data_integrity]\nallow_unsafe_split = true\n`);
  assert.deepEqual([unsafeSplit().allowed, unsafeSplit().reason], [false, "release-branch"]);
  assert.match(succeeds(directory, "config", "001"), /安全でない分割\s+許さない/);
});

test("CLI: validate は許されていない安全でない分割と、解消するビルドの不備を検出する", (t) => {
  const directory = workspace(t, true);
  setOriginHead(directory, "main");
  const cycle = "docs/hikyaku/cycles/001-test";
  succeeds(directory, "tasklist", "add", "001", "--title", "列の追加");
  succeeds(directory, "tasklist", "add", "001", "--title", "移行", "--deps", "1");
  const unsafe = "# Build 01: 列の追加\n\n## マージ時点で残る危険\n\n- 旧カラムが残る\n- 解消するビルド: build-02\n";
  write(directory, `${cycle}/build-01/issue.md`, unsafe);
  write(directory, `${cycle}/build-02/issue.md`);

  const denied = cli(directory, "validate", "--json");
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /安全でない分割が許されていません/);

  write(directory, `${cycle}/.hikyaku.config`, `base_branch = "feature/x"\n[data_integrity]\nallow_unsafe_split = true\n`);
  assert.equal(JSON.parse(succeeds(directory, "validate", "--json")).ok, true);

  write(directory, `${cycle}/build-01/issue.md`, unsafe.replace("build-02", "build-07"));
  const missing = cli(directory, "validate", "--json");
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /build-07 は tasklist.md にありません/);
});

test("設定: [context] の目安は整数か、k / m の単位を付けた文字列で書ける", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[context]\napproval = "250k"\nimplement = 320000\nreview = "0.4m"\n');
  const config = JSON.parse(succeeds(directory, "config", "--json"));
  assert.deepEqual(config.context, { approval: 250_000, implement: 320_000, review: 400_000 });

  for (const value of ['"250"', '"250x"', "0", '"0k"', '"1.5"', "-1"]) {
    write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"\n[context]\napproval = ${value}\n`);
    const result = cli(directory, "config", "--json");
    if (value === '"250"') {
      assert.equal(result.status, 0, "単位の無い文字列は整数と同じ");
      continue;
    }
    assert.equal(result.status, 1, value);
    assert.match(result.stderr, /\[context\]\.approval はトークン数で指定してください/);
  }
});

test("設定: v3 で廃止した bp_max と [bp_actual] は、移行先を示して止める", (t) => {
  const directory = workspace(t);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\nbp_max = 8\n');
  let result = cli(directory, "config", "--json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /bp_max は v3 で廃止/);
  assert.match(result.stderr, /split_above/);

  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[bp_actual]\nexclude = []\n');
  result = cli(directory, "config", "--json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[diff\] に改名/);

  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", "bp_max = 8\n");
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n');
  assert.equal(JSON.parse(succeeds(directory, "config", "--json")).peakBands.splitAbove, 450_000);
});
