import assert from "node:assert/strict";
import { test } from "node:test";
import { succeeds, workspace, write } from "./helpers.mts";
import { groupUnhelpful, parseCandidate, parseUnhelpful, sectionItems } from "../scripts/lib/promotions.mts";

const CYCLE = "docs/hikyaku/cycles/001-test";

test("sectionItems: 同名の節をレベルを問わず拾い、続きの行をつなげ、コードブロックは読まない", () => {
  const source = [
    "# 振り返り",
    "## 永続化すること",
    "- `constraints` [高]: 1行目",
    "  の続き",
    "```markdown",
    "## 永続化すること",
    "- `overview` [中]: 例",
    "```",
    "## 別の節",
    "- 読まない",
    "### 永続化すること",
    "- `workflow` [中]: 追記分",
  ].join("\n");
  assert.deepEqual(sectionItems(source, "永続化すること"), ["`constraints` [高]: 1行目 の続き", "`workflow` [中]: 追記分"]);
});

test("parseCandidate: 宛先・重要度・済を読み、書式の崩れは理由を返す", () => {
  assert.deepEqual(parseCandidate("`rule:.claude/rules/x.md` [高] 済: 並列で通ってしまう"), {
    target: "rule:.claude/rules/x.md", kind: "rule", importance: "高", written: true, text: "並列で通ってしまう",
  });
  assert.deepEqual(parseCandidate("`upstream`: dry-run が評価できない"), {
    target: "upstream", kind: "upstream", importance: undefined, written: false, text: "dry-run が評価できない",
  });
  assert.match(String(parseCandidate("`learnings` [高]: 落とし穴")), /宛先が不明/);
  assert.match(String(parseCandidate("`conventions`: 重要度なし")), /重要度/);
  assert.match(String(parseCandidate("`conventions` [低]: 些細")), /低の知見は書きません/);
  assert.match(String(parseCandidate("conventions に足す")), /形になっていません/);
});

test("parseUnhelpful: 場所・引用・理由・補足を読み、理由は3つに限る", () => {
  assert.deepEqual(parseUnhelpful("`AGENTS.md`「抽出 API」: 古い（ルートが無い）"), {
    location: "AGENTS.md", quote: "抽出 API", reason: "古い", note: "ルートが無い",
  });
  assert.deepEqual(parseUnhelpful("`conventions`「fixture」: 自明"), {
    location: "conventions", quote: "fixture", reason: "自明", note: "",
  });
  assert.match(String(parseUnhelpful("`conventions`「fixture」: 不要")), /理由が不明/);
});

test("groupUnhelpful: 同じ記述への指摘を束ね、件数の多い順に並べる", () => {
  const groups = groupUnhelpful([
    { location: "AGENTS.md", quote: "A", reason: "無関係", note: "", source: "build-01/retrospective.md" },
    { location: "conventions", quote: "B", reason: "古い", note: "x", source: "build-01/retrospective.md" },
    { location: "AGENTS.md", quote: "A", reason: "無関係", note: "", source: "build-02/retrospective.md" },
  ]);
  assert.equal(groups[0]?.location, "AGENTS.md");
  assert.equal(groups[0]?.reasons["無関係"], 2);
  assert.deepEqual(groups[0]?.sources, ["build-01/retrospective.md", "build-02/retrospective.md"]);
});

test("promotions: handoff・振り返り・design-delta から集め、読めない行も返す", (t) => {
  const directory = workspace(t, true);
  write(directory, `${CYCLE}/design/design-delta.md`, "# 設計差分\n\n## 永続ドキュメントの更新予定\n\n- `overview` の「請求」: キュー経由になる\n");
  write(directory, `${CYCLE}/build-01/handoff.md`, [
    "# Build 01 申し送り", "", "## 永続化すること", "",
    "- `constraints` [高]: 1 分あたり 100 件まで（build-01 で確認）",
    "- `learnings` [中]: 廃止した宛先",
  ].join("\n"));
  write(directory, `${CYCLE}/build-02/retrospective.md`, [
    "# 振り返り", "", "## 永続化すること", "", "なし", "", "## 役に立たなかった記述", "",
    "- `AGENTS.md`「古い節」: 古い（機能が無い）",
  ].join("\n"));

  const output = JSON.parse(succeeds(directory, "promotions", "001", "--json")) as {
    sources: string[];
    candidates: { target: string; items: { importance: string; source: string }[] }[];
    planned: { text: string }[];
    unhelpful: { location: string; reasons: Record<string, number> }[];
    unparsed: { line: string; problem: string }[];
  };
  assert.deepEqual(output.sources, ["design/design-delta.md", "build-01/handoff.md", "build-02/retrospective.md"]);
  assert.equal(output.candidates.length, 1);
  assert.equal(output.candidates[0]?.target, "constraints");
  assert.equal(output.candidates[0]?.items[0]?.source, "build-01/handoff.md");
  assert.equal(output.planned.length, 1);
  assert.equal(output.unhelpful[0]?.reasons["古い"], 1);
  assert.equal(output.unparsed.length, 1, "「なし」は候補にも読めない行にも数えない");
  assert.match(output.unparsed[0]?.problem ?? "", /宛先が不明/);

  const text = succeeds(directory, "promotions", "001");
  assert.match(text, /constraints（未作成）/);
  assert.match(text, /読めなかった行/);
});
