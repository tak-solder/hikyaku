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
 * 完了の条件は produces ではなく requires で書く。rules.toml / README.md / cases.toml は前の回や
 * init が作っているので、produces にすると「記録が欠けている」と読まれて止まる。同じ理由で generate は
 * 基準表の有無で手順から外さず、あれば何もせずに done を報告させる（生成した直後に
 * 手順から外れると、生成の報告を受け付けなくなるため）。
 *
 * render と pr では、3ファイルが揃っていることと validate の検査を確かめる（cases.toml が無いと
 * 期待値の検査が既定のケースに落ちるため、揃っていることは別に見る）。requires は完了したあとも
 * 毎回確かめるので、render のあとに基準表を壊せば現在地は前に戻る。pr にも置くのは、変更案を
 * 作らない回（render が無い）でも検査を通らない基準表を PR にしないため。承認は自動では
 * 取り直させず、rules.toml / cases.toml の変更は Git の履歴とレビューで追う。
 *
 * BP の算出方式（rules.toml の段階表と cases.toml の期待値）は、#68 で v3 の見積もり方を決めるまでの
 * 暫定のもの。方式を変えるときは、この手順・build-manager の estimate・分割のしきい値を合わせて変える。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { BP_CASES_FILE, BP_README_FILE, BP_RULES_FILE, bpGuideProblems } from "../bp.mts";
import { currentEvents, type SkillSteps, type StepContext } from "./engine.mts";

/** 今回の回（最後の step restart より後）の、そのステップの最後の記録 */
function latestThisRound(ctx: StepContext, step: string): string | undefined {
  const events = currentEvents(BP_GUIDE_STEPS, ctx.events).filter((event) => event.skill === "bp-guide" && event.step === step);
  return events[events.length - 1]?.result;
}

/** 基準表の3ファイルが揃っているか */
function guideMissing(ctx: StepContext): string | undefined {
  const missing = [BP_RULES_FILE, BP_README_FILE, BP_CASES_FILE].filter((name) => !existsSync(join(ctx.unitDirectory, name)));
  return missing.length === 0 ? undefined : `bp-guide/ に ${missing.join(", ")} がありません`;
}

/** 3ファイルが揃い、README の表・期待値・rules.toml の構文が validate の bp-guide の検査を通るか */
function guideReady(ctx: StepContext): string | undefined {
  return guideMissing(ctx) ?? guideInvalid(ctx);
}

/** README の表・期待値・rules.toml の構文が揃っているか（validate の bp-guide の検査と同じ） */
function guideInvalid(ctx: StepContext): string | undefined {
  const problems = bpGuideProblems(ctx.config.hikyakuRoot);
  if (problems.length === 0) return undefined;
  return problems.map((problem) => `${problem.scope}: ${problem.message}`).join(" / ");
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
    { id: "generate", kind: "run", title: "基準表（bp-guide/）の生成（あれば何もしない）", requires: guideMissing },
    { id: "collect", kind: "run", title: "見積もりと実績の収集", skippable: true },
    { id: "propose", kind: "run", title: "変更案の作成", when: collected, skippable: true },
    {
      id: "approve",
      kind: "gate",
      title: "rules.toml / cases.toml の変更の承認",
      when: proposed,
    },
    { id: "render", kind: "run", title: "README の表の再生成と検証", when: proposed, requires: guideReady },
    { id: "pr", kind: "run", title: "コミットと PR", recordsPr: true, requires: guideReady },
  ],
};
