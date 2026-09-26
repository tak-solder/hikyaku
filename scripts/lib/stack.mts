/**
 * フェーズの解決と、スタック元の導出。
 *
 * PR のマージ先（pr base）と、差分を測る基準（bp actual）は同じ答えでなければ
 * ならない。基準がずれると、PR に含まれない差分を測ったり、逆に先行ビルドの
 * 差分まで数えたりする。導出をここに1つだけ置くのはそのため。
 */

import { flagString, type ParsedArgs } from "./args.mts";
import { isCyclelessPhase, isPhase, parseBranch, type Phase } from "./branch.mts";
import { loadConfig, type ResolvedConfig } from "./config.mts";
import { HikyakuError } from "./errors.mts";
import {
  defaultBranch,
  listKnownBranches,
  localSha,
  nearestAncestorBranch,
  type KnownBranch,
} from "./git.mts";
import { normalizeBuildId } from "./tasklist.mts";
import { resolveViews } from "./views.mts";
import { openCycle, type CycleContext } from "./workspace.mts";

export function requirePhase(raw: string | undefined): Phase {
  if (raw === undefined) {
    throw new HikyakuError(
      "フェーズを指定してください",
      "使用できる値: init | bp-guide | create | plan | architect | build-NN | close",
    );
  }
  if (!isPhase(raw)) {
    throw new HikyakuError(
      `フェーズの値が不正です: ${raw}`,
      "使用できる値: init | bp-guide | create | plan | architect | build-NN（NN は2桁以上の数字）| close",
    );
  }
  return raw;
}

export interface Scope {
  /** サイクル固有設定を重ねた設定。init ではリポジトリルートの設定 */
  config: ResolvedConfig;
  cycle: string | undefined;
  /** init 以外では対象サイクル。スタック元の導出に使う */
  context: CycleContext | undefined;
}

/**
 * 対象サイクルと、そのサイクルの設定を決める。
 * init はサイクルに属さないのでリポジトリルートの設定だけを使う。
 *
 * 明示指定があっても解決を通す。[branch] / [pr] / [session] はサイクル側で
 * 上書きできるため、サイクルディレクトリを特定しないと名前を組み立てられない。
 * 引数を ID や slug で渡されたときにディレクトリ名へ正規化されるのも、
 * 解決を通す副次的な効果（`002` から `002-billing` のブランチ名が出る）。
 */
export function scopeFor(args: ParsedArgs, phase: Phase, operand: string | undefined): Scope {
  if (isCyclelessPhase(phase)) {
    return {
      config: loadConfig({ root: flagString(args, "root") }),
      cycle: undefined,
      context: undefined,
    };
  }
  const opened = openCycle(args, operand);
  return { config: opened.config, cycle: opened.context.name, context: opened.context };
}

/**
 * スタック元のブランチを導出する。
 *
 * デフォルトブランチへマージせず、先行フェーズのブランチから積んだ場合、
 * PR の base はデフォルトブランチではなくそのブランチになる。状態は保存せず、
 * 「同じサイクルの Hikyaku ブランチのうち、HEAD の祖先で、まだ base に
 * 取り込まれていない、最も近いもの」として導出する。
 *
 * 取り込み済みの判定は2つ併用する。
 *
 *   祖先関係      git merge-base --is-ancestor で base に含まれるか
 *   base の PR 列  そのビルドの PR 列がデフォルトブランチで非空か
 *
 * 後者が要るのは、**squash merge / rebase merge ではマージ済みでも
 * ブランチの先端が base の祖先にならない**ため。どれだけ fetch しても
 * 祖先関係は false のままなので、Hikyaku 自身の完了の定義で補う。
 *
 * 積んでいなければ undefined を返す（＝PR の base はデフォルトブランチ）。
 */
export async function stackParent(
  config: ResolvedConfig,
  context: CycleContext | undefined,
  phase: Phase,
  base: string | undefined,
  options: { fetch: boolean },
): Promise<KnownBranch | undefined> {
  if (context === undefined) return undefined;

  const views = await resolveViews(config, context, { fetch: options.fetch });

  const candidates = (await listKnownBranches(config.repoRoot)).filter((branch) => {
    if (branch.name === base) return false;
    const parsed = parseBranch(config.branch, branch.name);
    if (parsed === undefined || parsed.cycle !== context.name || parsed.phase === phase) {
      return false;
    }
    // マージ済みのビルドは、祖先関係に関わらずスタック元にならない
    const buildId = /^build-(\d+)$/.exec(parsed.phase)?.[1];
    if (buildId !== undefined && views.mergedIds?.has(normalizeBuildId(buildId)) === true) {
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return undefined;

  const baseRefs: string[] = [];
  if (base !== undefined) {
    for (const ref of [`origin/${base}`, base]) {
      if ((await localSha(config.repoRoot, ref)) !== undefined) baseRefs.push(ref);
    }
  }

  // 取り込み済みを1つも除外できないなら、スタック元を推測しない。
  // この状態で祖先を拾うと、既にマージ済みのブランチや無関係のブランチへ
  // PR を向けることになる。デフォルトブランチへフォールバックするほうが安全
  if (views.mergedIds === undefined && baseRefs.length === 0) return undefined;

  return nearestAncestorBranch(config.repoRoot, candidates, baseRefs);
}

/**
 * ブランチ名を、ローカルで解決できる ref に直す。
 *
 * 追跡参照しか無いブランチ名をそのまま git merge-base に渡すと解決に失敗し、
 * コミット済み差分が空のまま扱われる（= 差分ゼロに見える）。
 */
export async function resolvableRef(
  repoRoot: string,
  branch: string,
): Promise<string | undefined> {
  if ((await localSha(repoRoot, branch)) !== undefined) return branch;
  const tracking = `origin/${branch}`;
  if ((await localSha(repoRoot, tracking)) !== undefined) return tracking;
  return undefined;
}

export interface PrBase {
  /** PR の base に渡すブランチ名 */
  base: string;
  /** ローカルで解決できる ref（git merge-base / git diff に渡す） */
  ref: string | undefined;
  /** 積んでいる場合のスタック元 */
  stacked: KnownBranch | undefined;
  /** 設定または自動検出のデフォルトブランチ */
  defaultBase: string | undefined;
}

/**
 * PR のマージ先と、その ref を導出する。
 *
 * **PR を作るときも、差分を測るときも、基準はこの1つ。**
 */
export async function resolvePrBase(
  scope: Scope,
  phase: Phase,
  options: { fetch: boolean },
): Promise<PrBase> {
  const { config, context } = scope;
  const defaultBase = config.baseBranch ?? defaultBranch(config.repoRoot);
  const stacked = await stackParent(config, context, phase, defaultBase, options);
  const base = stacked?.name ?? defaultBase;

  if (base === undefined) {
    throw new HikyakuError(
      "PR のマージ先を決められません",
      "base_branch を設定するか、origin/HEAD が解決できる状態にしてください。",
    );
  }

  return { base, ref: await resolvableRef(config.repoRoot, base), stacked, defaultBase };
}
