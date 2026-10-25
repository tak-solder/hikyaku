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
 *
 * どこかで判定できなければ止めない。フックはプラグインを入れた全てのセッションで動くので、
 * Hikyaku を使っていないリポジトリや壊れた記録で、作業を妨げないため。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config.mts";
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
}

const CONTINUING: Directive["kind"][] = ["run", "call"];

/** 止めるなら、モデルに渡す理由。止めないなら undefined */
export function stopReason(input: StopInput): string | undefined {
  if (input.stop_hook_active === true) return undefined;
  if (typeof input.session_id !== "string" || input.session_id === "") return undefined;
  if (typeof input.last_assistant_message === "string") {
    const outcome = parseFinalText(input.last_assistant_message).outcome;
    if (outcome === "gate" || outcome === "done" || outcome === "blocked") return undefined;
  }

  const from = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
  if (!existsSync(join(repoRoot(from), ".hikyaku.config"))) return undefined;
  if (from !== process.cwd()) process.chdir(from);

  const config = loadConfig();
  const records = existsSync(cyclesPath(config.hikyakuRoot)) ? loadCycles(config.hikyakuRoot) : [];
  const position = locateSession(config.hikyakuRoot, records, input.session_id);
  if (position === undefined) return undefined;

  const { opened, directive } = directiveOf(position.unit);
  if (!CONTINUING.includes(directive.kind)) return undefined;

  const where = `${directive.skill} ${directive.unit}${directive.cycle === null ? "" : ` ${directive.cycle}`}`;
  return [
    `Hikyaku の手順がまだ途中です（${where}: 次は ${directive.kind} ${directive.step ?? ""}「${directive.title ?? ""}」）。`,
    "次の1手を確かめて、続けてください:",
    `  ${nextCommand(opened)}`,
    "ユーザーへの問いで止まるところ、またはユーザーが中断や別の作業を指示したところなら、そのまま終えてかまいません（止めるのは1回だけです）。",
    "非対話で起動されている（conductor の子）なら、規約どおり最後にブロックを1つ出して終えてください。",
  ].join("\n");
}
