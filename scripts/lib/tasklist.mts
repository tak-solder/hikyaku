/**
 * tasklist.md の読み書きと依存グラフ。
 *
 * ビルドの完了は、そのビルドの完了の記録（build-NN/progress.jsonl の builder の pr の done。
 * --pr に作った PR が添えてある）から導く。status 列は持たない。記録は当該ビルドの PR に同梱されるため、
 * main 上に記録が在ること自体が「マージ済み = 完了」を意味する。
 *
 * PR 列は close-cycle（cycle close）がまとめて埋める、サイクルを締めたあとの一覧。サイクルの途中は書かない。
 * 表は行のあいだに空行を挟めないので、並行するビルドの PR が隣り合う行の PR 列を埋めると、
 * Git は必ずコンフリクトにする。記録はビルドごとのファイルにあるので、並行してもぶつからない。
 * PR 列が埋まっていれば（close-cycle の後や、この形より前のサイクル）、それも完了として読む。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HikyakuError } from "./errors.mts";
import { findTableByHeaders, renderTable } from "./markdown.mts";
import { PROGRESS_FILE, readProgress, type ProgressEvent } from "./progress.mts";
import { formatRef } from "./refs.mts";
import { formatK, parseTokenAmount } from "./tokens.mts";

export const TASKLIST_HEADERS = ["buildID", "title", "予測ピーク", "dependencies", "PR"];

/**
 * v3 のベータ版までの見出し（issue 列あり）。ビルドごとの外部起票を廃止したので列は使わない。
 * 読めるようにし、書き込むときに列を落とす
 */
export const ISSUE_COLUMN_TASKLIST_HEADERS = ["buildID", "title", "予測ピーク", "dependencies", "issue", "PR"];

/**
 * v2 の tasklist.md の見出し（3列目が BP）。読むことはできるが、BP は予測ピークではないので
 * 値は読まない。書き込むと BP の列が消えるので、書き込みは止める（workspace.mts）
 */
export const LEGACY_TASKLIST_HEADERS = ["buildID", "title", "BP", "dependencies", "issue", "PR"];

export interface BuildRecord {
  id: string;
  title: string;
  /** architect 段階の予測ピーク（トークン） */
  peak: number | undefined;
  dependsOn: string[];
  /** 完了したビルドの PR（PR 列か完了の記録）。空なら未完了 */
  pr: string;
  /**
   * pr を完了の記録（progress.jsonl）から読んだ。PR 列には書かない（並行するビルドの PR がコンフリクトしないよう、
   * PR 列は close-cycle がまとめて埋める）。無ければ PR 列から読んだか未完了
   */
  prSource?: "record";
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

/** v2 の見出し（BP 列）の tasklist.md か */
export function isLegacyTasklist(source: string): boolean {
  return (
    findTableByHeaders(source, TASKLIST_HEADERS) === undefined &&
    findTableByHeaders(source, ISSUE_COLUMN_TASKLIST_HEADERS) === undefined &&
    findTableByHeaders(source, LEGACY_TASKLIST_HEADERS) !== undefined
  );
}

export function parseTasklist(source: string): BuildRecord[] {
  const legacy = isLegacyTasklist(source);
  const table = legacy
    ? findTableByHeaders(source, LEGACY_TASKLIST_HEADERS)
    : (findTableByHeaders(source, TASKLIST_HEADERS) ?? findTableByHeaders(source, ISSUE_COLUMN_TASKLIST_HEADERS));
  if (!table) {
    throw new HikyakuError(
      "tasklist.md に想定するテーブルが見つかりません",
      `見出しを次の並びにしてください: | ${TASKLIST_HEADERS.join(" | ")} |`,
    );
  }

  // PR 列の位置。issue 列のある見出し（v2 と v3 のベータ版）では1つ右にある
  const prColumn = table.headers[4] === "issue" ? 5 : 4;
  return table.rows
    .map((row) => {
      return {
        id: normalizeBuildId(cellText(row[0])),
        title: cellText(row[1]),
        peak: legacy ? undefined : parseTokenAmount(cellText(row[2])),
        dependsOn: cellText(row[3])
          .split(/[,、]/)
          .map((item) => normalizeBuildId(item))
          .filter((item) => item !== ""),
        pr: cellText(row[prColumn]),
      };
    })
    .filter((record) => record.id !== "");
}

/** 作業ツリーの tasklist.md と、各ビルドの完了の記録を読む */
export function loadTasklist(cycleDirectory: string): BuildRecord[] {
  const path = tasklistPath(cycleDirectory);
  if (!existsSync(path)) return [];
  return withRecordedPrs(parseTasklist(readFileSync(path, "utf8")), (id) => readProgress(join(cycleDirectory, buildDirName(id))));
}

/** ビルドの完了の記録（progress.jsonl）のサイクルのディレクトリからの相対パス */
export function completionRecordPath(id: string): string {
  return `${buildDirName(id)}/${PROGRESS_FILE}`;
}

/**
 * 完了の記録から読んだ PR（`[#12](URL)` の形）。builder の pr の done のうち、--pr を添えた最後のもの。
 * step restart より前の記録も数える（PR 列と同じく、一度作った PR は完了のまま）。無ければ undefined
 */
export function recordedPr(events: ProgressEvent[]): string | undefined {
  const done = events.findLast((event) => event.skill === "builder" && event.step === "pr" && event.result === "done" && event.pr !== undefined);
  return done?.pr === undefined ? undefined : formatRef(done.pr, "PR");
}

/** PR 列が空のビルドに、完了の記録の PR を補う。eventsOf はそのビルドの記録を返す（読めなければ投げる） */
export function withRecordedPrs(builds: BuildRecord[], eventsOf: (id: string) => ProgressEvent[]): BuildRecord[] {
  return builds.map((build) => {
    if (build.pr !== "") return build;
    const pr = recordedPr(eventsOf(build.id));
    return pr === undefined ? build : { ...build, pr, prSource: "record" };
  });
}

/** 完了の記録から読んだ PR を PR 列に書く形にする（cycle close がサイクルを締めるときに使う） */
export function fillPrColumn(builds: BuildRecord[]): BuildRecord[] {
  return builds.map((build) => {
    if (build.prSource !== "record") return build;
    const { prSource: _recorded, ...rest } = build;
    return rest;
  });
}

/** ビルドが完了しているか。判定は PR（PR 列か完了の記録）が非空かどうかの一点 */
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
    formatK(build.peak),
    build.dependsOn.length > 0 ? build.dependsOn.join(", ") : "—",
    // 完了の記録から読んだ PR は書かない（PR 列は close-cycle がまとめて埋める）
    dash(build.prSource === "record" ? "" : build.pr),
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

/** 図の凡例。グラフの色と STATE_STYLES を対応づける */
export const GRAPH_LEGEND = "紫: 完了（merged） / 緑: 着手可能（ready） / グレー: 待機中（blocked）。点線は先行ビルドが未完了の依存";

/**
 * 依存グラフの Mermaid 表現。辺は推移的簡約をかけたもので、
 * tasklist の dependencies 列（宣言された直接依存）と到達可能性が一致する。
 * ノードは状態（完了 / 着手可能 / 待機中）で色分けし、先行ビルドが未完了の依存線は点線にする。
 *
 * どの行も、1つのビルドの完了だけで決まるように書く。`done` は当該ビルドの PR に入るので、
 * 複数のビルドの状態を1行にまとめると（`class b01,b02 ready` や `linkStyle 0,1,2`）、
 * 並行するビルドの PR 同士が必ずコンフリクトする。
 *
 *   - ビルドごとのブロックに分け、空行で区切る（隣り合う行の変更は Git が自動でマージできないため）
 *   - 完了は自分のノードの行に付ける（`:::merged`）
 *   - 待機中は、未完了の先行ビルドが自分のブロックの線に付ける（`-.-> b04:::blocked`）
 *   - 着手可能は誰も書かない。何も付いていない未完了ノードの既定の色（`classDef default`）にする
 *
 * 着手可能は「すべての依存が完了」で決まり、1つのビルドの PR からは書けない。先行ビルドの線が
 * 1本ずつ実線になり、`blocked` を付ける線が無くなったときに既定の色へ戻る形にすると、
 * 先行ビルドが並行してマージされても、マージ結果の図が正しくなる
 */
export function renderGraph(builds: BuildRecord[]): string {
  const byId = new Map(builds.map((b) => [b.id, b]));
  const edges = graphEdges(builds);
  const edgeLine = (from: string, to: string): string => {
    const source = byId.get(from);
    return source !== undefined && isComplete(source)
      ? `  ${nodeId(from)} --> ${nodeId(to)}`
      : `  ${nodeId(from)} -.-> ${nodeId(to)}:::blocked`;
  };

  const lines = [
    "```mermaid",
    "graph TD",
    `  classDef default ${STATE_STYLES.ready}`,
    `  classDef blocked ${STATE_STYLES.blocked}`,
    `  classDef merged ${STATE_STYLES.merged}`,
  ];
  for (const build of builds) {
    const label = `${buildDirName(build.id)}: ${build.title}`.replace(/"/g, "'");
    lines.push("", `  ${nodeId(build.id)}["${label}"]${isComplete(build) ? ":::merged" : ""}`);
    // 存在しない先行ビルドからの線は、書き換える持ち主がいないので後続のブロックに置く
    for (const [from, to] of edges) {
      if (to === build.id && !byId.has(from)) lines.push(edgeLine(from, to));
    }
    for (const [from, to] of edges) {
      if (from === build.id) lines.push(edgeLine(from, to));
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
    "ビルドの完了は、各ビルドの完了の記録（`build-NN/progress.jsonl`）から判定します。",
    "記録は当該ビルドの PR に同梱されるため、デフォルトブランチ上に記録が在ること自体が",
    "マージ済みを意味します。依存グラフの色は記録から描き直されます。",
    "`PR` 列はサイクルを締めるときにまとめて埋まります（並行するビルドの PR がコンフリクトしないよう、途中では書きません）。",
    "",
    "依存関係のあるビルドは、先行ビルドの成果がこのブランチの履歴に在ることが着手の条件です。",
    "依存関係がないビルドは並行実行できます。",
    "",
    renderTable(TASKLIST_HEADERS, sorted.map(toRow), { raggedLastColumn: true }),
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
