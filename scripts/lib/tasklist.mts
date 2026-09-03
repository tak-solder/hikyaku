/**
 * tasklist.md の読み書きと依存グラフ。
 *
 * ビルドの完了判定は PR 列が非空かどうかだけで行う。status 列は持たない。
 * PR 列の更新は当該ビルドの PR に同梱されるため、main 上で PR 列が埋まって
 * いること自体が「マージ済み = 完了」を意味する。status 列を別に持つと
 * 「status は done だが PR 列が空」という嘘の状態が作れてしまう。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HikyakuError } from "./errors.mts";
import { findTableByHeaders, renderTable } from "./markdown.mts";

export const TASKLIST_HEADERS = ["buildID", "title", "BP", "dependencies", "issue", "PR"];

export interface BuildRecord {
  id: string;
  title: string;
  bp: number | undefined;
  dependsOn: string[];
  issue: string;
  pr: string;
}

const EMPTY_CELLS = new Set(["", "—", "-"]);

function cellText(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return EMPTY_CELLS.has(trimmed) ? "" : trimmed;
}

export function tasklistPath(cycleDirectory: string): string {
  return join(cycleDirectory, "tasklist.md");
}

export function parseTasklist(source: string): BuildRecord[] {
  const table = findTableByHeaders(source, TASKLIST_HEADERS);
  if (!table) {
    throw new HikyakuError(
      "tasklist.md に想定するテーブルが見つかりません",
      `見出しを次の並びにしてください: | ${TASKLIST_HEADERS.join(" | ")} |`,
    );
  }

  return table.rows
    .map((row) => {
      const bpText = cellText(row[2]);
      const bp = Number.parseInt(bpText, 10);
      return {
        id: cellText(row[0]),
        title: cellText(row[1]),
        bp: Number.isInteger(bp) ? bp : undefined,
        dependsOn: cellText(row[3])
          .split(/[,、]/)
          .map((item) => item.trim().replace(/^build-/, "").replace(/^0+(?=\d)/, ""))
          .filter((item) => item !== ""),
        issue: cellText(row[4]),
        pr: cellText(row[5]),
      };
    })
    .filter((record) => record.id !== "");
}

export function loadTasklist(cycleDirectory: string): BuildRecord[] {
  const path = tasklistPath(cycleDirectory);
  if (!existsSync(path)) return [];
  return parseTasklist(readFileSync(path, "utf8"));
}

/** ビルドが完了しているか。判定は PR 列が非空かどうかの一点 */
export function isComplete(build: BuildRecord): boolean {
  return build.pr !== "";
}

export function buildDirName(id: string): string {
  return `build-${id.padStart(2, "0")}`;
}

function toRow(build: BuildRecord): string[] {
  const dash = (value: string): string => (value === "" ? "—" : value);
  return [
    build.id,
    build.title,
    build.bp === undefined ? "—" : String(build.bp),
    build.dependsOn.length > 0 ? build.dependsOn.join(", ") : "—",
    dash(build.issue),
    dash(build.pr),
  ];
}

/** 依存グラフの Mermaid 表現。tasklist の dependencies 列と常に一致させる */
export function renderGraph(builds: BuildRecord[]): string {
  const lines = ["```mermaid", "graph TD"];
  for (const build of builds) {
    const label = `${buildDirName(build.id)}: ${build.title}`.replace(/"/g, "'");
    lines.push(`  ${nodeId(build.id)}["${label}"]`);
  }
  for (const build of builds) {
    for (const dep of build.dependsOn) {
      lines.push(`  ${nodeId(dep)} --> ${nodeId(build.id)}`);
    }
  }
  lines.push("```");
  return lines.join("\n");
}

function nodeId(id: string): string {
  return `b${id.padStart(2, "0")}`;
}

/** tasklist.md の全文を生成する */
export function renderTasklistFile(cycle: string, builds: BuildRecord[]): string {
  const sorted = [...builds].sort((a, b) => Number(a.id) - Number(b.id));
  return [
    `# ビルド一覧 — ${cycle}`,
    "",
    "ビルドの完了判定は `PR` 列が非空かどうかで行います。",
    "`PR` 列の更新は当該ビルドの PR に同梱されるため、デフォルトブランチ上で",
    "`PR` 列が埋まっていること自体がマージ済みを意味します。",
    "",
    "依存関係のあるビルドは、先行ビルドがデフォルトブランチにマージ済みであることが必須です。",
    "依存関係がないビルドは並行実行できます。",
    "",
    renderTable(TASKLIST_HEADERS, sorted.map(toRow)),
    "",
    "## 依存グラフ",
    "",
    renderGraph(sorted),
    "",
  ].join("\n");
}

export interface GraphProblem {
  message: string;
}

/** 依存グラフの整合性を検証する（存在しない依存・循環） */
export function validateGraph(builds: BuildRecord[]): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const ids = new Set(builds.map((b) => b.id));

  for (const build of builds) {
    for (const dep of build.dependsOn) {
      if (!ids.has(dep)) {
        problems.push({ message: `build-${build.id} の依存 build-${dep} が存在しません` });
      }
      if (dep === build.id) {
        problems.push({ message: `build-${build.id} が自分自身に依存しています` });
      }
    }
  }

  for (const cycle of findCycles(builds)) {
    problems.push({
      message: `依存グラフに循環があります: ${cycle.map((id) => `build-${id}`).join(" → ")}`,
    });
  }

  return problems;
}

/** 深さ優先探索で循環を検出する */
function findCycles(builds: BuildRecord[]): string[][] {
  const edges = new Map(builds.map((b) => [b.id, b.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const found: string[][] = [];
  const stack: string[] = [];

  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") {
      const start = stack.indexOf(id);
      found.push([...stack.slice(start), id]);
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (edges.has(next)) visit(next);
    }
    stack.pop();
    state.set(id, "done");
  };

  for (const build of builds) visit(build.id);
  return found;
}

/**
 * 着手可能なビルドを返す。
 * 依存するビルドがすべて完了（PR 列が非空）していることが条件。
 */
export function readyBuilds(builds: BuildRecord[]): BuildRecord[] {
  const byId = new Map(builds.map((b) => [b.id, b]));
  return builds.filter((build) => {
    if (isComplete(build)) return false;
    return build.dependsOn.every((dep) => {
      const target = byId.get(dep);
      return target !== undefined && isComplete(target);
    });
  });
}

/** 依存が満たされておらず待機中のビルド */
export function blockedBuilds(builds: BuildRecord[]): BuildRecord[] {
  const ready = new Set(readyBuilds(builds).map((b) => b.id));
  return builds.filter((build) => !isComplete(build) && !ready.has(build.id));
}

export function nextBuildId(builds: BuildRecord[]): string {
  const max = builds.reduce((acc, build) => {
    const value = Number.parseInt(build.id, 10);
    return Number.isInteger(value) ? Math.max(acc, value) : acc;
  }, 0);
  return String(max + 1);
}
