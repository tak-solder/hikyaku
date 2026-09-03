/**
 * cycles.md の読み書き。
 *
 * サイクルレベルの状態はすべてここに集約する。status はサイクルの生涯で
 * 2回しか変わらない（create で active、close で closed）ため、分散させる理由がない。
 *
 * hikyaku 列には「作成時のバージョン」を記録する。ディレクトリレイアウトや
 * ファイル形式は作成時に決まるので、それを解釈するために必要。以後は更新しない。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HikyakuError } from "./errors.mts";
import { findTableByHeaders, renderTable } from "./markdown.mts";

/** 保存する状態は3値だけ。フェーズは導出するので持たない */
export type CycleStatus = "active" | "closed" | "abandoned";
export const CYCLE_STATUSES: CycleStatus[] = ["active", "closed", "abandoned"];

export const CYCLES_HEADERS = [
  "ID",
  "slug",
  "status",
  "profile",
  "hikyaku",
  "チケット",
  "依存",
  "開始",
  "完了",
  "要約",
];

export interface CycleRecord {
  id: string;
  slug: string;
  status: CycleStatus;
  profile: string;
  /** 作成時の Hikyaku バージョン */
  hikyaku: string;
  ticket: string;
  /** 依存するサイクルの ID。サイクルレベルに留める（ビルドレベルは持たない） */
  dependsOn: string[];
  started: string;
  finished: string;
  summary: string;
}

/** ディレクトリ名 = {ID}-{slug} */
export function cycleDirName(record: Pick<CycleRecord, "id" | "slug">): string {
  return `${record.id}-${record.slug}`;
}

export function cycleDir(hikyakuRoot: string, record: Pick<CycleRecord, "id" | "slug">): string {
  return join(hikyakuRoot, "cycles", cycleDirName(record));
}

export function cyclesPath(hikyakuRoot: string): string {
  return join(hikyakuRoot, "cycles.md");
}

const EMPTY_CELLS = new Set(["", "—", "-"]);

function cellText(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return EMPTY_CELLS.has(trimmed) ? "" : trimmed;
}

export function parseCycles(source: string): CycleRecord[] {
  const table = findTableByHeaders(source, CYCLES_HEADERS);
  if (!table) {
    throw new HikyakuError(
      "cycles.md に想定するテーブルが見つかりません",
      `見出しを次の並びにしてください: | ${CYCLES_HEADERS.join(" | ")} |`,
    );
  }

  return table.rows
    .map((row) => {
      const rawStatus = cellText(row[2]);
      const status = (CYCLE_STATUSES as string[]).includes(rawStatus)
        ? (rawStatus as CycleStatus)
        : "active";
      return {
        id: cellText(row[0]),
        slug: cellText(row[1]),
        status,
        profile: cellText(row[3]),
        hikyaku: cellText(row[4]),
        ticket: cellText(row[5]),
        dependsOn: cellText(row[6])
          .split(/[,、]/)
          .map((item) => item.trim())
          .filter((item) => item !== ""),
        started: cellText(row[7]),
        finished: cellText(row[8]),
        summary: cellText(row[9]),
      };
    })
    .filter((record) => record.id !== "");
}

export function loadCycles(hikyakuRoot: string): CycleRecord[] {
  const path = cyclesPath(hikyakuRoot);
  if (!existsSync(path)) {
    throw new HikyakuError(
      `cycles.md が見つかりません: ${path}`,
      "/hikyaku:init を実行して生成してください。",
    );
  }
  return parseCycles(readFileSync(path, "utf8"));
}

function toRow(record: CycleRecord): string[] {
  const dash = (value: string): string => (value === "" ? "—" : value);
  return [
    record.id,
    record.slug,
    record.status,
    dash(record.profile),
    dash(record.hikyaku),
    dash(record.ticket),
    record.dependsOn.length > 0 ? record.dependsOn.join(", ") : "—",
    dash(record.started),
    dash(record.finished),
    dash(record.summary),
  ];
}

/** cycles.md の全文を生成する（本文の説明は固定） */
export function renderCyclesFile(records: CycleRecord[]): string {
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  return [
    "# サイクル一覧",
    "",
    "このリポジトリで実施した / 実施中のサイクルの索引です。",
    "並行サイクルの検出はこのファイルを起点に行います。",
    "",
    "| 列 | 意味 |",
    "| --- | --- |",
    "| `status` | `active` 進行中 / `closed` 永続ドキュメントへの昇格まで完了 / `abandoned` 中止 |",
    "| `profile` | サイクル作成時に選択した profile（light / saving / standard / strict） |",
    "| `hikyaku` | 作成時の Hikyaku バージョン。ディレクトリ構造の解釈に使う。以後更新しない |",
    "| `依存` | 依存するサイクルの ID。依存が満たされた = そのサイクルが `closed` |",
    "",
    renderTable(CYCLES_HEADERS, sorted.map(toRow)),
    "",
  ].join("\n");
}

/** 次のサイクル ID（3桁ゼロ埋め） */
export function nextCycleId(records: CycleRecord[]): string {
  const max = records.reduce((acc, record) => {
    const value = Number.parseInt(record.id, 10);
    return Number.isInteger(value) ? Math.max(acc, value) : acc;
  }, 0);
  return String(max + 1).padStart(3, "0");
}

/** slug に使える文字へ正規化する（ブランチ名の解析を壊さないため） */
export function normalizeSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug === "") {
    throw new HikyakuError(
      `slug に使える文字が含まれていません: ${raw}`,
      "英数字とハイフンで指定してください（例: billing, user-auth）。",
    );
  }
  return slug;
}
