/**
 * 監督は安全側にだけ倒すこと（build-07）: 監督が答えてよい値、答えの出どころ、答えを待つ blocked、
 * 監督の答えの記録の確かめ（ADR conductor-runs-to-end・pending-items-ledger・risk-ceiling-table）
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  DEFAULT_CONDUCTOR,
  needsRiskDeclaration,
  parseFinalText,
  parseResultJson,
  resolveAsk,
  safeAnswerOf,
  type AskSettings,
} from "../scripts/lib/conductor.mts";
import { answerProblem, childAnswer } from "../scripts/lib/ledger.mts";
import { cli, cliWith, ESCALATION_BODY, succeeds, temporaryDirectory, testEnvironment, workspace, write } from "./helpers.mts";

const settings: AskSettings = {
  gates: { codebaseSurvey: false, designChoice: true, architecture: true, plan: false, promotion: true },
  reviews: {
    userStories: true, architecture: true, tasklist: true, plan: true, testSpec: true, code: true,
    security: "recommended", retrospective: "auto", validate: "manual",
  },
};

const BUILD = "docs/hikyaku/cycles/001-test/build-01";
const LEDGER = `${BUILD}/decisions.jsonl`;
const SESSION = "s-answers";

function git(directory: string, ...args: string[]): string {
  const run = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory, encoding: "utf8", env: testEnvironment(), timeout: 10_000,
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

function digest(directory: string): string {
  return JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json")).digest;
}

function result(text: string): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: "s-1", total_cost_usd: 1 });
}

/** build-01 を登録し、回答ファイルを置いたワークスペース */
function built(t: TestContext, config?: string): string {
  const directory = workspace(t, true);
  if (config !== undefined) {
    const path = join(directory, ".hikyaku.config");
    writeFileSync(path, `${readFileSync(path, "utf8")}${config}`);
  }
  succeeds(directory, "tasklist", "add", "001", "--title", "export", "--peak", "350k");
  write(directory, `${BUILD}/issue.md`);
  write(directory, "answer.txt", "既存の API は残す\n");
  return directory;
}

/** ユーザーの答えを待つ question を記録して ID を返す */
function openQuestion(directory: string, ...extra: string[]): string {
  const args = ["ledger", "open", "build-01", "001", "--type", "question", "--who", "user", "--when", "now", "--ask", "G8", "--summary", "既存の API を残すか", ...extra];
  return JSON.parse(succeeds(directory, ...args, "--json")).record.id;
}

function launch(directory: string, ...args: string[]) {
  return cli(directory, "conductor", "launch", "builder", "001", "1", ...args, "--expect-digest", digest(directory));
}

function launched(directory: string, ...args: string[]) {
  const run = launch(directory, ...args, "--json");
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as { argv: string[]; command: string; answerToken: string | null; resumed: boolean };
}

const RESUME = ["--resume", "s-1", "--message", "answer.txt"];

function answerVars(command: string): string[] {
  return [...command.matchAll(/HIKYAKU_ANSWER_[A-Z]+/g)].map((m) => m[0]);
}

// ---------------------------------------------------------------------------
// lib

test("SAFE_ANSWERS: 確認ゲートは承認と差し戻しの両方が safe で、既定は差し戻し（解釈）", () => {
  for (const id of ["G2", "G4", "G6", "G7", "G8", "G10", "docs-link"]) {
    const safe = safeAnswerOf(id);
    assert.deepEqual(Object.keys(safe?.choices ?? {}), ["approved", "rejected"], id);
    assert.deepEqual(safe?.safe, ["approved", "rejected"], id);
    assert.equal(safe?.default, "rejected", id);
  }
});

test("SAFE_ANSWERS: G3 は推奨以外の案が safe に入らない", () => {
  const g3 = safeAnswerOf("G3");
  assert.deepEqual(Object.keys(g3?.choices ?? {}), ["recommended", "other", "rejected"]);
  assert.deepEqual(g3?.safe, ["recommended", "rejected"]);
  assert.equal(g3?.default, "recommended");
});

test("SAFE_ANSWERS: design-conflict・unsafe-split・retrospective は安全側の1つだけが safe、review-findings は3つとも", () => {
  const cases: [string, string, string[]][] = [["design-conflict", "return", ["conform", "adjust"]], ["unsafe-split", "merge", ["redesign", "unsafe"]], ["retrospective", "run", ["skip"]]];
  for (const [id, safe, unsafe] of cases) {
    const answer = safeAnswerOf(id);
    assert.deepEqual(answer?.safe, [safe], id);
    for (const value of unsafe) assert.ok(answer?.choices[value] !== undefined && !answer.safe.includes(value), value);
  }
  assert.deepEqual([...(safeAnswerOf("review-findings")?.safe ?? [])].sort(), ["fix", "new-build", "proceed"]);
  assert.equal(safeAnswerOf("questions"), undefined);
  assert.equal(safeAnswerOf("no-such-ask"), undefined);
});

test("resolveAsk: safe と declaresRisk を埋める", () => {
  const ask = (id: string) => resolveAsk(id, DEFAULT_CONDUCTOR, settings);
  assert.deepEqual(ask("G3").safe, safeAnswerOf("G3"));
  assert.equal(ask("G3").declaresRisk, false);
  assert.equal(ask("questions").safe, null);
  assert.equal(ask("questions").declaresRisk, true);
  assert.equal(ask("review-findings").declaresRisk, true);
  assert.equal(ask("G8").declaresRisk, false);
});

test("needsRiskDeclaration: questions は常に、review-findings は proceed のときだけ申告が要る", () => {
  assert.equal(needsRiskDeclaration("questions", undefined), true);
  assert.equal(needsRiskDeclaration("review-findings", "proceed"), true);
  assert.equal(needsRiskDeclaration("review-findings", "fix"), false);
  assert.equal(needsRiskDeclaration("review-findings", "new-build"), false);
  assert.equal(needsRiskDeclaration("G8", "approved"), false);
});

const WAITING_TEXT = "<hikyaku-blocked>\nユーザーに上げました。\nwaiting: Q-3\n</hikyaku-blocked>";

test("parseFinalText: 実在する未決の事項を指す waiting は検査を外す", () => {
  assert.deepEqual(parseFinalText(WAITING_TEXT, { isWaitingItem: (id) => id === "Q-3" }), {
    outcome: "blocked", body: "ユーザーに上げました。\nwaiting: Q-3", waiting: ["Q-3"],
  });
});

test("parseFinalText: 指す先の無い waiting・waiting の無い blocked・オプション無し・行頭でない waiting は従来どおり検査する", () => {
  const two = "<hikyaku-blocked>\nwaiting: Q-3\nwaiting: Q-9\n</hikyaku-blocked>";
  assert.equal(parseFinalText(two, { isWaitingItem: (id) => id === "Q-3" }).outcome, "violation");
  const none = parseFinalText("<hikyaku-blocked>\n止まります\n</hikyaku-blocked>", { isWaitingItem: () => true });
  assert.equal(none.outcome, "violation");
  assert.equal(none.waiting, undefined);
  assert.equal(parseFinalText(WAITING_TEXT).outcome, "violation");
  const inline = parseFinalText("<hikyaku-blocked>\n前回は waiting: Q-3 でした\n</hikyaku-blocked>", { isWaitingItem: () => true });
  assert.equal(inline.outcome, "violation");
  assert.equal(inline.waiting, undefined);
  // 行き詰まりの報告がそろっていれば、waiting が無くても従来どおり blocked
  assert.equal(parseFinalText(`<hikyaku-blocked>\n${ESCALATION_BODY}</hikyaku-blocked>`, { isWaitingItem: () => false }).outcome, "blocked");
});

test("parseResultJson: 結果の JSON からも waiting を返す", () => {
  const parsed = parseResultJson(result(WAITING_TEXT), { isWaitingItem: (id) => id === "Q-3" });
  assert.equal(parsed.outcome, "blocked");
  assert.deepEqual(parsed.waiting, ["Q-3"]);
});

test("childAnswer: 子の環境変数から答えを読み、子でなければ undefined", () => {
  const env = {
    HIKYAKU_CONDUCTOR_CHILD: "1", HIKYAKU_ANSWER_FROM: "supervisor", HIKYAKU_ANSWER_ASK: "review-findings",
    HIKYAKU_ANSWER_CHOICE: "proceed", HIKYAKU_ANSWER_RISK: "中:app.exposure,area:billing", HIKYAKU_ANSWER_TOKEN: "t-1",
  };
  assert.deepEqual(childAnswer(env), {
    from: "supervisor", items: [], ask: "review-findings", choice: "proceed",
    risk: { kind: "declared", harm: "中", premises: ["app.exposure", "area:billing"] }, token: "t-1",
  });
  assert.deepEqual(childAnswer({ ...env, HIKYAKU_ANSWER_RISK: "none" })?.risk, { kind: "none" });
  const { HIKYAKU_CONDUCTOR_CHILD: _child, ...notChild } = env;
  assert.equal(childAnswer(notChild), undefined);
});

test("answerProblem: 子の --by user は FROM=user で ITEMS にある ID だけ通し、子でない・ai は検査しない", () => {
  const user = { from: "user" as const, items: ["Q-3"] };
  const supervisor = { from: "supervisor" as const, items: [] };
  const unset = { from: undefined, items: [] };
  assert.equal(answerProblem("user", "Q-3", user), undefined);
  for (const [id, answer] of [["Q-4", user], ["Q-3", supervisor], ["Q-3", unset]] as const) {
    assert.equal(typeof answerProblem("user", id, answer), "string", `${id} ${answer.from}`);
  }
  assert.equal(answerProblem("user", "Q-3", undefined), undefined);
  assert.equal(answerProblem("ai:builder", "Q-3", unset), undefined);
});

// ---------------------------------------------------------------------------
// CLI: conductor parse・asks

test("CLI: conductor parse は gate の ask に safe と declaresRisk を出し、asks は各問いと queueing を出す", (t) => {
  const directory = built(t);
  write(directory, "r.json", result('<hikyaku-gate id="G3">\nどの案にしますか？\n</hikyaku-gate>'));
  const parsed = JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest(directory), "--json"));
  assert.deepEqual(parsed.ask.safe.safe, ["recommended", "rejected"]);
  assert.equal(parsed.ask.safe.default, "recommended");
  assert.equal(parsed.ask.declaresRisk, false);

  const asks = JSON.parse(succeeds(directory, "conductor", "asks", "001", "--json"));
  const find = (id: string) => asks.asks.find((ask: { id: string }) => ask.id === id);
  assert.equal(find("questions").safe, null);
  assert.equal(find("questions").declaresRisk, true);
  assert.deepEqual(find("design-conflict").safe.safe, ["return"]);
  assert.equal(find("design-conflict").declaresRisk, false);
  assert.equal(typeof asks.queueing, "string");
  assert.notEqual(asks.queueing, "");
  assert.equal(asks.deferredConsent, undefined);
  assert.match(succeeds(directory, "conductor", "asks", "001"), /ユーザーに上げる問いは記録に積み、依存しないビルドを先に進める/);
});

test("CLI: conductor parse は記録にある未決の who=user・when=now の question を指す waiting だけ検査を外す", (t) => {
  const directory = built(t);
  const parse = (id: string) => {
    write(directory, "r.json", result(`<hikyaku-blocked>\nユーザーに上げました\nwaiting: ${id}\n</hikyaku-blocked>`));
    return JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest(directory), "--json"));
  };
  const question = openQuestion(directory);
  const waiting = parse(question);
  assert.equal(waiting.outcome, "blocked");
  assert.deepEqual(waiting.waiting, [question]);

  const base = ["ledger", "open", "build-01", "001", "--summary", "x", "--json"];
  const ai = JSON.parse(succeeds(directory, ...base, "--type", "question", "--who", "ai:build-01", "--when", "now")).record.id;
  const later = JSON.parse(succeeds(directory, ...base, "--type", "question", "--who", "user", "--when", "merge")).record.id;
  const risk = JSON.parse(succeeds(directory, ...base, "--type", "risk", "--who", "user", "--when", "now")).record.id;
  for (const id of [ai, later, risk, "build-01.99-ffff"]) assert.equal(parse(id).outcome, "violation", id);

  succeeds(directory, "ledger", "decide", "build-01", question, "001", "--decision", "decided", "--by", "user", "--input", "残す");
  assert.equal(parse(question).outcome, "violation");
});

// ---------------------------------------------------------------------------
// CLI: conductor launch（答えの出どころ）

test("CLI: conductor launch は --from も --notice も無い再開を拒み、--notice は答えの環境変数を置かない", (t) => {
  const directory = built(t);
  const bare = launch(directory, ...RESUME);
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /--from .*--notice/);
  write(directory, "notice.txt", "conductor ブランチを取り込みました\n");
  const notice = launched(directory, "--resume", "s-1", "--message", "notice.txt", "--notice");
  assert.equal(notice.argv[2], "conductor ブランチを取り込みました");
  assert.deepEqual(answerVars(notice.command), []);
  assert.equal(launch(directory, "--resume", "s-1", "--message", "notice.txt", "--notice", "--from", "supervisor", "--ask", "G8", "--choice", "approved").status, 1);
  // 回答の無い初回の起動には何も置かない
  assert.deepEqual(answerVars(launched(directory).command), []);
});

test("CLI: conductor launch --from user は --closes の未決の事項だけを受け付け、閉じる固定文と環境変数を置く", (t) => {
  const directory = built(t);
  const q3 = openQuestion(directory);
  const q4 = openQuestion(directory);
  const output = launched(directory, ...RESUME, "--from", "user", "--closes", `${q3},${q4}`);
  assert.match(output.command, /^HIKYAKU_CONDUCTOR_CHILD=1 HIKYAKU_ANSWER_FROM=user HIKYAKU_ANSWER_ITEMS=/);
  assert.ok(output.command.includes(`${q3},${q4}`));
  assert.ok(output.argv[2]?.startsWith("次の事項はユーザーの答えで閉じます"));
  assert.ok(output.argv[2]?.includes(`ledger decide build-01 ${q3} 001-test --decision decided --by user --input "既存の API は残す"`));
  assert.ok(output.argv[2]?.endsWith("既存の API は残す"));

  const missing = launch(directory, ...RESUME, "--from", "user");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--closes/);
  succeeds(directory, "ledger", "decide", "build-01", q4, "001", "--decision", "decided", "--by", "user", "--input", "x");
  for (const closes of ["build-01.9-ffff", `${q3},${q4}`]) {
    const refused = launch(directory, ...RESUME, "--from", "user", "--closes", closes);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, closes === `${q3},${q4}` ? new RegExp(q4.replace(".", "\\.")) : /build-01\.9-ffff/);
  }
});

test("CLI: conductor launch は初回の起動でも --from を添えれば --message を渡せる", (t) => {
  const directory = built(t);
  const q3 = openQuestion(directory);
  const output = launched(directory, "--message", "answer.txt", "--from", "user", "--closes", q3);
  assert.equal(output.resumed, false);
  assert.ok(output.argv[2]?.startsWith("/hikyaku:builder 001-test 1\n\n次の事項はユーザーの答えで閉じます"));
  assert.ok(output.argv[2]?.includes(q3));
  assert.ok(output.command.includes("HIKYAKU_ANSWER_FROM=user"));
  assert.equal(launch(directory, "--message", "answer.txt").status, 1);
});

// ---------------------------------------------------------------------------
// CLI: conductor launch（監督の答えの検査）

test("CLI: conductor launch は handler が user の問い・中止・同意に倒した回への --from supervisor を拒む", (t) => {
  const directory = built(t, '\n[conductor]\nescalate = ["G8"]\n');
  const escalated = launch(directory, ...RESUME, "--from", "supervisor", "--ask", "G8", "--choice", "approved");
  assert.equal(escalated.status, 1);
  assert.match(escalated.stderr, /--escalate/);
  assert.equal(launch(directory, ...RESUME, "--from", "supervisor", "--ask", "abandon").status, 1);
  // 回で同意になるゲート（G10・G3）は、子の位置を確かめられなければ同意に倒す
  const close = (ask: string, choice: string) =>
    cli(directory, "conductor", "launch", ask === "G10" ? "close-cycle" : "architect", "001", "--resume", "s-unknown", "--message", "answer.txt",
      "--from", "supervisor", "--ask", ask, "--choice", choice, "--expect-digest", digest(directory));
  assert.equal(close("G10", "approved").status, 1);
  assert.equal(close("G3", "recommended").status, 1);
});

test("CLI: conductor launch は --ask・--choice の欠落、表に無い値、safe に無い値を拒む", (t) => {
  const directory = built(t);
  const run = (...args: string[]) => launch(directory, ...RESUME, "--from", "supervisor", ...args);
  assert.match(run().stderr, /--ask/);
  assert.match(run("--ask", "G8").stderr, /--choice/);
  assert.equal(run("--ask", "G8", "--choice", "yes").status, 1);
  const unsafe = run("--ask", "design-conflict", "--choice", "adjust");
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /--escalate/);
});

test("CLI: conductor launch は確認ゲートの承認も差し戻しも監督の答えとして受け付ける（解釈）", (t) => {
  const directory = built(t);
  for (const choice of ["approved", "rejected"]) {
    const output = launched(directory, ...RESUME, "--from", "supervisor", "--ask", "G8", "--choice", choice);
    assert.ok(output.command.includes("HIKYAKU_ANSWER_FROM=supervisor"));
    assert.ok(output.command.includes("HIKYAKU_ANSWER_ASK=G8"));
    assert.ok(output.command.includes(`HIKYAKU_ANSWER_CHOICE=${choice}`));
    assert.ok(output.command.includes("HIKYAKU_ANSWER_TOKEN="));
    assert.ok(!output.command.includes("HIKYAKU_ANSWER_RISK"));
    assert.ok(!output.command.includes("HIKYAKU_ANSWER_ITEMS"));
  }
});

test("CLI: conductor launch はリスクを受け入れうる答えに申告を求め、--no-risk は RISK=none と TOKEN を渡す", (t) => {
  const directory = built(t);
  const run = (...args: string[]) => launch(directory, ...RESUME, "--from", "supervisor", ...args);
  const questions = run("--ask", "questions");
  assert.equal(questions.status, 1);
  assert.match(questions.stderr, /--harm .*--no-risk/);
  assert.equal(run("--ask", "review-findings", "--choice", "proceed").status, 1);
  assert.equal(run("--ask", "review-findings", "--choice", "fix").status, 0);

  const first = launched(directory, ...RESUME, "--from", "supervisor", "--ask", "questions", "--no-risk");
  assert.match(first.command, /^HIKYAKU_CONDUCTOR_CHILD=1 HIKYAKU_ANSWER_FROM=supervisor HIKYAKU_ANSWER_ASK=questions HIKYAKU_ANSWER_RISK=none HIKYAKU_ANSWER_TOKEN=/);
  assert.equal(typeof first.answerToken, "string");
  assert.ok(first.command.includes(`HIKYAKU_ANSWER_TOKEN=${first.answerToken}`));
  const second = launched(directory, ...RESUME, "--from", "supervisor", "--ask", "questions", "--no-risk");
  assert.notEqual(second.answerToken, first.answerToken);
});

/** 宣言を main にコミットして origin へ push する（上限の判定の基準） */
function declared(t: TestContext, app: string): string {
  const directory = built(t, app);
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", "main");
  const remote = temporaryDirectory(t);
  git(remote, "init", "--quiet", "--bare");
  git(directory, "remote", "add", "origin", remote);
  git(directory, "push", "-q", "origin", "main");
  git(directory, "remote", "set-head", "origin", "main");
  return directory;
}

const MEDIUM = '\n[app]\nexposure = "internal"\ndata = "none"\nimpact = "low"\n';

test("CLI: conductor launch は上限以内の申告を受け付け、上限を超える申告は事後同意が有効でも拒む", (t) => {
  const directory = declared(t, MEDIUM);
  const within = launched(directory, ...RESUME, "--from", "supervisor", "--ask", "review-findings", "--choice", "proceed", "--harm", "中", "--premises", "app.exposure");
  assert.ok(within.command.includes("HIKYAKU_ANSWER_CHOICE=proceed"));
  assert.ok(within.command.includes("HIKYAKU_ANSWER_RISK='中:app.exposure'"));
  const over = launch(directory, ...RESUME, "--from", "supervisor", "--ask", "questions", "--harm", "高", "--premises", "app.exposure");
  assert.equal(over.status, 1);
  assert.match(over.stderr, /上限を超える/);

  write(directory, "docs/hikyaku/cycles/001-test/.hikyaku.config", "[consent]\ndeferred = true\n");
  assert.equal(launch(directory, ...RESUME, "--from", "supervisor", "--ask", "questions", "--harm", "高", "--premises", "app.exposure").status, 1);
});

test("CLI: conductor launch は重い領域を前提に挙げた申告を害が中でも拒み、宣言が無ければ高も受け付ける", (t) => {
  const heavy = declared(t, '\n[app]\nexposure = "personal"\ndata = "none"\nimpact = "low"\n\n[[app.areas]]\nname = "billing"\npaths = ["src/billing/**"]\nexposure = "public"\ndata = "personal-or-secret"\nimpact = "high"\n');
  assert.equal(launch(heavy, ...RESUME, "--from", "supervisor", "--ask", "questions", "--harm", "中", "--premises", "area:billing").status, 1);
  const free = built(t);
  assert.equal(launch(free, ...RESUME, "--from", "supervisor", "--ask", "questions", "--harm", "高", "--premises", "app.exposure").status, 0);
});

test("CLI: conductor launch --escalate はユーザーに上げる問いを記録させる固定文で再開し、単位を読み替える", (t) => {
  const directory = built(t, '\n[conductor]\nescalate = ["G8"]\n');
  const output = launched(directory, "--resume", "s-1", "--escalate", "--ask", "G8");
  assert.ok(output.argv[2]?.includes("hikyaku ledger open build-01 001-test --type question --who user --when now --ask G8"));
  assert.match(output.argv[2] ?? "", /コミットして push/);
  assert.match(output.argv[2] ?? "", /waiting: <記録した ID>/);
  assert.deepEqual(answerVars(output.command), []);

  const other = (phase: string, ask: string) =>
    JSON.parse(succeeds(directory, "conductor", "launch", phase, "001", "--resume", "s-1", "--escalate", "--ask", ask, "--expect-digest", digest(directory), "--json")).argv[2] as string;
  assert.ok(other("architect", "G3").includes("ledger open architect 001-test"));
  assert.ok(other("close-cycle", "G10").includes("ledger open close 001-test"));
  assert.equal(launch(directory, "--resume", "s-1", "--escalate", "--message", "answer.txt", "--ask", "G8").status, 1);
  assert.equal(launch(directory, "--resume", "s-1", "--escalate").status, 1);
});

// ---------------------------------------------------------------------------
// 子の手順の位置で判定する回（G3・G10 の確認の回）

function reportAs(t: TestContext, directory: string, phase: string, step: string, ...extra: string[]): Record<string, unknown> {
  const env = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CONFIG_DIR: temporaryDirectory(t) };
  const run = cliWith(directory, env, "step", "report", phase, step, "001", ...extra, "--json");
  assert.equal(run.status, 0, run.stderr);
  return (JSON.parse(run.stdout) as { directive: Record<string, unknown> }).directive;
}

test("CLI: conductor launch は子が G3 の確認の回で止まっていれば推奨案を受け付け、推奨以外の案は拒む", (t) => {
  // ビルドの分割の成果物（tasklist）があると architect の記録が欠けているとみなされるので、ビルドを登録しない
  const directory = workspace(t, true);
  write(directory, "answer.txt", "推奨案で進める\n");
  let directive = JSON.parse(succeeds(directory, "step", "next", "architect", "001", "--json")).directive as Record<string, unknown>;
  for (let i = 0; i < 20 && directive["step"] !== "G3"; i += 1) {
    const step = String(directive["step"]);
    assert.ok(directive["step"] !== undefined, JSON.stringify(directive));
    if (directive["kind"] === "gate") {
      directive = reportAs(t, directory, "architect", step, "--result", "approved", "--input", "OK");
      continue;
    }
    if (step === "survey") write(directory, "docs/hikyaku/cycles/001-test/design/codebase-survey.md");
    directive = reportAs(t, directory, "architect", step, "--result", "done");
  }
  assert.deepEqual([directive["step"], directive["approval"]], ["G3", "confirm"]);
  const run = (choice: string) =>
    cli(directory, "conductor", "launch", "architect", "001", "--resume", SESSION, "--message", "answer.txt",
      "--from", "supervisor", "--ask", "G3", "--choice", choice, "--expect-digest", digest(directory), "--json");
  const accepted = run("recommended");
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.ok(JSON.parse(accepted.stdout).command.includes("HIKYAKU_ANSWER_FROM=supervisor"));
  const other = run("other");
  assert.equal(other.status, 1);
  assert.match(other.stderr, /--escalate/);
});

test("CLI: conductor launch は子が G10 の確認の回で止まっていれば承認を受け付け、同意の回なら拒む", (t) => {
  const directory = built(t);
  const gate = reportAs(t, directory, "close", "collect", "--result", "done");
  assert.deepEqual([gate["step"], gate["approval"]], ["G10", "confirm"]);
  const run = () =>
    cli(directory, "conductor", "launch", "close-cycle", "001", "--resume", SESSION, "--message", "answer.txt",
      "--from", "supervisor", "--ask", "G10", "--choice", "approved", "--expect-digest", digest(directory), "--json");
  assert.equal(run().status, 0, run().stderr);

  write(directory, `${BUILD}/handoff.md`, "# 申し送り\n\n## 永続化すること\n\n- `decisions` [高]: ADR に再評価条件を足す\n");
  const restarted = cliWith(directory, { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CONFIG_DIR: temporaryDirectory(t) }, "step", "restart", "close", "001", "--reason", "候補が増えた");
  assert.equal(restarted.status, 0, restarted.stderr);
  const consent = reportAs(t, directory, "close", "collect", "--result", "done");
  assert.deepEqual([consent["step"], consent["approval"]], ["G10", "consent"]);
  assert.equal(run().status, 1);
});

// ---------------------------------------------------------------------------
// CLI: ledger decide・object（答えの出どころ）

function lines(directory: string): Record<string, unknown>[] {
  return readFileSync(join(directory, LEDGER), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function decideAs(directory: string, env: NodeJS.ProcessEnv, id: string, by: string, ...extra: string[]) {
  return cliWith(directory, env, "ledger", "decide", "build-01", id, "001", "--decision", "decided", "--by", by, "--input", "残す", ...extra, "--json");
}

const CHILD = { HIKYAKU_CONDUCTOR_CHILD: "1" };

test("CLI: ledger decide は子で出どころが user でない・ITEMS に無い ID への --by user を拒み、記録を書かない", (t) => {
  const directory = built(t);
  const q3 = openQuestion(directory);
  const q4 = openQuestion(directory);
  const before = lines(directory).length;
  for (const env of [{ ...CHILD, HIKYAKU_ANSWER_FROM: "supervisor" }, { ...CHILD, HIKYAKU_ANSWER_FROM: "user", HIKYAKU_ANSWER_ITEMS: q3 }]) {
    const target = env.HIKYAKU_ANSWER_FROM === "user" ? q4 : q3;
    for (const extra of [[], ["--dry-run"]]) {
      const refused = decideAs(directory, env, target, "user", ...extra);
      assert.equal(refused.status, 1, JSON.stringify(env));
      if (env.HIKYAKU_ANSWER_FROM === "user") assert.match(refused.stderr, /ユーザーが答えた事項/);
    }
  }
  assert.equal(lines(directory).length, before);

  const written = decideAs(directory, { ...CHILD, HIKYAKU_ANSWER_FROM: "user", HIKYAKU_ANSWER_ITEMS: q3 }, q3, "user");
  assert.equal(written.status, 0, written.stderr);
  assert.equal(lines(directory).at(-1)?.["from"], "user");
  succeeds(directory, "ledger", "list", "001");
});

test("CLI: ledger decide は子でないセッションを縛らず、答えの環境変数があっても欄を足さない", (t) => {
  const directory = built(t);
  const q4 = openQuestion(directory);
  const q5 = openQuestion(directory);
  const q6 = openQuestion(directory);
  assert.equal(decideAs(directory, { HIKYAKU_ANSWER_FROM: "user", HIKYAKU_ANSWER_ITEMS: "x" }, q4, "user").status, 0);
  assert.equal(decideAs(directory, {}, q5, "user").status, 0);
  const env = { HIKYAKU_ANSWER_FROM: "supervisor", HIKYAKU_ANSWER_ASK: "questions", HIKYAKU_ANSWER_RISK: "none", HIKYAKU_ANSWER_TOKEN: "t-9" };
  assert.equal(decideAs(directory, env, q6, "user").status, 0);
  for (const record of lines(directory).filter((line) => line["record"] === "decide")) {
    for (const key of ["from", "ask", "choice", "risk", "token"]) assert.equal(record[key], undefined, key);
  }
});

/** supervisor が決める事項（監督の答えの記録先） */
function openSupervisorItem(directory: string): string {
  const args = ["ledger", "open", "build-01", "001", "--type", "question", "--who", "supervisor", "--when", "now", "--summary", "指摘をどうするか", "--json"];
  return JSON.parse(succeeds(directory, ...args)).record.id;
}

test("CLI: ledger decide は子の --by supervisor に FROM=supervisor を求め、問い・値・申告・token を必ず残す", (t) => {
  const directory = built(t);
  const id = openSupervisorItem(directory);
  const env = {
    ...CHILD, HIKYAKU_ANSWER_FROM: "supervisor", HIKYAKU_ANSWER_ASK: "review-findings", HIKYAKU_ANSWER_CHOICE: "proceed",
    HIKYAKU_ANSWER_RISK: "none", HIKYAKU_ANSWER_TOKEN: "t-1",
  };
  for (const from of ["user", undefined]) {
    assert.equal(decideAs(directory, { ...env, HIKYAKU_ANSWER_FROM: from }, id, "supervisor").status, 1);
  }
  assert.equal(decideAs(directory, env, id, "supervisor").status, 0);
  const record = lines(directory).at(-1) ?? {};
  assert.deepEqual(
    [record["from"], record["ask"], record["choice"], record["risk"], record["token"]],
    ["supervisor", "review-findings", "proceed", { kind: "none" }, "t-1"],
  );

  assert.equal(decideAs(directory, { ...env, HIKYAKU_ANSWER_RISK: "中:app.exposure" }, id, "supervisor").status, 0);
  assert.deepEqual(lines(directory).at(-1)?.["risk"], { kind: "declared", harm: "中", premises: ["app.exposure"] });
});

test("CLI: ledger decide は申告の要る答えで RISK の無い起動の --by supervisor を拒み、fix は申告なしで書ける", (t) => {
  const directory = built(t);
  const id = openSupervisorItem(directory);
  const base = { ...CHILD, HIKYAKU_ANSWER_FROM: "supervisor", HIKYAKU_ANSWER_TOKEN: "t-2" };
  const before = lines(directory).length;
  assert.equal(decideAs(directory, { ...base, HIKYAKU_ANSWER_ASK: "questions" }, id, "supervisor").status, 1);
  assert.equal(decideAs(directory, { ...base, HIKYAKU_ANSWER_ASK: "review-findings", HIKYAKU_ANSWER_CHOICE: "proceed" }, id, "supervisor").status, 1);
  assert.equal(lines(directory).length, before);
  const fix = decideAs(directory, { ...base, HIKYAKU_ANSWER_ASK: "review-findings", HIKYAKU_ANSWER_CHOICE: "fix", HIKYAKU_ANSWER_TOKEN: "t-3" }, id, "supervisor");
  assert.equal(fix.status, 0, fix.stderr);
  const record = lines(directory).at(-1) ?? {};
  assert.deepEqual([record["choice"], record["token"], record["risk"]], ["fix", "t-3", undefined]);
});

const OBJECTION = ["ledger", "object", "build-01", "001", "--summary", "API を消す", "--basis", "[app] data", "--loses", "互換", "--harm", "中", "--decision", "consented", "--input", "進める", "--json"];

test("CLI: ledger object は子の決定つきの記録に --answers を求め、ITEMS にある ID だけ受け付ける", (t) => {
  const directory = built(t);
  const q3 = openQuestion(directory);
  const env = { ...CHILD, HIKYAKU_ANSWER_FROM: "user", HIKYAKU_ANSWER_ITEMS: q3 };
  const before = lines(directory).length;
  assert.equal(cliWith(directory, env, ...OBJECTION).status, 1);
  assert.equal(cliWith(directory, env, ...OBJECTION, "--answers", "build-01.9-ffff").status, 1);
  assert.equal(lines(directory).length, before);
  const written = cliWith(directory, env, ...OBJECTION, "--answers", q3);
  assert.equal(written.status, 0, written.stderr);
  const decide = lines(directory).at(-1) ?? {};
  assert.deepEqual([decide["answers"], decide["from"]], [q3, "user"]);

  // 子でないセッションは --answers を検査しない
  assert.equal(cli(directory, ...OBJECTION).status, 0);
});

// ---------------------------------------------------------------------------
// CLI: conductor parse --expect-answer・ledger answers

test("CLI: conductor parse --expect-answer は token の一致する監督の決定が無ければ stepProblems に入れる", (t) => {
  const directory = built(t);
  write(directory, "r.json", result("<hikyaku-done next=\"\">\n終えました\n</hikyaku-done>"));
  const parse = (token: string) =>
    JSON.parse(succeeds(directory, "conductor", "parse", "r.json", "001", "--expect-digest", digest(directory), "--expect-answer", token, "--json")).stepProblems as string[];
  const missing = parse("t-1");
  assert.equal(missing.filter((problem) => /監督の答え/.test(problem)).length, 1);

  const id = openSupervisorItem(directory);
  const user = openQuestion(directory);
  decideAs(directory, { ...CHILD, HIKYAKU_ANSWER_FROM: "supervisor", HIKYAKU_ANSWER_ASK: "G8", HIKYAKU_ANSWER_TOKEN: "t-1" }, id, "supervisor");
  decideAs(directory, { ...CHILD, HIKYAKU_ANSWER_FROM: "user", HIKYAKU_ANSWER_ITEMS: user, HIKYAKU_ANSWER_TOKEN: "t-2" }, user, "user");
  assert.equal(parse("t-1").filter((problem) => /監督の答え/.test(problem)).length, 0);
  assert.equal(parse("t-2").filter((problem) => /監督の答え/.test(problem)).length, 1);
});

test("CLI: ledger answers は監督が答えた問いを並べ、none を「リスクなしと申告」と示し、古い決定もそのまま出す", (t) => {
  const directory = built(t);
  const first = openSupervisorItem(directory);
  const second = openSupervisorItem(directory);
  const old = openSupervisorItem(directory);
  const env = { ...CHILD, HIKYAKU_ANSWER_FROM: "supervisor", HIKYAKU_ANSWER_TOKEN: "t" };
  decideAs(directory, { ...env, HIKYAKU_ANSWER_ASK: "questions", HIKYAKU_ANSWER_RISK: "none" }, first, "supervisor");
  decideAs(directory, { ...env, HIKYAKU_ANSWER_ASK: "review-findings", HIKYAKU_ANSWER_CHOICE: "proceed", HIKYAKU_ANSWER_RISK: "中:app.exposure" }, second, "supervisor");
  decideAs(directory, {}, old, "supervisor");
  const user = openQuestion(directory);
  decideAs(directory, {}, user, "user");

  const before = readFileSync(join(directory, LEDGER), "utf8");
  const pr = succeeds(directory, "ledger", "answers", "001", "--format", "pr");
  assert.match(pr, /^## 監督が答えた問い/);
  const rows = pr.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(rows.length, 3);
  assert.match(rows[0] ?? "", /questions.*リスクなしと申告/);
  assert.match(rows[1] ?? "", /review-findings \/ proceed.*害 中・前提 app\.exposure/);
  assert.ok(rows[2]?.includes(old));
  assert.doesNotMatch(rows[2] ?? "", /リスクなしと申告/);
  assert.ok(!pr.includes(user));

  const json = JSON.parse(succeeds(directory, "ledger", "answers", "001", "--json"));
  assert.deepEqual(json.answers.map((a: { ask?: string; risk?: unknown }) => [a.ask ?? null, a.risk ?? null]), [
    ["questions", { kind: "none" }],
    ["review-findings", { kind: "declared", harm: "中", premises: ["app.exposure"] }],
    [null, null],
  ]);
  assert.equal(readFileSync(join(directory, LEDGER), "utf8"), before);
});
