/**
 * bp actual の差分の振り分け。
 *
 * 差分のファイルを「生成物（数えない）」「テスト」「実装」に分ける。生成物は
 * ロックファイル・スナップショット・生成コードのように、書いた量ではなく
 * ツールが出した量なので、実装の規模と比べると実績を汚す。
 *
 * パターンは既定値を持ち、[bp_actual] で置き換えられる（足し合わせない）。
 */

import type { DiffFile } from "./git.mts";

/** 数えない生成物の既定パターン */
export const DEFAULT_ACTUAL_EXCLUDE: string[] = [
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
export const DEFAULT_ACTUAL_TESTS: string[] = [
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

export interface ActualPatterns {
  exclude: string[];
  tests: string[];
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
export function classifyPath(patterns: ActualPatterns, path: string): FileKind {
  if (matchesAny(patterns.exclude, path)) return "generated";
  if (matchesAny(patterns.tests, path)) return "test";
  return "implementation";
}

export interface ActualStats {
  /** 生成物を除いた新規ファイル数（実装 + テスト） → bp estimate の --new-files */
  newFiles: number;
  /** 生成物を除いた、差分に現れたファイル数（リネームは1件） */
  changedFiles: number;
  /** 生成物を除いた追加行数（実装 + テスト） → bp estimate の --lines */
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

export function summarizeDiff(files: DiffFile[], patterns: ActualPatterns): ActualStats {
  const stats: ActualStats = {
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
