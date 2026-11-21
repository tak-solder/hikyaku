import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, succeeds, workspace, write } from "./helpers.mts";

const ROOT_LINE = 'hikyaku_root = "docs/hikyaku"\n';

const V2_CONDUCTOR = `# top
hikyaku_root = "docs/hikyaku"

[conductor]
provider = "claude"  # v2
escalate = ["G8"]

[conductor.claude]
model = "opus"

[conductor.claude.models]
builder = "sonnet"
architect = "opus"

# codex の分
[conductor.codex]
model = "gpt-5"

[context]
limit = "600k"
`;

test("設定: v2 の [conductor] provider / claude / codex は、移行先と migrate を示して止める", (t) => {
  const directory = workspace(t);
  for (const body of ['[conductor]\nprovider = "claude"', '[conductor.claude]\nmodel = "opus"', '[conductor.codex.models]\nbuilder = "x"']) {
    write(directory, ".hikyaku.config", `${ROOT_LINE}${body}\n`);
    const result = cli(directory, "config", "--json");
    assert.equal(result.status, 1, body);
    assert.match(result.stderr, /\[conductor\] .* は v3 で廃止しました/);
    assert.match(result.stderr, /config migrate/);
  }
});

test("設定: [conductor] の知らないキーはエラー", (t) => {
  const directory = workspace(t);
  write(directory, ".hikyaku.config", `${ROOT_LINE}[conductor]\nbudget = 3\n`);
  const result = cli(directory, "config", "--json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[conductor\] に指定できないキーです: budget/);
});

test("設定: 閉じたサイクルの設定に残った v2 の conductor の設定は読み飛ばす", (t) => {
  const directory = workspace(t, true);
  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", '[conductor.claude]\nmodel = "opus"\n');
  const result = cli(directory, "config", "001", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).retired.length, 1);
});

test("config migrate: claude の設定を [conductor] model / [conductor.models] に移し、codex と provider を消す", (t) => {
  const directory = workspace(t);
  write(directory, ".hikyaku.config", V2_CONDUCTOR);

  const dry = cli(directory, "config", "migrate", "--dry-run", "--json");
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).written, false);
  assert.equal(readFileSync(join(directory, ".hikyaku.config"), "utf8"), V2_CONDUCTOR);

  const result = JSON.parse(succeeds(directory, "config", "migrate", "--json"));
  assert.equal(result.written, true);
  const after = readFileSync(join(directory, ".hikyaku.config"), "utf8");
  assert.doesNotMatch(after, /provider|codex|conductor\.claude|gpt-5/);
  assert.match(after, /# top/);
  assert.match(after, /\[context\]\nlimit = "600k"/);
  const config = JSON.parse(succeeds(directory, "config", "--json"));
  assert.equal(config.conductor.model, "opus");
  assert.deepEqual(config.conductor.models, { builder: "sonnet", architect: "opus" });
  assert.deepEqual(config.conductor.escalate, ["G8"]);

  assert.match(succeeds(directory, "config", "migrate"), /ありません/);
});

test("config migrate --drop: 取り込まずに旧キーだけ消す", (t) => {
  const directory = workspace(t);
  write(directory, ".hikyaku.config", V2_CONDUCTOR);
  succeeds(directory, "config", "migrate", "--drop");
  const config = JSON.parse(succeeds(directory, "config", "--json"));
  assert.equal(config.conductor.model, undefined);
  assert.deepEqual(config.conductor.models, {});
  assert.deepEqual(config.conductor.escalate, ["G8"]);
});

test("config migrate: 移し先に別の値があれば上書きせず、何も書かずに止める", (t) => {
  const directory = workspace(t);
  const source = `${ROOT_LINE}[conductor]\nmodel = "sonnet"\n[conductor.claude]\nmodel = "opus"\n`;
  write(directory, ".hikyaku.config", source);
  const result = cli(directory, "config", "migrate");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[conductor\] model = "sonnet" が既にあり/);
  assert.equal(readFileSync(join(directory, ".hikyaku.config"), "utf8"), source);

  // 同じ値なら衝突ではなく、旧キーを消すだけ
  write(directory, ".hikyaku.config", `${ROOT_LINE}[conductor]\nmodel = "opus"\n[conductor.claude]\nmodel = "opus"\n`);
  succeeds(directory, "config", "migrate");
  assert.equal(JSON.parse(succeeds(directory, "config", "--json")).conductor.model, "opus");
});

test("config migrate: [conductor] が無いときは作り、ドット記法の旧キーも扱う", (t) => {
  const directory = workspace(t);
  write(directory, ".hikyaku.config", `${ROOT_LINE}[conductor.claude.models]\nbuilder = "sonnet"\n[conductor.codex]\nmodel = "x"\n`);
  succeeds(directory, "config", "migrate");
  assert.deepEqual(JSON.parse(succeeds(directory, "config", "--json")).conductor.models, { builder: "sonnet" });

  write(directory, ".hikyaku.config", `${ROOT_LINE}[conductor]\nclaude.model = "opus"\ncodex.model = "x"\nreview_timeout = 5\n`);
  succeeds(directory, "config", "migrate");
  const config = JSON.parse(succeeds(directory, "config", "--json"));
  assert.equal(config.conductor.model, "opus");
  assert.equal(config.conductor.reviewTimeoutMinutes, 5);
});
