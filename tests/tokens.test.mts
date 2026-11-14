import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../scripts/lib/paths.mts";
import {
  bodyHash,
  DEFAULT_PEAK_BANDS,
  formatK,
  guideHeaderProblems,
  loadStandardGuide,
  parseTokenAmount,
  peakVerdict,
  renderEstimateMarkdown,
  renderGuide,
  splitGuide,
  STANDARD_GUIDE,
  sumComponents,
} from "../scripts/lib/tokens.mts";

test("tokens: トークン数を整数・カンマ区切り・k / m の単位で読み、0 を許す", () => {
  assert.equal(parseTokenAmount("120000"), 120_000);
  assert.equal(parseTokenAmount("120,000"), 120_000);
  assert.equal(parseTokenAmount("120k"), 120_000);
  assert.equal(parseTokenAmount("1.2m"), 1_200_000);
  assert.equal(parseTokenAmount(" 45K "), 45_000);
  assert.equal(parseTokenAmount("0"), 0);
  for (const invalid of ["", "-5", "12kk", "1,23", "abc", "1e5"]) {
    assert.equal(parseTokenAmount(invalid), undefined, invalid);
  }
  assert.equal(formatK(380_000), "380k");
  assert.equal(formatK(999), "999");
  assert.equal(formatK(undefined), "—");
  // 表の値は --peak や tasklist にそのまま渡り、帯と比べ直されるので丸めない
  for (const value of [450_400, 450_401, 450_010, 1_234_567, 1_000, 0]) {
    assert.equal(parseTokenAmount(formatK(value)), value, String(value));
  }
  assert.equal(formatK(450_400), "450.4k");
  assert.equal(formatK(450_010), "450.01k");
});

test("tokens: 成分を合計し、帯の境目を含めて判定する", () => {
  const estimate = sumComponents({
    fixed: { tokens: 90_000, basis: "実測の固定分" },
    reading: { tokens: 110_000 },
    implementation: { tokens: 90_000 },
    tests: { tokens: 50_000 },
    unknown: { tokens: 0 },
  });
  assert.equal(estimate.total, 340_000);
  assert.deepEqual(estimate.components.map((c) => c.key), ["fixed", "reading", "implementation", "tests", "unknown"]);
  assert.equal(estimate.components[1]?.basis, "");

  const bands = DEFAULT_PEAK_BANDS;
  assert.equal(peakVerdict(299_999, bands), "merge");
  assert.equal(peakVerdict(300_000, bands), "target");
  assert.equal(peakVerdict(450_000, bands), "target");
  assert.equal(peakVerdict(450_001, bands), "split");
});

test("tokens: 内訳表の最後の行にガイドの版とハッシュを残し、根拠の | と改行をエスケープする", () => {
  const estimate = sumComponents({
    fixed: { tokens: 90_000, basis: "a|b\nc" },
    reading: { tokens: 110_000 },
    implementation: { tokens: 90_000 },
    tests: { tokens: 50_000 },
    unknown: { tokens: 200_000 },
  });
  const markdown = renderEstimateMarkdown(estimate, peakVerdict(estimate.total, DEFAULT_PEAK_BANDS), DEFAULT_PEAK_BANDS, {
    kind: "project",
    version: 3,
    actualHash: "1a2b3c4d",
  });
  const lines = markdown.split("\n");
  assert.equal(lines[0], "| 成分 | 予測 | 根拠 |");
  assert.equal(lines[2], "| 固定費 | 90k | a\\|b c |");
  assert.match(markdown, /\| \*\*予測ピーク\*\* \| \*\*540k\*\* \| 分割を検討/);
  assert.equal(lines.at(-1), "| ガイド | プロジェクト v3 | 1a2b3c4d |");
});

test("tokens: ガイドの宣言を読み書きし、本文のハッシュは先頭と末尾の空行・行末の空白に左右されない", () => {
  const body = "# ガイド\n\n本文  \n";
  const rendered = renderGuide({ version: 2, basedOn: "標準 v1" }, `\n\n${body}\n\n`);
  const { header, body: read, hasHeader } = splitGuide(rendered);
  assert.equal(hasHeader, true);
  assert.equal(header.version, 2);
  assert.equal(header.basedOn, "標準 v1");
  assert.equal(header.hash, bodyHash(body));
  assert.equal(bodyHash(read), bodyHash(body));
  assert.notEqual(bodyHash("# ガイド\n\n本文を変えた\n"), bodyHash(body));

  const plain = splitGuide("# 宣言なし\n");
  assert.equal(plain.hasHeader, false);
  assert.equal(plain.header.version, undefined);
});

test("tokens: 標準のガイドは版とハッシュの宣言を持ち、ハッシュが本文と合っている", () => {
  const guide = loadStandardGuide();
  assert.equal(guide.path, join(pluginRoot(), STANDARD_GUIDE));
  assert.deepEqual(
    guideHeaderProblems(guide),
    [],
    "標準のガイドの本文を変えたら、version を上げて hash を本文に合わせる（AGENTS.md）",
  );
  // 成分の節がガイドにあること（見積もりの手順が節の名前で参照する）
  const source = readFileSync(guide.path, "utf8");
  for (const flag of ["--fixed", "--reading", "--implementation", "--tests", "--unknown"]) {
    assert.ok(source.includes(`（\`${flag}\`）`), flag);
  }
});

test("tokens: 同じガイドの版で同じ向きに外れたビルドが複数あるときだけ、ガイドの見直しを勧める", async () => {
  const { guideReview, emptyContext } = await import("../scripts/lib/tokens-history.mts");
  const record = (build: string, builder: number, peak: number | undefined, guide = "標準 v1") => ({
    cycle: "001-test", build, path: "", architect: undefined, builder, session: undefined, components: {},
    guide, guideHash: undefined, context: { ...emptyContext(), peak }, diff: { newFiles: undefined, addedLines: undefined, implementationLines: undefined, testLines: undefined },
    checkpoints: {},
  });
  assert.equal(guideReview([record("build-01", 300_000, 400_000)]).needed, false, "1件だけのぶれでは勧めない");
  assert.equal(guideReview([record("build-01", 300_000, 400_000), record("build-02", 300_000, 200_000)]).needed, false, "向きが違えば勧めない");
  const under = guideReview([record("build-01", 300_000, 400_000), record("build-02", 300_000, 380_000), record("build-03", 300_000, 310_000)]);
  assert.equal(under.needed, true);
  assert.deepEqual(under.under, ["build-01", "build-02"]);
  assert.equal(
    guideReview([record("build-01", 300_000, 400_000, "標準 v1"), record("build-02", 300_000, 400_000, "プロジェクト v2")]).needed,
    false,
    "ガイドの版が違えば混ぜない",
  );
  assert.equal(guideReview([record("build-01", 300_000, undefined)]).paired, 0);
  // ガイドの版が記録に無いビルドは、同じ版とみなさず判定から外す
  const versionless = (build: string, peak: number) => ({ ...record(build, 300_000, peak), guide: undefined });
  const unknown = guideReview([versionless("build-01", 400_000), versionless("build-02", 400_000)]);
  assert.equal(unknown.needed, false);
  assert.deepEqual(unknown.unknownGuide, ["build-01", "build-02"]);
  assert.match(unknown.reason, /版が記録に無い 2 件/);
  assert.equal(guideReview([versionless("build-01", 400_000), record("build-02", 300_000, 400_000), record("build-03", 300_000, 400_000)]).needed, true);
});
