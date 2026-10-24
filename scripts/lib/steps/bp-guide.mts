/**
 * bp-guide（BP 基準表の運用）のステップ。
 *
 * step に乗せるのは、前提の確認（config・bp guide の表示）より後の手順。show で
 * 表示だけして終えるときは step に記録しない。
 *
 * 作業単位は {HIKYAKU_ROOT}/bp-guide/ で、progress.jsonl もそこに置く。基準表を
 * 生成する前はディレクトリが無いが、最初の報告で作られる。
 *
 * bp-guide は init と違い、ワークスペースの寿命のあいだに何度も回す。前の回の記録は
 * PR と一緒にデフォルトブランチへ入るので、次の回の step next は done を返す。
 * そのときは step restart で区切って新しい回を始める（前の回の記録は残る）。
 *
 * produces は置かない。rules.toml / README.md / cases.toml は前の回や init が作っているので、
 * 成果物として宣言すると「記録が欠けている」と読まれて止まる。同じ理由で generate は
 * 基準表の有無で手順から外さず、あれば何もせずに done を報告させる（生成した直後に
 * 手順から外れると、生成の報告を受け付けなくなるため）。
 */

import { RESTART } from "../progress.mts";
import type { SkillSteps, StepContext } from "./engine.mts";

/** 今回の回（最後の step restart より後）の、そのステップの最後の記録 */
function latestThisRound(ctx: StepContext, step: string): string | undefined {
  let latest: string | undefined;
  for (const event of ctx.events) {
    if (event.skill !== "bp-guide") continue;
    if (event.result === RESTART) latest = undefined;
    else if (event.step === step) latest = event.result;
  }
  return latest;
}

function collected(ctx: StepContext): boolean {
  return latestThisRound(ctx, "collect") !== "skipped";
}

function proposed(ctx: StepContext): boolean {
  return collected(ctx) && latestThisRound(ctx, "propose") !== "skipped";
}

export const BP_GUIDE_STEPS: SkillSteps = {
  skill: "bp-guide",
  unit: (phase) => (phase === "bp-guide" ? "bp-guide" : undefined),
  steps: [
    { id: "start", kind: "run", title: "回の開始とブランチの確認" },
    { id: "generate", kind: "run", title: "基準表（bp-guide/）の生成（あれば何もしない）" },
    { id: "collect", kind: "run", title: "見積もりと実績の収集", skippable: true },
    { id: "propose", kind: "run", title: "変更案の作成", when: collected, skippable: true },
    {
      id: "approve",
      kind: "gate",
      title: "rules.toml / cases.toml の変更の承認",
      when: proposed,
      binds: ["rules.toml", "cases.toml"],
    },
    { id: "render", kind: "run", title: "README の表の再生成と検証", when: proposed },
    { id: "pr", kind: "run", title: "コミットと PR" },
  ],
};
