/**
 * 事後同意の有効の判定と、上限を超える受け入れの積み上げ（build-16。ADR 20261116-deferred-consent）。
 *
 * 有効の判定は G1 の承認の記録と、基準（origin/HEAD と base_branch）の merge-base のサイクル設定を読むので、
 * 一時リポジトリに origin を作り、ブランチを切って確かめる
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
// steps/index.mts を先に読み込む（architect.mts を先に読むと、循環で初期化前に参照される）
import { lintApproval } from "../scripts/lib/steps/engine.mts";
import "../scripts/lib/steps/index.mts";
import { cli, cliWith, repository, succeeds, temporaryDirectory, testEnvironment, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const DESIGN = `${CYCLE}/design`;
const PLANNING = `${CYCLE}/planning`;
const CYCLE_CONFIG = `${CYCLE}/.hikyaku.config`;
const CONSENT = "\n[consent]\ndeferred = true\n";

function git(directory: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function commit(directory: string, message: string): void {
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "--allow-empty", "-m", message);
}

/**
 * 1分前の時刻でコミットする。コミットの時刻は秒の精度で、提示と同じ秒のコミットは提示より後とみなすので、
 * 提示より前に選んだ値を表すコミットはこれで作る（テストが速く進んでも同じ秒にならない）
 */
function commitEarlier(directory: string, message: string): void {
  git(directory, "add", "-A");
  const date = new Date(Date.now() - 60_000).toISOString();
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message], {
    cwd: directory, encoding: "utf8", env: { ...testEnvironment(), GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date }, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
}

/** [app] の宣言。axes は exposure / data / impact */
function app(options: { exposure?: string; mergeGate?: boolean; areas?: { name: string; paths: string[] }[] } = {}): string {
  const lines = ["", "[app]", `exposure = "${options.exposure ?? "internal"}"`, `data = "none"`, `impact = "low"`];
  if (options.mergeGate !== false) lines.push(`merge_gate = "user"`);
  for (const area of options.areas ?? []) {
    lines.push("", "[[app.areas]]", `name = "${area.name}"`, `paths = [${area.paths.map((path) => `"${path}"`).join(", ")}]`);
  }
  return `${lines.join("\n")}\n`;
}

const AUTH = { name: "auth", paths: ["src/auth/**"] };
const BILLING = { name: "billing", paths: ["src/billing/**"] };

interface Setup {
  profile?: string;
  /** main にコミットするルート設定の宣言 */
  app?: string;
  /** main にコミットするサイクル設定に [consent] deferred = true を書く */
  consentOnMain?: boolean;
  /** origin を作らない */
  noOrigin?: boolean;
  /** origin は作るが origin/HEAD を設定しない */
  noOriginHead?: boolean;
}

/** サイクル 001-test を持つワークスペース。main にコミットして origin へ push する */
function workspace(t: TestContext, setup: Setup = {}): string {
  const directory = repository(t);
  succeeds(directory, "init", "--root", "docs/hikyaku");
  succeeds(directory, "cycle", "new", "test", "--profile", setup.profile ?? "standard");
  const config = join(directory, ".hikyaku.config");
  writeFileSync(config, `retrospective = "skip"\n${readFileSync(config, "utf8")}${setup.app ?? app()}`);
  if (setup.consentOnMain === true) addConsent(directory);
  write(directory, "src/api/handler.ts", "export {};\n");
  write(directory, "src/auth/session.ts", "export {};\n");
  write(directory, "src/billing/invoice.ts", "export {};\n");
  commit(directory, "main");
  if (setup.noOrigin !== true) {
    const remote = temporaryDirectory(t);
    git(remote, "init", "--quiet", "--bare");
    git(directory, "remote", "add", "origin", remote);
    git(directory, "push", "-q", "origin", "main");
    if (setup.noOriginHead !== true) git(directory, "remote", "set-head", "origin", "main");
  }
  return directory;
}

function addConsent(directory: string): void {
  const path = join(directory, CYCLE_CONFIG);
  if (existsSync(path)) appendFileSync(path, CONSENT);
  else write(directory, CYCLE_CONFIG, CONSENT);
}

interface Judged {
  requested: boolean;
  effective: boolean;
  reason: string;
}

function judged(directory: string, env: NodeJS.ProcessEnv = {}): Judged {
  const result = cliWith(directory, env, "config", "001", "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { deferredConsent: Judged }).deferredConsent;
}

interface Directive {
  kind: string;
  skill?: string;
  step?: string;
  approval?: string;
  approvalReason?: string | null;
  args?: Record<string, unknown>;
  notices?: string[];
}

function parse(stdout: string): Directive {
  return (JSON.parse(stdout) as { directive: Directive }).directive;
}

function next(directory: string, phase = "architect"): Directive {
  return parse(succeeds(directory, "step", "next", phase, "001", "--json"));
}

function report(directory: string, phase: string, step: string, ...extra: string[]): Directive {
  return parse(succeeds(directory, "step", "report", phase, step, "001", ...extra, "--json"));
}

function events(directory: string, unit: string): Record<string, unknown>[] {
  return readFileSync(join(directory, unit, "progress.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function ledger(directory: string): Record<string, unknown>[] {
  const path = join(directory, DESIGN, "decisions.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** planner を G1 の手前まで進める */
function plannerToG1(directory: string): Directive {
  let directive = next(directory, "plan");
  for (let i = 0; i < 10; i += 1) {
    if (directive.step === "G1") return directive;
    if (directive.step === "user-stories") write(directory, `${PLANNING}/user-stories.md`, "# ユーザーストーリー\n");
    directive = report(directory, "plan", directive.step ?? "", "--result", "done");
  }
  throw new Error(`G1 に着きません（現在: ${directive.step}）`);
}

interface Drive {
  options?: string[];
  delta?: string;
}

/** stop のステップまで、run を done で、ゲートを承認で進める */
function driveTo(directory: string, stop: string[], drive: Drive = {}): Directive {
  let directive = next(directory);
  for (let i = 0; i < 20; i += 1) {
    const step = directive.step ?? "";
    if (stop.includes(step) || directive.kind === "done" || directive.kind === "stop") return directive;
    if (directive.kind === "gate") {
      directive = report(directory, "architect", step, "--result", "approved", "--input", "OK");
      continue;
    }
    if (step === "survey") write(directory, `${DESIGN}/codebase-survey.md`);
    if (step === "options") {
      directive = report(directory, "architect", step, "--result", "done", ...(drive.options ?? []));
      continue;
    }
    if (step === "design-delta") write(directory, `${DESIGN}/design-delta.md`, drive.delta ?? "# 設計差分\n");
    directive = report(directory, "architect", step, "--result", "done");
  }
  throw new Error(`${stop.join("/")} に着きません（現在: ${directive.step}）`);
}

// ---------------------------------------------------------------------------
// 設定

test("config: ルート設定に [consent] を書くとエラー", (t) => {
  const directory = workspace(t);
  appendFileSync(join(directory, ".hikyaku.config"), CONSENT);
  const result = cli(directory, "config", "--json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[consent\] はリポジトリルートの設定では指定できません/);
});

test("config: サイクル設定の [consent] に知らないキー・真偽値でない値はエラー", (t) => {
  const directory = workspace(t);
  write(directory, CYCLE_CONFIG, "[consent]\ndeferred = \"yes\"\n");
  assert.equal(cli(directory, "config", "001", "--json").status, 1);
  write(directory, CYCLE_CONFIG, "[consent]\ndefer = true\n");
  assert.equal(cli(directory, "config", "001", "--json").status, 1);
});

test("config: [consent] が無ければ requested も effective も false", (t) => {
  const directory = workspace(t);
  const result = judged(directory);
  assert.equal(result.requested, false);
  assert.equal(result.effective, false);
});

// ---------------------------------------------------------------------------
// 有効の判定

test("有効: ベースブランチにマージされた値と merge_gate があれば有効", (t) => {
  const directory = workspace(t, { consentOnMain: true });
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/architect");
  const result = judged(directory);
  assert.equal(result.effective, true, result.reason);
  assert.match(result.reason, /マージされた値/);
});

test("無効: merge_gate が無ければ、マージされた値があっても有効にならず理由を示す", (t) => {
  const directory = workspace(t, { consentOnMain: true, app: app({ mergeGate: false }) });
  const result = judged(directory);
  assert.equal(result.requested, true);
  assert.equal(result.effective, false);
  assert.match(result.reason, /merge_gate/);
  const directive = next(directory);
  assert.ok(directive.notices?.some((notice) => /事後同意.*有効になっていません/.test(notice)), JSON.stringify(directive.notices));
});

test("無効: 作業ツリーにだけ merge_gate を書いても有効にならない", (t) => {
  const directory = workspace(t, { consentOnMain: true, app: app({ mergeGate: false }) });
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/architect");
  const config = join(directory, ".hikyaku.config");
  writeFileSync(config, readFileSync(config, "utf8").replace('impact = "low"', 'impact = "low"\nmerge_gate = "user"'));
  commit(directory, "merge_gate を足す");
  const result = judged(directory);
  assert.equal(result.effective, false);
  assert.match(result.reason, /merge_gate/);
});

test("無効: 基準の宣言を読めない（origin が無い）ときは有効にならない", (t) => {
  const directory = workspace(t, { consentOnMain: true, noOrigin: true });
  const result = judged(directory);
  assert.equal(result.effective, false);
  assert.match(result.reason, /基準の宣言を読めず/);
});

test("有効: conductor の子でも有効になる（build-19）", (t) => {
  const directory = workspace(t, { consentOnMain: true });
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/architect");
  const result = judged(directory, { HIKYAKU_CONDUCTOR_CHILD: "1" });
  assert.equal(result.effective, true, result.reason);
  assert.doesNotMatch(result.reason, /conductor の子/);
});

test("有効: 同じプロセスで、子でない評価のあとに asConductorChild の中で評価しても同じ結果（キャッシュの鍵に子かを持たない）", async (t) => {
  const directory = workspace(t, { consentOnMain: true });
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/architect");
  const { loadConfig } = await import("../scripts/lib/config.mts");
  const { deferredConsent } = await import("../scripts/lib/deferred-consent.mts");
  const { asConductorChild } = await import("../scripts/lib/steps/consent.mts");
  const saved = process.cwd();
  process.chdir(directory);
  t.after(() => process.chdir(saved));
  const cycleDirectory = join(directory, CYCLE);
  const config = loadConfig({ cycleDir: cycleDirectory });
  assert.equal(deferredConsent(config, cycleDirectory).effective, true);
  assert.equal(asConductorChild(() => deferredConsent(config, cycleDirectory)).effective, true);
});

test("無効: 作業中のブランチで足した値は効かず、デフォルトブランチへマージすると有効になる", (t) => {
  const directory = workspace(t);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/architect");
  addConsent(directory);
  commit(directory, "consent を足す");
  const before = judged(directory);
  assert.equal(before.requested, true);
  assert.equal(before.effective, false);
  assert.match(before.reason, /G1 の承認の記録に値が無く.*マージされていない値は効きません/);
  // 対照: main へマージして push する
  git(directory, "checkout", "-q", "main");
  git(directory, "merge", "-q", "--ff-only", "hikyaku/001-test/architect");
  git(directory, "push", "-q", "origin", "main");
  git(directory, "checkout", "-q", "hikyaku/001-test/architect");
  assert.equal(judged(directory).effective, true);
});

test("無効: スタックした前フェーズのブランチに入っているだけでは有効にならない", (t) => {
  const directory = workspace(t);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/architect");
  addConsent(directory);
  commit(directory, "consent を足す");
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/build-01");
  const result = judged(directory);
  assert.equal(result.effective, false);
  assert.match(result.reason, /基準 (origin\/)?main .*マージされていない値は効きません/);
});

test("無効: base_branch を値のあるブランチへ向け直しても、デフォルトブランチの基準が残るので有効にならない", (t) => {
  const directory = workspace(t);
  git(directory, "checkout", "-q", "-b", "feature/x");
  addConsent(directory);
  commit(directory, "consent を足す");
  git(directory, "checkout", "-q", "-b", "work");
  appendFileSync(join(directory, CYCLE_CONFIG), "");
  const path = join(directory, CYCLE_CONFIG);
  writeFileSync(path, `base_branch = "feature/x"\n${readFileSync(path, "utf8")}`);
  commit(directory, "base_branch を向け直す");
  const result = judged(directory);
  assert.equal(result.effective, false);
  assert.match(result.reason, /基準 (origin\/)?main .*マージされていない値は効きません/);
});

test("無効: デフォルトブランチ（origin/HEAD）が分からなければ (b) は成り立たない", (t) => {
  const directory = workspace(t, { consentOnMain: true, noOriginHead: true });
  const path = join(directory, CYCLE_CONFIG);
  writeFileSync(path, `base_branch = "main"\n${readFileSync(path, "utf8")}`);
  commit(directory, "base_branch");
  git(directory, "push", "-q", "origin", "main");
  const result = judged(directory);
  assert.equal(result.effective, false);
  assert.match(result.reason, /origin\/HEAD/);
  // 対照
  git(directory, "remote", "set-head", "origin", "main");
  assert.equal(judged(directory).effective, true);
});

// ---------------------------------------------------------------------------
// G1 の記録

test("G1: args に deferredConsent を添え、承認の記録に設定の値を残すと有効になる", (t) => {
  const directory = workspace(t);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/plan");
  addConsent(directory);
  commitEarlier(directory, "consent を選ぶ");
  const g1 = plannerToG1(directory);
  assert.equal(g1.args?.["deferredConsent"], true);
  assert.equal(g1.approval, "consent");
  report(directory, "plan", "G1", "--result", "approved", "--input", "OK");
  const approved = events(directory, PLANNING).filter((event) => event["step"] === "G1").pop();
  assert.equal(approved?.["deferredConsent"], true);
  const result = judged(directory);
  assert.equal(result.effective, true, result.reason);
  assert.match(result.reason, /G1/);
});

test("G1: 提示のあとに未コミットで足した値は false で記録する", (t) => {
  const directory = workspace(t);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/plan");
  plannerToG1(directory);
  addConsent(directory);
  const result = succeeds(directory, "step", "report", "plan", "G1", "001", "--result", "approved", "--input", "OK");
  assert.match(result, /false で記録しました/);
  const approved = events(directory, PLANNING).filter((event) => event["step"] === "G1").pop();
  assert.equal(approved?.["deferredConsent"], false);
  commit(directory, "記録");
  assert.equal(judged(directory).effective, false);
});

test("G1: 選んでいなければ false を記録し、G1 の後に足しても有効にならない", (t) => {
  const directory = workspace(t);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/plan");
  plannerToG1(directory);
  report(directory, "plan", "G1", "--result", "approved", "--input", "OK");
  assert.equal(events(directory, PLANNING).filter((event) => event["step"] === "G1").pop()?.["deferredConsent"], false);
  addConsent(directory);
  commit(directory, "G1 の後に足す");
  assert.equal(judged(directory).effective, false);
});

test("G1: 設定を直してコミットしてから差し戻しを報告し、提示し直して承認すれば true を記録する", (t) => {
  const directory = workspace(t);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/plan");
  plannerToG1(directory);
  addConsent(directory);
  commitEarlier(directory, "consent を選ぶ");
  report(directory, "plan", "G1", "--result", "rejected", "--input", "事後同意を選ぶ");
  report(directory, "plan", "G1", "--result", "approved", "--input", "OK");
  assert.equal(events(directory, PLANNING).filter((event) => event["step"] === "G1").pop()?.["deferredConsent"], true);
  assert.equal(judged(directory).effective, true);
});

test("G1: 差し戻しのあとにコミットした値は、提示し直したあとの書き換えとして false で記録する", (t) => {
  const directory = workspace(t);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/plan");
  plannerToG1(directory);
  report(directory, "plan", "G1", "--result", "rejected", "--input", "文言を直す");
  addConsent(directory);
  commit(directory, "提示し直したあとに consent を足す");
  const result = succeeds(directory, "step", "report", "plan", "G1", "001", "--result", "approved", "--input", "OK");
  assert.match(result, /false で記録しました/);
  assert.equal(events(directory, PLANNING).filter((event) => event["step"] === "G1").pop()?.["deferredConsent"], false);
});

test("G1: 承認のあとに差し戻した・planner を回し直したら、前の承認の値は数えない", (t) => {
  const directory = workspace(t);
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/plan");
  addConsent(directory);
  commitEarlier(directory, "consent を選ぶ");
  plannerToG1(directory);
  report(directory, "plan", "G1", "--result", "approved", "--input", "OK");
  assert.equal(judged(directory).effective, true);
  // 報告し直して G1 を差し戻す
  report(directory, "plan", "review", "--result", "done");
  report(directory, "plan", "G1", "--result", "rejected", "--input", "直す");
  assert.equal(judged(directory).effective, false);
  report(directory, "plan", "G1", "--result", "approved", "--input", "OK");
  assert.equal(judged(directory).effective, true);
  succeeds(directory, "step", "restart", "plan", "001", "--reason", "回し直す");
  assert.equal(judged(directory).effective, false);
});

test("G1: 事後同意が有効でも G1 は同意のまま", (t) => {
  const directory = workspace(t, { consentOnMain: true });
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/plan");
  const g1 = plannerToG1(directory);
  assert.equal(g1.approval, "consent");
});

// ---------------------------------------------------------------------------
// G3・G4 の積み上げ

function deferredWorkspace(t: TestContext, setup: Setup = {}): string {
  const directory = workspace(t, { consentOnMain: true, app: app({ areas: [AUTH, BILLING] }), ...setup });
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/architect");
  return directory;
}

test("G3: 上限を超える受け入れは --loses を求め、risk の事項を積んで G3 を確認にする", (t) => {
  const directory = deferredWorkspace(t);
  driveTo(directory, ["options"]);
  const refused = cli(directory, "step", "report", "architect", "options", "001", "--result", "done", "--harm", "高", "--paths", "src/api/**");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--loses/);
  assert.equal(ledger(directory).length, 0);

  const dry = cli(directory, "step", "report", "architect", "options", "001", "--result", "done", "--harm", "高", "--paths", "src/api/**", "--loses", "既存 API を壊さない", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(ledger(directory).length, 0);

  const directive = report(directory, "architect", "options", "--result", "done", "--harm", "高", "--paths", "src/api/**", "--loses", "既存 API を壊さない");
  const [item] = ledger(directory);
  assert.equal(item?.["type"], "risk");
  assert.equal(item?.["who"], "user");
  assert.equal(item?.["when"], "merge@architect");
  assert.equal(item?.["step"], "options");
  assert.equal(item?.["ask"], "G3");
  assert.equal(item?.["source"], "step-report");
  assert.equal(item?.["loses"], "既存 API を壊さない");
  assert.deepEqual(item?.["premises"], ["app.exposure"]);
  assert.equal(directive.step, "G3");
  assert.equal(directive.approval, "confirm");
});

test("G3: express では deferred の回の G3 はプロファイルで外れる。step where と step next の現在地が一致する", (t) => {
  const directory = deferredWorkspace(t, { profile: "express" });
  driveTo(directory, ["options"]);
  const directive = report(directory, "architect", "options", "--result", "done", "--harm", "高", "--paths", "src/api/**", "--loses", "x");
  assert.equal(directive.step, "adr");
  const where = JSON.parse(succeeds(directory, "step", "where", "001", "--json")) as { units: { directive: Directive }[] };
  const unit = where.units.find((entry) => entry.directive.skill === "architect");
  assert.equal(unit?.directive.step, next(directory).step);
});

test("G3: 重い領域だけに当たれば、前提は area:<name> だけ", (t) => {
  const directory = deferredWorkspace(t, { app: app({ exposure: "personal", areas: [AUTH, BILLING] }) });
  driveTo(directory, ["options"]);
  report(directory, "architect", "options", "--result", "done", "--harm", "中", "--paths", "src/auth/**", "--loses", "x");
  assert.deepEqual(ledger(directory)[0]?.["premises"], ["area:auth"]);
});

test("G3: 手書きの事項しか無ければ（自動で積んだ事項が消えた）G3 は同意に戻る", (t) => {
  const directory = deferredWorkspace(t);
  driveTo(directory, ["options"]);
  report(directory, "architect", "options", "--result", "done", "--harm", "高", "--paths", "src/api/**", "--loses", "x");
  const path = join(directory, DESIGN, "decisions.jsonl");
  const record = JSON.parse(readFileSync(path, "utf8").trim()) as Record<string, unknown>;
  delete record["source"];
  writeFileSync(path, `${JSON.stringify(record)}\n`);
  const directive = next(directory);
  assert.equal(directive.step, "G3");
  assert.equal(directive.approval, "consent");
});

test("G3: ユーザーが積んだ事項を退けたら、G3 はその場の同意に戻る", (t) => {
  const directory = deferredWorkspace(t);
  driveTo(directory, ["options"]);
  report(directory, "architect", "options", "--result", "done", "--harm", "高", "--paths", "src/api/**", "--loses", "x");
  const id = ledger(directory)[0]?.["id"] as string;
  succeeds(directory, "ledger", "decide", "architect", id, "001", "--decision", "rejected", "--by", "user", "--input", "受け入れない");
  const directive = next(directory);
  assert.equal(directive.step, "G3");
  assert.equal(directive.approval, "consent");
});

test("G3: 事後同意が無効なら --loses を求めず、その場で同意", (t) => {
  const directory = workspace(t, { app: app({ areas: [AUTH] }) });
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/architect");
  driveTo(directory, ["options"]);
  const directive = report(directory, "architect", "options", "--result", "done", "--harm", "高", "--paths", "src/api/**");
  assert.equal(directive.step, "G3");
  assert.equal(directive.approval, "consent");
  assert.equal(ledger(directory).length, 0);
});

test("G3: 申告が欠けた回は事後同意に回さない", (t) => {
  const directory = deferredWorkspace(t);
  driveTo(directory, ["options"]);
  const directive = report(directory, "architect", "options", "--result", "done", "--harm", "高");
  assert.equal(directive.approval, "consent");
  assert.equal(ledger(directory).length, 0);
});

const CHILD = { HIKYAKU_CONDUCTOR_CHILD: "1" };

test("G3: 事後同意が有効なサイクルの architect の子でも、上限を超える受け入れを積んで確認にする（build-19）", (t) => {
  const directory = deferredWorkspace(t);
  driveTo(directory, ["options"]);
  const options = ["step", "report", "architect", "options", "001", "--result", "done", "--harm", "高", "--paths", "src/api/**"];
  const refused = cliWith(directory, CHILD, ...options);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--loses/);
  assert.equal(ledger(directory).length, 0);

  const result = cliWith(directory, CHILD, ...options, "--loses", "入力検証を先に作る利点", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parse(result.stdout).approval, "confirm");
  const [item] = ledger(directory);
  assert.equal(item?.["type"], "risk");
  assert.equal(item?.["who"], "user");
  assert.equal(item?.["when"], "merge@architect");
  assert.equal(item?.["source"], "step-report");
});

test("G3: 事後同意が無効なサイクルの architect の子は、従来どおりその場で同意", (t) => {
  const directory = workspace(t, { app: app({ areas: [AUTH] }) });
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/architect");
  driveTo(directory, ["options"]);
  const result = cliWith(directory, CHILD, "step", "report", "architect", "options", "001", "--result", "done", "--harm", "高", "--paths", "src/api/**", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parse(result.stdout).approval, "consent");
  assert.equal(ledger(directory).length, 0);
});

test("G4: 事後同意が有効なサイクルの architect の子で、申告に無い重い領域に触れる設計は積んで確認にする（build-19）", (t) => {
  const directory = deferredWorkspace(t, { app: app({ exposure: "personal", areas: [AUTH, BILLING] }) });
  driveTo(directory, ["options"]);
  report(directory, "architect", "options", "--result", "done", "--harm", "中", "--paths", "src/api/**");
  driveTo(directory, ["design-delta"]);
  write(directory, `${DESIGN}/design-delta.md`, "# 設計差分\n\n- `src/billing/invoice.ts` を変える\n");
  const result = cliWith(directory, CHILD, "step", "report", "architect", "design-delta", "001", "--result", "done", "--loses", "課金に触れない", "--json");
  assert.equal(result.status, 0, result.stderr);
  const [item] = ledger(directory);
  assert.equal(item?.["ask"], "G4");
  assert.deepEqual(item?.["premises"], ["area:billing"]);
  // G4 の位置で、子の評価が確認になる
  let directive = parse(succeeds(directory, "step", "next", "architect", "001", "--json"));
  for (let i = 0; i < 10 && directive.step !== "G4"; i += 1) {
    directive = directive.kind === "gate"
      ? report(directory, "architect", directive.step ?? "", "--result", "approved", "--input", "OK")
      : report(directory, "architect", directive.step ?? "", "--result", "done");
  }
  const child = cliWith(directory, CHILD, "step", "next", "architect", "001", "--json");
  assert.equal(parse(child.stdout).step, "G4");
  assert.equal(parse(child.stdout).approval, "confirm");
});

test("G3: supervisor-answer の risk は、G3 を deferred にする根拠に数えない", (t) => {
  const directory = deferredWorkspace(t);
  driveTo(directory, ["options"]);
  report(directory, "architect", "options", "--result", "done", "--harm", "高", "--paths", "src/api/**", "--loses", "x");
  const [stepped] = ledger(directory);
  succeeds(directory, "ledger", "decide", "architect", stepped?.["id"] as string, "001", "--decision", "rejected", "--by", "user", "--input", "受け入れない");
  // ask=G3 の supervisor-answer の事項を足しても、その場の同意のまま
  const path = join(directory, DESIGN, "decisions.jsonl");
  appendFileSync(path, `${JSON.stringify({
    record: "open", at: new Date().toISOString(), id: "architect.9-abcd", unit: "architect", step: "options", type: "risk",
    summary: "監督の答え（questions）で受け入れたリスク: x", when: "merge@architect", who: "user", premises: ["app.exposure", "app.data", "app.impact"],
    loses: "x", harm: "高", ask: "G3", source: "supervisor-answer", token: "t-1",
  })}\n`);
  const directive = parse(cliWith(directory, CHILD, "step", "next", "architect", "001", "--json").stdout);
  assert.equal(directive.step, "G3");
  assert.equal(directive.approval, "consent");
});

test("G4: 申告に無い重い領域に触れる設計は積んで確認にし、事項に無い領域に触れ直すと同意に戻る", (t) => {
  const directory = deferredWorkspace(t, { app: app({ exposure: "personal", areas: [AUTH, BILLING] }) });
  driveTo(directory, ["options"]);
  report(directory, "architect", "options", "--result", "done", "--harm", "中", "--paths", "src/api/**");
  assert.equal(ledger(directory).length, 0);
  driveTo(directory, ["design-delta"]);
  write(directory, `${DESIGN}/design-delta.md`, "# 設計差分\n\n- `src/billing/invoice.ts` を変える\n");
  const refused = cli(directory, "step", "report", "architect", "design-delta", "001", "--result", "done");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--loses/);
  report(directory, "architect", "design-delta", "--result", "done", "--loses", "課金に触れない");
  const [item] = ledger(directory);
  assert.equal(item?.["ask"], "G4");
  assert.equal(item?.["step"], "design-delta");
  assert.deepEqual(item?.["premises"], ["area:billing"]);
  const g4 = driveTo(directory, ["G4"]);
  assert.equal(g4.approval, "confirm");

  // レビューで設計の文書が変わり、auth にも触れた
  write(directory, `${DESIGN}/design-delta.md`, "# 設計差分\n\n- `src/billing/invoice.ts` を変える\n- `src/auth/session.ts` を変える\n");
  const after = next(directory);
  assert.equal(after.step, "G4");
  assert.equal(after.approval, "consent");
});

test("G4: 外との境界に触れる回は、事後同意が有効でも積まずにその場で同意", (t) => {
  const directory = deferredWorkspace(t, {
    app: `${app({ exposure: "personal", areas: [AUTH, BILLING] })}\n[boundaries]\nexternal = ["src/api/**"]\n`,
  });
  driveTo(directory, ["options"]);
  report(directory, "architect", "options", "--result", "done", "--harm", "中", "--paths", "docs/**");
  driveTo(directory, ["design-delta"]);
  write(directory, `${DESIGN}/design-delta.md`, "# 設計差分\n\n- `src/api/handler.ts` と `src/billing/invoice.ts` を変える\n");
  report(directory, "architect", "design-delta", "--result", "done");
  assert.equal(ledger(directory).filter((item) => item["ask"] === "G4").length, 0);
  const g4 = driveTo(directory, ["G4"]);
  assert.equal(g4.approval, "consent");
  assert.match(g4.approvalReason ?? "", /外との境界/);
});

test("step lint: gate に defers を持たせると検出する", () => {
  const problems = lintApproval({
    skill: "x",
    steps: [{ id: "G9", kind: "gate", title: "t", consent: false, defers: () => undefined }],
  });
  assert.ok(problems.some((problem) => /defers を持てません/.test(problem)), problems.join("\n"));
});

test("同意ゲート: 積んだ事項が consent-list に載る", (t) => {
  const directory = deferredWorkspace(t);
  driveTo(directory, ["options"]);
  report(directory, "architect", "options", "--result", "done", "--harm", "高", "--paths", "src/api/**", "--loses", "既存 API を壊さない");
  const id = ledger(directory)[0]?.["id"] as string;
  const list = succeeds(directory, "ledger", "consent-list", "architect", "001");
  assert.match(list, new RegExp(id.replace(/[.]/g, "\\.")));
});

test("--loses は defers の無いステップには添えられない", (t) => {
  const directory = deferredWorkspace(t);
  write(directory, `${DESIGN}/codebase-survey.md`);
  const result = cli(directory, "step", "report", "architect", "survey", "001", "--result", "done", "--loses", "x");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--loses を添えられません/);
});
