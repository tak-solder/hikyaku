/**
 * init（ワークスペースの初期化）のステップ。
 *
 * step に乗せるのは、雛形（hikyaku init）を生成したあとの手順だけ。それより前の
 * doctor・HIKYAKU_ROOT の決定・v1 の移行・雛形の生成は SKILL.md に置く。step は .hikyaku.config から
 * HIKYAKU_ROOT を解決するので、雛形ができるまでは設定を読めず、現在地を導出できない。
 *
 * 作業単位は HIKYAKU_ROOT 自身で、progress.jsonl はワークスペース直下に置く。
 * init は1リポジトリにつき1回なので、回ごとに分ける必要は無い。
 *
 * 初期化済みかどうかは stop で決める。pr を（PR を添えて）終えていれば止まる。init の記録が1件も無いのに
 * document-guide.md に登録がある（未作成以外の行がある）なら、v2 までに初期化した
 * ワークスペースとみなして止まる。登録が無い（雛形のまま）なら、雛形を生成した直後に
 * 中断したとみなして cleanup から続ける。
 *
 * 完了の条件は produces / evidence ではなく requires で書く。document-guide.md も AGENTS.md も
 * 雛形の生成や init より前から存在しうるので、produces / evidence にすると
 * 「後ろのステップの成果物があるのに記録が無い」と読まれて止まる。
 *
 * 移行の回（step restart init --round migrate）は、初期化済みのワークスペースで、v3 で廃止した
 * 論理名（learnings など）の文書の中身を振り分ける。初期化の回とは別の手順（triage → 承認 →
 * 書き込み → 索引 → PR）を返す。必要かどうかは、初期化済みで止まるときのメッセージで知らせる。
 *
 * requires は完了したあとも毎回確かめるので、link のあとに guide を直して索引と食い違えば、
 * 現在地は link に戻る（guide と索引が食い違ったまま PR にはしない）。承認は自動では取り直させず、
 * guide の変更は Git の履歴とレビューで追う。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INDEX_MARKER, loadGuide, RENAMED_FILES, RETIRED_DOCS, renderIndexBlock, validateGuide, type DocEntry } from "../docs.mts";
import { HikyakuError } from "../errors.mts";
import { upsertMarkerBlock } from "../markdown.mts";
import { currentEvents, currentRound, type SkillSteps, type StepContext } from "./engine.mts";

/** 廃止した論理名の文書を振り分ける回 */
const MIGRATE_ROUND = "migrate";

function migrating(ctx: StepContext): boolean {
  return currentRound(INIT_STEPS, ctx.events) === MIGRATE_ROUND;
}

/** document-guide.md に残っている、廃止した論理名 */
function retiredEntries(ctx: StepContext): string[] {
  const entries = guideEntries(ctx);
  if (typeof entries === "string") return [];
  return entries.filter((entry) => RETIRED_DOCS[entry.name] !== undefined).map((entry) => entry.name);
}

/** 初期化済みで止まるときに添える、移行の案内 */
function migrationHint(ctx: StepContext): string[] {
  const retired = retiredEntries(ctx);
  if (retired.length === 0) return [];
  return [
    `document-guide.md に、v3 で廃止した論理名が残っています: ${retired.join(", ")}`,
    "中身を振り分けるには、移行の回を始めてください:",
    '  hikyaku step restart init --round migrate --reason "v3 への移行"',
  ];
}

function guideEntries(ctx: StepContext): DocEntry[] | string {
  try {
    return loadGuide(ctx.config.hikyakuRoot);
  } catch (error) {
    if (error instanceof HikyakuError) return error.message;
    throw error;
  }
}

function initialized(ctx: StepContext): string | undefined {
  // PR まで終えたら、以後 document-guide.md や AGENTS.md が変わっても手順に戻らない
  // （requires が満たされなくなって link に戻り、承認なしで索引を書き直すのを防ぐ）
  const prDone = (events: StepContext["events"]): boolean =>
    events.some((event) => event.skill === "init" && event.step === "pr" && event.result === "done" && event.pr !== undefined);
  if (migrating(ctx)) {
    // 移行の回は、この回の PR まで終えたら止まる
    if (!prDone(currentEvents(INIT_STEPS, ctx.events))) return undefined;
    return ["移行は完了しています。", ...migrationHint(ctx)].join("\n");
  }
  if (prDone(ctx.events)) {
    return ["このワークスペースは初期化済みです（init の手順をすべて終えています）。", ...migrationHint(ctx)].join("\n");
  }
  if (ctx.events.some((event) => event.skill === "init")) return undefined;
  const entries = guideEntries(ctx);
  if (typeof entries === "string") return undefined;
  if (entries.every((entry) => entry.ownership === "未作成")) return undefined;
  return [
    "このワークスペースは初期化済みです（document-guide.md に登録があり、init の記録がありません）。",
    "init はやり直しません。ドキュメントの登録を直すときは document-guide.md を編集し、hikyaku docs validate で確かめてください。",
    ...migrationHint(ctx),
  ].join("\n");
}

/** 旧名のまま残っているファイル */
function renamedLeft(ctx: StepContext): string | undefined {
  const left = RENAMED_FILES.filter(([stale]) => existsSync(join(ctx.config.hikyakuRoot, stale)));
  if (left.length === 0) return undefined;
  return `旧名のファイルが残っています: ${left.map(([stale, current]) => `${stale} → ${current}`).join(", ")}`;
}

/** document-guide.md が検証を通るか（docs validate と同じ検査） */
function guideProblems(ctx: StepContext): string | undefined {
  const entries = guideEntries(ctx);
  if (typeof entries === "string") return entries;
  const problems = validateGuide(entries, ctx.config.repoRoot);
  if (problems.length === 0) return undefined;
  return `document-guide.md が検証を通りません: ${problems.map((problem) => `${problem.entry}: ${problem.message}`).join(" / ")}`;
}

/** AGENTS.md（無ければ CLAUDE.md）の索引が document-guide.md から生成したものと一致するか（docs link と同じ探し方） */
function indexStale(ctx: StepContext): string | undefined {
  const entries = guideEntries(ctx);
  if (typeof entries === "string") return entries;
  const target = ["AGENTS.md", "CLAUDE.md"].map((name) => join(ctx.config.repoRoot, name)).find((path) => existsSync(path));
  if (target === undefined) return "AGENTS.md がありません。hikyaku docs link で索引を書き込んでください";
  const before = readFileSync(target, "utf8");
  if (upsertMarkerBlock(before, INDEX_MARKER, renderIndexBlock(entries)).content !== before) {
    return "索引が document-guide.md と一致していません。hikyaku docs link で書き込んでください";
  }
  return undefined;
}

export const INIT_STEPS: SkillSteps = {
  skill: "init",
  unit: (phase) => (phase === "init" ? "" : undefined),
  stop: initialized,
  rounds: [MIGRATE_ROUND],
  steps: [
    { id: "cleanup", kind: "run", title: "雛形の警告と旧名ファイルの後始末", when: (ctx) => !migrating(ctx), requires: renamedLeft },
    {
      id: "register",
      kind: "run",
      title: "既存ドキュメントの検出と document-guide.md への登録",
      when: (ctx) => !migrating(ctx),
      requires: guideProblems,
    },
    // 移行の回: 振り分けの結果は会話の中で提示するので、ファイルに結びつけない
    { id: "triage", kind: "run", title: "既存文書の振り分け（doc-triager）", when: migrating },
    { id: "triage-approval", kind: "gate", title: "振り分けの承認", when: migrating },
    {
      id: "triage-write",
      kind: "run",
      title: "振り分けの書き込みと、document-guide.md の更新",
      when: migrating,
      requires: guideProblems,
    },
    {
      id: "link-approval",
      kind: "gate",
      title: "AGENTS.md への索引の承認",
    },
    { id: "link", kind: "run", title: "AGENTS.md への索引の書き込み", requires: indexStale },
    {
      id: "pr",
      kind: "run",
      title: "ブランチ・コミット・PR",
      recordsPr: true,
    },
  ],
};
