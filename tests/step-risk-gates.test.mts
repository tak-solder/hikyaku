/**
 * G3・G4 を宣言の上限で同意にする（build-15。ADR risk-ceiling-table・approval-kind-in-step-definitions）。
 *
 * options の done の申告（--harm / --paths）を上限と比べて G3 を、設計の文書が触れるパスと申告を照合して G4 を、
 * 同意にするかを確かめる。基準の宣言は origin/HEAD との merge-base から読むので、一時リポジトリに origin を作る
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
// steps/index.mts から読む（architect.mts を先に読み込むと、risk.mts 経由の循環で初期化前に参照される）
import { lintApproval } from "../scripts/lib/steps/engine.mts";
import { stepsOf } from "../scripts/lib/steps/index.mts";
import { cli, repository, succeeds, temporaryDirectory, testEnvironment, write } from "./helpers.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";
const DESIGN = `${CYCLE}/design`;

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

function withOrigin(t: TestContext, directory: string): void {
  const remote = temporaryDirectory(t);
  git(remote, "init", "--quiet", "--bare");
  git(directory, "remote", "add", "origin", remote);
  git(directory, "push", "-q", "origin", "main");
  git(directory, "remote", "set-head", "origin", "main");
}

interface Axes {
  exposure: string;
  data: string;
  impact: string;
}
/** 上限: 高まで / 中まで / 何も任せない */
const HIGH: Axes = { exposure: "personal", data: "none", impact: "low" };
const MEDIUM: Axes = { exposure: "internal", data: "none", impact: "low" };
const NONE: Axes = { exposure: "public", data: "none", impact: "low" };

interface Area {
  name: string;
  paths: string[];
}

function declaration(axes: Axes, areas: Area[] = []): string {
  const lines = ["", "[app]", `exposure = "${axes.exposure}"`, `data = "${axes.data}"`, `impact = "${axes.impact}"`];
  for (const area of areas) {
    lines.push("", "[[app.areas]]", `name = "${area.name}"`, `paths = [${area.paths.map((path) => `"${path}"`).join(", ")}]`);
  }
  return `${lines.join("\n")}\n`;
}

const GUIDE = [
  "# ドキュメントガイド",
  "",
  "| 論理名 | 管理 | パス | 概要 |",
  "| --- | --- | --- | --- |",
  "| decisions | hikyaku | `docs/adr/` | 設計判断 |",
  "",
].join("\n");

interface Setup {
  profile?: string;
  /** main にコミットして origin へ push する宣言（undefined なら宣言なし） */
  committed?: string;
  /** コミットしたあと作業ツリーだけで書き換える宣言（committed を置き換える） */
  working?: string;
  /** origin を作らない */
  noOrigin?: boolean;
  /** document-guide.md に decisions を登録する */
  guide?: boolean;
}

/** サイクル 001-test を持つワークスペース。宣言を main にコミットし、origin/HEAD → origin/main にする */
function workspace(t: TestContext, setup: Setup): string {
  const directory = repository(t);
  succeeds(directory, "init", "--root", "docs/hikyaku");
  succeeds(directory, "cycle", "new", "test", "--profile", setup.profile ?? "express");
  const config = join(directory, ".hikyaku.config");
  const original = readFileSync(config, "utf8");
  writeFileSync(config, `retrospective = "skip"\n${original}${setup.committed ?? ""}`);
  if (setup.guide === true) write(directory, "docs/hikyaku/document-guide.md", GUIDE);
  write(directory, "src/api/handler.ts", "export {};\n");
  write(directory, "src/auth/session.ts", "export {};\n");
  write(directory, "src/billing/invoice.ts", "export {};\n");
  commit(directory, "main");
  if (setup.noOrigin !== true) withOrigin(t, directory);
  if (setup.working !== undefined) writeFileSync(config, `retrospective = "skip"\n${original}${setup.working}`);
  return directory;
}

interface Directive {
  kind: string;
  step?: string;
  approval?: string;
  approvalReason?: string | null;
  args?: Record<string, unknown>;
  notices?: string[];
  report?: Record<string, string>;
}

function parse(stdout: string): Directive {
  return (JSON.parse(stdout) as { directive: Directive }).directive;
}

function next(directory: string): Directive {
  return parse(succeeds(directory, "step", "next", "architect", "001", "--json"));
}

function report(directory: string, step: string, ...extra: string[]): Directive {
  return parse(succeeds(directory, "step", "report", "architect", step, "001", ...extra, "--json"));
}

interface Drive {
  /** options の報告に添える引数（skip なら skipped で報告する） */
  options?: string[] | "skip";
  /** design-delta.md の本文 */
  delta?: string;
  /** design-delta の報告の前に置くファイル（ADR など） */
  files?: Record<string, string>;
}

/** stop に挙げたステップの directive が返るまで、run を done で、ゲートを承認で進める */
function driveTo(directory: string, stop: string[], drive: Drive = {}): Directive {
  let directive = next(directory);
  for (let i = 0; i < 20; i += 1) {
    const step = directive.step ?? "";
    if (stop.includes(step) || directive.kind === "done" || directive.kind === "stop") return directive;
    if (directive.kind === "gate") {
      directive = report(directory, step, "--result", "approved", "--input", "OK");
      continue;
    }
    if (step === "survey") write(directory, `${DESIGN}/codebase-survey.md`);
    if (step === "options") {
      directive = drive.options === "skip"
        ? report(directory, step, "--result", "skipped", "--reason", "分岐なし")
        : report(directory, step, "--result", "done", ...(drive.options ?? []));
      continue;
    }
    if (step === "design-delta") {
      for (const [path, content] of Object.entries(drive.files ?? {})) write(directory, path, content);
      write(directory, `${DESIGN}/design-delta.md`, drive.delta ?? "# 設計差分\n");
    }
    directive = report(directory, step, "--result", "done");
  }
  throw new Error(`${stop.join("/")} に着きません（現在: ${directive.step}）`);
}

/** G3 の位置（G3 が外れていれば adr）まで進める */
function toG3(directory: string, options: string[]): Directive {
  return driveTo(directory, ["G3", "adr"], { options });
}

function statuses(directory: string): string[] {
  return (JSON.parse(succeeds(directory, "step", "status", "architect", "001", "--json")).steps as { id: string; status: string }[])
    .map((entry) => `${entry.id}:${entry.status}`);
}

const AUTH: Area = { name: "auth", paths: ["src/auth/**"] };
const BILLING: Area = { name: "billing", paths: ["src/billing/**"] };

// ---------------------------------------------------------------------------
// step report の申告

test("step report: options の done に --harm と --paths（波括弧の外で区切る）を記録する", (t) => {
  const directory = workspace(t, { committed: declaration(HIGH) });
  driveTo(directory, ["options"]);
  report(directory, "options", "--result", "done", "--harm", "中", "--paths", "src/{api,auth}/**,docs/x.md");
  const events = readFileSync(join(directory, DESIGN, "progress.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const options = events.find((event) => event.step === "options");
  assert.equal(options.harm, "中");
  assert.deepEqual(options.paths, ["src/{api,auth}/**", "docs/x.md"]);
});

test("step report: 申告が欠けていても options の done は受け付ける", (t) => {
  const directory = workspace(t, {});
  driveTo(directory, ["options"]);
  const directive = report(directory, "options", "--result", "done");
  assert.notEqual(directive.step, "options");
});

test("step report: --harm に高・中以外、--paths に空の要素はエラー", (t) => {
  const directory = workspace(t, {});
  driveTo(directory, ["options"]);
  const harm = cli(directory, "step", "report", "architect", "options", "001", "--result", "done", "--harm", "低");
  assert.equal(harm.status, 1);
  assert.match(harm.stderr, /--harm は 高 か 中/);
  for (const paths of ["src/a/**,,src/b/**", "src/a/**,", ","]) {
    const result = cli(directory, "step", "report", "architect", "options", "001", "--result", "done", "--paths", paths);
    assert.equal(result.status, 1, paths);
    assert.match(result.stderr, /--paths は/);
  }
});

test("step report: options 以外のステップや、options の skipped には申告を添えられない", (t) => {
  const directory = workspace(t, {});
  write(directory, `${DESIGN}/codebase-survey.md`);
  const survey = cli(directory, "step", "report", "architect", "survey", "001", "--result", "done", "--harm", "中");
  assert.equal(survey.status, 1);
  assert.match(survey.stderr, /survey には --harm \/ --paths を添えられません/);
  driveTo(directory, ["options"]);
  const skipped = cli(directory, "step", "report", "architect", "options", "001", "--result", "skipped", "--reason", "x", "--harm", "中");
  assert.equal(skipped.status, 1);
  assert.match(skipped.stderr, /done の報告にだけ/);
});

test("directive: options の done の報告コマンドに申告の欄が載る", (t) => {
  const directory = workspace(t, {});
  const options = driveTo(directory, ["options"]);
  assert.match(options.report?.["done"] ?? "", /--harm 高\|中 --paths <触れるパスの glob,\.\.\.>/);
  assert.doesNotMatch(options.report?.["skipped"] ?? "", /--harm/);
});

test("step lint: gate に declaresRisk を付けた定義は弾く", () => {
  const problems = lintApproval({ skill: "x", steps: [{ id: "G9", kind: "gate", title: "t", consent: false, declaresRisk: true }] });
  assert.ok(problems.some((problem) => problem.includes("declaresRisk")), problems.join("\n"));
  const architect = stepsOf("architect");
  assert.ok(architect !== undefined);
  assert.deepEqual(lintApproval(architect), []);
});

// ---------------------------------------------------------------------------
// G3

test("G3: 申告が上限以内で重い領域に当たらなければ、express では省ける", (t) => {
  const directory = workspace(t, { committed: declaration(MEDIUM, [AUTH]) });
  const directive = toG3(directory, ["--harm", "中", "--paths", "src/api/**"]);
  assert.equal(directive.step, "adr");
  assert.equal(directive.args?.["designChoiceGate"], false);
  assert.ok(statuses(directory).includes("G3:off"));
});

test("G3: 害の申告が上限を超えれば、express でも同意として返る", (t) => {
  const directory = workspace(t, { committed: declaration(MEDIUM) });
  const directive = toG3(directory, ["--harm", "高", "--paths", "src/api/**"]);
  assert.deepEqual([directive.step, directive.approval], ["G3", "consent"]);
  assert.match(directive.approvalReason ?? "", /害の申告（高）が上限（中まで）を超える/);
});

test("G3: 上限が「何も任せない」なら害が中でも同意", (t) => {
  const directory = workspace(t, { committed: declaration(NONE) });
  assert.equal(toG3(directory, ["--harm", "中", "--paths", "src/api/**"]).approval, "consent");
});

test("G3: 3軸すべてが最下段なら害が高でも省ける", (t) => {
  const directory = workspace(t, { committed: declaration(HIGH) });
  assert.equal(toG3(directory, ["--harm", "高", "--paths", "src/api/**"]).step, "adr");
});

test("G3: 申告したパスが重い領域に当たれば、害が中でも同意", (t) => {
  const directory = workspace(t, { committed: declaration(HIGH, [AUTH]) });
  const directive = toG3(directory, ["--harm", "中", "--paths", "src/auth/session.ts"]);
  assert.equal(directive.approval, "consent");
  assert.match(directive.approvalReason ?? "", /重い領域（auth）/);
});

test("G3: --harm か --paths のどちらかが欠ければ同意", (t) => {
  for (const options of [["--harm", "中"], ["--paths", "src/api/**"], []]) {
    const directory = workspace(t, { committed: declaration(HIGH) });
    const directive = toG3(directory, options);
    assert.equal(directive.approval, "consent", options.join(" "));
    assert.match(directive.approvalReason ?? "", /申告（.*）が欠けている/);
  }
});

test("G3: 宣言が無いワークスペースでは従来どおりプロファイルで決まり、notices を出さない", (t) => {
  const express = workspace(t, { noOrigin: true });
  assert.equal(toG3(express, ["--harm", "高", "--paths", "src/auth/**"]).step, "adr");
  const standard = workspace(t, { profile: "standard", noOrigin: true });
  const g3 = toG3(standard, []);
  assert.deepEqual([g3.step, g3.approval], ["G3", "confirm"]);
  assert.deepEqual(g3.notices, []);
});

test("G3: 基準の宣言を読めない（incomplete）なら、申告が上限以内でも同意で、notices に出る", (t) => {
  const directory = workspace(t, {
    committed: `\n[app]\nexposure = "everyone"\ndata = "none"\nimpact = "low"\n`,
    working: declaration(HIGH),
  });
  const directive = toG3(directory, ["--harm", "中", "--paths", "src/api/**"]);
  assert.deepEqual([directive.step, directive.approval], ["G3", "consent"]);
  assert.match(directive.approvalReason ?? "", /基準の宣言を読めず/);
  assert.ok(directive.notices?.some((notice) => notice.includes("基準 main の宣言を読めません")), JSON.stringify(directive.notices));
  // 手順の位置だけを読む経路には出さない
  const where = succeeds(directory, "step", "where", "001");
  assert.doesNotMatch(where, /宣言を読めません/);
});

test("G3: origin が無く作業ツリーにだけ宣言があると、上限が分からないので同意", (t) => {
  const directory = workspace(t, { committed: declaration(HIGH), noOrigin: true });
  assert.equal(toG3(directory, ["--harm", "中", "--paths", "src/api/**"]).approval, "consent");
});

test("G3: 作業ツリーで宣言を緩めても、基準の厳しい宣言で判定する", (t) => {
  const directory = workspace(t, { committed: declaration(MEDIUM), working: declaration(HIGH) });
  assert.equal(toG3(directory, ["--harm", "高", "--paths", "src/api/**"]).approval, "consent");
});

// ---------------------------------------------------------------------------
// designChoiceGate

test("designChoiceGate: options の done の前は宣言による同意を含めず、done のあとは申告で決まる", (t) => {
  const directory = workspace(t, { committed: declaration(NONE) });
  const options = driveTo(directory, ["options"]);
  assert.equal(options.args?.["designChoiceGate"], false, "申告前なので宣言だけで同意にしない");
  const g3 = report(directory, "options", "--result", "done", "--harm", "高", "--paths", "src/api/**");
  assert.equal(g3.step, "G3");
  const adr = report(directory, "G3", "--result", "approved", "--input", "Minimal 案で");
  assert.deepEqual([adr.step, adr.args?.["designChoiceGate"]], ["adr", true]);
});

// ---------------------------------------------------------------------------
// G4（申告の裏取り）

test("G4: design-delta.md が G3 の申告に無い重い領域に触れれば、express でも同意", (t) => {
  const directory = workspace(t, { committed: declaration(HIGH, [AUTH, BILLING]) });
  const g4 = driveTo(directory, ["G4", "build-split"], {
    options: ["--harm", "中", "--paths", "src/api/**"],
    delta: "# 設計差分\n\n- `src/api/handler.ts` と `src/billing/invoice.ts` を変える\n",
  });
  assert.deepEqual([g4.step, g4.approval], ["G4", "consent"]);
  assert.match(g4.approvalReason ?? "", /G3 の申告に無い重い領域（billing）/);
  assert.deepEqual(g4.args?.["undeclaredAreas"], [{ name: "billing", touched: ["src/billing/invoice.ts"] }]);
});

test("G4: このサイクルで足した ADR が申告に無い重い領域に触れても同意", (t) => {
  const directory = workspace(t, { committed: declaration(HIGH, [BILLING]), guide: true });
  const g4 = driveTo(directory, ["G4", "build-split"], {
    options: ["--harm", "中", "--paths", "src/api/**"],
    delta: "# 設計差分\n\n- `src/api/handler.ts`\n",
    files: { "docs/adr/20261117-billing.md": "# 請求\n\n影響範囲: `src/billing/**`\n" },
  });
  assert.equal(g4.approval, "consent");
  assert.deepEqual(g4.args?.["undeclaredAreas"], [{ name: "billing", touched: ["src/billing/**"] }]);
});

test("G4: 申告が当たっている領域は除き、express では省く", (t) => {
  const directory = workspace(t, { committed: declaration(HIGH, [AUTH]) });
  const after = driveTo(directory, ["G4", "build-split"], {
    options: ["--harm", "中", "--paths", "src/auth/**"],
    delta: "# 設計差分\n\n- `src/auth/session.ts`\n",
  });
  assert.equal(after.step, "build-split");
  assert.ok(statuses(directory).includes("G4:off"));
});

test("G4: options をスキップした回・--paths が無い回は、申告を空とみなして裏取りする", (t) => {
  for (const options of ["skip", ["--harm", "中"]] as const) {
    const directory = workspace(t, { committed: declaration(HIGH, [AUTH]) });
    const g4 = driveTo(directory, ["G4", "build-split"], {
      options: options === "skip" ? "skip" : [...options],
      delta: "# 設計差分\n\n- `src/auth/session.ts`\n",
    });
    assert.deepEqual([g4.step, g4.approval], ["G4", "consent"], String(options));
    assert.deepEqual(g4.args?.["undeclaredAreas"], [{ name: "auth", touched: ["src/auth/session.ts"] }]);
  }
});

test("G4: 基準の宣言を読めない（incomplete）なら、申告が当たらなくても同意", (t) => {
  const directory = workspace(t, {
    committed: `\n[app]\nexposure = "everyone"\ndata = "none"\nimpact = "low"\n`,
    working: declaration(HIGH, [AUTH]),
  });
  const g4 = driveTo(directory, ["G4", "build-split"], {
    options: ["--harm", "中", "--paths", "src/api/**"],
    delta: "# 設計差分\n\n- `src/api/handler.ts`\n",
  });
  assert.deepEqual([g4.step, g4.approval], ["G4", "consent"]);
  assert.ok(g4.notices?.some((notice) => notice.includes("宣言を読めません")));
});

test("G4: 宣言が無ければ従来どおりで、undeclaredAreas は空", (t) => {
  const directory = workspace(t, { profile: "standard" });
  const g4 = driveTo(directory, ["G4"], { options: [], delta: "# 設計差分\n\n- `src/auth/session.ts`\n" });
  assert.deepEqual([g4.step, g4.approval], ["G4", "confirm"]);
  assert.deepEqual(g4.args?.["undeclaredAreas"], []);
  assert.deepEqual(g4.notices, []);
});

test("G4: ADR の一覧を読めなければ同意に倒し、理由を notices に出す", (t) => {
  const directory = workspace(t, { committed: declaration(HIGH, [AUTH]) });
  const g4Before = driveTo(directory, ["architecture-review", "G4", "build-split"], {
    options: ["--harm", "中", "--paths", "src/api/**"],
    delta: "# 設計差分\n\n- `src/api/handler.ts`\n",
  });
  // ADR の所在を引く document-guide.md を壊す
  writeFileSync(join(directory, "docs/hikyaku/document-guide.md"), "壊れたガイド\n");
  const g4 = g4Before.step === "architecture-review" ? report(directory, "architecture-review", "--result", "done") : next(directory);
  assert.deepEqual([g4.step, g4.approval], ["G4", "consent"]);
  assert.match(g4.approvalReason ?? "", /裏取りできない/);
  assert.ok(g4.notices?.some((notice) => notice.includes("G3 の申告を裏取りできない")), JSON.stringify(g4.notices));
});
