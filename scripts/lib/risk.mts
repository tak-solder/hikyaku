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
 * G3・G4 の同意の判定（steps/architect.mts）がこの上限を使う。境界（[boundaries]）はまだ判定に使わない（build-12）。
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

function basenameOf(path: string): string {
  return path.split("/").pop() ?? "";
}

function hasLiteralBasename(path: string): boolean {
  const basename = basenameOf(path);
  return basename !== "" && !WILDCARD.test(basename);
}

/** 素の名前（`/` もワイルドカードも無い `config.mts`）。どのディレクトリにもありうるので、見本の材料にしない */
function isBareName(path: string): boolean {
  return !path.includes("/") && !WILDCARD.test(path);
}

function pairOverlaps(x: string, y: string, files: string[]): boolean {
  if (isLiteral(x) && isLiteral(y)) return x === y || within(x, y) || within(y, x);
  if (isLiteral(y)) return pairOverlaps(y, x, files);
  const rx = ruleGlobToRegExp(x);
  const ry = ruleGlobToRegExp(y);
  if (isLiteral(x)) {
    if (ry.test(x)) return true;
    // 拡張子の無い字義どおりのパスはディレクトリかもしれない。その下すべての glob として照合し直す
    return !/\.[A-Za-z0-9]+$/.test(basenameOf(x)) && pairOverlaps(`${x}/**`, y, files);
  }
  if (files.some((file) => rx.test(file) && ry.test(file))) return true;
  // 見本: 片方のワイルドカードを置き換えたパスと、片方のディレクトリにもう片方のファイル名を置いたパス。
  // どちらにも当たる見本があれば、まだ無いファイルでも重なりうる
  const candidates = [sample(x), sample(y)];
  if (!isBareName(x)) candidates.push([staticPrefix(y), sample(basenameOf(x))].filter(Boolean).join("/"));
  if (!isBareName(y)) candidates.push([staticPrefix(x), sample(basenameOf(y))].filter(Boolean).join("/"));
  if (candidates.some((candidate) => rx.test(candidate) && ry.test(candidate))) return true;
  // 迷う形（どちらもファイル名を決めておらず、ディレクトリが重なる）は当たるに倒す。
  // 素の名前（`config.mts`）はファイル一覧だけで照合する（どのディレクトリにも当たりうるとすると、
  // 設計の文書が触れる名前がすべての重い領域に当たってしまう）
  if (isBareName(x) || isBareName(y)) return false;
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
    // 版の番号（3.0.0・v1.2）は拡張子で終わる形でもパスではない
    if (/^v?\d+(\.\d+)+$/.test(token)) continue;
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
  /** 読んだ ref（origin/<branch> か <branch>。両方あれば両方を別の Baseline として読む） */
  ref: string | undefined;
  /** merge-base のコミット */
  commit: string | undefined;
  /** 読めたときの宣言（宣言が無ければ undefined） */
  declaration: AppDeclaration | undefined;
  /** 読めなかった理由 */
  unavailable: string | undefined;
  /** 設定ファイルはあるのに、宣言を読めなかった（壊れている・この版の検査を通らない） */
  unreadableDeclaration?: boolean;
}

export interface EffectiveDeclaration {
  /** 作業ツリーと、読めた基準すべてのうち最も厳しい宣言。どこにも無ければ undefined（上限を設けない） */
  declaration: AppDeclaration | undefined;
  baselines: Baseline[];
  /** 読めなかった基準の説明 */
  notices: string[];
  /**
   * 設定ファイルがあるのに宣言を読めなかった基準がある。その基準がどれだけ厳しいかが分からないので、
   * ゲートの判定（build-15）は上げる向き（同意）に倒す
   */
  incomplete: boolean;
}

const CONFIG_FILE = ".hikyaku.config";

/**
 * 基準のブランチの宣言を、origin/<branch> とローカルの <branch> の両方から読めるだけ読む。
 * どちらか一方だけを採ると、PR を経ないローカルのコミットで緩めるか、fetch していない古い origin/ が
 * ローカルでマージ済みのより厳しい宣言に勝つかのどちらかが起きる。両方を厳しいほうで重ねれば、どちらも防げる
 */
function readBaselines(config: ResolvedConfig, branch: string): Baseline[] {
  if (isHikyakuBranch(config, branch)) {
    return [{ branch, ref: undefined, commit: undefined, declaration: undefined, unavailable: "Hikyaku のブランチはユーザーのマージを経ていないので、基準にしません" }];
  }
  const refs = [`origin/${branch}`, branch].filter((ref) => gitSync(config.repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== undefined);
  if (refs.length === 0) {
    return [{ branch, ref: undefined, commit: undefined, declaration: undefined, unavailable: `${branch} も origin/${branch} もありません` }];
  }
  return refs.map((ref) => readBaselineAt(config, branch, ref));
}

function readBaselineAt(config: ResolvedConfig, branch: string, ref: string): Baseline {
  const miss = (unavailable: string, ref?: string, commit?: string): Baseline => ({ branch, ref, commit, declaration: undefined, unavailable });
  const commit = gitSync(config.repoRoot, ["merge-base", "HEAD", ref])?.trim();
  if (commit === undefined || commit === "") return miss(`HEAD と ${ref} に共通の祖先がありません`, ref);
  // ls-tree は、ファイルが無ければ空を返して成功し、git が失敗したときだけ失敗する（cat-file -e は両方で失敗し、
  // git の失敗を「設定ファイルが無い」と読んで基準の宣言を落としてしまう）
  const listed = gitSync(config.repoRoot, ["ls-tree", "--name-only", commit, "--", CONFIG_FILE]);
  if (listed === undefined) return { ...miss(`${ref} の ${CONFIG_FILE} の有無を確かめられません`, ref, commit), unreadableDeclaration: true };
  if (listed.trim() === "") {
    // 基準にまだ設定ファイルが無い: 宣言なしとして読めた
    return { branch, ref, commit, declaration: undefined, unavailable: undefined };
  }
  const source = gitSync(config.repoRoot, ["show", `${commit}:${CONFIG_FILE}`]);
  if (source === undefined) return { ...miss(`${ref} の ${CONFIG_FILE} を読めません`, ref, commit), unreadableDeclaration: true };
  try {
    const table = parseToml(source);
    const app = table["app"];
    if (app !== undefined && (typeof app !== "object" || Array.isArray(app))) throw new Error("[app] がテーブルではありません");
    return { branch, ref, commit, declaration: readAppDeclaration(app as TomlTable | undefined), unavailable: undefined };
  } catch (error) {
    const baseline = miss(`${ref} の ${CONFIG_FILE} の宣言を読めません: ${error instanceof Error ? error.message : String(error)}`, ref, commit);
    return { ...baseline, unreadableDeclaration: true };
  }
}

/** 既定の命名規則（サイクルごとに規則を変えていても、既定の規則のブランチは Hikyaku のもの） */
const DEFAULT_NAMING = { prefix: "hikyaku", separator: "/" };

function isHikyakuBranch(config: ResolvedConfig, branch: string): boolean {
  return parseBranch(config.branch, branch) !== undefined || parseBranch(DEFAULT_NAMING, branch) !== undefined;
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
  // stack.mts の defaultBaseOf と同じ（base_branch か、デフォルトブランチ）。デフォルトブランチを読み直さない
  const base = config.baseBranch ?? fallback;
  if (base !== undefined && !branches.includes(base)) branches.push(base);

  const baselines: Baseline[] = [];
  let declaration = config.app;
  for (const branch of branches) {
    const read = readBaselines(config, branch);
    baselines.push(...read);
    const failed = read.filter((baseline) => baseline.unavailable !== undefined);
    if (failed.length === read.length) {
      notices.push(`基準 ${branch} の宣言を読めません: ${failed.map((baseline) => baseline.unavailable).join(" / ")}`);
    } else {
      // 片方の ref だけ読めないときも、設定ファイルがあるのに読めなかったものは知らせる
      for (const baseline of failed) {
        if (baseline.unreadableDeclaration === true) notices.push(`基準 ${baseline.ref ?? branch} の宣言を読めません: ${baseline.unavailable}`);
      }
    }
    for (const baseline of read) {
      if (baseline.unavailable === undefined) declaration = strictest(declaration, baseline.declaration);
    }
  }
  // 厳しさの分からない基準がある: 設定ファイルはあるのに宣言を読めなかったか、作業ツリーが宣言しているのに
  // 基準を1つも読めなかった（作業ツリーの宣言だけで、セッションが自分の上限を緩められる）
  const noneReadable = baselines.every((baseline) => baseline.unavailable !== undefined);
  const result: EffectiveDeclaration = {
    declaration,
    baselines,
    notices,
    incomplete: baselines.some((baseline) => baseline.unreadableDeclaration === true) || (noneReadable && config.app !== undefined),
  };
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
  // document-guide.md を読めなければエラーのまま返す（空を返すと「ADR に触れていない」と読まれる）
  const location = loadGuide(config.hikyakuRoot).find((entry) => entry.name === "decisions")?.path;
  if (location === undefined) return [];
  const commits = effectiveDeclaration(config).baselines.flatMap((baseline) =>
    baseline.unavailable === undefined && baseline.commit !== undefined ? [baseline.commit] : []);
  const found = new Set<string>();
  const add = (paths: string[]) => paths.forEach((path) => found.add(path));
  const repo = config.repoRoot;
  // -z で読む（既定では日本語のファイル名が引用符と8進のエスケープで返る）
  if (commits.length === 0) {
    add(lines(gitSync(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", location]), "\0"));
  } else {
    for (const commit of commits) add(lines(gitSync(repo, ["diff", "-z", "--name-only", "--diff-filter=d", commit, "--", location]), "\0"));
    add(lines(gitSync(repo, ["ls-files", "-z", "--others", "--exclude-standard", "--", location]), "\0"));
  }
  return [...found].sort();
}
