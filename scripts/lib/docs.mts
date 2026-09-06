/**
 * document-guide.md の解析と検証。
 *
 * document-guide は「どの永続ドキュメントが、どこに、誰の管理で存在するか」を
 * 宣言する唯一の場所。設定ファイル（TOML）ではなくドキュメントにしたのは:
 *
 *   1. 「意図的に持たない」を表現できる（キー欠落では未設定と区別できない）
 *   2. 概要欄があることで、必要なものだけを選んで読める
 *   3. AGENTS.md から参照させれば Hikyaku 以外のセッションからも使える
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { HikyakuError } from "./errors.mts";
import { findTableByHeaders } from "./markdown.mts";

/** Hikyaku が管理を担えるかどうか */
export type DocOwnership = "hikyaku" | "repo" | "未作成" | "対象外";

export const OWNERSHIP_VALUES: DocOwnership[] = ["hikyaku", "repo", "未作成", "対象外"];

/**
 * 採用レベル。
 *   required — 同等のリポジトリ固有ドキュメントがあれば代替可。なければ Hikyaku が作る
 *   optional — あれば利用するが、なくても Hikyaku は作らない
 */
export type DocLevel = "required" | "optional";

export interface DocDefinition {
  name: string;
  level: DocLevel;
  purpose: string;
  /** Hikyaku が新規作成する場合の既定パス（HIKYAKU_ROOT からの相対ではなくリポジトリ相対） */
  suggestedPath: string;
}

/**
 * 永続ドキュメントの定義。
 *
 * tech-stack / db-schema / interfaces が optional なのは、これらの正がコード側
 * （lockfile / マイグレーション / OpenAPI）にあるため。Hikyaku は作らないが、
 * リポジトリにあれば俯瞰の手がかりとして読む。
 */
export const DOC_DEFINITIONS: DocDefinition[] = [
  {
    name: "overview",
    level: "required",
    purpose: "システムの責務・境界・データフローと、正がどこにあるかのポインタ",
    suggestedPath: "docs/overview.md",
  },
  {
    name: "decisions",
    level: "required",
    purpose: "設計判断（ADR）。コードから復元できない唯一の情報",
    suggestedPath: "docs/adr/",
  },
  {
    name: "constraints",
    level: "required",
    purpose: "性能・可用性・セキュリティ・互換性などの制約",
    suggestedPath: "docs/constraints.md",
  },
  {
    name: "learnings",
    level: "required",
    purpose: "再現条件が明確な落とし穴と回避策",
    suggestedPath: "docs/learnings.md",
  },
  {
    name: "conventions",
    level: "required",
    purpose: "コーディング規約。AI が自動で読む AGENTS.md が既定のマップ先",
    suggestedPath: "AGENTS.md",
  },
  {
    name: "glossary",
    level: "optional",
    purpose: "ドメイン用語集。人間が権威を持って定義したものだけが価値を持つ",
    suggestedPath: "docs/glossary.md",
  },
  {
    name: "test-strategy",
    level: "optional",
    purpose: "テスト方針。conventions に含めても成立する",
    suggestedPath: "docs/test-strategy.md",
  },
  {
    name: "security-model",
    level: "optional",
    purpose: "認証認可方式・信頼境界。原則は constraints に統合し、肥大化時のみ分離",
    suggestedPath: "docs/security-model.md",
  },
  {
    name: "tech-stack",
    level: "optional",
    purpose: "参考。正は lockfile / マニフェスト",
    suggestedPath: "docs/tech-stack.md",
  },
  {
    name: "db-schema",
    level: "optional",
    purpose: "参考。正はマイグレーション",
    suggestedPath: "docs/db-schema.md",
  },
  {
    name: "interfaces",
    level: "optional",
    purpose: "参考。正は OpenAPI / 型定義",
    suggestedPath: "docs/interfaces.md",
  },
];

export interface DocEntry {
  name: string;
  ownership: DocOwnership;
  /** リポジトリルートからの相対パス。ownership が 未作成/対象外 のときは undefined */
  path: string | undefined;
  summary: string;
  definition: DocDefinition | undefined;
}

export const GUIDE_HEADERS = ["論理名", "管理", "パス", "概要"];

export function guidePath(hikyakuRoot: string): string {
  return join(hikyakuRoot, "document-guide.md");
}

/** セル中の `path` / [text](path) / 素のパス からパス文字列を取り出す */
function extractPath(cell: string): string | undefined {
  const trimmed = cell.trim();
  if (trimmed === "" || trimmed === "—" || trimmed === "-") return undefined;
  const link = /\[[^\]]*\]\(([^)]+)\)/.exec(trimmed);
  if (link?.[1]) return link[1];
  const code = /`([^`]+)`/.exec(trimmed);
  if (code?.[1]) return code[1];
  return trimmed;
}

export function parseGuide(source: string): DocEntry[] {
  const table = findTableByHeaders(source, GUIDE_HEADERS);
  if (!table) {
    throw new HikyakuError(
      "document-guide.md に想定するテーブルが見つかりません",
      `1行目の見出しを次の並びにしてください: | ${GUIDE_HEADERS.join(" | ")} |`,
    );
  }

  return table.rows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const name = (row[0] ?? "").replace(/`/g, "").trim();
      const rawOwnership = (row[1] ?? "").trim();
      // 未知の値を黙って「対象外」に落とすと、タイプミスひとつで登録済みの
      // ドキュメントが索引からも昇格対象からも静かに消える。誤りは報告する
      if (!(OWNERSHIP_VALUES as string[]).includes(rawOwnership)) {
        throw new HikyakuError(
          `document-guide.md の管理列が不正です: ${JSON.stringify(rawOwnership)}（${name || "名前なし"}）`,
          `使用できる値: ${OWNERSHIP_VALUES.join(" | ")}`,
        );
      }
      const ownership = rawOwnership as DocOwnership;
      return {
        name,
        ownership,
        path: ownership === "hikyaku" || ownership === "repo" ? extractPath(row[2] ?? "") : undefined,
        summary: (row[3] ?? "").trim(),
        definition: DOC_DEFINITIONS.find((d) => d.name === name),
      };
    });
}

export function loadGuide(hikyakuRoot: string): DocEntry[] {
  const path = guidePath(hikyakuRoot);
  if (!existsSync(path)) {
    throw new HikyakuError(
      `document-guide.md が見つかりません: ${path}`,
      "/hikyaku:init を実行して生成してください。存在しなければ Hikyaku は動作しません。",
    );
  }
  return parseGuide(readFileSync(path, "utf8"));
}

export interface GuideProblem {
  entry: string;
  message: string;
}

/** guide の内容を検証する。ポインタの陳腐化を機械検出できるのがこの仕組みの利点 */
export function validateGuide(entries: DocEntry[], repoRoot: string): GuideProblem[] {
  const problems: GuideProblem[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.name === "") {
      problems.push({ entry: "(空)", message: "論理名が空の行があります" });
      continue;
    }
    if (seen.has(entry.name)) {
      problems.push({ entry: entry.name, message: "論理名が重複しています" });
    }
    seen.add(entry.name);

    if (!entry.definition) {
      problems.push({
        entry: entry.name,
        message: `未知の論理名です。使用できるのは: ${DOC_DEFINITIONS.map((d) => d.name).join(", ")}`,
      });
      continue;
    }

    if (entry.ownership === "hikyaku" || entry.ownership === "repo") {
      if (entry.path === undefined) {
        problems.push({ entry: entry.name, message: `管理が ${entry.ownership} ですがパスが空です` });
        continue;
      }
      const absolute = isAbsolute(entry.path) ? entry.path : resolve(repoRoot, entry.path);
      if (!existsSync(absolute)) {
        problems.push({ entry: entry.name, message: `パスが存在しません: ${entry.path}` });
      }
    }

    if (entry.ownership === "対象外" && entry.summary === "") {
      problems.push({
        entry: entry.name,
        message: "対象外の理由を概要欄に記載してください（意図的に持たないことを残すため）",
      });
    }
  }

  for (const definition of DOC_DEFINITIONS) {
    if (definition.level === "required" && !seen.has(definition.name)) {
      problems.push({
        entry: definition.name,
        message: "必要なドキュメントの行がありません（未作成 / 対象外 でも行は必要です）",
      });
    }
  }

  return problems;
}

/** AGENTS.md に埋め込む索引ブロックの本文を生成する */
export function renderIndexBlock(entries: DocEntry[]): string {
  const listed = entries.filter(
    (entry) => (entry.ownership === "hikyaku" || entry.ownership === "repo") && entry.path,
  );

  const lines = ["## 設計ドキュメント", ""];
  if (listed.length === 0) {
    lines.push("（document-guide.md に登録された永続ドキュメントはまだありません）");
  } else {
    for (const entry of listed) {
      const summary = entry.summary === "" ? "" : ` — ${entry.summary}`;
      lines.push(`- ${entry.name}: \`${entry.path}\`${summary}`);
    }
  }
  lines.push(
    "",
    "この一覧は Hikyaku が document-guide.md から生成しています（`hikyaku docs link`）。",
    "編集は document-guide.md 側で行ってください。",
  );
  return lines.join("\n");
}
