/**
 * 上限を超える異議と、事後同意の同意ゲートの範囲（build-18。US-13.3・ADR 20261116-deferred-consent）。
 *
 * 事後同意の有効の判定は基準（origin/HEAD）の merge-base のサイクル設定を読むので、一時リポジトリに origin を作る
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
// steps/index.mts を先に読み込む（循環 import の初期化順のため）
import "../scripts/lib/steps/index.mts";
import { consentDecided, isHighObjection, unacceptedObjections, type DecideRecord, type LedgerItem, type OpenRecord } from "../scripts/lib/ledger.mts";
import { exceedsCeilingFor, type EffectiveDeclaration } from "../scripts/lib/risk.mts";
import type { AppDeclaration } from "../scripts/lib/config.mts";
import { cli, cliWith, repository, succeeds, temporaryDirectory, testEnvironment, write } from "./helpers.mts";

delete process.env["HIKYAKU_CONDUCTOR_CHILD"];

const CYCLE = "docs/hikyaku/cycles/001-test";
const BUILD = `${CYCLE}/build-01`;
const DESIGN = `${CYCLE}/design`;
const CYCLE_CONFIG = `${CYCLE}/.hikyaku.config`;
const PR = "https://github.com/o/r/pull/12";

// ---------------------------------------------------------------------------
// 単体: 上限との比較

function declaration(axes: Partial<AppDeclaration["axes"]> = {}, areas: string[] = []): AppDeclaration {
  return {
    axes: { exposure: "personal", data: "none", impact: "low", ...axes } as AppDeclaration["axes"],
    mergeGate: "user",
    areas: areas.map((name) => ({ name, paths: [`src/${name}/**`] })),
  };
}

function effective(declared: AppDeclaration | undefined, incomplete = false): EffectiveDeclaration {
  return { declaration: declared, baselines: [], notices: [], incomplete };
}

test("exceedsCeilingFor: 宣言なしは超えない、基準を読めない回は超える", () => {
  assert.equal(exceedsCeilingFor(effective(undefined), "高", []), false);
  assert.equal(exceedsCeilingFor(effective(undefined, true), "中", []), true);
  assert.equal(exceedsCeilingFor(effective(declaration(), true), "中", []), true);
});

test("exceedsCeilingFor: 上限（高まで / 中まで / なし）と害の組み合わせ。害なしは中として比べる", () => {
  assert.equal(exceedsCeilingFor(effective(declaration()), "高", []), false, "高まで");
  assert.equal(exceedsCeilingFor(effective(declaration({ exposure: "internal" })), "中", []), false, "中まで・中");
  assert.equal(exceedsCeilingFor(effective(declaration({ exposure: "internal" })), "高", []), true, "中まで・高");
  assert.equal(exceedsCeilingFor(effective(declaration({ exposure: "public" })), "中", []), true, "なし・中");
  assert.equal(exceedsCeilingFor(effective(declaration({ exposure: "public" })), undefined, []), true, "なし・害なし");
  assert.equal(exceedsCeilingFor(effective(declaration({ exposure: "internal" })), undefined, []), false, "中まで・害なし");
});

test("exceedsCeilingFor: 宣言にある重い領域を前提に挙げれば害に関わらず超え、宣言に無い名前は効かない", () => {
  const declared = effective(declaration({}, ["auth"]));
  assert.equal(exceedsCeilingFor(declared, "中", ["area:auth"]), true);
  assert.equal(exceedsCeilingFor(declared, "中", ["area:billing"]), false);
  assert.equal(exceedsCeilingFor(declared, "中", ["app.data"]), false);
});

// ---------------------------------------------------------------------------
// 単体: 高として扱う異議

function open(id: string, overrides: Partial<OpenRecord> = {}): OpenRecord {
  return {
    record: "open", at: "2026-11-16T00:00:00.000Z", id, unit: "build-01", step: "G8", type: "objection", summary: "s",
    when: "now", who: "user", harm: "中", ...overrides,
  };
}

function decide(id: string, overrides: Partial<DecideRecord> = {}): DecideRecord {
  return { record: "decide", at: "2026-11-16T01:00:00.000Z", id, unit: "build-01", decision: "consented", by: "user", input: "進める", ...overrides };
}

function item(o: OpenRecord, ds: DecideRecord[] = []): LedgerItem {
  return { open: o, decisions: ds, latest: ds[ds.length - 1] };
}

test("isHighObjection: 害が高か、上限を超える objection だけ", () => {
  assert.equal(isHighObjection(item(open("a", { harm: "高" }))), true);
  assert.equal(isHighObjection(item(open("a", { exceedsCeiling: true }))), true);
  assert.equal(isHighObjection(item(open("a"))), false);
  assert.equal(isHighObjection(item(open("a", { type: "risk", exceedsCeiling: true }))), false);
});

test("unacceptedObjections: 上限を超える中の異議は受け入れの言葉の無い consented で片づかない", () => {
  const o = open("a", { exceedsCeiling: true });
  const ids = (items: LedgerItem[]) => items.map((entry) => entry.open.id);
  assert.deepEqual(ids(unacceptedObjections({ items: [item(o, [decide("a")])], orphans: [] }, "build-01", "G8")), ["a"]);
  assert.deepEqual(ids(unacceptedObjections({ items: [item(o, [decide("a", { accepts: "受け入れる" })])], orphans: [] }, "build-01", "G8")), []);
  assert.deepEqual(ids(unacceptedObjections({ items: [item(open("b"), [decide("b")])], orphans: [] }, "build-01", "G8")), [], "中は数えない");
});

test("unacceptedObjections: who=user・merge@ の異議は同意ゲートで扱うので数えず、who が user でない merge@ は数える", () => {
  const ids = (items: LedgerItem[]) => items.map((entry) => entry.open.id);
  const deferred = item(open("a", { exceedsCeiling: true, when: "merge@build-01" }));
  const byAi = item(open("b", { harm: "高", when: "merge@build-01", who: "ai:build-01" }));
  // --defer の形でない merge@ の異議（ほかの単位の merge@・上限の判定が無い）は同意ゲートで決まる保証が無いので数える
  const otherUnit = item(open("c", { exceedsCeiling: true, when: "merge@build-05" }));
  const legacy = item(open("d", { harm: "高", when: "merge@build-01" }));
  assert.deepEqual(ids(unacceptedObjections({ items: [deferred, byAi, otherUnit, legacy], orphans: [] }, "build-01", "G8")), ["b", "c", "d"]);
});

test("consentDecided: 上限を超える異議は accepts 付きの consented・decided・resolved で決定、rejected は数えない", () => {
  const o = open("a", { exceedsCeiling: true, when: "merge@build-01" });
  assert.equal(consentDecided(item(o, [decide("a")])), false);
  assert.equal(consentDecided(item(o, [decide("a", { accepts: "受け入れる" })])), true);
  assert.equal(consentDecided(item(o, [decide("a", { decision: "decided" })])), true);
  assert.equal(consentDecided(item(o, [decide("a", { decision: "resolved" })])), true);
  assert.equal(consentDecided(item(o, [decide("a", { decision: "rejected", accepts: "x" })])), false);
});

// ---------------------------------------------------------------------------
// 結合

function git(directory: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

interface Setup {
  exposure?: string;
  /** main のサイクル設定に [consent] deferred = true を書く（事後同意が有効になる） */
  consent?: boolean;
  /** [consent] を作業ツリーにだけ書く（requested だが有効でない） */
  requestedOnly?: boolean;
  /** [app] を書かない */
  noApp?: boolean;
}

/** サイクル 001-test とビルド2つを持ち、main を origin へ push したワークスペース。build-01 のブランチで作業する */
function workspace(t: TestContext, setup: Setup = {}): string {
  const directory = repository(t);
  succeeds(directory, "init", "--root", "docs/hikyaku");
  succeeds(directory, "cycle", "new", "test", "--profile", "standard");
  const config = join(directory, ".hikyaku.config");
  const app = setup.noApp === true
    ? ""
    : `\n[app]\nexposure = "${setup.exposure ?? "internal"}"\ndata = "none"\nimpact = "low"\nmerge_gate = "user"\n\n[[app.areas]]\nname = "auth"\npaths = ["src/auth/**"]\n`;
  writeFileSync(config, `retrospective = "skip"\n${readFileSync(config, "utf8")}${app}`);
  if (setup.consent === true) write(directory, CYCLE_CONFIG, "[consent]\ndeferred = true\n");
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
  succeeds(directory, "tasklist", "add", "001", "--title", "画面", "--peak", "350k");
  write(directory, `${BUILD}/issue.md`);
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "main");
  const remote = temporaryDirectory(t);
  git(remote, "init", "--quiet", "--bare");
  git(directory, "remote", "add", "origin", remote);
  git(directory, "push", "-q", "origin", "main");
  git(directory, "remote", "set-head", "origin", "main");
  git(directory, "checkout", "-q", "-b", "hikyaku/001-test/build-01");
  if (setup.requestedOnly === true) write(directory, CYCLE_CONFIG, "[consent]\ndeferred = true\n");
  return directory;
}

interface Directive {
  kind: string;
  skill?: string;
  step?: string;
  approval?: string;
  objection?: { guide: string[]; command: string };
}

function next(directory: string, phase = "build-01"): Directive {
  return (JSON.parse(succeeds(directory, "step", "next", phase, "001", "--json")) as { directive: Directive }).directive;
}

function report(directory: string, step: string, ...extra: string[]): Directive {
  const result = cli(directory, "step", "report", "build-01", step, "001", ...extra, "--json");
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { directive: Directive }).directive;
}

function upToG8(directory: string): void {
  write(directory, `${BUILD}/plan.md`, "# plan\n");
  report(directory, "plan", "--result", "done", "--peak", "350k");
  report(directory, "plan-review", "--result", "done");
  write(directory, `${BUILD}/test-spec.md`, "# test-spec\n");
  report(directory, "test-spec", "--result", "done");
  report(directory, "test-spec-review", "--result", "done");
}

/** handoff を done にする手前まで進める */
function upToHandoff(directory: string): void {
  upToG8(directory);
  report(directory, "G8", "--result", "approved", "--input", "OK");
  report(directory, "implement", "--result", "done");
  report(directory, "verify", "--result", "done");
  write(directory, `${BUILD}/agreement.md`);
  report(directory, "agreement-review", "--result", "done");
  report(directory, "review", "--result", "done");
  write(directory, `${BUILD}/handoff.md`);
}

function records(directory: string, unit = BUILD): Record<string, unknown>[] {
  const path = join(directory, unit, "decisions.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

const OBJECT = ["ledger", "object", "build-01", "001", "--summary", "公開 API の入力検証を後に回す", "--basis", '[app] exposure = "public"', "--loses", "不正な入力を最初から弾けない"];

function where(directory: string, skill = "builder"): string | undefined {
  const output = JSON.parse(succeeds(directory, "step", "where", "001", "--json")) as { units: { directive: Directive }[] };
  return output.units.find((unit) => unit.directive.skill === skill)?.directive.step;
}

test("ledger object: 上限を超える中の異議は、事後同意が無効でも --accepts・--premises が無ければ拒み、そろえば exceedsCeiling を残す", (t) => {
  const directory = workspace(t, { exposure: "public" });
  upToG8(directory);
  const noAccepts = cli(directory, ...OBJECT, "--harm", "中", "--decision", "consented", "--input", "進める", "--premises", "app.exposure");
  assert.equal(noAccepts.status, 1);
  assert.match(noAccepts.stderr, /上限を超える.*--accepts/);
  const noPremises = cli(directory, ...OBJECT, "--harm", "中", "--decision", "consented", "--input", "進める", "--accepts", "受け入れる");
  assert.equal(noPremises.status, 1);
  assert.match(noPremises.stderr, /--premises/);
  succeeds(directory, ...OBJECT, "--harm", "中", "--decision", "consented", "--input", "進める", "--accepts", "検証が遅れることを受け入れる", "--premises", "app.exposure");
  const [opened] = records(directory);
  assert.equal(opened?.["exceedsCeiling"], true);
  assert.equal(opened?.["when"], "now");
  assert.equal(report(directory, "G8", "--result", "approved", "--input", "OK").step, "implement");
});

test("ledger object: 上限を超えなければ従来どおり、中は --accepts なしで記録でき exceedsCeiling は付かない", (t) => {
  const directory = workspace(t, { exposure: "internal" });
  upToG8(directory);
  succeeds(directory, ...OBJECT, "--harm", "中", "--decision", "consented", "--input", "進める");
  assert.equal(records(directory)[0]?.["exceedsCeiling"], undefined);
});

test("ledger object: 重い領域を前提に挙げた中の異議は上限を超える", (t) => {
  const directory = workspace(t, { exposure: "personal" });
  upToG8(directory);
  const refused = cli(directory, ...OBJECT, "--harm", "中", "--decision", "consented", "--input", "進める", "--premises", "area:auth");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--accepts/);
});

test("ledger object: 基準の宣言を読めない回は上限を超えるとみなす", (t) => {
  const directory = workspace(t, { exposure: "personal" });
  // 基準（origin/main と main）の設定ファイルを壊す: 作業ツリーの宣言より厳しいかが分からない
  git(directory, "checkout", "-q", "main");
  writeFileSync(join(directory, ".hikyaku.config"), "{broken\n");
  git(directory, "commit", "-q", "-am", "壊す");
  git(directory, "push", "-q", "origin", "main");
  git(directory, "checkout", "-q", "hikyaku/001-test/build-01");
  git(directory, "merge", "-q", "-s", "ours", "main", "-m", "取り込む");
  upToG8(directory);
  const refused = cli(directory, ...OBJECT, "--harm", "中", "--decision", "consented", "--input", "進める");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /上限を超える.*--accepts/);
});

test("ledger open + decide: 上限を超える異議は受け入れの言葉なしの consented ではゲートを通らない", (t) => {
  const directory = workspace(t, { exposure: "public" });
  upToG8(directory);
  const noPremises = cli(directory, "ledger", "open", "build-01", "001", "--type", "objection", "--when", "now", "--who", "user", "--harm", "中", "--summary", "s");
  assert.equal(noPremises.status, 1);
  assert.match(noPremises.stderr, /上限を超える異議には --premises/);
  const opened = JSON.parse(succeeds(
    directory, "ledger", "open", "build-01", "001", "--type", "objection", "--when", "now", "--who", "user", "--harm", "中",
    "--premises", "app.exposure", "--summary", "s", "--json",
  )) as { record: OpenRecord };
  assert.equal(opened.record.exceedsCeiling, true);
  succeeds(directory, "ledger", "decide", "build-01", opened.record.id, "001", "--decision", "consented", "--by", "user", "--input", "進める");
  assert.equal(cli(directory, "step", "report", "build-01", "G8", "001", "--result", "approved", "--input", "OK").status, 1);
  succeeds(directory, "ledger", "decide", "build-01", opened.record.id, "001", "--decision", "consented", "--by", "user", "--input", "進める", "--accepts", "公開で漏れうることを受け入れる");
  assert.equal(report(directory, "G8", "--result", "approved", "--input", "OK").step, "implement");
});

test("ledger open: 異議の --when merge は拒み、ledger object --defer を案内する", (t) => {
  const directory = workspace(t, { exposure: "public", consent: true });
  const refused = cli(directory, "ledger", "open", "build-01", "001", "--type", "objection", "--when", "merge", "--who", "user", "--harm", "中", "--premises", "app.exposure", "--summary", "s");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /ledger object --defer/);
  assert.deepEqual(records(directory), []);
});

test("ledger object --defer: 事後同意が無効なら拒む（requested でも有効でなければ拒む）", (t) => {
  for (const setup of [{ exposure: "public" }, { exposure: "public", requestedOnly: true }]) {
    const directory = workspace(t, setup);
    upToG8(directory);
    const refused = cli(directory, ...OBJECT, "--harm", "中", "--defer", "--premises", "app.exposure");
    assert.equal(refused.status, 1, JSON.stringify(setup));
    assert.match(refused.stderr, /事後同意が有効でない/);
    assert.deepEqual(records(directory), []);
  }
});

test("ledger object --defer: 前提が無い・宣言以外を含む・上限を超えない・決定の欄を渡したら拒む", (t) => {
  const directory = workspace(t, { exposure: "public", consent: true });
  upToG8(directory);
  const refuse = (pattern: RegExp, ...extra: string[]) => {
    const result = cli(directory, ...OBJECT, "--harm", "中", "--defer", ...extra);
    assert.equal(result.status, 1, extra.join(" "));
    assert.match(result.stderr, pattern);
  };
  refuse(/app\.\* か area:\*/);
  refuse(/app\.\* か area:\*/, "--premises", "app.exposure,assumption:社内だけ");
  refuse(/重い領域が宣言にありません: typo/, "--premises", "area:typo");
  refuse(/一緒に渡せません/, "--premises", "app.exposure", "--decision", "consented");
  refuse(/一緒に渡せません/, "--premises", "app.exposure", "--input", "進める");
  refuse(/一緒に渡せません/, "--premises", "app.exposure", "--accepts", "受け入れる");
  assert.deepEqual(records(directory), []);

  const within = workspace(t, { exposure: "personal", consent: true });
  upToG8(within);
  const result = cli(within, ...OBJECT, "--harm", "中", "--defer", "--premises", "app.exposure");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /上限を超えない/);
});

test("ledger object --defer: 同意ゲートの置き場が無い作業単位（plan）は拒む", (t) => {
  const directory = workspace(t, { exposure: "public", consent: true });
  const result = cli(directory, "ledger", "object", "plan", "001", "--summary", "s", "--basis", "b", "--loses", "l", "--harm", "中", "--defer", "--premises", "app.exposure");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /同意ゲートがありません/);
});

test("ledger object --defer: 積んだ異議は同意ゲートに載り、決定なしではゲートも pr も完了しない。pr の後は拒む", (t) => {
  const directory = workspace(t, { exposure: "public", consent: true });
  upToG8(directory);
  const dry = cli(directory, ...OBJECT, "--harm", "中", "--defer", "--premises", "app.exposure", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(records(directory), []);
  const recorded = JSON.parse(succeeds(directory, ...OBJECT, "--harm", "中", "--defer", "--premises", "app.exposure", "--json")) as { record: OpenRecord; decision: unknown };
  assert.equal(recorded.record.when, "merge@build-01");
  assert.equal(recorded.record.who, "user");
  assert.equal(recorded.record.exceedsCeiling, true);
  assert.equal(recorded.decision, null);
  // 同意ゲートで扱うので、G8 の承認は止めない
  report(directory, "G8", "--result", "approved", "--input", "OK");
  report(directory, "implement", "--result", "done");
  report(directory, "verify", "--result", "done");
  write(directory, `${BUILD}/agreement.md`);
  report(directory, "agreement-review", "--result", "done");
  report(directory, "review", "--result", "done");
  write(directory, `${BUILD}/handoff.md`);
  assert.equal(report(directory, "handoff", "--result", "done").step, "consent");
  assert.match(succeeds(directory, "ledger", "consent-list", "build-01", "001"), /受け入れの言葉（--accepts）が要る（上限を超える異議）/);
  assert.equal(cli(directory, "step", "report", "build-01", "consent", "001", "--result", "approved", "--input", "OK").status, 1);
  succeeds(directory, "ledger", "decide", "build-01", recorded.record.id, "001", "--decision", "consented", "--by", "user", "--input", "同意する");
  assert.equal(cli(directory, "step", "report", "build-01", "consent", "001", "--result", "approved", "--input", "OK").status, 1, "受け入れの言葉が無い");
  succeeds(directory, "ledger", "decide", "build-01", recorded.record.id, "001", "--decision", "consented", "--by", "user", "--input", "同意する", "--accepts", "検証が遅れることを受け入れる");
  assert.equal(report(directory, "consent", "--result", "approved", "--input", "OK").step, "pr");
  succeeds(directory, "tasklist", "done", "001", "--id", "1", "--pr", PR);
  report(directory, "pr", "--result", "done", "--pr", PR);
  const after = cli(directory, ...OBJECT, "--harm", "中", "--defer", "--premises", "app.exposure");
  assert.equal(after.status, 1);
  assert.match(after.stderr, /今の回には同意ゲートが現れません/);
});

/** design/ に、ほかの作業単位（architect）で記録した when=merge@build-01 の事項を置く */
function otherUnitItem(directory: string): void {
  mkdirSync(join(directory, DESIGN), { recursive: true });
  writeFileSync(join(directory, DESIGN, "decisions.jsonl"), `${JSON.stringify({
    record: "open", at: new Date().toISOString(), id: "architect.1-aaaa", unit: "architect", type: "risk", summary: "s",
    when: "merge@build-01", who: "user", premises: ["app.exposure"], loses: "l",
  })}\n`);
}

test("同意ゲート: 事後同意を選んだサイクルでは、ほかの作業単位の事項だけでも step next と step where がゲートを示す", (t) => {
  const directory = workspace(t, { exposure: "public", consent: true });
  upToHandoff(directory);
  otherUnitItem(directory);
  assert.equal(report(directory, "handoff", "--result", "done").step, "consent");
  assert.equal(next(directory).step, "consent");
  assert.equal(where(directory), "consent");
});

test("同意ゲート: 事後同意を選んでいないサイクルは、ほかの作業単位の事項だけではゲートを出さず pr の accepts が止める", (t) => {
  const directory = workspace(t, { exposure: "public" });
  upToHandoff(directory);
  otherUnitItem(directory);
  assert.equal(report(directory, "handoff", "--result", "done").step, "pr");
  assert.equal(where(directory), "pr");
  const refused = cli(directory, "step", "report", "build-01", "pr", "001", "--result", "done", "--pr", PR);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /ledger consent-list build-01/);
  assert.match(refused.stderr, /--accepts/);
});

test("同意ゲート: 事後同意を選んだサイクルで記録が壊れていれば手順に入れる。位置だけの経路は記録を読まずに入れる", (t) => {
  const directory = workspace(t, { exposure: "public", consent: true });
  upToHandoff(directory);
  report(directory, "handoff", "--result", "done");
  // 対象が無い: step next は pr、位置だけの経路は安全側で consent
  assert.equal(next(directory).step, "pr");
  assert.equal(where(directory), "consent");
  mkdirSync(join(directory, DESIGN), { recursive: true });
  writeFileSync(join(directory, DESIGN, "decisions.jsonl"), "{broken\n");
  assert.equal(next(directory).step, "consent");
});

test("ledger object: 事後同意を選んだサイクルで対象が無いとき、記録する step は位置だけの評価の consent ではなく step next の現在地", (t) => {
  const directory = workspace(t, { exposure: "internal", consent: true });
  upToHandoff(directory);
  report(directory, "handoff", "--result", "done");
  assert.equal(where(directory), "consent");
  succeeds(directory, ...OBJECT, "--harm", "中", "--decision", "consented", "--input", "進める");
  assert.equal(records(directory)[0]?.["step"], "pr");
});

test("同意ゲート: ほかの単位の事項だけのときの承認の拒否は consent.md の案内になる", (t) => {
  const directory = workspace(t, { exposure: "public", consent: true });
  upToHandoff(directory);
  otherUnitItem(directory);
  report(directory, "handoff", "--result", "done");
  const refused = cli(directory, "step", "report", "build-01", "consent", "001", "--result", "approved", "--input", "OK");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /skills\/builder\/steps\/consent\.md/);
});

test("conductor parse 相当: conductor の子では、事後同意を選んだサイクルでも同意ゲートを手順に入れない", (t) => {
  const directory = workspace(t, { exposure: "public", consent: true });
  upToHandoff(directory);
  otherUnitItem(directory);
  report(directory, "handoff", "--result", "done");
  const child = cliWith(directory, { HIKYAKU_CONDUCTOR_CHILD: "1" }, "step", "next", "build-01", "001", "--json");
  assert.equal((JSON.parse(child.stdout) as { directive: Directive }).directive.step, "pr");
  const whereChild = cliWith(directory, { HIKYAKU_CONDUCTOR_CHILD: "1" }, "step", "where", "001", "--json");
  const unit = (JSON.parse(whereChild.stdout) as { units: { directive: Directive }[] }).units.find((entry) => entry.directive.skill === "builder");
  assert.equal(unit?.directive.step, "pr");
});

test("directive: gate の異議の指示に、上限を超える異議と --defer の扱いが載る", (t) => {
  const directory = workspace(t, { exposure: "public" });
  upToG8(directory);
  const directive = next(directory);
  assert.equal(directive.step, "G8");
  assert.ok(directive.objection?.guide.some((line) => /上限/.test(line) && /--accepts/.test(line)));
  assert.ok(directive.objection?.guide.some((line) => /--defer/.test(line)));
  assert.match(directive.objection?.command ?? "", /--defer/);
});

test("help: ledger object の usage と details に --defer と上限を超える異議の扱いが載る", (t) => {
  const directory = workspace(t);
  const help = succeeds(directory, "help", "ledger", "object");
  assert.match(help, /--defer/);
  assert.match(help, /超える異議は高と同じに扱い/);
});
