/**
 * token-guide（予測ピークの見積もりのガイドの校正）のステップ。
 *
 * step に乗せるのは、前提の確認（config・tokens guide の表示）より後の手順。show で
 * 表示だけして終えるときは step に記録しない。
 *
 * 作業単位は {HIKYAKU_ROOT}/token-guide/ で、progress.jsonl もそこに置く。ガイドを
 * 作る前はディレクトリが無いが、最初の報告で作られる。
 *
 * ガイドを書き換えるのはこのスキルだけ。人が呼ぶほか、close-cycle がサイクルの乖離を見て
 * 自動で呼ぶ（--round auto。承認のゲートを置かず、採否は PR のマージで決める）。前の回の記録は
 * PR と一緒にデフォルトブランチへ入るので、次の回の step next は done を返す。
 * そのときは step restart で区切って新しい回を始める（前の回の記録は残る）。
 *
 * 完了の条件は produces ではなく requires で書く。guide.md は前の回が
 * 作っているので、produces にすると「記録が欠けている」と読まれて止まる。
 *
 * write と pr では、ガイドの版の宣言が本文と合っていることを確かめる（本文を変えたのに
 * tokens stamp で版を上げていない状態を PR にしない）。requires は完了したあとも毎回
 * 確かめるので、write のあとに本文を直して stamp を忘れれば現在地は前に戻る。
 */

import { existsSync } from "node:fs";
import { projectGuidePath, TOKEN_GUIDE_DIR, TOKEN_GUIDE_FILE, tokenGuideProblems } from "../tokens.mts";
import { currentEvents, currentRound, type SkillSteps, type StepContext } from "./engine.mts";

/**
 * close-cycle が、サイクルの乖離を見て呼んだ回。変更の採否は PR のマージで決めるので、
 * 承認のゲートを置かない（根拠は PR の本文に載せる）
 */
const AUTO_ROUND = "auto";

function auto(ctx: StepContext): boolean {
  return currentRound(TOKEN_GUIDE_STEPS, ctx.events) === AUTO_ROUND;
}

/** 今回の回（最後の step restart より後）の、そのステップの最後の記録 */
function latestThisRound(ctx: StepContext, step: string): string | undefined {
  const events = currentEvents(TOKEN_GUIDE_STEPS, ctx.events).filter((event) => event.skill === "token-guide" && event.step === step);
  return events[events.length - 1]?.result;
}

/** ガイドの版の宣言が本文と合っているか（validate の token-guide の検査と同じ）。無いのは問題にしない */
export function guideConsistent(ctx: StepContext): string | undefined {
  const problems = tokenGuideProblems(ctx.config.hikyakuRoot);
  if (problems.length === 0) return undefined;
  return problems.map((problem) => `${problem.scope}: ${problem.message}`).join(" / ");
}

/** 変更を書き込んだあと: ガイドがあり、版の宣言が本文と合っているか */
function guideWritten(ctx: StepContext): string | undefined {
  if (!existsSync(projectGuidePath(ctx.config.hikyakuRoot))) {
    return `${TOKEN_GUIDE_DIR}/${TOKEN_GUIDE_FILE} がありません（hikyaku tokens stamp で標準のガイドから作ってから補正してください）`;
  }
  return guideConsistent(ctx);
}

function collected(ctx: StepContext): boolean {
  return latestThisRound(ctx, "collect") !== "skipped";
}

function proposed(ctx: StepContext): boolean {
  return collected(ctx) && latestThisRound(ctx, "propose") !== "skipped";
}

export const TOKEN_GUIDE_STEPS: SkillSteps = {
  skill: "token-guide",
  unit: (phase) => (phase === "token-guide" ? TOKEN_GUIDE_DIR : undefined),
  rounds: [AUTO_ROUND],
  steps: [
    { id: "start", kind: "run", title: "回の開始とブランチの確認" },
    { id: "collect", kind: "run", title: "予測と実測の収集", skippable: true },
    { id: "propose", kind: "run", title: "ガイドの変更案の作成", when: collected, skippable: true },
    { id: "approve", kind: "gate", title: "ガイドの変更の承認", when: (ctx) => proposed(ctx) && !auto(ctx) },
    { id: "write", kind: "run", title: "ガイドの書き込みと版の更新", when: proposed, requires: guideWritten },
    { id: "pr", kind: "run", title: "コミットと PR", recordsPr: true, requires: guideConsistent },
  ],
};
