/**
 * Stop フック — 手順の途中でセッションが止まろうとしたら、1回だけ続きを促す（#50）。
 *
 * 転送ループは「step next を呼び、返った1手を行い、step report で返す」の繰り返しで、
 * モデルが途中で報告を終えたつもりになると、ループが黙って切れる。止めるのは次のときだけ。
 *
 *   - このセッションが Hikyaku の手順を進めている（progress.jsonl に自分のセッション ID がある）
 *   - その作業単位の次の1手が run か call（gate・done・stop なら止まってよい）
 *   - 同じターンでまだ止めていない（stop_hook_active）。ステップの途中でユーザーに
 *     尋ねる箇所があるので、2回目は止めない
 *   - 最後の出力が非対話規約のブロックで終わっていない（conductor の子は、ブロックを
 *     出して終えるのが規約どおりの止まり方）
 *   - バックグラウンドで動いている作業（サブエージェント・Bash）が無い。待っているあいだに
 *     ターンを終えるのは、完了の通知を待つ正しい止まり方
 *   - このセッションが最後に記録したのが、セッションの切り替え（handover）ではない
 *
 * どこかで判定できなければ止めない。フックはプラグインを入れた全てのセッションで動くので、
 * Hikyaku を使っていないリポジトリや壊れた記録で、作業を妨げないため。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type ResolvedConfig } from "../config.mts";
import { currentPatchPhase, patchUnitDirectory } from "../patch.mts";
import { parseFinalText } from "../conductor.mts";
import { cyclesPath, loadCycles } from "../cycles.mts";
import { repoRoot } from "../paths.mts";
import { nextCommand, type Directive } from "./directive.mts";
import { directiveOf, locateSession } from "./locate.mts";

/** Claude Code が Stop フックに渡す入力のうち、使うもの */
export interface StopInput {
  session_id?: unknown;
  cwd?: unknown;
  stop_hook_active?: unknown;
  last_assistant_message?: unknown;
  /** 実行中のバックグラウンドの作業（サブエージェント・Bash など）。Claude Code が渡す */
  background_tasks?: unknown;
}

const CONTINUING: Directive["kind"][] = ["run", "call"];

/** 止めるなら、モデルに渡す理由。止めないなら undefined */
export function stopReason(input: StopInput): string | undefined {
  if (input.stop_hook_active === true) return undefined;
  if (typeof input.session_id !== "string" || input.session_id === "") return undefined;
  if (hasRunningBackgroundTask(input.background_tasks)) return undefined;
  if (typeof input.last_assistant_message === "string") {
    // 切り替え（handover）の blocked は、下で記録を確かめるので、ここでは規約どおりの止まり方として読む
    const parsed = parseFinalText(input.last_assistant_message, { isHandover: () => true });
    if (parsed.outcome === "gate" || parsed.outcome === "done" || parsed.outcome === "blocked") return undefined;
    // blocked を出したが行き詰まりの報告が欠けている。続きを促さず、欠けた節を書き足すよう返す（1回だけ）
    if (parsed.outcome === "violation" && /<hikyaku-blocked>/.test(input.last_assistant_message) && /行き詰まりの報告/.test(parsed.reason ?? "")) {
      return `${parsed.reason}\n欠けた節を書き足した blocked を出し直して終えてください。`;
    }
  }

  const from = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
  if (!existsSync(join(repoRoot(from), ".hikyaku.config"))) return undefined;
  if (from !== process.cwd()) process.chdir(from);

  const config = loadConfig();
  const records = existsSync(cyclesPath(config.hikyakuRoot)) ? loadCycles(config.hikyakuRoot) : [];
  const position = locateSession(config.hikyakuRoot, { records, explicit: false, patch: currentPatchUnit(config) }, input.session_id);
  if (position === undefined) return undefined;

  const { opened, directive } = directiveOf(position.unit);
  if (!CONTINUING.includes(directive.kind)) return undefined;
  // セッションを切り替えた（handover）なら、このセッションは終えてよい。続きは新しいセッションが同じステップから進める
  const own = opened.ctx.events.filter((event) => event.session === input.session_id);
  if (own.at(-1)?.result === "handover") return undefined;

  const where = `${directive.skill} ${directive.unit}${directive.cycle === null ? "" : ` ${directive.cycle}`}`;
  return [
    `Hikyaku の手順がまだ途中です（${where}: 次は ${directive.kind} ${directive.step ?? ""}「${directive.title ?? ""}」）。`,
    "次の1手を確かめて、続けてください:",
    `  ${nextCommand(opened)}`,
    "ユーザーへの問いで止まるところ、またはユーザーが中断や別の作業を指示したところなら、そのまま終えてかまいません（止めるのは1回だけです）。",
    "非対話で起動されている（conductor の子）なら、規約どおり最後にブロックを1つ出して終えてください。",
  ].join("\n");
}

/** 終わった作業の状態。これ以外（実行中・待機中・不明）は、まだ動いているとみなす */
const FINISHED = ["completed", "failed", "killed", "cancelled", "stopped"];

/** Stop の入力に、まだ終わっていないバックグラウンドの作業があるか */
function hasRunningBackgroundTask(tasks: unknown): boolean {
  if (!Array.isArray(tasks)) return false;
  return tasks.some((task) => {
    const status = typeof task === "object" && task !== null ? (task as Record<string, unknown>)["status"] : undefined;
    return typeof status !== "string" || !FINISHED.includes(status);
  });
}

/** 現在のブランチが patch のブランチなら、その作業単位（patches/{YYYYMM}/{slug}） */
function currentPatchUnit(config: ResolvedConfig): string | undefined {
  const phase = currentPatchPhase(config);
  return phase === undefined ? undefined : patchUnitDirectory(phase);
}
