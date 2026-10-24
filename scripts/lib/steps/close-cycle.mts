/**
 * close-cycle（CLOSE フェーズ）のステップ。
 *
 * 並びは SKILL.md の Step 1〜7 と同じ。Step 0（設定・ブランチ・完了の確認・セッション名）は
 * セッションごとにやり直す準備なので、ここには含めず SKILL.md に置く。
 *
 * 作業単位はサイクルのディレクトリの直下にする（progress.jsonl は cycles/{cycle}/progress.jsonl）。
 *
 *   - CLOSE の成果物はサイクルの外（永続ドキュメント・instructions.md・cycles.md）にあり、
 *     planning/ や build-NN/ のように「このフェーズの成果物を置くディレクトリ」が無い
 *   - close/ は retrospective.md の置き場で、振り返りが skip なら作られない。振り返りの
 *     有無で記録の置き場が変わらないよう、close/ ではなく直下に置く
 *   - CLOSE はサイクルの最後のフェーズで、ほかのフェーズが直下に記録を置くことはない。
 *     置いたとしても、記録はスキル名で分かれるので混ざらない
 */

import type { SkillSteps, StepContext } from "./engine.mts";

/** cycle close で closed / abandoned になったか */
function cycleClosed(ctx: StepContext): boolean {
  return ctx.cycle !== undefined && ctx.cycle.record.status !== "active";
}

export const CLOSE_CYCLE_STEPS: SkillSteps = {
  skill: "close-cycle",
  unit: (phase) => (phase === "close" ? "" : undefined),
  steps: [
    {
      // 昇格より先に行う。後に回すと、この回の振り返りで出た学びを昇格させる機会が無くなる
      id: "retrospective",
      kind: "call",
      title: "振り返り",
      call: "retrospective",
      when: (ctx) => ctx.config.reviews.retrospective !== "skip",
      reason: () => "サイクル終了の振り返り。昇格の素材にするため、昇格より先に行う",
    },
    { id: "collect", kind: "run", title: "素材の収集（昇格候補の抽出を Agent に委任）" },
    { id: "organize", kind: "run", title: "昇格候補の整理" },
    // 昇格候補は会話の中で提示するのでファイルに結びつけない。profile の管轄外で、常に行う
    { id: "G10", kind: "gate", title: "昇格の承認", ask: "G10" },
    { id: "write", kind: "run", title: "永続ドキュメントへの書き込みと検証" },
    { id: "close", kind: "run", title: "サイクルの終了（cycle close）", evidence: cycleClosed },
    { id: "pr", kind: "run", title: "PR の作成" },
  ],
};
