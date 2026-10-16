import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReviewKindSettings, ReviewProviderChoice } from "../scripts/lib/config.mts";
import {
  buildInvocation,
  nativeSecurityReason,
  parseClaudeResult,
  parseCodexResult,
  planReview,
  stripFrontmatter,
} from "../scripts/lib/review.mts";
import { cli, succeeds, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";

const cliPath = fileURLToPath(new URL("../scripts/hikyaku.mts", import.meta.url));

function settings(
  overrides: Partial<ReviewKindSettings> & { provider?: ReviewProviderChoice } = {},
): ReviewKindSettings {
  const { provider, ...rest } = overrides;
  return {
    providers: [
      ...(provider === undefined ? [] : [{ source: "review" as const, provider }]),
      { source: "default", provider: "auto" },
    ],
    maxRounds: 1,
    autoFix: false,
    models: { claude: {}, codex: {} },
    ...rest,
  };
}

/** --self を渡したときに決まるプロバイダ（review resolve の JSON） */
function resolvedProvider(directory: string, kind: string, self: string): { provider: string; providerSource: string } {
  const plan = JSON.parse(succeeds(directory, "review", "resolve", kind, "build-01", "--self", self, "--no-fetch", "--json"));
  return { provider: plan.provider, providerSource: plan.providerSource };
}

const ROOT_CONFIG = 'hikyaku_root = "docs/hikyaku"\nbase_branch = "main"\n';

function reviewConfig(directory: string, body = ""): Record<string, unknown> {
  write(directory, ".hikyaku.config", ROOT_CONFIG + body);
  return JSON.parse(succeeds(directory, "config", "001", "--json")).review;
}

test("レビュー設定: profile ごとの max_rounds が既定になり、[review] で上書きできる", (t) => {
  const directory = workspace(t, true);
  const standard = reviewConfig(directory) as { code: ReviewKindSettings; doc: ReviewKindSettings; timeoutMinutes: number };
  assert.equal(standard.code.maxRounds, 2);
  assert.deepEqual(standard.code.providers, [{ source: "default", provider: "auto" }]);
  assert.equal(standard.code.autoFix, false);
  assert.equal(standard.doc.maxRounds, 1);
  assert.equal(standard.timeoutMinutes, 30);

  const economy = JSON.parse(succeeds(directory, "config", "001", "--profile", "economy", "--json")).review;
  assert.equal(economy.code.maxRounds, 1);
  const thorough = JSON.parse(succeeds(directory, "config", "001", "--profile", "thorough", "--json")).review;
  assert.equal(thorough.security.maxRounds, 3);

  const custom = reviewConfig(directory, "[review]\nmax_rounds = 0\nauto_fix = true\n[review.security]\nmax_rounds = 1\n") as {
    code: ReviewKindSettings;
    security: ReviewKindSettings;
  };
  assert.equal(custom.code.maxRounds, 0);
  assert.equal(custom.code.autoFix, true);
  assert.equal(custom.security.maxRounds, 1);
});

test("レビュー設定: モデルとエフォートは種類×プロバイダ → プロバイダの順に重なり、空文字で既定に戻る", (t) => {
  const directory = workspace(t, true);
  const review = reviewConfig(
    directory,
    [
      "[review]",
      'provider = "codex"',
      "[review.claude]",
      'model = "opus"',
      'effort = "high"',
      "[review.codex]",
      'model = "gpt-a"',
      'effort = "ultra"',
      "[review.code]",
      'provider = "claude"',
      "[review.code.claude]",
      'effort = "max"',
      "[review.security.codex]",
      'model = ""',
      "[review.doc]",
      'provider = "auto"',
      "",
    ].join("\n"),
  ) as Record<"code" | "security" | "doc", ReviewKindSettings>;
  assert.deepEqual(review.code.providers[0], { source: "kind", provider: "claude" });
  assert.deepEqual(review.code.models.claude, { model: "opus", effort: "max" });
  assert.deepEqual(review.security.providers[0], { source: "review", provider: "codex" });
  // Codex の effort はモデル依存なので検証しない
  assert.deepEqual(review.security.models.codex, { effort: "ultra" });
  assert.deepEqual(review.doc.providers[0], { source: "kind", provider: "auto" });
  assert.deepEqual(review.doc.models.codex, { model: "gpt-a", effort: "ultra" });
});

test("レビュー設定: 不正な値・未知のキーを黙って捨てずにエラーにする", (t) => {
  const directory = workspace(t, true);
  const cases: [string, RegExp][] = [
    ['[review]\nprovider = "gemini"\n', /provider の値が不正/],
    ['[review.claude]\neffort = "ultra"\n', /effort の値が不正/],
    ["[review]\nmax_rounds = -1\n", /0 以上/],
    ["[review]\nrounds = 2\n", /指定できないキー.*rounds/],
    ["[review.code]\nmodel = \"opus\"\n", /\[review\.code\] に指定できないキー.*model/],
    ["[review.doc]\nmax_rounds = 2\n", /回数は設定できません/],
    ["[review.codex]\nreasoning = \"high\"\n", /\[review\.codex\] に指定できないキー/],
    ['[review]\ncode = "codex"\n', /\[review\.code\]/],
    ["[review]\ntimeout = 0\n", /timeout/],
    ['[review.provider_for]\nclaude = "auto"\n', /provider_for\]\.claude の値が不正/],
    ['[review.provider_for]\ngemini = "codex"\n', /\[review\.provider_for\] に指定できないキー/],
    ['[review]\nprovider_for = "codex"\n', /\[review\.provider_for\]/],
  ];
  for (const [body, pattern] of cases) {
    write(directory, ".hikyaku.config", ROOT_CONFIG + body);
    const result = cli(directory, "config", "001", "--json");
    assert.equal(result.status, 1, body);
    assert.match(result.stderr, pattern, body);
  }
});

test("レビューの解決: code / security は常に別プロセス、doc はメインと同じならサブエージェント", () => {
  assert.deepEqual(
    [planReview({ kind: "code", self: "claude", settings: settings() })].map((plan) => [plan.provider, plan.mode, plan.style]),
    [["claude", "process", "code-review"]],
  );
  const doc = planReview({ kind: "doc", self: "codex", settings: settings() });
  assert.equal(doc.mode, "agent");
  const otherDoc = planReview({ kind: "doc", self: "codex", settings: settings({ provider: "claude" }) });
  assert.deepEqual([otherDoc.mode, otherDoc.style], ["process", "prompt"]);

  const native = planReview({ kind: "security", self: "claude", settings: settings(), nativeSecurity: true });
  assert.equal(native.style, "security-review");
  const stacked = planReview({ kind: "security", self: "claude", settings: settings(), nativeSecurity: false });
  assert.equal(stacked.style, "prompt");
  // Codex にはセキュリティ専用のレビュー機能が無い
  const codex = planReview({ kind: "security", self: "claude", settings: settings({ provider: "codex" }), nativeSecurity: true });
  assert.equal(codex.style, "prompt");
});

test("レビューの解決: /security-review は origin のデフォルトブランチ宛てでスタックしていないときだけ使う", () => {
  assert.equal(nativeSecurityReason({ originHead: "main", prBase: "main", stacked: false }).native, true);
  assert.equal(nativeSecurityReason({ originHead: undefined, prBase: "main", stacked: false }).native, false);
  assert.equal(nativeSecurityReason({ originHead: "main", prBase: "hikyaku/001-x/build-01", stacked: true }).native, false);
  assert.equal(nativeSecurityReason({ originHead: "main", prBase: "develop", stacked: false }).native, false);
});

test("レビューのコマンド: プロバイダと種類ごとに組み立て、書き換えを禁じる", () => {
  const models = { claude: { model: "opus", effort: "high" }, codex: { model: "gpt-a", effort: "xhigh" } };
  const claudeCode = buildInvocation(planReview({ kind: "code", self: "claude", settings: settings({ models }) }), {
    baseRef: "origin/main",
    prompt: undefined,
    outputFile: "/tmp/out",
  });
  assert.equal(claudeCode.command, "claude");
  assert.deepEqual(claudeCode.args.slice(0, 4), ["-p", "/code-review high origin/main...HEAD", "--output-format", "json"]);
  assert.ok(claudeCode.args.includes("--disallowedTools"));
  assert.equal(claudeCode.outputFile, undefined);

  const noEffort = buildInvocation(planReview({ kind: "code", self: "claude", settings: settings() }), {
    baseRef: "main",
    prompt: undefined,
    outputFile: "/tmp/out",
  });
  assert.equal(noEffort.args[1], "/code-review main...HEAD");
  assert.ok(!noEffort.args.includes("--model"));

  const codexCode = buildInvocation(planReview({ kind: "code", self: "claude", settings: settings({ provider: "codex", models }) }), {
    baseRef: "main",
    prompt: undefined,
    outputFile: "/tmp/out",
  });
  assert.deepEqual(codexCode.args, [
    "exec",
    "review",
    "--base",
    "main",
    "-m",
    "gpt-a",
    "-c",
    'model_reasoning_effort="xhigh"',
    "-c",
    'sandbox_mode="read-only"',
    "-o",
    "/tmp/out",
  ]);

  // --base と指示文は排他なので、セキュリティは指示文だけを渡す
  const codexSecurity = buildInvocation(
    planReview({ kind: "security", self: "codex", settings: settings() }),
    { baseRef: "main", prompt: "観点", outputFile: "/tmp/out" },
  );
  assert.deepEqual(codexSecurity.args.slice(0, 2), ["exec", "review"]);
  assert.ok(!codexSecurity.args.includes("--base"));
  assert.equal(codexSecurity.args.at(-1), "観点");

  const codexDoc = buildInvocation(planReview({ kind: "doc", self: "claude", settings: settings({ provider: "codex" }) }), {
    baseRef: undefined,
    prompt: "doc",
    outputFile: "/tmp/out",
  });
  assert.equal(codexDoc.args[1], "-c");

  assert.throws(() =>
    buildInvocation(planReview({ kind: "doc", self: "claude", settings: settings() }), {
      baseRef: undefined,
      prompt: "doc",
      outputFile: "/tmp/out",
    }),
  );
});

test("レビューの結果: 空の結果を指摘0件と取り違えない", () => {
  assert.equal(parseClaudeResult('{"is_error":false,"num_turns":0,"result":"calc.js:3 off-by-one"}').ok, true);
  assert.equal(parseClaudeResult('Warning: no stdin\n{"is_error":false,"result":"指摘なし"}').ok, true);
  // origin/HEAD が無いときの /security-review
  assert.equal(parseClaudeResult('{"is_error":false,"num_turns":0,"result":""}').ok, false);
  assert.equal(parseClaudeResult('{"is_error":true,"result":"x","subtype":"error_max_turns"}').ok, false);
  assert.equal(parseClaudeResult("not json").ok, false);
  assert.equal(parseCodexResult(undefined).ok, false);
  assert.equal(parseCodexResult("  \n").ok, false);
  assert.equal(parseCodexResult("[P1] 指摘").ok, true);
  assert.equal(stripFrontmatter("---\nname: x\n---\n\n本文\n"), "本文");
});

/** claude / codex の代わりに PATH へ置くスタブ。受け取った引数を記録し、決めた出力を返す */
function stubs(t: TestContext, claudeOutput: string): string {
  const bin = temporaryDirectory(t);
  write(
    bin,
    "claude",
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${bin}/claude.args"\ncat <<'EOF'\n${claudeOutput}\nEOF\n`,
  );
  write(
    bin,
    "codex",
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${bin}/codex.args"\nout=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done\nprintf '[P1] 指摘\\n' > "$out"\n`,
  );
  chmodSync(join(bin, "claude"), 0o755);
  chmodSync(join(bin, "codex"), 0o755);
  return bin;
}

function runWith(directory: string, bin: string, ...args: string[]) {
  return runEnv(directory, { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }, ...args);
}

function runEnv(directory: string, extra: NodeJS.ProcessEnv, ...args: string[]) {
  const env = { ...testEnvironment(), ...extra };
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: directory, encoding: "utf8", env, timeout: 20_000 });
  assert.ifError(result.error);
  return result;
}

function buildBranch(t: TestContext, body = ""): string {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", ROOT_CONFIG + body);
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", env: testEnvironment() });
    assert.equal(result.status, 0, result.stderr);
  };
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-q", "-m", "init");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "workspace");
  git("checkout", "-q", "-b", "hikyaku/001-test/build-01");
  return directory;
}

test("review run: 別プロセスの出力を .git の中に保存して返す", (t) => {
  const directory = buildBranch(t);
  const bin = stubs(t, '{"is_error":false,"num_turns":0,"result":"calc.js:3 off-by-one"}');
  const result = runWith(directory, bin, "review", "run", "code", "build-01", "--self", "claude", "--no-fetch", "--json");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.result, "calc.js:3 off-by-one");
  assert.match(output.output, /\.git\/hikyaku\/reviews\/001-test\/build-01\/round-1-code\.md$/);
  assert.equal(readFileSync(output.output, "utf8"), "calc.js:3 off-by-one");
  assert.match(readFileSync(join(bin, "claude.args"), "utf8"), /\/code-review main\.\.\.HEAD/);

  const codex = runWith(directory, bin, "review", "run", "code", "build-01", "--self", "codex", "--round", "2", "--no-fetch", "--json");
  assert.equal(codex.status, 0, codex.stderr);
  assert.equal(JSON.parse(codex.stdout).result, "[P1] 指摘\n");
  assert.match(readFileSync(join(bin, "codex.args"), "utf8"), /^exec\nreview\n--base\nmain\n/);
});

test("review run: 空の結果・回数の上限・サブエージェントの種類は失敗にする", (t) => {
  const directory = buildBranch(t, "[review.code]\nmax_rounds = 1\n");
  const empty = stubs(t, '{"is_error":false,"num_turns":0,"result":""}');
  const result = runWith(directory, empty, "review", "run", "code", "build-01", "--self", "claude", "--no-fetch");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /空の結果/);

  const over = runWith(directory, empty, "review", "run", "code", "build-01", "--self", "claude", "--round", "2", "--no-fetch");
  assert.equal(over.status, 1);
  assert.match(over.stderr, /最大 1 回/);

  const agent = runWith(directory, empty, "review", "run", "doc", "plan", "--self", "claude", "--context", "plan", "--files", "a.md");
  assert.equal(agent.status, 1);
  assert.match(agent.stderr, /サブエージェント/);
});

test("review run --dry-run: コマンドだけを返し、何も実行しない", (t) => {
  const directory = buildBranch(t, '[review.security]\nprovider = "codex"\n');
  const bin = stubs(t, "{}");
  const result = runWith(directory, bin, "review", "run", "security", "build-01", "--self", "claude", "--dry-run", "--no-fetch", "--json");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.style, "prompt");
  assert.match(output.args.at(-1), /# セキュリティレビュー[\s\S]*差分の基準: `main`/);
  assert.equal(existsSync(join(bin, "codex.args")), false);
  assert.equal(existsSync(output.output), false);

  const resolved = JSON.parse(succeeds(directory, "review", "resolve", "security", "build-01", "--self", "claude", "--no-fetch", "--json"));
  assert.equal(resolved.provider, "codex");
  assert.equal(resolved.security.native, false);
  assert.equal(resolved.enabled, "recommended");
});

test("環境変数 HIKYAKU_REVIEW_PROVIDER: 設定ファイルの provider より優先し、出所を示す", (t) => {
  const directory = buildBranch(t, '[review]\nprovider = "codex"\n[review.security]\nprovider = "codex"\n[review.claude]\neffort = "low"\n');
  const plain = JSON.parse(succeeds(directory, "review", "resolve", "security", "build-01", "--self", "claude", "--no-fetch", "--json"));
  assert.deepEqual([plain.provider, plain.providerSource], ["codex", "kind"]);

  const overridden = runEnv(directory, { HIKYAKU_REVIEW_PROVIDER: "claude" }, "review", "resolve", "security", "build-01", "--self", "codex", "--no-fetch", "--json");
  assert.equal(overridden.status, 0, overridden.stderr);
  const resolved = JSON.parse(overridden.stdout);
  assert.deepEqual([resolved.provider, resolved.providerSource], ["claude", "env"]);
  // モデルとエフォートは切り替え先のプロバイダの設定が使われる
  assert.equal(resolved.effort, "low");

  const text = runEnv(directory, { HIKYAKU_REVIEW_PROVIDER: "claude" }, "review", "resolve", "code", "build-01", "--self", "claude", "--no-fetch");
  assert.match(text.stdout, /出所 +環境変数 HIKYAKU_REVIEW_PROVIDER/);
  const config = runEnv(directory, { HIKYAKU_REVIEW_PROVIDER: "auto" }, "config", "001");
  assert.match(config.stdout, /code +auto（環境変数 HIKYAKU_REVIEW_PROVIDER）/);

  const empty = runEnv(directory, { HIKYAKU_REVIEW_PROVIDER: "" }, "review", "resolve", "code", "build-01", "--self", "claude", "--no-fetch", "--json");
  assert.equal(JSON.parse(empty.stdout).providerSource, "review");

  const invalid = runEnv(directory, { HIKYAKU_REVIEW_PROVIDER: "gemini" }, "config", "001");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /環境変数 HIKYAKU_REVIEW_PROVIDER の値が不正/);
});

test("review run: CLI を起動できないときは失敗にし、環境変数での切り替えを案内する", (t) => {
  const directory = buildBranch(t, '[review.code]\nprovider = "codex"\n');
  // codex の無い PATH（git だけは使えるようにする）
  const bin = temporaryDirectory(t);
  const result = runEnv(directory, { PATH: `${bin}${delimiter}/usr/bin${delimiter}/bin` }, "review", "run", "code", "build-01", "--self", "claude", "--no-fetch");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /codex を起動できません/);
  assert.match(result.stderr, /HIKYAKU_REVIEW_PROVIDER=claude/);
});

test("provider_for: メインのプロバイダごとにレビューの実行先を決め、行が無ければ provider に戻る", (t) => {
  const directory = buildBranch(
    t,
    [
      "[review]",
      'provider = "auto"',
      "[review.provider_for]",
      'claude = "codex"',
      "[review.security]",
      'provider = "claude"',
      "[review.doc.provider_for]",
      'codex = "claude"',
      "",
    ].join("\n"),
  );
  // Claude で開発していれば Codex でレビューする。Codex の行は無いので auto（Codex のまま）
  assert.deepEqual(resolvedProvider(directory, "code", "claude"), { provider: "codex", providerSource: "review.provider_for" });
  assert.deepEqual(resolvedProvider(directory, "code", "codex"), { provider: "codex", providerSource: "review" });
  // 種類の provider は [review.provider_for] より強い
  assert.deepEqual(resolvedProvider(directory, "security", "claude"), { provider: "claude", providerSource: "kind" });
  // 種類の provider_for は種類の provider より強く、行が無ければ下の段へ進む
  assert.deepEqual(resolvedProvider(directory, "doc", "codex"), { provider: "claude", providerSource: "kind.provider_for" });
  assert.deepEqual(resolvedProvider(directory, "doc", "claude"), { provider: "codex", providerSource: "review.provider_for" });

  const text = succeeds(directory, "review", "resolve", "code", "build-01", "--self", "claude", "--no-fetch");
  assert.match(text, /出所 +\[review\.provider_for\] の claude/);
  const config = succeeds(directory, "config", "001");
  assert.match(config, /code +provider_for（claude→codex） > auto +回数/);

  // 環境変数は provider_for より強い
  const env = runEnv(directory, { HIKYAKU_REVIEW_PROVIDER: "claude" }, "review", "resolve", "code", "build-01", "--self", "claude", "--no-fetch", "--json");
  assert.deepEqual([JSON.parse(env.stdout).provider, JSON.parse(env.stdout).providerSource], ["claude", "env"]);
});

test("review run: 同じラウンドの再実行で、前回の Codex の出力を今回の結果として読まない", (t) => {
  const directory = buildBranch(t, '[review.code]\nprovider = "codex"\n');
  const bin = stubs(t, "{}");
  const first = runWith(directory, bin, "review", "run", "code", "build-01", "--self", "claude", "--no-fetch", "--json");
  assert.equal(first.status, 0, first.stderr);
  const output: string = JSON.parse(first.stdout).output;
  assert.ok(existsSync(output.replace(/\.md$/, ".raw")));

  // 2回目の Codex は -o に何も書かずに正常終了する
  write(bin, "codex", "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "codex"), 0o755);
  const second = runWith(directory, bin, "review", "run", "code", "build-01", "--self", "claude", "--no-fetch");
  assert.equal(second.status, 1);
  assert.match(second.stderr, /codex が結果を書き出しませんでした/);
  assert.equal(readFileSync(output, "utf8"), "");
});
