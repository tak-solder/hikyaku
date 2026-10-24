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
 * 初期化済みかどうかは stop で決める。pr を終えていれば止まる。init の記録が1件も無いのに
 * document-guide.md に登録がある（未作成以外の行がある）なら、v2 までに初期化した
 * ワークスペースとみなして止まる。登録が無い（雛形のまま）なら、雛形を生成した直後に
 * 中断したとみなして cleanup から続ける。
 *
 * 完了の条件は produces / evidence ではなく requires で書く。document-guide.md も AGENTS.md も
 * 雛形の生成や init より前から存在しうるので、produces / evidence にすると
 * 「後ろのステップの成果物があるのに記録が無い」と読まれて止まる。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INDEX_MARKER, loadGuide, RENAMED_FILES, renderIndexBlock, validateGuide, type DocEntry } from "../docs.mts";
import { HikyakuError } from "../errors.mts";
import { upsertMarkerBlock } from "../markdown.mts";
import type { SkillSteps, StepContext } from "./engine.mts";

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
  if (ctx.events.some((event) => event.skill === "init" && event.step === "pr" && event.result === "done")) {
    return "このワークスペースは初期化済みです（init の手順をすべて終えています）。";
  }
  if (ctx.events.some((event) => event.skill === "init")) return undefined;
  const entries = guideEntries(ctx);
  if (typeof entries === "string") return undefined;
  if (entries.every((entry) => entry.ownership === "未作成")) return undefined;
  return [
    "このワークスペースは初期化済みです（document-guide.md に登録があり、init の記録がありません）。",
    "init はやり直しません。ドキュメントの登録を直すときは document-guide.md を編集し、hikyaku docs validate で確かめてください。",
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
  steps: [
    { id: "cleanup", kind: "run", title: "雛形の警告と旧名ファイルの後始末", requires: renamedLeft },
    {
      id: "register",
      kind: "run",
      title: "既存ドキュメントの検出と document-guide.md への登録",
      requires: guideProblems,
    },
    {
      id: "link-approval",
      kind: "gate",
      title: "AGENTS.md への索引の承認",
      binds: ["document-guide.md"],
    },
    { id: "link", kind: "run", title: "AGENTS.md への索引の書き込み", requires: indexStale },
    { id: "pr", kind: "run", title: "ブランチ・コミット・PR" },
  ],
};
