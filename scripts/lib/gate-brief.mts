/**
 * G4・G8 の提示の中身（US-12。原則12「ユーザーに見せる量は、限られた時間で読める量に合わせる」）。
 *
 *   G4  design-delta.md とこのサイクルの ADR が触れるパスを [boundaries] と照合し、外との境界の変更（同意が要る）と
 *       内部の境界の変更（確かめる）を分ける。宣言が無ければ従来どおりの提示（design-delta と指摘への対処）
 *   G8  test-spec.md の「（解釈）」のシナリオと、どのシナリオの「- 対応:」にも無い受け入れ基準だけを示す
 *
 * 全文は求められたときに --full で出す。G4 の同意の判定（steps/architect.mts）も boundaryChanges を使う。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ResolvedConfig } from "./config.mts";
import { cycleAdrs, effectiveBoundaries, overlaps, repositoryFiles, touchedPaths } from "./risk.mts";
import {
  definedCriteria,
  INTERPRETED_MARK,
  ISSUE_CRITERIA_HEADING,
  markdownSection,
  referencedCriteria,
  testSpecScenarios,
} from "./traceability.mts";

/** 境界のパスと、それに当たった設計の文書のパス */
export interface BoundaryHit {
  boundary: string;
  touched: string[];
}

export interface BoundaryChanges {
  /** [boundaries] を作業ツリーか基準のどちらかで宣言しているか。false なら従来どおりの提示 */
  declared: boolean;
  /** 外との境界の変更（同意が要る） */
  external: BoundaryHit[];
  /** 内部の境界の変更（確かめる） */
  internal: BoundaryHit[];
  /** 作業ツリーだけが宣言していて、基準を1つも読めない（G4 は同意に倒す） */
  unverified: boolean;
  /** 照合した文書（リポジトリからの相対パス） */
  documents: string[];
  notices: string[];
}

export const DESIGN_DELTA = "design-delta.md";

/**
 * design-delta.md と、このサイクルの ADR が触れるパスを、境界と照合する。迷う形は overlaps のとおり当たる側に倒す。
 * 宣言が無ければ declared: false で、ADR も読まない。ADR の一覧・文書を読めなければ Error
 */
export function boundaryChanges(config: ResolvedConfig, designDirectory: string): BoundaryChanges | Error {
  // G4 の consent・args・notices と gate brief から同じ1回の実行で何度も呼ばれる（git と ADR を読み直さない）
  let byDirectory = boundaryCache.get(config);
  if (byDirectory === undefined) {
    byDirectory = new Map();
    boundaryCache.set(config, byDirectory);
  }
  const cached = byDirectory.get(designDirectory);
  if (cached !== undefined) return cached;
  const result = computeBoundaryChanges(config, designDirectory);
  byDirectory.set(designDirectory, result);
  return result;
}

const boundaryCache = new WeakMap<ResolvedConfig, Map<string, BoundaryChanges | Error>>();

/** 基準の境界を確かめられないときの notices の先頭（G4 の notices が同意の理由として使う） */
export const UNVERIFIED_NOTICE = "基準の [boundaries] を確かめられないので、G4 を同意にしています";

function computeBoundaryChanges(config: ResolvedConfig, designDirectory: string): BoundaryChanges | Error {
  const boundaries = effectiveBoundaries(config);
  const declared = boundaries.external.length > 0 || boundaries.internal.length > 0 || boundaries.unverified;
  if (!declared) return { declared, external: [], internal: [], unverified: false, documents: [], notices: [] };

  const read = designTouchedPaths(config, designDirectory);
  if (read instanceof Error) return read;
  const notices: string[] = [];
  const delta = join(designDirectory, DESIGN_DELTA);
  if (!existsSync(delta)) notices.push(`${DESIGN_DELTA} がまだありません（${relative(config.repoRoot, delta)}）`);
  if (boundaries.unverified) notices.push(`${UNVERIFIED_NOTICE}: ${boundaries.reasons.join(" / ")}`);

  const files = repositoryFiles(config);
  const hits = (paths: string[]): BoundaryHit[] =>
    paths
      .map((boundary) => ({ boundary, touched: read.touched.filter((path) => overlaps(boundary, path, files)) }))
      .filter((hit) => hit.touched.length > 0);
  return {
    declared,
    external: hits(boundaries.external),
    internal: hits(boundaries.internal),
    unverified: boundaries.unverified,
    documents: read.documents.map((path) => relative(config.repoRoot, path)),
    notices,
  };
}

/**
 * design-delta.md とこのサイクルの ADR が触れるパス（touchedPaths）。G4 の境界の照合と、G3 の申告の裏取り
 * （steps/architect.mts）が同じ文書の集合で判定するよう、ここだけで集める。ADR の一覧・文書を読めなければ Error
 */
export function designTouchedPaths(config: ResolvedConfig, designDirectory: string): { documents: string[]; touched: string[] } | Error {
  let adrs: string[];
  try {
    adrs = cycleAdrs(config);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const documents: string[] = [];
  const touched: string[] = [];
  for (const path of [join(designDirectory, DESIGN_DELTA), ...adrs.map((adr) => join(config.repoRoot, adr))]) {
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      return new Error(`${path} を読めません: ${error instanceof Error ? error.message : String(error)}`);
    }
    documents.push(path);
    for (const entry of touchedPaths(text)) if (!touched.includes(entry)) touched.push(entry);
  }
  return { documents, touched };
}

/** G4 の提示。境界の変更と、G3 の申告の裏取り（G4 の args の undeclaredAreas / verified） */
export interface G4Brief {
  boundaries: BoundaryChanges | { error: string };
  undeclaredAreas: { name: string; touched: string[] }[];
  /** 裏取りできなかった（ADR を読めない）とき false */
  verified: boolean;
}

export function renderG4Brief(brief: G4Brief, full: string | undefined): string {
  const lines: string[] = ["# G4 の提示", ""];
  const boundaries = brief.boundaries;
  if ("error" in boundaries) {
    lines.push(`! 境界を照合できませんでした（G4 は同意です）: ${boundaries.error}`, "");
  } else if (!boundaries.declared) {
    lines.push("[boundaries] の宣言が無いので、従来どおり design-delta.md と doc-reviewer の指摘への対処を提示してください。", "");
  } else {
    lines.push("## 外との境界の変更（同意が要る）", "");
    if (boundaries.external.length === 0) lines.push("なし");
    for (const hit of boundaries.external) lines.push(`- ${hit.boundary}: ${hit.touched.join(", ")}`);
    lines.push("", "## 内部の境界の変更（確かめる）", "");
    if (boundaries.internal.length === 0) lines.push("なし");
    for (const hit of boundaries.internal) lines.push(`- ${hit.boundary}: ${hit.touched.join(", ")}`);
    lines.push("");
    if (boundaries.documents.length > 0) lines.push(`照合した文書: ${boundaries.documents.join(", ")}`, "");
    // unverified のときは、notices に同意にした理由が入っている
    for (const notice of boundaries.notices) lines.push(`! ${notice}`);
    if (boundaries.notices.length > 0) lines.push("");
  }
  if (brief.undeclaredAreas.length > 0) {
    lines.push("## G3 の申告に無い重い領域（同意が要る）", "");
    for (const area of brief.undeclaredAreas) lines.push(`- ${area.name}: ${area.touched.join(", ")}`);
    lines.push("");
  }
  if (!brief.verified) lines.push("! G3 の申告を裏取りできませんでした（このサイクルの ADR を読めない）。G4 は同意です", "");
  if (full !== undefined) lines.push("---", "", `# ${DESIGN_DELTA}（全文）`, "", full);
  return lines.join("\n").trimEnd();
}

export interface G8Brief {
  /** test-spec.md があるか（スキップしたビルドでは false。そのときは plan.md を提示する） */
  testSpec: boolean;
  /** 見出しに「（解釈）」の印が付いたシナリオ */
  interpreted: { heading: string; body: string }[];
  /**
   * issue.md の「対応する受け入れ基準」のうち、どのシナリオの「- 対応:」にも無いもの。
   * 追跡できない（番号付きの基準が無い・節が無い・test-spec が無い）ときは undefined
   */
  uncovered: string[] | undefined;
  /** 追跡できないときの issue.md の受け入れ基準の節（網羅性を確かめる材料を消さない） */
  criteriaSection: string | undefined;
}

export function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function g8Brief(cycleDirectory: string, buildDirectory: string): G8Brief {
  const testSpec = readIfExists(join(buildDirectory, "test-spec.md"));
  const issue = readIfExists(join(buildDirectory, "issue.md")) ?? "";
  const stories = readIfExists(join(cycleDirectory, "planning", "user-stories.md")) ?? "";
  const scenarios = testSpec === undefined ? [] : testSpecScenarios(testSpec);
  const defined = definedCriteria(stories);
  const referenced = referencedCriteria(issue);
  const trackable = testSpec !== undefined && defined.length > 0 && referenced !== undefined;
  const covered = new Set(scenarios.flatMap((scenario) => scenario.criteria));
  return {
    testSpec: testSpec !== undefined,
    interpreted: scenarios.filter((scenario) => scenario.interpreted).map(({ heading, body }) => ({ heading, body })),
    uncovered: trackable ? [...new Set(referenced)].filter((id) => !covered.has(id)) : undefined,
    criteriaSection: trackable ? undefined : (markdownSection(issue, "受け入れ基準") ?? markdownSection(issue, ISSUE_CRITERIA_HEADING)),
  };
}

export function renderG8Brief(brief: G8Brief, full: { plan: string | undefined; testSpec: string | undefined } | undefined): string {
  const lines: string[] = ["# G8 の提示", ""];
  if (!brief.testSpec) {
    lines.push("test-spec.md がありません（スキップ）。plan.md を提示してください。", "");
  } else {
    lines.push(`## 解釈で決めた振る舞い（${INTERPRETED_MARK}の印）`, "");
    if (brief.interpreted.length === 0) lines.push("なし", "");
    for (const scenario of brief.interpreted) lines.push(`### ${scenario.heading}`, scenario.body, "");
    if (brief.uncovered !== undefined) {
      lines.push("## どのシナリオにも対応していない受け入れ基準", "");
      lines.push(brief.uncovered.length === 0 ? "なし" : brief.uncovered.map((id) => `- ${id}`).join("\n"), "");
    }
  }
  if (brief.uncovered === undefined && brief.criteriaSection !== undefined) {
    lines.push("## 受け入れ基準（番号で追跡できないので、そのまま示します）", "", brief.criteriaSection, "");
  }
  if (full !== undefined) {
    lines.push("---", "", "# plan.md（全文）", "", full.plan ?? "（plan.md がありません）", "");
    lines.push("# test-spec.md（全文）", "", full.testSpec ?? "（test-spec.md がありません）");
  }
  return lines.join("\n").trimEnd();
}
