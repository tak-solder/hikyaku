/** PR の作成と公開を分け、Ready とレビュアーの処理を終えるまで手順を完了にしない。 */
import { type StepContext, type StepDefinition } from "./engine.mts";

export function publicationStep(when?: (ctx: StepContext) => boolean): StepDefinition {
  return {
    id: "publish",
    kind: "run",
    title: "PR の公開とレビュアーの依頼",
    ...(when === undefined ? {} : { when }),
    args: (ctx) => {
      const skill = ctx.unit.startsWith("build-") ? "builder" : ctx.unit === "plan" ? "planner" : ctx.unit === "close" ? "close-cycle" : "architect";
      const pr = ctx.events.findLast((e) => e.skill === skill && e.step === "pr" && e.result === "done")?.pr;
      return { phase: ctx.unit, cycle: ctx.cycle?.name, pr };
    },
  };
}
