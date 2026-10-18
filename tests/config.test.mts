import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { cli, snapshot, succeeds, workspace, write } from "./helpers.mts";

test("設定: ルート・サイクル・profile の優先順でマージし、未上書きキーを保持する", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"
profile = "economy"
bp_max = 13
ask = ["branch.prefix", "pr.title"]
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
  assert.equal(config.bpMax, 13);
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
  write(directory, "docs/hikyaku/.hikyaku.config", "bp_max = 13\n");
  const result = cli(directory, "config", "--json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /読み込まれません/);
});

test("設定: 不正な型・profile を既定値に落とさずエラーにする", (t) => {
  const directory = workspace(t);
  for (const content of ['profile = "typo"', 'plan_gate = "false"', 'bp_max = 1.5']) {
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
