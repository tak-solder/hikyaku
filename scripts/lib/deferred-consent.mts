/**
 * 事後同意（[consent] deferred）が有効かの判定（ADR 20261116-deferred-consent・design-delta 3節）。
 *
 * サイクル設定の [consent] deferred = true は、上限を超えるリスクの受け入れの同意をマージの前の同意ゲートへ
 * 遅らせる。緩める向きの設定なので、作業中のブランチで AI が書いただけでは効かせない。有効になるのは、
 * 次のすべてを満たすときだけ:
 *
 *   - サイクル設定に deferred = true がある（requested）
 *   - conductor の子でない（conductor での扱いは build-07。それまでは安全側）
 *   - 基準の宣言を読めない回（incomplete）でない
 *   - [app] にマージがユーザーの関門である前提（merge_gate = "user"）があり、それが作業ツリーと読めた基準すべてで
 *     書かれている（effectiveDeclaration の strictest の論理積）
 *   - 次のどちらか
 *     (a) planner の G1 の承認の記録（planning/progress.jsonl の deferredConsent）が true。G1 で提示し、
 *         ユーザーが要件と一緒に合意した値
 *     (b) 基準（デフォルトブランチと defaultBase。それぞれ origin/<branch> とローカル）のすべての merge-base の
 *         サイクル設定に deferred = true がある。ユーザーがマージしたコミットで入った値。読めない基準・Hikyaku の
 *         ブランチが1つでもあれば成り立たない。PR のマージ先（スタック元・conductor ブランチ）は使わない
 *
 * git を読むので loadConfig の中では計算せず、ResolvedConfig とサイクルのディレクトリを鍵にキャッシュする。
 * consent.mts（conductor の子の判定）は ledger.mts 経由で steps/ と循環するので import せず、環境変数を直接読む。
 */

import { join, relative, sep } from "node:path";
import { readConsent, type ResolvedConfig } from "./config.mts";
import { defaultBranch, gitSync } from "./git.mts";
import { readProgress, RESTART } from "./progress.mts";
import { effectiveDeclaration } from "./risk.mts";
import { parseToml, type TomlTable } from "./toml.mts";

export interface DeferredConsent {
  /** サイクル設定に [consent] deferred = true がある */
  requested: boolean;
  effective: boolean;
  /** 判定の理由（有効でないときは、最初に外れた条件） */
  reason: string;
}

const CONFIG_FILE = ".hikyaku.config";

function isConductorChild(): boolean {
  return process.env["HIKYAKU_CONDUCTOR_CHILD"] === "1";
}

const cache = new WeakMap<ResolvedConfig, Map<string, DeferredConsent>>();

/** 事後同意が有効か。requested でなければ git も記録も読まない */
export function deferredConsent(config: ResolvedConfig, cycleDirectory: string | undefined): DeferredConsent {
  if (config.consent.deferred !== true) {
    return { requested: false, effective: false, reason: "サイクル設定に [consent] deferred = true がありません" };
  }
  // conductor の子かどうかで結果が変わる（監督が asConductorChild で子として評価する）ので鍵に含める
  const key = `${isConductorChild() ? "child" : "self"}:${cycleDirectory ?? ""}`;
  let entries = cache.get(config);
  if (entries === undefined) {
    entries = new Map();
    cache.set(config, entries);
  }
  const cached = entries.get(key);
  if (cached !== undefined) return cached;
  const result = compute(config, cycleDirectory);
  entries.set(key, result);
  return result;
}

function compute(config: ResolvedConfig, cycleDirectory: string | undefined): DeferredConsent {
  const no = (reason: string): DeferredConsent => ({ requested: true, effective: false, reason });
  if (isConductorChild()) return no("conductor の子では事後同意を有効にしません（conductor での扱いはまだ入っていません）");
  if (cycleDirectory === undefined) return no("サイクルが分からないので、G1 の記録も基準のサイクル設定も読めません");
  const effective = effectiveDeclaration(config);
  if (effective.incomplete) return no("基準の宣言を読めず、マージがユーザーの関門である前提を確かめられません");
  if (effective.declaration?.mergeGate !== "user") {
    return no("[app] にマージがユーザーの関門である前提（merge_gate = \"user\"）が、作業ツリーと基準のブランチの両方に書かれていません");
  }
  if (g1Recorded(cycleDirectory)) return { requested: true, effective: true, reason: "G1 で提示し、承認された値" };
  const merged = mergedValue(config, cycleDirectory);
  if (merged === undefined) return { requested: true, effective: true, reason: "基準のブランチにマージされた値" };
  return no(`G1 の承認の記録に値が無く、${merged}`);
}

/**
 * planner の今回の手順（最後の step restart より後）で、G1 の最新の記録が承認で、その deferredConsent が true か。
 * 最新が差し戻し（rejected）なら、その前の承認は数えない。記録を読めなければ false
 */
function g1Recorded(cycleDirectory: string): boolean {
  let events;
  try {
    events = readProgress(join(cycleDirectory, "planning"));
  } catch {
    return false;
  }
  const restart = events.findLastIndex((event) => event.skill === "planner" && event.result === RESTART);
  const g1 = events.slice(restart + 1).filter((event) => event.skill === "planner" && event.step === "G1");
  const latest = g1[g1.length - 1];
  return latest?.result === "approved" && latest.deferredConsent === true;
}

/**
 * (b) 基準のすべての merge-base のサイクル設定に deferred = true があるか。あれば undefined、無ければ理由。
 * 基準は effectiveDeclaration が読んだものを使う（上限と同じ基準。PR のマージ先は含まない）
 */
function mergedValue(config: ResolvedConfig, cycleDirectory: string): string | undefined {
  if (defaultBranch(config.repoRoot) === undefined) {
    return "デフォルトブランチ（origin/HEAD）が分からないので、マージされた値を確かめられません（git remote set-head origin --auto で設定できます）";
  }
  const baselines = effectiveDeclaration(config).baselines;
  const unreadable = baselines.find((baseline) => baseline.unavailable !== undefined || baseline.commit === undefined);
  if (baselines.length === 0 || unreadable !== undefined) {
    return `基準のブランチを読めないので、マージされた値を確かめられません${unreadable?.unavailable === undefined ? "" : `（${unreadable.unavailable}）`}`;
  }
  const path = relative(config.repoRoot, join(cycleDirectory, CONFIG_FILE)).split(sep).join("/");
  for (const baseline of baselines) {
    const at = baseline.ref ?? baseline.branch;
    const listed = gitSync(config.repoRoot, ["ls-tree", "--name-only", baseline.commit as string, "--", path]);
    if (listed === undefined) return `基準 ${at} のサイクル設定を読めません`;
    if (listed.trim() === "") return `基準 ${at} にサイクル設定がありません（マージされていない値は効きません）`;
    const source = gitSync(config.repoRoot, ["show", `${baseline.commit as string}:${path}`]);
    if (source === undefined) return `基準 ${at} のサイクル設定を読めません`;
    let value: boolean | undefined;
    try {
      const table = parseToml(source);
      const raw = table["consent"];
      if (raw !== undefined && (typeof raw !== "object" || Array.isArray(raw))) throw new Error("[consent] がテーブルではありません");
      value = readConsent(raw as TomlTable | undefined).deferred;
    } catch (error) {
      return `基準 ${at} のサイクル設定を読めません: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (value !== true) return `基準 ${at} のサイクル設定に [consent] deferred = true がありません（マージされていない値は効きません）`;
  }
  return undefined;
}

/** requested なのに有効でないときの notices の行（有効なとき・requested でないときは undefined） */
export function deferredConsentNotice(config: ResolvedConfig, cycleDirectory: string | undefined): string | undefined {
  const judged = deferredConsent(config, cycleDirectory);
  if (!judged.requested || judged.effective) return undefined;
  return `事後同意（[consent] deferred）は有効になっていません: ${judged.reason}。上限を超える受け入れは、その場でユーザーの同意を取ります`;
}

/**
 * G1 の承認で記録する値。requested でなければ false。提示したあとに書き換えた値を承認として残さないよう、
 * サイクル設定に未コミットの変更がある・git を読めない・最後のコミットが最後の提示の起点（presentedAfter:
 * G1 の直前に完了したステップか、その後の G1 の差し戻しのうち最後の記録の時刻）より後、のどれかなら false と、
 * その理由を返す。提示した時刻そのものは記録に無いので、起点より後の提示はすべてその後に行われたとみなす。
 * 値を変えるときは、設定を直してコミットしてから差し戻しを報告し、提示し直す（G1.md）
 */
export function g1ConsentRecord(
  config: ResolvedConfig,
  cycleDirectory: string,
  presentedAfter: string | undefined,
): { value: boolean; note?: string } {
  if (config.consent.deferred !== true) return { value: false };
  const refuse = (note: string) => ({ value: false, note: `事後同意の値を false で記録しました: ${note}` });
  if (presentedAfter === undefined) return refuse("G1 の前に完了したステップの記録が無く、提示の時刻が分かりません");
  const path = join(cycleDirectory, CONFIG_FILE);
  const status = gitSync(config.repoRoot, ["status", "--porcelain", "--", path]);
  if (status === undefined) return refuse("git でサイクル設定の状態を読めません");
  if (status.trim() !== "") return refuse("サイクル設定に未コミットの変更があります（提示した値として確かめられません）");
  const committed = gitSync(config.repoRoot, ["log", "-1", "--format=%cI", "--", path])?.trim();
  if (committed === undefined || committed === "") return refuse("サイクル設定のコミットを読めません");
  const committedAt = new Date(committed).getTime();
  const presentedAt = new Date(presentedAfter).getTime();
  if (Number.isNaN(committedAt) || Number.isNaN(presentedAt)) return refuse("サイクル設定のコミットの時刻を読めません");
  // コミットの時刻は秒の精度なので、提示と同じ秒のコミットは提示より後とみなす（安全側）
  if (committedAt >= Math.floor(presentedAt / 1000) * 1000) return refuse("サイクル設定の最後のコミットが G1 の提示より後です（提示したあとに書き換えた値は記録しません）");
  return { value: true };
}
