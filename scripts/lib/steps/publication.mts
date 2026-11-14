/** PR の作成と公開を分け、Ready とレビュアーの処理を終えるまで手順を完了にしない。 */
import { currentEvents, type StepContext, type StepDefinition } from "./engine.mts";

export function publicationStep(skill: string, when?: (ctx: StepContext) => boolean): StepDefinition {
  return {
    id: "publish",
    kind: "run",
    title: "PR の公開とレビュアーの依頼",
    ...(when === undefined ? {} : { when }),
    args: (ctx) => {
      const pr = currentEvents({ skill }, ctx.events).findLast((e) => e.skill === skill && e.step === "pr" && e.result === "done")?.pr;
      return { phase: ctx.unit, cycle: ctx.cycle?.name, pr };
    },
  };
}
