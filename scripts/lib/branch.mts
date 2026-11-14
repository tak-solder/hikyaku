/**
 * ブランチ名の生成と解析。
 *
 *   {prefix}{separator}{cycle}{separator}{phase}
 *
 * ブランチ名は解析対象（着手状態の導出に使う）なので、構造を固定する。
 * separator を "-" にしても解析できるのは、phase が閉じた集合だから:
 * prefix を前から、phase を後ろから剥がせば cycle が残る。
 * cycle slug 自体が "-" を含んでいても、末尾から既知の phase を剥がすので破綻しない。
 */

import { HikyakuError } from "./errors.mts";

/** フェーズは閉じた集合。これがブランチ名の解析を成立させている */
export type Phase =
  | "init"
  | "token-guide"
  | "create"
  | "plan"
  | "architect"
  | "close"
  | "conductor"
  | `build-${string}`
  | `patch-${string}`;

/**
 * サイクルに属さないフェーズ。ブランチ名は {prefix}{sep}{phase} になる。
 * init はワークスペースの初期化、token-guide は予測ピークのガイドの校正（どちらもサイクル横断）
 */
export const CYCLELESS_PHASES = ["init", "token-guide"] as const;

/**
 * conductor はフェーズではなく、/hikyaku:conductor がサイクルの作業を集める統合ブランチ。
 * 各フェーズのブランチはここから切り、PR もここへ向ける。ブランチ名の解析と
 * スタック元の導出に参加させるため、フェーズと同じ閉じた集合に入れる
 */
export const FIXED_PHASES = ["init", "token-guide", "create", "plan", "architect", "close", "conductor"] as const;

export function isCyclelessPhase(phase: string): boolean {
  return (CYCLELESS_PHASES as readonly string[]).includes(phase);
}

const BUILD_PHASE = /^build-\d{2,}$/;

/**
 * patch（/hikyaku:patch）の作業単位。patch-{YYYYMM}-{slug}。
 *
 * サイクルに属さないことも、進行中のサイクルに属すこともある。どちらでもブランチ名は
 * {prefix}{sep}patch{sep}{YYYYMM}{sep}{slug} で、記録は patches/{YYYYMM}/{slug}/ に置く
 * （サイクルに属すならサイクルのディレクトリの下、属さないなら HIKYAKU_ROOT の下）。
 * 年月を名前に含めるのは、記録の場所をブランチ名から一意に導くため（別の月の同じ slug と区別する）
 */
const PATCH_PHASE = /^patch-(\d{4}(?:0[1-9]|1[0-2]))-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export interface PatchId {
  /** YYYYMM */
  month: string;
  slug: string;
}

export function parsePatchPhase(value: string): PatchId | undefined {
  const match = PATCH_PHASE.exec(value);
  return match === null ? undefined : { month: match[1] as string, slug: match[2] as string };
}

export function isPatchPhase(value: string): boolean {
  return PATCH_PHASE.test(value);
}

export function patchPhase(id: PatchId): Phase {
  return `patch-${id.month}-${id.slug}` as Phase;
}

export function isPhase(value: string): value is Phase {
  return (FIXED_PHASES as readonly string[]).includes(value) || BUILD_PHASE.test(value) || PATCH_PHASE.test(value);
}

export function buildPhase(buildId: string | number): Phase {
  const id = typeof buildId === "number" ? String(buildId) : buildId;
  return `build-${id.padStart(2, "0")}` as Phase;
}

export interface BranchNaming {
  prefix: string;
  separator: string;
}

/**
 * init / token-guide はサイクルに属さないので {prefix}{sep}{phase} になる。
 * patch はサイクルの有無に関わらず {prefix}{sep}patch{sep}{YYYYMM}{sep}{slug}
 */
export function branchName(naming: BranchNaming, phase: Phase, cycle?: string): string {
  const patch = parsePatchPhase(phase);
  if (patch !== undefined) {
    const body = ["patch", patch.month, patch.slug].join(naming.separator);
    return naming.prefix === "" ? body : `${naming.prefix}${naming.separator}${body}`;
  }
  const parts = isCyclelessPhase(phase) ? [phase] : [cycle ?? "", phase];
  if (!isCyclelessPhase(phase) && (cycle === undefined || cycle === "")) {
    throw new HikyakuError(`フェーズ ${phase} のブランチ名にはサイクルが必要です`);
  }
  const body = parts.join(naming.separator);
  return naming.prefix === "" ? body : `${naming.prefix}${naming.separator}${body}`;
}

export interface ParsedBranch {
  cycle: string | undefined;
  phase: Phase;
}

/**
 * ブランチ名からサイクルとフェーズを取り出す。
 * Hikyaku が作ったものでなければ undefined を返す。
 */
export function parseBranch(naming: BranchNaming, name: string): ParsedBranch | undefined {
  const { prefix, separator } = naming;
  if (separator === "") return undefined;

  let rest = name;
  if (prefix !== "") {
    const head = `${prefix}${separator}`;
    if (!rest.startsWith(head)) return undefined;
    rest = rest.slice(head.length);
  }

  for (const phase of CYCLELESS_PHASES) {
    if (rest === phase) return { cycle: undefined, phase };
  }

  // patch はサイクルより先に見る。サイクル名は数字で始まるので patch とは重ならないが、
  // slug が close などのフェーズ名で終わると、末尾から剥がす解析では取り違える
  const patchHead = `patch${separator}`;
  if (rest.startsWith(patchHead)) {
    const tail = rest.slice(patchHead.length);
    const month = tail.slice(0, 6);
    const slug = tail.slice(6 + separator.length);
    if (/^\d{6}$/.test(month) && tail.slice(6, 6 + separator.length) === separator) {
      const phase = `patch-${month}-${slug}`;
      if (isPatchPhase(phase)) return { cycle: undefined, phase: phase as Phase };
    }
    return undefined;
  }

  // 末尾から既知のフェーズを剥がす（サイクルに属さないフェーズは上で完全一致のみ）
  for (const phase of FIXED_PHASES) {
    if (isCyclelessPhase(phase)) continue;
    const tail = `${separator}${phase}`;
    if (rest.endsWith(tail)) {
      const cycle = rest.slice(0, -tail.length);
      return cycle === "" ? undefined : { cycle, phase };
    }
  }

  const buildTail = new RegExp(`${escapeRegExp(separator)}(build-\\d{2,})$`);
  const match = buildTail.exec(rest);
  if (match?.[1]) {
    const cycle = rest.slice(0, match.index);
    return cycle === "" ? undefined : { cycle, phase: match[1] as Phase };
  }

  return undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * PR タイトルのテンプレートを展開する。
 *
 * 空になった変数は、その前後の区切り文字ごと詰める。そうしないと
 * init のようにサイクルを持たないフェーズで "[hikyaku] : init" のような
 * 見苦しい出力になる。空変数を番兵で追跡してから詰めることで、
 * 正常な区切り（"{cycle}: {phase}" のコロン）は残す。
 */
const EMPTY = "\u0000";
const DELIMITERS = String.raw`[:,\-\u2013\u2014]`;

export function renderPrTitle(
  template: string,
  values: { cycle?: string; phase?: string; buildId?: string; title?: string },
): string {
  const cycle = values.cycle ?? "";
  const [cycleId = "", ...nameParts] = cycle.split("-");
  const fill = (value: string): string => (value === "" ? EMPTY : value);

  const substituted = template
    .replace(/\{cycle\}/g, fill(cycle))
    .replace(/\{cycle_id\}/g, fill(cycleId))
    .replace(/\{cycle_name\}/g, fill(nameParts.join("-")))
    .replace(/\{phase\}/g, fill(values.phase ?? ""))
    .replace(/\{build_id\}/g, fill(values.buildId ?? ""))
    .replace(/\{title\}/g, fill(values.title ?? ""));

  return substituted
    // 空変数に隣接する区切り文字を落とす
    .replace(new RegExp(`${EMPTY}\\s*${DELIMITERS}\\s*`, "g"), " ")
    .replace(new RegExp(`\\s*${DELIMITERS}\\s*${EMPTY}`, "g"), " ")
    .replace(new RegExp(EMPTY, "g"), "")
    .replace(/\s{2,}/g, " ")
    .replace(new RegExp(`\\s*${DELIMITERS}\\s*$`), "")
    .trim();
}
