import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, succeeds, temporaryDirectory, workspace, write } from "./helpers.mts";
import { isAutoLoaded } from "../scripts/commands/context.mts";
import {
  docRef,
  githubAnchor,
  markdownAnchors,
  parseGuide,
  renderIndexBlock,
  validateGuide,
  type DocEntry,
} from "../scripts/lib/docs.mts";

const HEADER = "| 論理名 | 管理 | パス | 概要 |\n| --- | --- | --- | --- |\n";

function guide(rows: string[]): string {
  return HEADER + rows.join("\n") + "\n";
}

const REQUIRED = [
  "| overview | 未作成 | — | 概要 |",
  "| decisions | 未作成 | — | ADR |",
  "| constraints | 未作成 | — | 制約 |",
  "| conventions | 未作成 | — | 規約 |",
];

function entry(overrides: Partial<DocEntry>): DocEntry {
  return { name: "glossary", ownership: "repo", path: undefined, anchor: undefined, summary: "", definition: undefined, ...overrides };
}

test("parseGuide: アンカー付きのパスを path と anchor に分け、エンコードはデコードし、無ければ今と同じ", () => {
  const [glossary, conventions, encoded] = parseGuide(guide([
    "| glossary | repo | `docs/concepts.md#用語` | 用語集 |",
    "| conventions | repo | AGENTS.md | 規約 |",
    "| overview | repo | [x](docs/overview.md#%E8%B2%AC%E5%8B%99) | 概要 |",
  ]));
  assert.equal(glossary?.path, "docs/concepts.md");
  assert.equal(glossary?.anchor, "用語");
  assert.equal(conventions?.path, "AGENTS.md");
  assert.equal(conventions?.anchor, undefined);
  assert.equal(encoded?.path, "docs/overview.md");
  assert.equal(encoded?.anchor, "責務");
});

test("docRef: アンカーがあれば path#anchor、無ければ path、パスが無ければ undefined", () => {
  assert.equal(docRef({ path: "docs/concepts.md", anchor: "用語" }), "docs/concepts.md#用語");
  assert.equal(docRef({ path: "AGENTS.md", anchor: undefined }), "AGENTS.md");
  assert.equal(docRef({ path: undefined, anchor: undefined }), undefined);
});

test("githubAnchor: 小文字にし、空白を - にし、日本語は残し、- と _ 以外の記号は除く", () => {
  assert.equal(githubAnchor("Getting Started"), "getting-started");
  assert.equal(githubAnchor("設計の原則（v3）"), "設計の原則v3");
  assert.equal(githubAnchor("API v2.1 — snake_case-name!"), "api-v21--snake_case-name");
});

test("markdownAnchors: 見出しから集め、重複に -1 を付け、コードブロックの中は読まない", () => {
  const anchors = markdownAnchors([
    "# 概要",
    "## 用語",
    "```markdown",
    "## コードの中",
    "```",
    "## 用語",
    "### `config` の [書き方](x.md)",
  ].join("\n"));
  assert.deepEqual([...anchors], ["概要", "用語", "用語-1", "config-の-書き方"]);
});

test("markdownAnchors: setext と字下げした ATX の見出しを読み、囲みは同じ文字と長さでだけ閉じる", () => {
  const anchors = markdownAnchors([
    "Overview",
    "========",
    "",
    "  ## 字下げ",
    "",
    "- 箇条書き",
    "---",
    "````",
    "~~~",
    "## コードの中",
    "```",
    "## まだコードの中",
    "````",
    "## 囲みの後",
  ].join("\n"));
  assert.deepEqual([...anchors], ["overview", "字下げ", "囲みの後"]);
});

test("validateGuide: 実在する節は通し、消えた節・ディレクトリへのアンカーを報告し、存在はアンカーを除いて調べる", (t) => {
  const root = temporaryDirectory(t);
  write(root, "docs/concepts.md", "# 概念\n\n## 用語\n");
  write(root, "docs/adr/a.md", "# a\n");
  const check = (glossary: string): string[] =>
    validateGuide(parseGuide(guide([...REQUIRED, glossary])), root).map((problem) => problem.message);
  assert.deepEqual(check("| glossary | repo | `docs/concepts.md#用語` | 用語 |"), []);
  assert.match(check("| glossary | repo | `docs/concepts.md#定義` | 用語 |").join("\n"), /節が見つかりません: docs\/concepts\.md#定義/);
  assert.match(check("| glossary | repo | `docs/adr/#用語` | 用語 |").join("\n"), /アンカーはファイルにだけ/);
  assert.match(check("| glossary | repo | `docs/missing.md#用語` | 用語 |").join("\n"), /パスが存在しません: docs\/missing\.md$/m);
});

test("renderIndexBlock: 表示はアンカー付きで、載せるかはアンカーの有無で変わらない", () => {
  const withAnchor = [
    entry({ path: "docs/concepts.md", anchor: "用語", summary: "用語集" }),
    entry({ name: "overview", ownership: "未作成" }),
  ];
  const block = renderIndexBlock(withAnchor);
  assert.match(block, /^- glossary: `docs\/concepts\.md#用語` — 用語集$/m);
  assert.doesNotMatch(block, /overview/);
  const withoutAnchor = renderIndexBlock([entry({ path: "docs/concepts.md", summary: "用語集" }), withAnchor[1] as DocEntry]);
  assert.match(withoutAnchor, /^- glossary: `docs\/concepts\.md` — 用語集$/m);
});

test("isAutoLoaded: アンカーを除いたパスで判定する", () => {
  const [conventions] = parseGuide(guide(["| conventions | repo | `AGENTS.md#規約` | 規約 |"]));
  assert.equal(isAutoLoaded(conventions?.path), true);
});

function anchoredWorkspace(t: Parameters<typeof workspace>[0], withFile = true): string {
  const directory = workspace(t, true);
  if (withFile) write(directory, "docs/concepts.md", "# 概念\n\n## 用語\n");
  const path = join(directory, "docs/hikyaku/document-guide.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(/^\| glossary .*$/m, "| glossary | repo | `docs/concepts.md#用語` | 用語集 |"));
  return directory;
}

test("context: アンカー付きのパスで候補を返し、ファイルがあれば未作成にしない", (t) => {
  const directory = anchoredWorkspace(t);
  const output = JSON.parse(succeeds(directory, "context", "architect", "--json")) as {
    suggestions: { ref: string; path: string; file?: string }[];
    missingDocs: string[];
  };
  assert.equal(output.suggestions.find((s) => s.ref === "glossary")?.path, "docs/concepts.md#用語");
  assert.equal(output.suggestions.find((s) => s.ref === "glossary")?.file, "docs/concepts.md");
  assert.ok(!output.missingDocs.includes("glossary"));
});

test("context: アンカー付きでもファイルが無ければ未作成にする", (t) => {
  const directory = anchoredWorkspace(t, false);
  const output = JSON.parse(succeeds(directory, "context", "architect", "--json")) as {
    suggestions: { ref: string }[];
    missingDocs: string[];
  };
  assert.ok(!output.suggestions.some((s) => s.ref === "glossary"));
  assert.ok(output.missingDocs.includes("glossary"));
});

test("docs list はアンカー付きで表示し、docs validate は節の消失で失敗する", (t) => {
  const directory = anchoredWorkspace(t);
  assert.match(succeeds(directory, "docs", "list"), /docs\/concepts\.md#用語/);
  succeeds(directory, "docs", "validate");
  write(directory, "docs/concepts.md", "# 概念\n\n## 用語集\n");
  const result = cli(directory, "docs", "validate");
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /節が見つかりません/);
});
