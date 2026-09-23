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
export type Phase = "init" | "create" | "plan" | "architect" | "close" | `build-${string}`;

export const FIXED_PHASES = ["init", "create", "plan", "architect", "close"] as const;

const BUILD_PHASE = /^build-\d{2,}$/;

export function isPhase(value: string): value is Phase {
  return (FIXED_PHASES as readonly string[]).includes(value) || BUILD_PHASE.test(value);
}

export function buildPhase(buildId: string | number): Phase {
  const id = typeof buildId === "number" ? String(buildId) : buildId;
  return `build-${id.padStart(2, "0")}` as Phase;
}

export interface BranchNaming {
  prefix: string;
  separator: string;
}

/** init はサイクルに属さないので {prefix}{sep}init になる */
export function branchName(naming: BranchNaming, phase: Phase, cycle?: string): string {
  const parts = phase === "init" ? [phase] : [cycle ?? "", phase];
  if (phase !== "init" && (cycle === undefined || cycle === "")) {
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

  if (rest === "init") return { cycle: undefined, phase: "init" };

  // 末尾から既知のフェーズを剥がす
  for (const phase of FIXED_PHASES) {
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
