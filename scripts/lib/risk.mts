/**
 * AI に任せてよい害の上限（ADR 20261116-risk-ceiling-table）。
 *
 * アプリケーションの状況（[app] の3軸と [[app.areas]] の重い領域）から上限を決める。
 * 上限との比較はスクリプトが行い、LLM が付けた害の重さはユーザーに上げる向きにしか効かせない（原則11）。
 *
 * 上限は、ユーザーがマージした宣言で決める。作業ツリーの宣言は、セッションが書き換えられる。
 * そこで作業ツリーと、基準のブランチとの merge-base にある宣言のうち、最も厳しいものを使う。
 * 基準のブランチは2つ:
 *
 *   - デフォルトブランチ（origin/HEAD）
 *   - defaultBase（base_branch か、デフォルトブランチ）。ADR の定義
 *
 * base_branch は作業ツリーの設定にあり、自分のブランチへ向け直せば基準を外せるので、
 * デフォルトブランチの基準も足す（厳しくする向きにしか効かない）。PR のマージ先（スタック元や
 * conductor のブランチ）はユーザーのマージを経ていないので使わない。基準が Hikyaku のブランチを
 * 指しているとき（origin/HEAD の向け直しなど）も、その基準は読めない扱いにする。
 *
 * この版では宣言はまだゲートの判定に使わない（G3・G4 は build-15、境界は build-12）。
 */

import { parseBranch } from "./branch.mts";
import {
  DATA_WEIGHTS,
  EXPOSURES,
  IMPACTS,
  readAppDeclaration,
  type AppArea,
  type AppAxes,
  type AppDeclaration,
  type ResolvedConfig,
} from "./config.mts";
import { loadGuide } from "./docs.mts";
import { defaultBranch, gitSync } from "./git.mts";
import { expandBraces, ruleGlobToRegExp } from "./rules.mts";
import { defaultBaseOf } from "./stack.mts";
import { parseToml, type TomlTable } from "./toml.mts";

/** 害の重さ（persistence.md の重要度の高・中を流用する） */
export type Harm = "高" | "中";
/** 上限。"高" まで / "中" まで / "なし"（何も任せず、すべてユーザーに上げる） */
export type Ceiling = "高" | "中" | "なし";

const LEVELS = {
  exposure: EXPOSURES as readonly string[],
  data: DATA_WEIGHTS as readonly string[],
  impact: IMPACTS as readonly string[],
};
const AXES = ["exposure", "data", "impact"] as const;

function rank(axis: (typeof AXES)[number], value: string): number {
  return LEVELS[axis].indexOf(value);
}

/** 上限の表。3軸すべてが最下段なら高まで / どれかが中段なら中まで / どれかが最上段なら何も任せない */
export function ceilingOf(axes: AppAxes): Ceiling {
  const ranks = AXES.map((axis) => rank(axis, axes[axis]));
  if (ranks.some((value) => value >= 2)) return "なし";
  if (ranks.some((value) => value === 1)) return "中";
  return "高";
}

/** 害の申告が上限を超えるか */
export function exceeds(harm: Harm, ceiling: Ceiling): boolean {
  if (ceiling === "なし") return true;
  if (ceiling === "中") return harm === "高";
  return false;
}

function maxAxes(base: AppAxes, over: Partial<AppAxes>): AppAxes {
  const out: AppAxes = { ...base };
  for (const axis of AXES) {
    const value = over[axis];
    if (value !== undefined && rank(axis, value) > rank(axis, out[axis])) (out as unknown as Record<string, string>)[axis] = value;
  }
  return out;
}

/** パスの宣言: アプリケーションの軸に、当たる重い領域の軸を軸ごとの最大で重ねる */
export function axesForPath(declaration: AppDeclaration, path: string, files: string[]): AppAxes {
  return heavyAreasHit(declaration, [path], files).reduce((axes, area) => maxAxes(axes, area), declaration.axes);
}

function mergeAreas(a: AppArea[], b: AppArea[]): AppArea[] {
  const out: AppArea[] = a.map((area) => ({ ...area, paths: [...area.paths] }));
  for (const area of b) {
    const same = out.find((entry) => entry.name === area.name);
    if (same === undefined) {
      out.push({ ...area, paths: [...area.paths] });
      continue;
    }
    for (const path of area.paths) if (!same.paths.includes(path)) same.paths.push(path);
    for (const axis of AXES) {
      const value = area[axis];
      const current = same[axis];
      if (value !== undefined && (current === undefined || rank(axis, value) > rank(axis, current))) {
        (same as unknown as Record<string, string>)[axis] = value;
      }
    }
  }
  return out;
}

/**
 * 2つの宣言のうち厳しいほう。軸は軸ごとの最大、重い領域は和（同じ名前は1つにまとめ、パスは和、軸は最大）。
 * 片方が無ければもう片方。merge_gate は書くほど緩める向き（事後同意の前提）なので、
 * 両方が "user" のときだけ "user"（片方に宣言が無ければ undefined）
 */
export function strictest(a: AppDeclaration | undefined, b: AppDeclaration | undefined): AppDeclaration | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined || b === undefined) {
    const only = (a ?? b) as AppDeclaration;
    return { axes: { ...only.axes }, mergeGate: undefined, areas: mergeAreas(only.areas, []) };
  }
  return {
    axes: maxAxes(a.axes, b.axes),
    mergeGate: a.mergeGate === "user" && b.mergeGate === "user" ? "user" : undefined,
    areas: mergeAreas(a.areas, b.areas),
  };
}

// ---------------------------------------------------------------------------
// パスの照合

function normalizePath(path: string): string {
  let out = path.trim().replace(/^\.\//, "");
  // 末尾の / はディレクトリ。その下すべてとして扱う
  if (out.endsWith("/")) out = `${out}**`;
  return out;
}

const WILDCARD = /[*?]/;

/** `/` を含み、ワイルドカードが無い（どの階層のファイル名にも当たる素の名前は含めない） */
function isLiteral(path: string): boolean {
  return path.includes("/") && !WILDCARD.test(path);
}

/** 最初のワイルドカードを含むセグメントより前のディレクトリ。`/` を含まないパターンは "" */
function staticPrefix(path: string): string {
  if (!path.includes("/")) return "";
  const segments = path.split("/");
  const index = segments.findIndex((segment) => WILDCARD.test(segment));
  return (index === -1 ? segments : segments.slice(0, index)).join("/");
}

/** ワイルドカードを具体的な文字に置き換えた見本 */
function sample(path: string): string {
  return path.replace(/\*\*\//g, "").replace(/\*\*/g, "x").replace(/[*?]/g, "x");
}

function within(prefix: string, directory: string): boolean {
  return prefix === directory || prefix.startsWith(`${directory}/`);
}

function hasLiteralBasename(path: string): boolean {
  const basename = path.split("/").pop() ?? "";
  return basename !== "" && !WILDCARD.test(basename);
}

function pairOverlaps(x: string, y: string, files: string[]): boolean {
  const rx = ruleGlobToRegExp(x);
  const ry = ruleGlobToRegExp(y);
  // 字義どおりのパスは、もう片方のパターンで照合する。ディレクトリとして書かれていれば、その下も当たる
  if (isLiteral(x)) return ry.test(x) || (isLiteral(y) ? within(y, x) || within(x, y) : within(staticPrefix(y), x));
  if (isLiteral(y)) return rx.test(y) || within(staticPrefix(x), y);
  if (files.some((file) => rx.test(file) && ry.test(file))) return true;
  if (ry.test(sample(x)) || rx.test(sample(y))) return true;
  // 迷う形（どちらもファイル名を決めておらず、ディレクトリが重なる）は当たるに倒す。
  // 素の名前（`config.mts`）はファイル一覧と見本だけで照合する（どのディレクトリにも当たりうるとすると、
  // 設計の文書が触れる名前がすべての重い領域に当たってしまう）
  if (!x.includes("/") || !y.includes("/")) return false;
  if (hasLiteralBasename(x) || hasLiteralBasename(y)) return false;
  const px = staticPrefix(x);
  const py = staticPrefix(y);
  return px === "" || py === "" || within(px, py) || within(py, px);
}

/** 2つのパス（glob 可）が同じファイルに当たりうるか。迷う形は当たるに倒す */
export function overlaps(a: string, b: string, files: string[]): boolean {
  for (const x of expandBraces(normalizePath(a))) {
    for (const y of expandBraces(normalizePath(b))) {
      if (pairOverlaps(x, y, files)) return true;
    }
  }
  return false;
}

/** patterns のどれかに当たる重い領域 */
export function heavyAreasHit(declaration: AppDeclaration, patterns: string[], files: string[]): AppArea[] {
  return declaration.areas.filter((area) => area.paths.some((path) => patterns.some((pattern) => overlaps(path, pattern, files))));
}

/**
 * 文書がバッククォートで囲んだパスと glob。`/` か `*` を含むか、拡張子で終わるものを拾う。
 * 空白を含むもの（コマンド）、オプション（`-` で始まる）、URL、変数・プレースホルダは拾わない
 */
export function touchedPaths(markdown: string): string[] {
  const found: string[] = [];
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const token = (match[1] ?? "").trim();
    if (token === "" || /\s/.test(token)) continue;
    if (token.startsWith("-") || token.includes("://")) continue;
    if (/[$<>()|=:"']/.test(token)) continue;
    if (!(token.includes("/") || token.includes("*") || /\.[A-Za-z0-9]+$/.test(token))) continue;
    const path = token.replace(/^\.\//, "");
    if (!found.includes(path)) found.push(path);
  }
  return found;
}

// ---------------------------------------------------------------------------
// 基準の宣言

export interface Baseline {
  /** 基準のブランチ */
  branch: string;
  /** 読んだ ref（origin/<branch> か <branch>） */
  ref: string | undefined;
  /** merge-base のコミット */
  commit: string | undefined;
  /** 読めたときの宣言（宣言が無ければ undefined） */
  declaration: AppDeclaration | undefined;
  /** 読めなかった理由 */
  unavailable: string | undefined;
}

export interface EffectiveDeclaration {
  /** 作業ツリーと、読めた基準すべてのうち最も厳しい宣言。どこにも無ければ undefined（上限を設けない） */
  declaration: AppDeclaration | undefined;
  baselines: Baseline[];
  /** 読めなかった基準の説明 */
  notices: string[];
}

const CONFIG_FILE = ".hikyaku.config";

function resolveRef(repoRoot: string, branch: string): string | undefined {
  // マージ済みの写し（origin/）を先に採る。ローカルのブランチには PR を経ないコミットが載りうる
  return [`origin/${branch}`, branch].find((ref) => gitSync(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== undefined);
}

function readBaseline(config: ResolvedConfig, branch: string): Baseline {
  const miss = (unavailable: string, ref?: string, commit?: string): Baseline => ({ branch, ref, commit, declaration: undefined, unavailable });
  if (parseBranch(config.branch, branch) !== undefined) {
    return miss("Hikyaku のブランチはユーザーのマージを経ていないので、基準にしません");
  }
  const ref = resolveRef(config.repoRoot, branch);
  if (ref === undefined) return miss(`${branch} も origin/${branch} もありません`);
  const commit = gitSync(config.repoRoot, ["merge-base", "HEAD", ref])?.trim();
  if (commit === undefined || commit === "") return miss(`HEAD と ${ref} に共通の祖先がありません`, ref);
  if (gitSync(config.repoRoot, ["cat-file", "-e", `${commit}:${CONFIG_FILE}`]) === undefined) {
    // 基準にまだ設定ファイルが無い: 宣言なしとして読めた
    return { branch, ref, commit, declaration: undefined, unavailable: undefined };
  }
  const source = gitSync(config.repoRoot, ["show", `${commit}:${CONFIG_FILE}`]);
  if (source === undefined) return miss(`${ref} の ${CONFIG_FILE} を読めません`, ref, commit);
  try {
    const table = parseToml(source);
    const app = table["app"];
    if (app !== undefined && (typeof app !== "object" || Array.isArray(app))) throw new Error("[app] がテーブルではありません");
    return { branch, ref, commit, declaration: readAppDeclaration(app as TomlTable | undefined), unavailable: undefined };
  } catch (error) {
    return miss(`${ref} の ${CONFIG_FILE} の宣言を読めません: ${error instanceof Error ? error.message : String(error)}`, ref, commit);
  }
}

const effectiveCache = new WeakMap<ResolvedConfig, EffectiveDeclaration>();

/** 上限の判定に使う宣言。作業ツリーと、読めた基準すべてのうち最も厳しいもの */
export function effectiveDeclaration(config: ResolvedConfig): EffectiveDeclaration {
  const cached = effectiveCache.get(config);
  if (cached !== undefined) return cached;

  const notices: string[] = [];
  const branches: string[] = [];
  const fallback = defaultBranch(config.repoRoot);
  if (fallback === undefined) {
    notices.push("デフォルトブランチ（origin/HEAD）が分からないので、その基準の宣言を読めません（git remote set-head origin --auto で設定できます）");
  } else {
    branches.push(fallback);
  }
  const base = defaultBaseOf(config);
  if (base !== undefined && !branches.includes(base)) branches.push(base);

  const baselines = branches.map((branch) => readBaseline(config, branch));
  let declaration = config.app;
  for (const baseline of baselines) {
    if (baseline.unavailable !== undefined) {
      notices.push(`基準 ${baseline.branch} の宣言を読めません: ${baseline.unavailable}`);
      continue;
    }
    declaration = strictest(declaration, baseline.declaration);
  }
  const result: EffectiveDeclaration = { declaration, baselines, notices };
  effectiveCache.set(config, result);
  return result;
}

function lines(output: string | undefined, separator = "\n"): string[] {
  return (output ?? "").split(separator).map((line) => line.trim()).filter((line) => line !== "");
}

const filesCache = new WeakMap<ResolvedConfig, string[]>();

/** リポジトリのファイル一覧（追跡しているものと、無視されていない追跡外のもの） */
export function repositoryFiles(config: ResolvedConfig): string[] {
  const cached = filesCache.get(config);
  if (cached !== undefined) return cached;
  const files = lines(gitSync(config.repoRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]), "\0");
  filesCache.set(config, files);
  return files;
}

/**
 * このサイクルの ADR。読めた基準それぞれの merge-base から変わった・足された decisions のファイルの和と、
 * 追跡外のファイル。基準を1つも読めなければ decisions のファイルすべて（多めに拾う側に倒す）
 */
export function cycleAdrs(config: ResolvedConfig): string[] {
  let location: string | undefined;
  try {
    location = loadGuide(config.hikyakuRoot).find((entry) => entry.name === "decisions")?.path;
  } catch {
    return [];
  }
  if (location === undefined) return [];
  const commits = effectiveDeclaration(config).baselines.flatMap((baseline) =>
    baseline.unavailable === undefined && baseline.commit !== undefined ? [baseline.commit] : []);
  const found = new Set<string>();
  const add = (paths: string[]) => paths.forEach((path) => found.add(path));
  const repo = config.repoRoot;
  if (commits.length === 0) {
    add(lines(gitSync(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "--", location])));
  } else {
    for (const commit of commits) add(lines(gitSync(repo, ["diff", "--name-only", "--diff-filter=d", commit, "--", location])));
    add(lines(gitSync(repo, ["ls-files", "--others", "--exclude-standard", "--", location])));
  }
  return [...found].sort();
}
