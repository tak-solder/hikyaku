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

import { existsSync, readFileSync, statSync } from "node:fs";
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
 * ここに並べるのは「選んで読む文書」だけ。置き場は読み込まれ方で決める:
 * 一部のファイルにしか効かない知見はパス指定の rule、決まった手順はスキル、
 * 機械で防げるものはコード（lint・テスト・ヘルパー・その場のコメント）に置く。
 * 判定の基準は skills/close-cycle/references/persistence.md が正。
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
    purpose: "設計を縛る条件（性能・可用性・セキュリティ・互換性・外部サービスの上限）",
    suggestedPath: "docs/constraints.md",
  },
  {
    name: "conventions",
    level: "required",
    purpose: "リポジトリ全体に効く取り決め。AI が自動で読む AGENTS.md が既定のマップ先",
    suggestedPath: "AGENTS.md",
  },
  {
    name: "glossary",
    level: "optional",
    purpose: "ドメイン用語集。人間が権威を持って定義したものだけが価値を持つ",
    suggestedPath: "docs/glossary.md",
  },
];

/**
 * v3 で廃止した論理名と、中身の行き先。
 *
 * 黙って無視すると、登録済みの文書が読む候補からも昇格先からも静かに消える。
 * 未知の論理名と同じくエラーにし、行き先を添える。
 */
export const RETIRED_DOCS: Record<string, string> = {
  learnings:
    "落とし穴は重要度で振り分けます（機械で防ぐ / パス指定の rule / constraints / 書かない）",
  "test-strategy": "全体に効く方針は conventions へ、テストのファイルだけに効く注意はパス指定の rule へ",
  "security-model": "設計を縛る条件は constraints へ、構造は overview へ",
  "tech-stack": "正は lockfile / マニフェスト。overview にポインタを1行書けば足ります",
  "db-schema": "正はマイグレーション。overview にポインタを1行書けば足ります",
  interfaces: "正は OpenAPI / 型定義。overview にポインタを1行書けば足ります",
};

/** 廃止した論理名が残っているときの案内 */
export const RETIRED_HINT =
  "行を消すだけにせず、/hikyaku:init を実行して中身を振り分けてください（再発しても気づけない知見が混ざっていることがあります）";

export interface DocEntry {
  name: string;
  ownership: DocOwnership;
  /**
   * リポジトリルートからの相対パス（アンカーを除く）。ownership が 未作成/対象外 のときは undefined。
   * ファイルを開く・差分を取る呼び出し元はこれを使う。読む節を示すときは docRef で表示する
   */
  path: string | undefined;
  /** 節のアンカー（`#` の後ろ。デコード済み）。登録がファイル全体を指すなら undefined */
  anchor: string | undefined;
  summary: string;
  definition: DocDefinition | undefined;
}

/** AGENTS.md の索引ブロックのマーカー（docs link が書き込む） */
export const INDEX_MARKER = "hikyaku:docs";

/** HIKYAKU_ROOT 直下で改名したファイル。[旧名, 新名]。validate と init の step が残存を検出する */
export const RENAMED_FILES: [string, string][] = [["instruction.md", "instructions.md"]];

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

/** `docs/concepts.md#用語` をパスとアンカーに分ける。パーセントエンコードされたアンカーはデコードする */
function splitAnchor(raw: string | undefined): { path: string | undefined; anchor: string | undefined } {
  if (raw === undefined) return { path: undefined, anchor: undefined };
  const at = raw.indexOf("#");
  if (at === -1) return { path: raw, anchor: undefined };
  const path = raw.slice(0, at);
  const fragment = raw.slice(at + 1);
  let anchor = fragment;
  try {
    anchor = decodeURIComponent(fragment);
  } catch {
    // 読めないエンコードはそのまま比べる（validate が節の不一致として知らせる）
  }
  return { path: path === "" ? undefined : path, anchor: anchor === "" ? undefined : anchor };
}

/** 読む場所の表示（アンカー付き）。パスが無ければ undefined */
export function docRef(entry: Pick<DocEntry, "path" | "anchor">): string | undefined {
  if (entry.path === undefined) return undefined;
  return entry.anchor === undefined ? entry.path : `${entry.path}#${entry.anchor}`;
}

/**
 * 見出しから GitHub 式のアンカーを作る。小文字にし、文字・数字・`-`・`_`・空白以外を除き、空白を `-` にする。
 * 日本語などの文字はそのまま残る（GitHub と同じ）
 */
export function githubAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Markdown の見出しのアンカーの集合。ATX（`## 用語`。字下げ 3 つまで）と setext（下線の `===` / `---`）の
 * 見出しを読む。コードブロックの中は除き、同じアンカーには `-1` `-2` を付ける（GitHub と同じ）
 */
export function markdownAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  const add = (raw: string): void => {
    const text = raw.replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    const base = githubAnchor(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  };
  // 閉じるのは、開いたのと同じ文字で、同じ長さ以上の囲み（``` の中の ~~~ では閉じない）
  let fence: { char: string; length: number } | undefined;
  let previous: string | undefined;
  for (const line of source.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence !== undefined) {
      if (marker && (marker[1] as string)[0] === fence.char && (marker[1] as string).length >= fence.length && (marker[2] as string).trim() === "") {
        fence = undefined;
      }
      continue;
    }
    if (marker) {
      fence = { char: (marker[1] as string)[0] as string, length: (marker[1] as string).length };
      previous = undefined;
      continue;
    }
    const atx = /^ {0,3}#{1,6}(?:\s+(.*?))?\s*$/.exec(line);
    if (atx) {
      add((atx[1] ?? "").replace(/\s+#+$/, ""));
      previous = undefined;
      continue;
    }
    // setext: 段落の1行の直後の下線。箇条書き・表・引用の行は見出しにしない
    if (/^ {0,3}(=+|-+)\s*$/.test(line) && previous !== undefined && previous.trim() !== "" && !/^\s*([-*+>|]|\d+[.)])/.test(previous)) {
      add(previous.trim());
      previous = undefined;
      continue;
    }
    previous = line;
  }
  return anchors;
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
      const located = ownership === "hikyaku" || ownership === "repo" ? splitAnchor(extractPath(row[2] ?? "")) : undefined;
      return {
        name,
        ownership,
        path: located?.path,
        anchor: located?.anchor,
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
      const retired = RETIRED_DOCS[entry.name];
      problems.push({
        entry: entry.name,
        message:
          retired === undefined
            ? `未知の論理名です。使用できるのは: ${DOC_DEFINITIONS.map((d) => d.name).join(", ")}`
            : `v3 で廃止した論理名です。${retired}。${RETIRED_HINT}`,
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
      } else if (entry.anchor !== undefined) {
        // 節を指す登録は、見出しが改名・削除されると読む場所を失う。ファイルの存在だけでは気づけない
        if (!statSync(absolute).isFile()) {
          problems.push({ entry: entry.name, message: `アンカーはファイルにだけ付けられます: ${docRef(entry)}` });
        } else if (!markdownAnchors(readFileSync(absolute, "utf8")).has(githubAnchor(entry.anchor))) {
          problems.push({ entry: entry.name, message: `節が見つかりません: ${docRef(entry)}（見出しが改名・削除されていないか確かめてください）` });
        }
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
      lines.push(`- ${entry.name}: \`${docRef(entry)}\`${summary}`);
    }
  }
  lines.push(
    "",
    "この一覧は Hikyaku が document-guide.md から生成しています（`hikyaku docs link`）。",
    "編集は document-guide.md 側で行ってください。",
  );
  return lines.join("\n");
}
