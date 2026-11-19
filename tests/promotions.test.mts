import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { succeeds, workspace, write } from "./helpers.mts";
import {
  REVIEW_RECORD_HEADING,
  collectPromotions,
  groupUnhelpful,
  parseCandidate,
  parseCriterionReasons,
  parseUnhelpful,
  sectionItems,
} from "../scripts/lib/promotions.mts";
import { parseReviewRecord } from "../scripts/lib/review-records.mts";

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

test("context build-NN: overview などは出さず、自動で読み込まれない conventions だけを出す", (t) => {
  const directory = workspace(t, true);
  succeeds(directory, "tasklist", "add", "001", "--title", "基盤", "--peak", "350k");
  write(directory, `${CYCLE}/build-01/issue.md`);
  write(directory, "docs/overview.md");
  write(directory, "docs/conventions.md");
  write(directory, "AGENTS.md");
  const guide = (conventions: string): string =>
    [
      "| 論理名 | 管理 | パス | 概要 |", "| --- | --- | --- | --- |",
      "| overview | repo | `docs/overview.md` | 概要 |",
      "| decisions | 未作成 | — | ADR |",
      "| constraints | 未作成 | — | 制約 |",
      `| conventions | repo | \`${conventions}\` | 規約 |`, "",
    ].join("\n");
  const docs = (): string[] =>
    (JSON.parse(succeeds(directory, "context", "build-01", "001", "--json")) as { suggestions: { ref: string; origin: string }[]; missingDocs: string[] })
      .suggestions.filter((s) => s.origin === "doc").map((s) => s.ref);

  write(directory, "docs/hikyaku/document-guide.md", guide("docs/conventions.md"));
  assert.deepEqual(docs(), ["conventions"], "AGENTS.md に無い規約は、自動では読み込まれないので渡す");

  write(directory, "docs/hikyaku/document-guide.md", guide("AGENTS.md"));
  assert.deepEqual(docs(), [], "AGENTS.md の規約はホストが読み込むので出さない");
});

// ---------------------------------------------------------------------------
// 「なくす」と基準の理由（build-10）

test("parseCandidate: 宛先 refactor を「なくす」の候補として読み、重要度は必須", () => {
  assert.deepEqual(parseCandidate("`refactor` [中]: 日付の書式を1つの関数に寄せれば規約が要らなくなる"), {
    target: "refactor", kind: "refactor", importance: "中", written: false, text: "日付の書式を1つの関数に寄せれば規約が要らなくなる",
  });
  assert.equal(parseCandidate("`refactor`: 日付の書式を寄せる"), "重要度（[高] か [中]）がありません");
});

test("parseCriterionReasons: 行末の理由から防ぐ・立つ・重要度を読み、重要度は省ける", () => {
  assert.deepEqual(parseCriterionReasons("日付は ISO 8601 で書く（防ぐ: build-03 で表示が崩れた / 立つ: いまの formatDate の形 / 重要度: 高）"), {
    text: "日付は ISO 8601 で書く",
    reasons: { prevents: "build-03 で表示が崩れた", basis: "いまの formatDate の形", importance: "高" },
  });
  assert.deepEqual(parseCriterionReasons("X を使う（防ぐ: 二重送信 / 立つ: API の冪等性の仮定）"), {
    text: "X を使う",
    reasons: { prevents: "二重送信", basis: "API の冪等性の仮定", importance: undefined },
  });
});

test("parseCriterionReasons: 欄の中のパスの / と入れ子の括弧を読める", () => {
  assert.deepEqual(parseCriterionReasons("共有 DB を使わない（防ぐ: src/billing のテストが通ってしまった / 立つ: 移行（up/down）の手順）"), {
    text: "共有 DB を使わない",
    reasons: { prevents: "src/billing のテストが通ってしまった", basis: "移行（up/down）の手順", importance: undefined },
  });
  assert.deepEqual(parseCriterionReasons("X（build-03 で確認）（防ぐ: 二重送信 / 立つ: 冪等性 / 重要度: 中）"), {
    text: "X（build-03 で確認）",
    reasons: { prevents: "二重送信", basis: "冪等性", importance: "中" },
  });
});

test("parseCriterionReasons: 理由の欄が無ければ reasons は undefined、崩れていれば問題を返す", () => {
  assert.deepEqual(parseCriterionReasons("日付は ISO 8601 で書く"), { text: "日付は ISO 8601 で書く", reasons: undefined });
  assert.deepEqual(parseCriterionReasons("新しい画面(ベータ版)"), { text: "新しい画面(ベータ版)", reasons: undefined });
  assert.match(parseCriterionReasons("X を使う（防ぐ: 二重送信 / 重要度: 中）") as string, /「立つ」がありません/);
  assert.match(parseCriterionReasons("X を使う（防ぐ: 二重送信 / 立つ: 冪等性 / 重要度: 低）") as string, /重要度が不正です: 低/);
  // 欄が閉じていない・欄の後ろに文字が続くときは、理由なしとして黙って読まない
  assert.match(parseCriterionReasons("X（防ぐ: a / 立つ: b") as string, /閉じていません/);
  assert.match(parseCriterionReasons("X（防ぐ: a / 立つ: b）。") as string, /行末に置きます/);
  assert.match(parseCriterionReasons("X（防ぐ: a / 立つ: b）（build-03 で確認）") as string, /行末に置きます/);
});

test("collectPromotions: 理由は Candidate.reasons に入り、重要度の食い違いは読めない行、理由の無い既存の行は今までどおり", (t) => {
  const directory = workspace(t, true);
  write(directory, `${CYCLE}/build-01/handoff.md`, [
    "## 永続化すること", "",
    "- `rule:.claude/rules/api.md` [高]: 冪等キーを付ける（防ぐ: 二重課金 / 立つ: 決済 API の仕様 / 重要度: 高）",
    "- `conventions` [高]: X を使う（防ぐ: 二重送信 / 立つ: 冪等性 / 重要度: 中）",
    "- `constraints` [中]: 外部 API は 5 秒で打ち切る", "",
  ].join("\n"));
  const collected = collectPromotions(join(directory, CYCLE));
  assert.deepEqual(collected.candidates.map((c) => [c.target, c.text, c.reasons]), [
    ["rule:.claude/rules/api.md", "冪等キーを付ける", { prevents: "二重課金", basis: "決済 API の仕様", importance: "高" }],
    ["constraints", "外部 API は 5 秒で打ち切る", undefined],
  ]);
  assert.equal(collected.unparsed.length, 1);
  assert.match(collected.unparsed[0]?.problem ?? "", /食い違って/);
});

test("見出しと宛先の語: テンプレートと persistence.md と promotions がそろい、置き場の順の先頭が「なくす」", () => {
  const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const persistence = read("skills/close-cycle/references/persistence.md");
  const templates = read("skills/builder/references/templates.md");
  const retrospective = read("skills/retrospective/steps/write.md");
  assert.equal(REVIEW_RECORD_HEADING, "レビューの記録");
  for (const source of [persistence, templates]) assert.match(source, new RegExp(`^## ${REVIEW_RECORD_HEADING}$`, "m"));
  assert.match(persistence, /`refactor`/);

  // 例の行は書式どおりに読める（テンプレートと解析が食い違うと、候補が黙って読めない行になる）
  const examples = (source: string, heading: string): string[] =>
    [...source.matchAll(/```markdown\n([\s\S]*?)```/g)].flatMap((m) => sectionItems(m[1] as string, heading));
  const promoted = [persistence, templates, retrospective]
    .flatMap((source) => examples(source, "永続化すること"))
    .filter((item) => !/（文面）|（一行の要約）/.test(item));
  assert.ok(promoted.some((item) => item.includes("防ぐ:")), "理由の欄の例がある");
  for (const item of promoted) assert.equal(typeof parseCandidate(item), "object", item);
  // テンプレートの例（{名前}・（指摘の要約））は記録として数えないので、書式の確認は persistence.md の例で行う
  const reviewed = examples(persistence, REVIEW_RECORD_HEADING);
  assert.ok(reviewed.length > 0);
  for (const item of reviewed) assert.equal(typeof parseReviewRecord(item), "object", item);

  // 置き場の表の最初の行が「なくす」で、doc-triager と builder は順を写さない
  const firstRow = /## 2\. 置き場を選ぶ[\s\S]*?\|---[^\n]*\n(\|[^\n]*)/.exec(persistence)?.[1] ?? "";
  assert.match(firstRow, /なくす/);
  assert.match(firstRow, /`refactor`/);
  assert.doesNotMatch(read("agents/doc-triager.md"), /機械で防ぐ → パス指定の rule/);
  assert.doesNotMatch(read("skills/builder/SKILL.md"), /\| 知見 \| あなたがすること \|/);
});
