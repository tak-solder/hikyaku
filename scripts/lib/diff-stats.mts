/**
 * ビルドの差分の集計（tokens history build-NN）の振り分け。
 *
 * 差分のファイルを「生成物（数えない）」「テスト」「実装」に分ける。生成物は
 * ロックファイル・スナップショット・生成コードのように、書いた量ではなく
 * ツールが出した量なので、実装の規模と比べると実績を汚す。
 *
 * 差分の集計は予測ピークの算出には使わない。予測と実測のピークが離れたときに、
 * 書いた量が想定と違ったのかを振り返る素材にする。
 *
 * パターンは既定値を持ち、[diff] で置き換えられる（足し合わせない）。
 */

import type { DiffFile } from "./git.mts";

/** 数えない生成物の既定パターン */
export const DEFAULT_DIFF_EXCLUDE: string[] = [
  // ロックファイル
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "bun.lockb",
  "*.lock",
  "go.sum",
  // スナップショット
  "**/__snapshots__/**",
  "*.snap",
  // 生成コード・圧縮済みの成果物
  "*.generated.*",
  "*.gen.*",
  "*_gen.go",
  "*.pb.go",
  "*_pb2.py",
  "*_pb2_grpc.py",
  "*.min.js",
  "*.min.css",
  "*.map",
];

/** テストとして数える既定パターン */
export const DEFAULT_DIFF_TESTS: string[] = [
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/spec/**",
  "**/e2e/**",
  "*.test.*",
  "*.spec.*",
  "*_test.*",
  "test_*.py",
];

/**
 * 差分の事実（diff facts）で使う印。テストファイルの変更行に**部分文字列**として現れるかで照合する。
 * 正規表現にしないのは、利用者が [diff] に足した印のエスケープ漏れで検査が壊れないため。
 * [diff] に書いた印は既定に追加される（既定は消せない。見逃しを設定で増やせないようにする）
 */
export const DEFAULT_TEST_DECLARATIONS: string[] = [
  // JS / TS（node:test・Jest・Vitest・Mocha）
  "it(", "test(", "describe(", "it.only(", "test.only(",
  // Python
  "def test_", "class Test",
  // Go
  "func Test", "func Benchmark",
  // Ruby（RSpec・Minitest）
  "it \"", "it '", "describe \"", "context \"",
  // Java / Kotlin（JUnit）・C#
  "@Test", "@ParameterizedTest", "[Test]", "[Fact]", "[TestMethod]",
  // Rust
  "#[test]",
  // PHP（PHPUnit）
  "public function test",
];

export const DEFAULT_SKIP_MARKERS: string[] = [
  // JS / TS
  ".skip(", ".todo(", "xit(", "xdescribe(", "xtest(", "{ skip:", "{ todo:", "t.skip(", "t.todo(",
  // Python
  "@pytest.mark.skip", "@pytest.mark.xfail", "@unittest.skip", "pytest.skip(", "self.skipTest(",
  // Go
  "t.Skip(", "t.SkipNow(", "b.Skip(",
  // Ruby
  "skip(", "skip \"", "skip '", "pending \"", "pending '", "xit \"", "xit '",
  // Java / Kotlin・C#
  "@Disabled", "@Ignore", "[Ignore]", "Skip =",
  // Rust
  "#[ignore",
  // PHP
  "markTestSkipped(", "markTestIncomplete(",
];

export const DEFAULT_ASSERTION_MARKERS: string[] = [
  "assert", "expect(", "expect {", ".should", "t.Error", "t.Fatal", "require.", "EXPECT_", "ASSERT_",
  "verify(", "refute",
];

const IDENTIFIER = /[A-Za-z0-9_$]/;

/**
 * 行に印が現れるか。印が識別子の文字で始まるときは、直前が識別子の文字でない位置だけを数える
 * （`it(` が `submit(` に、`test(` が `latest(` に当たらないように）
 */
export function findMarker(markers: string[], line: string): string | undefined {
  // 当たる印のうち最も長いもの（`@pytest.mark.skip(` に `.skip(` ではなく `@pytest.mark.skip` を返す）
  let found: string | undefined;
  for (const marker of markers) {
    if (found !== undefined && marker.length <= found.length) continue;
    const guarded = IDENTIFIER.test(marker[0] ?? "");
    let from = 0;
    for (;;) {
      const index = line.indexOf(marker, from);
      if (index === -1) break;
      if (!guarded || index === 0 || !IDENTIFIER.test(line[index - 1] as string)) {
        found = marker;
        break;
      }
      from = index + 1;
    }
  }
  return found;
}

export interface DiffPatterns {
  exclude: string[];
  tests: string[];
  /** テストの宣言の印（削除されたテストの検出） */
  testDeclarations: string[];
  /** スキップの印（追加されたスキップの検出） */
  skipMarkers: string[];
  /** アサーションの印（アサーションの行の変更の検出） */
  assertionMarkers: string[];
}

/**
 * パスの glob。gitignore に寄せた規則で、`/` を含まないパターンはファイル名に当てる。
 * `/` を含むパターンはリポジトリルートからのパス全体に当て、`**\/` は0個以上の
 * ディレクトリ、`*` は `/` をまたがない任意の文字列、`?` は `/` 以外の1文字。
 */
export function pathPatternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesPathPattern(pattern: string, path: string): boolean {
  const target = pattern.includes("/") ? path : (path.split("/").pop() ?? path);
  return pathPatternToRegExp(pattern.replace(/^\//, "")).test(target);
}

function matchesAny(patterns: string[], path: string): boolean {
  return patterns.some((pattern) => matchesPathPattern(pattern, path));
}

export type FileKind = "generated" | "test" | "implementation";

/** 生成物の判定が先。テストのスナップショットは生成物として数えない */
export function classifyPath(patterns: Pick<DiffPatterns, "exclude" | "tests">, path: string): FileKind {
  if (matchesAny(patterns.exclude, path)) return "generated";
  if (matchesAny(patterns.tests, path)) return "test";
  return "implementation";
}

export interface DiffStats {
  /** 生成物を除いた新規ファイル数（実装 + テスト） */
  newFiles: number;
  /** 生成物を除いた、差分に現れたファイル数（リネームは1件） */
  changedFiles: number;
  /** 生成物を除いた追加行数（実装 + テスト） */
  addedLines: number;
  deletedLines: number;
  /** 行数を数えられないファイル数（生成物を除く）。addedLines には含まれない */
  binaryFiles: number;
  implementationFiles: number;
  implementationNewFiles: number;
  implementationLines: number;
  testFiles: number;
  testNewFiles: number;
  testLines: number;
  /** 数えなかった生成物 */
  generatedFiles: number;
  generatedLines: number;
  generatedPaths: string[];
}

export function summarizeDiff(files: DiffFile[], patterns: Pick<DiffPatterns, "exclude" | "tests">): DiffStats {
  const stats: DiffStats = {
    newFiles: 0,
    changedFiles: 0,
    addedLines: 0,
    deletedLines: 0,
    binaryFiles: 0,
    implementationFiles: 0,
    implementationNewFiles: 0,
    implementationLines: 0,
    testFiles: 0,
    testNewFiles: 0,
    testLines: 0,
    generatedFiles: 0,
    generatedLines: 0,
    generatedPaths: [],
  };
  for (const file of files) {
    const kind = classifyPath(patterns, file.path);
    const added = file.added ?? 0;
    if (kind === "generated") {
      stats.generatedFiles += 1;
      stats.generatedLines += added;
      stats.generatedPaths.push(file.path);
      continue;
    }
    stats.changedFiles += 1;
    if (file.isNew) stats.newFiles += 1;
    if (file.added === undefined) stats.binaryFiles += 1;
    stats.addedLines += added;
    stats.deletedLines += file.deleted ?? 0;
    if (kind === "test") {
      stats.testFiles += 1;
      if (file.isNew) stats.testNewFiles += 1;
      stats.testLines += added;
    } else {
      stats.implementationFiles += 1;
      if (file.isNew) stats.implementationNewFiles += 1;
      stats.implementationLines += added;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// retrospective.md に貼る表（tokens history build-NN --markdown）

export const DIFF_TABLE_HEADERS = ["差分の集計", "値"];

export const DIFF_LABELS = {
  newFiles: "新規ファイル数",
  changedFiles: "変更ファイル数",
  addedLines: "追加行数",
  deletedLines: "削除行数",
  generated: "生成物（数えていない）",
} as const;

function count(value: number): string {
  return value.toLocaleString("en-US");
}

export function renderDiffMarkdown(stats: DiffStats | undefined, reason?: string): string {
  const rows: [string, string][] =
    stats === undefined
      ? [[DIFF_LABELS.addedLines, `計測不可（${reason ?? "理由不明"}）`]]
      : [
          [DIFF_LABELS.newFiles, `${count(stats.newFiles)}（実装 ${count(stats.implementationNewFiles)} / テスト ${count(stats.testNewFiles)}）`],
          [DIFF_LABELS.changedFiles, `${count(stats.changedFiles)}（実装 ${count(stats.implementationFiles)} / テスト ${count(stats.testFiles)}）`],
          [DIFF_LABELS.addedLines, `${count(stats.addedLines)}（実装 ${count(stats.implementationLines)} / テスト ${count(stats.testLines)}）`],
          [DIFF_LABELS.deletedLines, count(stats.deletedLines)],
          [DIFF_LABELS.generated, `${count(stats.generatedFiles)} ファイル・${count(stats.generatedLines)} 行`],
        ];
  return [
    `| ${DIFF_TABLE_HEADERS.join(" | ")} |`,
    `|${DIFF_TABLE_HEADERS.map(() => "------").join("|")}|`,
    ...rows.map(([label, value]) => `| ${label} | ${value.replace(/\|/g, "\\|")} |`),
  ].join("\n");
}

/** 「820（実装 600 / テスト 220）」を合計・実装・テストに分けて読む。読めなければ undefined */
export function parseSplitCount(cell: string | undefined): { total: number; implementation: number | undefined; tests: number | undefined } | undefined {
  if (cell === undefined) return undefined;
  const plain = cell.replace(/\*/g, "").replace(/,/g, "");
  const match = /^\s*(\d+)\s*(?:（実装\s*(\d+)\s*\/\s*テスト\s*(\d+)）)?/.exec(plain);
  if (match === null) return undefined;
  return {
    total: Number.parseInt(match[1] as string, 10),
    implementation: match[2] === undefined ? undefined : Number.parseInt(match[2], 10),
    tests: match[3] === undefined ? undefined : Number.parseInt(match[3], 10),
  };
}
