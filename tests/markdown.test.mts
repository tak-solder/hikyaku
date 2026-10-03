import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTables, renderTable, replaceTable, upsertMarkerBlock } from "../scripts/lib/markdown.mts";

test("Markdown: エスケープされた | を含むセルを列ずれなく読み書きする", () => {
  const headers = ["title", "issue", "PR"];
  const rows = [["認証 | 認可", "[issue](./issue.md)", "—"]];
  const table = parseTables(renderTable(headers, rows))[0];
  assert.ok(table);
  assert.deepEqual(table.headers, headers);
  assert.deepEqual(table.rows, rows);
});

test("Markdown: 表の直後に続く | を含む本文は取り込まない", () => {
  const tables = parseTables("| ID | status |\n| --- | --- |\n| 001 | active |\n説明: active | closed\n");
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0]?.rows, [["001", "active"]]);
  assert.equal(tables[0]?.endLine, 2);
});

test("Markdown: テーブル差し替えで前後の手書き本文を保持する", () => {
  const source = "# 索引\n\n| ID |\n| --- |\n| 001 |\n\n手書きの注記\n";
  const table = parseTables(source)[0];
  assert.ok(table);
  const replacement = renderTable(["ID"], [["002"]]);
  assert.equal(replaceTable(source, table, replacement), `# 索引\n\n${replacement}\n\n手書きの注記\n`);
});

test("Markdown: マーカーブロック更新は冪等で前後の本文を保持する", () => {
  const source = "説明\n<!-- test:begin -->\n旧内容\n<!-- test:end -->\n注記\n";
  const updated = upsertMarkerBlock(source, "test", "新内容\n");
  assert.equal(updated.created, false);
  assert.equal(updated.content, "説明\n<!-- test:begin -->\n新内容\n<!-- test:end -->\n注記\n");
  assert.deepEqual(upsertMarkerBlock(updated.content, "test", "新内容\n"), updated);
});
