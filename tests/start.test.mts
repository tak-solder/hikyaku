import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { cli, succeeds, testEnvironment, workspace, write } from "./helpers.mts";

// start: フェーズの冒頭の準備（作業サイクルの記録・ブランチ・状態・セッション名）

function git(directory: string, ...args: string[]): string {
  const run = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

/** base_branch を main にしてコミットしたワークスペース（サイクル 001-test あり） */
function committed(t: TestContext): string {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\nbase_branch = "main"\n');
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "init");
  return directory;
}

/** 設計まで終えて、ビルドを登録したサイクル（build-02 は build-01 に依存） */
function designed(t: TestContext): string {
  const directory = committed(t);
  write(directory, "docs/hikyaku/cycles/001-test/planning/user-stories.md");
  write(directory, "docs/hikyaku/cycles/001-test/design/design-delta.md");
  succeeds(directory, "tasklist", "add", "001", "--title", "請求テーブル");
  succeeds(directory, "tasklist", "add", "001", "--title", "請求画面", "--deps", "1");
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "design");
  return directory;
}

function start(directory: string, ...args: string[]): { status: number | null; data: Record<string, any> } {
  const result = cli(directory, "start", ...args, "--json");
  return { status: result.status, data: JSON.parse(result.stdout) as Record<string, any> };
}

test("start: デフォルトブランチに居ればブランチを作って切り替え、栞とセッション名を返す", (t) => {
  const directory = committed(t);
  const { status, data } = start(directory, "plan");
  assert.equal(status, 0);
  assert.equal(data["branch"].status, "created");
  assert.equal(git(directory, "branch", "--show-current"), "hikyaku/001-test/plan");
  assert.ok(existsSync(join(directory, "docs/hikyaku/.hikyaku.local")), "作業サイクルを記録する");
  assert.equal(data["sessionTitle"], "001-test plan");
  assert.equal(data["outcome"].kind, "continue");
  assert.equal(data["next"], "step next plan 001-test");

  // 2回目はそのブランチに居るので何もしない
  assert.equal(start(directory, "plan").data["branch"].status, "ok");
});

test("start: --dry-run はブランチも栞も作らない", (t) => {
  const directory = committed(t);
  const { status, data } = start(directory, "plan", "--dry-run");
  assert.equal(status, 0);
  assert.equal(data["branch"].status, "created");
  assert.equal(git(directory, "branch", "--show-current"), "main");
  assert.equal(existsSync(join(directory, "docs/hikyaku/.hikyaku.local")), false);
});

test("start: 切る元ではない作業ブランチに居れば尋ね、--keep-branch で続ける", (t) => {
  const directory = committed(t);
  git(directory, "switch", "-q", "-c", "work");
  const asked = start(directory, "architect");
  assert.equal(asked.status, 2);
  assert.deepEqual(asked.data["outcome"], {
    kind: "ask",
    ask: "branch",
    message: "切る元ではない作業ブランチに居ます。どのブランチで作業するかをユーザーに尋ねてください",
  });
  assert.equal(asked.data["state"], undefined, "尋ねる前に状態を読まない");

  const kept = start(directory, "architect", "--keep-branch");
  assert.equal(kept.status, 0);
  assert.equal(kept.data["branch"].status, "kept");
  assert.equal(git(directory, "branch", "--show-current"), "work");
  assert.equal(kept.data["unsafeSplit"].allowed, false, "architect では安全でない分割の判定も返す");
});

test("start: close はサイクルが completed でなければ中止するかを尋ねる", (t) => {
  const directory = committed(t);
  const { status, data } = start(directory, "close");
  assert.equal(status, 0);
  assert.equal(data["outcome"].kind, "ask");
  assert.equal(data["outcome"].ask, "abandon");
});

test("start: 待機中のビルドは止まり、ブランチを作らない。着手できるビルドはタイトルをセッション名に入れる", (t) => {
  const directory = designed(t);

  const waiting = start(directory, "build-02");
  assert.equal(waiting.status, 0);
  assert.equal(waiting.data["outcome"].kind, "stop");
  assert.match(waiting.data["outcome"].message, /待機中.*build-01/);
  assert.equal(waiting.data["branch"].status, "skipped");
  assert.equal(git(directory, "branch", "--show-current"), "main");

  const ready = start(directory, "build-01");
  assert.equal(ready.data["outcome"].kind, "continue");
  assert.equal(ready.data["sessionTitle"], "001-test build-01 請求テーブル");
  assert.equal(git(directory, "branch", "--show-current"), "hikyaku/001-test/build-01");
});

test("start: 差し戻し中のビルドのブランチでは止まり、architect の再開を案内する", (t) => {
  const directory = designed(t);
  git(directory, "switch", "-q", "-c", "hikyaku/001-test/build-01");
  write(directory, "docs/hikyaku/cycles/001-test/return.md", "# 差し戻し: build-01\n");

  const { data } = start(directory, "build-01");
  assert.equal(data["outcome"].kind, "stop");
  assert.match(data["outcome"].message, /\/hikyaku:architect 001-test build-01/);
});

test("start: architect は企画が無ければブランチを作らずに止まり、差し戻し元のブランチではブランチに触らない", (t) => {
  const directory = committed(t);
  const planless = start(directory, "architect");
  assert.equal(planless.data["outcome"].kind, "stop");
  assert.match(planless.data["outcome"].message, /\/hikyaku:planner 001-test/);
  assert.equal(git(directory, "branch", "--show-current"), "main");

  git(directory, "switch", "-q", "-c", "hikyaku/001-test/build-01");
  write(directory, "docs/hikyaku/cycles/001-test/return.md", "# 差し戻し: build-01\n");
  const returned = start(directory, "architect");
  assert.equal(returned.status, 0);
  assert.equal(returned.data["outcome"].kind, "return");
  assert.equal(returned.data["returned"].buildId, "1");
  assert.equal(git(directory, "branch", "--show-current"), "hikyaku/001-test/build-01");
});

test("start: 設計が終わっていなければ builder は止まる", (t) => {
  const directory = committed(t);
  const { data } = start(directory, "build-01");
  assert.equal(data["outcome"].kind, "stop");
  assert.match(data["outcome"].message, /まだビルド段階ではありません/);
  assert.equal(git(directory, "branch", "--show-current"), "main");
});

test("start: plan / architect / build-NN / close 以外は受け付けない", (t) => {
  const directory = committed(t);
  const result = cli(directory, "start", "init");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /start が扱うのは/);
});

test("pr title / session title: conductor は --build-title が無ければサイクルの要約が {title} に入る", (t) => {
  const directory = workspace(t);
  succeeds(directory, "cycle", "new", "test", "--profile", "standard", "--summary", "請求機能");
  assert.equal(succeeds(directory, "pr", "title", "conductor", "001").trim(), "[hikyaku] 001-test: conductor 請求機能");
  assert.equal(succeeds(directory, "session", "title", "conductor", "001").trim(), "001-test conductor 請求機能");
  assert.equal(succeeds(directory, "pr", "title", "conductor", "001", "--build-title", "別の題").trim(), "[hikyaku] 001-test: conductor 別の題");
  assert.equal(succeeds(directory, "pr", "title", "close", "001").trim(), "[hikyaku] 001-test: close");
});

test("pr title: conductor でサイクルの要約が空なら区切りごと詰める", (t) => {
  const directory = workspace(t, true);
  assert.equal(succeeds(directory, "pr", "title", "conductor", "001").trim(), "[hikyaku] 001-test: conductor");
});
