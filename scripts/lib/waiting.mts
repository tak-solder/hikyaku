/**
 * 待っている問いとビルド — ADR 20261116-conductor-runs-to-end。
 *
 * conductor はユーザーに上げる問いを子に記録させ（question・who=user・when=now）、それに依存しないビルドを先に
 * 進める。どのビルドが何の答えを待っているかは保存せず、毎回ここで記録から導く。
 *
 * 読む断面は作業ツリーと、architect・tasklist の各ビルドの origin のブランチ。問いを記録した子のブランチは
 * まだ conductor ブランチに取り込まれていない（答えを待って PR を作っていない）ので、作業ツリーだけでは見えない。
 * 同じ ID の事項は1つに重ね、どれかの断面に決定があれば待ちにしない。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { branchName, buildPhase, type Phase } from "./branch.mts";
import type { ResolvedConfig } from "./config.mts";
import { localSha, readFileAtRef } from "./git.mts";
import { LEDGER_FILE, ledgerPath, parseLedgerRecords, unitDirectories, type LedgerRecord, type OpenRecord } from "./ledger.mts";
import { buildDirName, type BuildRecord } from "./tasklist.mts";
import type { CycleContext } from "./workspace.mts";

export interface WaitingItem {
  id: string;
  /** 問いを記録した作業単位 */
  unit: string;
  summary: string;
  ask: string | null;
  /** 事項を見つけた断面（"worktree" か origin/<branch>） */
  source: string;
}

export interface WaitingBuild {
  id: string;
  /** 待っている事項の ID */
  waitingFor: string[];
}

export interface Waiting {
  items: WaitingItem[];
  builds: WaitingBuild[];
  /** 読めなかった断面と理由（判定は止めない。その断面の待ちが見えないだけ） */
  unavailable: string[];
}

/** すべてのビルドが待つ作業単位（ビルドの前のフェーズ） */
const BEFORE_BUILDS = ["plan", "architect", "create"];

function isWaitingOpen(open: OpenRecord): boolean {
  return open.type === "question" && open.who === "user" && open.when === "now";
}

/** その事項の答えを待つビルド: 問いを出したビルドと、推移的に依存するビルド。ビルドの前のフェーズなら全ビルド */
function waitingBuildsOf(unit: string, builds: BuildRecord[]): string[] {
  if (BEFORE_BUILDS.includes(unit)) return builds.map((build) => build.id);
  if (!unit.startsWith("build-")) return []; // close・patch を待つビルドは無い
  const origin = builds.find((build) => buildDirName(build.id) === unit);
  if (origin === undefined) return [];
  const found = new Set<string>([origin.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const build of builds) {
      if (found.has(build.id)) continue;
      if (build.dependsOn.some((dep) => found.has(dep))) {
        found.add(build.id);
        grew = true;
      }
    }
  }
  return builds.filter((build) => found.has(build.id)).map((build) => build.id);
}

export async function deriveWaiting(config: ResolvedConfig, cycle: CycleContext, builds: BuildRecord[]): Promise<Waiting> {
  const opens = new Map<string, { open: OpenRecord; source: string }>();
  const decided = new Set<string>();
  const unavailable: string[] = [];
  const take = (records: LedgerRecord[], source: string): void => {
    for (const record of records) {
      if (record.record === "decide") decided.add(record.id);
      else if (!opens.has(record.id)) opens.set(record.id, { open: record, source });
    }
  };

  // 作業ツリー（ファイルごとに読む。1つ壊れていても、ほかの断面の待ちは見せる）
  for (const directory of unitDirectories(cycle.directory)) {
    const path = join(cycle.directory, directory, LEDGER_FILE);
    if (!existsSync(path)) continue;
    try {
      take(parseLedgerRecords(readFileSync(path, "utf8"), path), "worktree");
    } catch (error) {
      unavailable.push(`作業ツリーの ${relative(config.repoRoot, path)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // architect と各ビルドの origin のブランチにある、その作業単位の記録
  const units: Phase[] = ["architect", ...builds.map((build) => buildPhase(build.id))];
  for (const unit of units) {
    const branch = branchName(config.branch, unit, cycle.name);
    const ref = `origin/${branch}`;
    if ((await localSha(config.repoRoot, ref)) === undefined) continue; // origin に無いブランチは読まない
    const path = relative(config.repoRoot, ledgerPath(cycle.directory, unit)).split("\\").join("/");
    const file = await readFileAtRef(config.repoRoot, ref, path);
    if (file.state === "absent") continue;
    if (file.state === "unreadable" || file.content === undefined) {
      unavailable.push(`${ref} の ${path}: ${file.unavailable ?? "読めません"}`);
      continue;
    }
    try {
      take(parseLedgerRecords(file.content, `${ref}:${path}`), ref);
    } catch (error) {
      unavailable.push(`${ref} の ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const items: WaitingItem[] = [...opens.values()]
    .filter(({ open }) => isWaitingOpen(open) && !decided.has(open.id))
    .map(({ open, source }) => ({ id: open.id, unit: open.unit, summary: open.summary, ask: open.ask ?? null, source }));

  const waitingFor = new Map<string, string[]>();
  for (const item of items) {
    for (const id of waitingBuildsOf(item.unit, builds)) waitingFor.set(id, [...(waitingFor.get(id) ?? []), item.id]);
  }
  const waitingBuilds = builds
    .filter((build) => waitingFor.has(build.id))
    .map((build) => ({ id: build.id, waitingFor: waitingFor.get(build.id) as string[] }));
  return { items, builds: waitingBuilds, unavailable };
}

/** テキストの節（next・conductor waiting）。待ちが無ければ空 */
export function waitingLines(waiting: Waiting, builds: BuildRecord[]): string[] {
  if (waiting.builds.length === 0 && waiting.items.length === 0) return [];
  const summaryOf = (id: string): string => waiting.items.find((item) => item.id === id)?.summary ?? "";
  const lines = ["答えを待っているビルド:"];
  if (waiting.builds.length === 0) lines.push("  （なし）");
  for (const build of waiting.builds) {
    const title = builds.find((entry) => entry.id === build.id)?.title ?? "";
    lines.push(`  ${buildDirName(build.id)}  ${title}  待っている問い: ${build.waitingFor.map((id) => `${id}（${summaryOf(id)}）`).join(", ")}`);
  }
  const unattached = waiting.items.filter((item) => !waiting.builds.some((build) => build.waitingFor.includes(item.id)));
  for (const item of unattached) lines.push(`  ${item.unit} の問い ${item.id}（${item.summary}）: 待っているビルドはありません`);
  return lines;
}
