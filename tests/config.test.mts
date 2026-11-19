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
limit = 600000
merge_ratio = "50%"
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
  assert.deepEqual(config.context, { limit: 600_000, estimateRatio: 0.9, mergeRatio: 0.5 });
  assert.deepEqual(config.peakBands, { mergeHint: 300_000, estimateLimit: 540_000 });
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
  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", "[review]\nmax_rounds = 5\n[context]\nlimit = '600k'\n");
  succeeds(directory, "cycle", "use", "002");
  write(directory, ".git/HEAD", "ref: refs/heads/hikyaku/001-test/plan\n");
  const config = JSON.parse(succeeds(directory, "config", "--json"));
  assert.equal(config.cycle, "001-test");
  assert.equal(config.cycleSource, "branch");
  assert.equal(config.review.code.maxRounds, 5);
  assert.equal(JSON.parse(succeeds(directory, "config", "--profile", "express", "--json")).review.code.maxRounds, 1);
  assert.equal(JSON.parse(succeeds(directory, "tokens", "guide", "--json")).bands.estimateLimit, 540_000);
  assert.equal(JSON.parse(succeeds(directory, "tokens", "guide", "--profile", "express", "--json")).bands.estimateLimit, 450_000);

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
  for (const content of ['profile = "typo"', 'plan_gate = "false"', '[context]\nlimit = "big"', '[context]\nmerge_ratio = "90%"\nestimate_ratio = "80%"', '[context]\nestimate_ratio = "120%"']) {
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

test("設定: [rules] hit_threshold と [areas] dormant_days は既定 3 と 180、サイクル設定で上書きでき、正の整数でなければエラー", (t) => {
  const directory = workspace(t, true);
  const defaults = JSON.parse(succeeds(directory, "config", "--json"));
  assert.deepEqual([defaults.rules, defaults.areas], [{ hitThreshold: 3 }, { dormantDays: 180 }]);

  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[rules]\nhit_threshold = 3\n[areas]\ndormant_days = 90\n');
  assert.equal(JSON.parse(succeeds(directory, "config", "--json")).areas.dormantDays, 90);
  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", "[rules]\nhit_threshold = 5\n[areas]\ndormant_days = 30\n");
  const cycle = JSON.parse(succeeds(directory, "config", "001", "--json"));
  assert.deepEqual([cycle.rules.hitThreshold, cycle.areas.dormantDays], [5, 30]);
  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", "");

  const invalid: [string, string, string][] = [["rules", "hit_threshold", "0"], ["areas", "dormant_days", '"180"'], ["areas", "dormant_days", "-1"], ["areas", "dormant_days", "1.5"]];
  for (const [table, key, value] of invalid) {
    write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"\n[${table}]\n${key} = ${value}\n`);
    const result = cli(directory, "config", "--json");
    assert.notEqual(result.status, 0, `${key} = ${value}`);
    assert.match(result.stderr, new RegExp(key));
  }
});

test("設定: [context] の limit は整数か、k / m の単位を付けた文字列で、割合は % か小数で書ける", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[context]\nlimit = "0.4m"\nestimate_ratio = 0.8\nmerge_ratio = "50%"\n');
  const config = JSON.parse(succeeds(directory, "config", "--json"));
  assert.deepEqual(config.context, { limit: 400_000, estimateRatio: 0.8, mergeRatio: 0.5 });
  assert.deepEqual(config.peakBands, { mergeHint: 200_000, estimateLimit: 320_000 });

  for (const value of ['"500"', '"500x"', "0", '"0k"', '"1.5"', "-1"]) {
    write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"\n[context]\nlimit = ${value}\n`);
    const result = cli(directory, "config", "--json");
    if (value === '"500"') {
      assert.equal(result.status, 0, "単位の無い文字列は整数と同じ");
      continue;
    }
    assert.equal(result.status, 1, value);
    assert.match(result.stderr, /\[context\]\.limit はトークン数で指定してください/);
  }
});

test("設定: v3 で廃止した [context] の目安と帯のキーは、移行先を示して止める", (t) => {
  const directory = workspace(t);
  for (const key of ["split_above", "merge_below", "approval", "implement", "review"]) {
    write(directory, ".hikyaku.config", `hikyaku_root = "docs/hikyaku"\n[context]\n${key} = "300k"\n`);
    const result = cli(directory, "config", "--json");
    assert.equal(result.status, 1, key);
    assert.match(result.stderr, new RegExp(`\\[context\\] ${key} は v3 で廃止しました`));
    assert.match(result.stderr, /limit/);
  }
});

test("設定: v3 で廃止した bp_max と [bp_actual] は、移行先を示して止める", (t) => {
  const directory = workspace(t);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\nbp_max = 8\n');
  let result = cli(directory, "config", "--json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /bp_max は v3 で廃止/);
  assert.match(result.stderr, /\[context\] limit/);

  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n[bp_actual]\nexclude = []\n');
  result = cli(directory, "config", "--json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[diff\] に改名/);

  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", "bp_max = 8\n");
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n');
  assert.equal(JSON.parse(succeeds(directory, "config", "--json")).peakBands.estimateLimit, 450_000);
});

const ROOT = 'hikyaku_root = "docs/hikyaku"\n';
const APP = '[app]\nexposure = "internal"\ndata = "none"\nimpact = "low"\nmerge_gate = "user"\n';

test("設定: ルート設定の [app]・[[app.areas]]・[boundaries] を読み、表示する", (t) => {
  const directory = workspace(t);
  write(directory, ".hikyaku.config", `${ROOT}${APP}[[app.areas]]\nname = "auth"\npaths = ["src/auth/**"]\nimpact = "high"\n[boundaries]\nexternal = ["api/**"]\ninternal = ["src/lib/**"]\n`);
  const config = JSON.parse(succeeds(directory, "config", "--json"));
  assert.deepEqual(config.app, {
    axes: { exposure: "internal", data: "none", impact: "low" },
    mergeGate: "user",
    areas: [{ name: "auth", paths: ["src/auth/**"], impact: "high" }],
  });
  assert.deepEqual(config.boundaries, { external: ["api/**"], internal: ["src/lib/**"] });

  const text = succeeds(directory, "config");
  assert.match(text, /internal \/ none \/ low/);
  assert.match(text, /merge_gate\s+user/);
  assert.match(text, /害「中」まで/);
  assert.match(text, /重い領域 auth\s+src\/auth\/\*\*（impact=high）/);
  assert.match(text, /external\s+api\/\*\*/);
  assert.match(text, /この版では検査と表示だけで、ゲートの判定にはまだ使わない/);
});

test("設定: 宣言が無ければ app は無く、boundaries は空で、「宣言なし（上限を設けない）」と出す", (t) => {
  const directory = workspace(t);
  const config = JSON.parse(succeeds(directory, "config", "--json"));
  assert.equal("app" in config, false);
  assert.deepEqual(config.boundaries, { external: [], internal: [] });
  assert.match(succeeds(directory, "config"), /宣言なし（上限を設けない）/);
});

test("設定: [app]・[[app.areas]]・[boundaries] の欠け・不正な値・知らないキー・名前の重複はエラー", (t) => {
  const directory = workspace(t);
  const area = (body: string) => `${APP}[[app.areas]]\n${body}\n`;
  for (const [body, pattern] of [
    ['[app]\nexposure = "public"\ndata = "none"\n', /exposure・data・impact/],
    ['[app]\nexposure = "world"\ndata = "none"\nimpact = "low"\n', /exposure の値が不正/],
    ['[app]\nexposure = "public"\ndata = "none"\nimpact = "low"\nmerge_gate = "ci"\n', /merge_gate の値が不正/],
    ['[app]\nexposure = "public"\ndata = "none"\nimpact = "low"\nceiling = "高"\n', /指定できないキーです: ceiling/],
    [area('name = "auth"\npaths = ["src/auth/**"]\ndata = "secret"'), /data の値が不正/],
    [area('name = "auth"\npaths = ["a/**"]\n[[app.areas]]\nname = "auth"\npaths = ["b/**"]'), /name が重複しています: auth/],
    [area('name = "auth"\npaths = []'), /paths が空/],
    [area('name = "auth"'), /paths がありません/],
    [area('paths = ["a/**"]'), /name がありません/],
    [area('name = "auth"\npaths = ["a/**"]\nowner = "x"'), /指定できないキーです: owner/],
    ['[boundaries]\nexternal = "api/**"\n', /external/],
    ["[boundaries]\ninternal = [1]\n", /internal/],
    ['[boundaries]\npublic = ["a"]\n', /指定できないキーです: public/],
  ] as const) {
    write(directory, ".hikyaku.config", `${ROOT}${body}`);
    const result = cli(directory, "config", "--json");
    assert.equal(result.status, 1, body);
    assert.match(result.stderr, pattern, body);
  }
});

test("設定: サイクル設定に [app]・[boundaries] があるとエラー", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", `${ROOT}${APP}`);
  const cycleConfig = "docs/hikyaku/cycles/001-test/.hikyaku.config";
  for (const [body, key] of [['[app]\nimpact = "low"\n', "app"], ['[boundaries]\nexternal = ["x"]\n', "boundaries"]] as const) {
    write(directory, cycleConfig, body);
    const result = cli(directory, "config", "001", "--json");
    assert.equal(result.status, 1, body);
    assert.match(result.stderr, new RegExp(`\\[${key}\\] はサイクル設定では指定できません`));
    assert.ok(result.stderr.includes(cycleConfig), result.stderr);
  }
});
