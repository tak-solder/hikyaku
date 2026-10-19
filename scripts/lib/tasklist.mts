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

/**
 * buildID を正規化する（`build-` 接頭辞とゼロ埋めを剥がす）。
 * buildID 列と dependencies 列で正規化が食い違うと、
 * 「build-02 の依存 build-01 が存在しません」のような自己矛盾した検証結果になる。
 */
export function normalizeBuildId(raw: string): string {
  const stripped = raw.trim().replace(/^build-/i, "").replace(/^0+(?=\d)/, "");
  return stripped;
}

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
        id: normalizeBuildId(cellText(row[0])),
        title: cellText(row[1]),
        bp: Number.isInteger(bp) ? bp : undefined,
        dependsOn: cellText(row[3])
          .split(/[,、]/)
          .map((item) => normalizeBuildId(item))
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

/**
 * 図に描く辺（先行 → 後続）を返す。推移的簡約をかけ、他の依存を経由して到達できる辺は省く。
 * 例えば 1→2→3 があれば 1→3 は描かない。到達可能性は変わらないので、図の意味は同じまま辺だけが減る。
 * 循環があると簡約が一意に定まらないため、その間は宣言された依存をそのまま返す（validateGraph が別途報告する）。
 */
export function graphEdges(builds: BuildRecord[]): Array<[string, string]> {
  const declared = new Map(builds.map((b) => [b.id, b.dependsOn.filter((dep) => dep !== b.id)]));
  const cyclic = findCycles(builds).length > 0;

  // from から宣言された依存を辿って到達できる先行ビルド
  const ancestors = (from: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...(declared.get(from) ?? [])];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(declared.get(id) ?? []));
    }
    return seen;
  };

  const edges: Array<[string, string]> = [];
  for (const build of builds) {
    const deps = [...new Set(declared.get(build.id) ?? [])];
    for (const dep of deps) {
      const redundant = !cyclic && deps.some((other) => other !== dep && ancestors(other).has(dep));
      if (!redundant) edges.push([dep, build.id]);
    }
  }
  return edges;
}

/**
 * ビルドの状態ごとの Mermaid スタイル。配色は GitHub の PR に合わせる
 * （Merged は紫、Open は緑）。fill が淡色でも暗いテーマで読めるよう、文字色も指定する
 */
const STATE_STYLES = {
  merged: "fill:#fbefff,stroke:#8250df,color:#6639ba",
  ready: "fill:#dafbe1,stroke:#1a7f37,color:#116329",
  blocked: "fill:#f6f8fa,stroke:#8c959f,color:#57606a",
} as const;

/** 先行ビルドが未完了の依存線のスタイル */
const PENDING_EDGE_STYLE = "stroke:#8c959f,stroke-dasharray:5 5";

/** 図の凡例。グラフの色と STATE_STYLES を対応づける */
export const GRAPH_LEGEND = "紫: 完了（merged） / 緑: 着手可能（ready） / グレー: 待機中（blocked）。点線は先行ビルドが未完了の依存";

/**
 * 依存グラフの Mermaid 表現。辺は推移的簡約をかけたもので、
 * tasklist の dependencies 列（宣言された直接依存）と到達可能性が一致する。
 * ノードは状態（完了 / 着手可能 / 待機中）で色分けし、先行ビルドが未完了の依存線は点線にする
 */
export function renderGraph(builds: BuildRecord[]): string {
  const lines = ["```mermaid", "graph TD"];
  for (const build of builds) {
    const label = `${buildDirName(build.id)}: ${build.title}`.replace(/"/g, "'");
    lines.push(`  ${nodeId(build.id)}["${label}"]`);
  }

  const byId = new Map(builds.map((b) => [b.id, b]));
  const pendingEdges: number[] = [];
  graphEdges(builds).forEach(([from, to], index) => {
    const done = byId.get(from) !== undefined && isComplete(byId.get(from)!);
    lines.push(`  ${nodeId(from)} ${done ? "-->" : "-.->"} ${nodeId(to)}`);
    if (!done) pendingEdges.push(index);
  });

  const ready = new Set(readyBuilds(builds).map((b) => b.id));
  const groups: Record<keyof typeof STATE_STYLES, string[]> = { merged: [], ready: [], blocked: [] };
  for (const build of builds) {
    const state = isComplete(build) ? "merged" : ready.has(build.id) ? "ready" : "blocked";
    groups[state].push(nodeId(build.id));
  }
  for (const state of Object.keys(STATE_STYLES) as Array<keyof typeof STATE_STYLES>) {
    lines.push(`  classDef ${state} ${STATE_STYLES[state]}`);
  }
  for (const state of Object.keys(groups) as Array<keyof typeof groups>) {
    if (groups[state].length > 0) lines.push(`  class ${groups[state].join(",")} ${state}`);
  }
  if (pendingEdges.length > 0) lines.push(`  linkStyle ${pendingEdges.join(",")} ${PENDING_EDGE_STYLE}`);

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
    GRAPH_LEGEND,
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
        problems.push({
          message: `${buildDirName(build.id)} の依存 ${buildDirName(dep)} が存在しません`,
        });
      }
      if (dep === build.id) {
        problems.push({ message: `${buildDirName(build.id)} が自分自身に依存しています` });
      }
    }
  }

  for (const cycle of findCycles(builds)) {
    problems.push({
      message: `依存グラフに循環があります: ${cycle.map(buildDirName).join(" → ")}`,
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
